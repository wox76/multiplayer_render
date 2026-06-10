const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const MAP_SIZE = 2500; // 2500x2500 pixels arena

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Game State
const players = {};
const projectiles = [];
let projectileIdCounter = 0;

const PLAYER_SPEED = 6;
const PLAYER_RADIUS = 22;
const BULLET_SPEED = 16;
const BULLET_RADIUS = 5;
const BULLET_COOLDOWN = 220; // ms between shots
const MAX_HEALTH = 100;

// Helper to get random spawn point
function getRandomSpawn() {
  const borderMargin = 100;
  return {
    x: borderMargin + Math.random() * (MAP_SIZE - borderMargin * 2),
    y: borderMargin + Math.random() * (MAP_SIZE - borderMargin * 2)
  };
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Handle joining game
  socket.on('joinGame', (data) => {
    const name = (data.name || 'Soldier').substring(0, 15);
    const spawn = getRandomSpawn();
    
    players[socket.id] = {
      id: socket.id,
      name: name,
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      angle: 0,
      health: MAX_HEALTH,
      score: 0,
      color: Math.floor(Math.random() * 360), // Random HSL hue
      inputs: { w: false, a: false, s: false, d: false },
      lastShot: 0
    };

    socket.emit('init', {
      mapSize: MAP_SIZE,
      playerId: socket.id
    });
  });

  // Handle player inputs
  socket.on('playerInput', (inputs) => {
    if (players[socket.id]) {
      players[socket.id].inputs = inputs;
    }
  });

  socket.on('playerAngle', (angle) => {
    if (players[socket.id]) {
      players[socket.id].angle = angle;
    }
  });

  // Handle shooting trigger
  socket.on('shoot', () => {
    const player = players[socket.id];
    if (!player || player.health <= 0) return;

    const now = Date.now();
    if (now - player.lastShot >= BULLET_COOLDOWN) {
      player.lastShot = now;
      
      // Calculate front tip of the player to spawn projectile
      const spawnX = player.x + Math.cos(player.angle) * PLAYER_RADIUS;
      const spawnY = player.y + Math.sin(player.angle) * PLAYER_RADIUS;

      projectiles.push({
        id: projectileIdCounter++,
        ownerId: socket.id,
        x: spawnX,
        y: spawnY,
        vx: Math.cos(player.angle) * BULLET_SPEED,
        vy: Math.sin(player.angle) * BULLET_SPEED,
        color: player.color,
        distanceTraveled: 0,
        maxDistance: 1200
      });

      // Broadcast shot event for sound/visual effects on clients
      io.emit('playerShot', {
        x: spawnX,
        y: spawnY,
        angle: player.angle,
        color: player.color
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    delete players[socket.id];
  });
});

// Server Game loop: 60 updates per second
setInterval(() => {
  // 1. Update Players
  for (const id in players) {
    const player = players[id];
    if (player.health <= 0) continue;

    // Movement vector
    let dx = 0;
    let dy = 0;

    if (player.inputs.w) dy -= 1;
    if (player.inputs.s) dy += 1;
    if (player.inputs.a) dx -= 1;
    if (player.inputs.d) dx += 1;

    // Normalize diagonal movement speed
    if (dx !== 0 && dy !== 0) {
      const length = Math.sqrt(dx * dx + dy * dy);
      dx /= length;
      dy /= length;
    }

    player.x += dx * PLAYER_SPEED;
    player.y += dy * PLAYER_SPEED;

    // Bound checking
    player.x = Math.max(PLAYER_RADIUS, Math.min(MAP_SIZE - PLAYER_RADIUS, player.x));
    player.y = Math.max(PLAYER_RADIUS, Math.min(MAP_SIZE - PLAYER_RADIUS, player.y));
  }

  // 2. Update Projectiles
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const proj = projectiles[i];
    proj.x += proj.vx;
    proj.y += proj.vy;
    proj.distanceTraveled += Math.sqrt(proj.vx * proj.vx + proj.vy * proj.vy);

    let removed = false;

    // Check bounds or range limit
    if (
      proj.x < 0 || proj.x > MAP_SIZE ||
      proj.y < 0 || proj.y > MAP_SIZE ||
      proj.distanceTraveled >= proj.maxDistance
    ) {
      projectiles.splice(i, 1);
      continue;
    }

    // Check hit collisions with players
    for (const pid in players) {
      const player = players[pid];
      if (player.health <= 0 || player.id === proj.ownerId) continue;

      const dist = Math.hypot(player.x - proj.x, player.y - proj.y);
      if (dist < PLAYER_RADIUS + BULLET_RADIUS) {
        // We have a hit!
        player.health -= 20;
        
        // Broadcast collision event for visual effects
        io.emit('hit', {
          x: proj.x,
          y: proj.y,
          color: player.color,
          playerId: player.id,
          damage: 20
        });

        // Check if player died
        if (player.health <= 0) {
          player.health = 0;
          
          // Give killer points
          const killer = players[proj.ownerId];
          if (killer) {
            killer.score += 1;
          }

          // Broadcast death event
          io.emit('playerKilled', {
            victimId: player.id,
            victimName: player.name,
            killerId: proj.ownerId,
            killerName: killer ? killer.name : 'Unknown'
          });

          // Respawn player after a short delay
          setTimeout(() => {
            if (players[player.id]) {
              const spawn = getRandomSpawn();
              players[player.id].x = spawn.x;
              players[player.id].y = spawn.y;
              players[player.id].health = MAX_HEALTH;
              io.emit('playerRespawned', {
                id: player.id,
                x: spawn.x,
                y: spawn.y
              });
            }
          }, 2000);
        }

        projectiles.splice(i, 1);
        removed = true;
        break;
      }
    }
  }

  // 3. Send state update to everyone
  // Send a minimized payload to conserve bandwidth
  const state = {
    players: Object.values(players).map(p => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      angle: p.angle,
      health: p.health,
      score: p.score,
      color: p.color
    })),
    projectiles: projectiles.map(p => ({
      id: p.id,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      color: p.color
    }))
  };

  io.emit('gameState', state);
}, 1000 / 60);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
