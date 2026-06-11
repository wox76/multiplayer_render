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
const MAP_SIZE = 2500;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game State
const players = {};
let asteroids = [];
let items = [];
const projectiles = [];
const bombs = [];

let projectileIdCounter = 0;
let asteroidIdCounter = 0;
let itemIdCounter = 0;

// Game constants
const PLAYER_RADIUS = 22;
const BULLET_SPEED = 16;
const BULLET_RADIUS = 5;
const BULLET_COOLDOWN = 220; // ms
const MAX_HEALTH = 100;
const MAX_FUEL = 100;

const ROTATION_SPEED = 0.065; // radians per tick
const ACCELERATION = 0.22;
const FRICTION = 0.985;
const MAX_SPEED = 10;
const FUEL_DECAY = 0.25; // fuel consumed per tick when thrusting

let countdownState = {
  active: false,
  count: 0,
  lastTick: 0
};

// Helper for spawn points
function getRandomSpawn() {
  const margin = 120;
  return {
    x: margin + Math.random() * (MAP_SIZE - margin * 2),
    y: margin + Math.random() * (MAP_SIZE - margin * 2)
  };
}

// Spawns initial asteroid belt in the center area of the map
function spawnAsteroidBelt(count = 7) {
  asteroids = [];
  const centerX = MAP_SIZE / 2;
  const centerY = MAP_SIZE / 2;
  const spawnRadius = 500; // spawn within 500px from center

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * spawnRadius;
    const x = centerX + Math.cos(angle) * dist;
    const y = centerY + Math.sin(angle) * dist;

    spawnAsteroid(x, y, 3); // Size 3 is large
  }
}

function spawnAsteroid(x, y, size) {
  let radius = 55;
  if (size === 2) radius = 30;
  if (size === 1) radius = 15;

  const angle = Math.random() * Math.PI * 2;
  const speed = Math.random() * 2 + (4 - size); // smaller ones move faster

  asteroids.push({
    id: asteroidIdCounter++,
    x: x,
    y: y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    size: size,
    radius: radius,
    angle: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.04
  });
}

// Spawns fuel canisters randomly
function maintainFuelCanisters() {
  const maxFuelItems = 12;
  const currentFuelCount = items.filter(item => item.type === 'fuel').length;

  if (currentFuelCount < maxFuelItems && Math.random() < 0.03) {
    const pos = getRandomSpawn();
    items.push({
      id: itemIdCounter++,
      x: pos.x,
      y: pos.y,
      type: 'fuel',
      radius: 24
    });
  }
}

// Spawn random items when small asteroids break
function rollItemDrop(x, y) {
  if (Math.random() < 0.45) { // 45% drop rate
    const rand = Math.random();
    let type = 'pw_shield';
    if (rand < 0.33) {
      type = 'pw_shield';
    } else if (rand < 0.66) {
      type = 'pw_triple';
    } else {
      type = 'pw_bomb';
    }

    items.push({
      id: itemIdCounter++,
      x: x,
      y: y,
      type: type,
      radius: 24
    });
  }
}

spawnAsteroidBelt();

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

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
      angle: -Math.PI / 2, // point up initially
      health: MAX_HEALTH,
      fuel: MAX_FUEL,
      score: 0,
      color: Math.floor(Math.random() * 360),
      shieldUntil: Date.now() + 2000, // 2 seconds spawn shield
      tripleShotUntil: 0,
      bombsCount: 0,
      inputs: { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false },
      lastShot: 0
    };

    socket.emit('init', {
      mapSize: MAP_SIZE,
      playerId: socket.id
    });
  });

  socket.on('playerInput', (inputs) => {
    if (players[socket.id] && !countdownState.active) {
      players[socket.id].inputs = inputs;
    }
  });

  socket.on('shoot', () => {
    const player = players[socket.id];
    if (!player || player.health <= 0 || countdownState.active) return;

    const now = Date.now();
    if (now - player.lastShot >= BULLET_COOLDOWN) {
      player.lastShot = now;

      const hasTriple = player.tripleShotUntil > now;
      const angles = hasTriple ? [player.angle - 0.25, player.angle, player.angle + 0.25] : [player.angle];

      angles.forEach(ang => {
        const spawnX = player.x + Math.cos(ang) * PLAYER_RADIUS;
        const spawnY = player.y + Math.sin(ang) * PLAYER_RADIUS;

        projectiles.push({
          id: projectileIdCounter++,
          ownerId: socket.id,
          x: spawnX,
          y: spawnY,
          vx: Math.cos(ang) * BULLET_SPEED,
          vy: Math.sin(ang) * BULLET_SPEED,
          color: player.color,
          distanceTraveled: 0,
          maxDistance: 1100
        });
      });

      io.emit('playerShot', {
        x: player.x + Math.cos(player.angle) * PLAYER_RADIUS,
        y: player.y + Math.sin(player.angle) * PLAYER_RADIUS,
        angle: player.angle,
        color: player.color,
        triple: hasTriple
      });
    }
  });

  // Handle bomb drop request
  socket.on('placeBomb', () => {
    const player = players[socket.id];
    if (!player || player.health <= 0 || countdownState.active) return;

    if (player.bombsCount > 0) {
      player.bombsCount--;

      bombs.push({
        id: projectileIdCounter++, // share id space
        ownerId: socket.id,
        x: player.x,
        y: player.y,
        vx: player.vx * 0.4, // drift slightly with player's inertia
        vy: player.vy * 0.4,
        color: player.color,
        timer: 120, // 2 seconds at 60fps
        radius: 12
      });

      io.emit('bombPlaced', {
        x: player.x,
        y: player.y,
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
  const now = Date.now();

  // Handle Countdown timer logic
  if (countdownState.active) {
    if (now - countdownState.lastTick >= 1000) {
      countdownState.count--;
      countdownState.lastTick = now;

      if (countdownState.count <= 0) {
        // RESET GAME STATE
        countdownState.active = false;
        
        // Reset scores
        for (const id in players) {
          const p = players[id];
          p.score = 0;
          p.health = MAX_HEALTH;
          p.fuel = MAX_FUEL;
          p.vx = 0;
          p.vy = 0;
          p.bombsCount = 0;
          p.tripleShotUntil = 0;
          p.shieldUntil = Date.now() + 2000; // 2s spawn shield
          const spawn = getRandomSpawn();
          p.x = spawn.x;
          p.y = spawn.y;
        }

        // Clean arrays
        projectiles.length = 0;
        bombs.length = 0;
        items.length = 0;
        
        // Respawn asteroids
        spawnAsteroidBelt();
        io.emit('gameResetComplete');
      } else {
        io.emit('countdownTick', countdownState.count);
      }
    }
  }

  // 1. Update Players (Asteroids-style physics)
  for (const id in players) {
    const player = players[id];
    if (player.health <= 0) continue;

    if (countdownState.active) {
      // Freeze movement during countdown
      player.vx = 0;
      player.vy = 0;
      continue;
    }

    // Rotation controls (ArrowLeft/ArrowRight)
    if (player.inputs.ArrowLeft) {
      player.angle -= ROTATION_SPEED;
    }
    if (player.inputs.ArrowRight) {
      player.angle += ROTATION_SPEED;
    }

    // Thrust acceleration (ArrowUp)
    if (player.inputs.ArrowUp && player.fuel > 0) {
      player.vx += Math.cos(player.angle) * ACCELERATION;
      player.vy += Math.sin(player.angle) * ACCELERATION;
      player.fuel -= FUEL_DECAY;
      if (player.fuel < 0) player.fuel = 0;
    }

    // Brake / deceleration (ArrowDown)
    if (player.inputs.ArrowDown) {
      player.vx *= 0.90;
      player.vy *= 0.90;
    } else {
      // Natural drifting friction
      player.vx *= FRICTION;
      player.vy *= FRICTION;
    }

    // Cap maximum speed
    const speed = Math.hypot(player.vx, player.vy);
    if (speed > MAX_SPEED) {
      player.vx = (player.vx / speed) * MAX_SPEED;
      player.vy = (player.vy / speed) * MAX_SPEED;
    }

    player.x += player.vx;
    player.y += player.vy;

    // Wrap around boundaries
    player.x = (player.x % MAP_SIZE + MAP_SIZE) % MAP_SIZE;
    player.y = (player.y % MAP_SIZE + MAP_SIZE) % MAP_SIZE;
  }

  // 2. Maintain collectibles
  maintainFuelCanisters();

  // 3. Update Asteroids
  if (asteroids.length === 0 && !countdownState.active) {
    // Wave clear! Spawn a new batch after delay
    setTimeout(() => {
      if (asteroids.length === 0 && !countdownState.active) {
        spawnAsteroidBelt(8);
      }
    }, 5000);
  }

  asteroids.forEach(ast => {
    ast.x += ast.vx;
    ast.y += ast.vy;
    ast.angle += ast.rotSpeed;

    // Wrap around map
    ast.x = (ast.x % MAP_SIZE + MAP_SIZE) % MAP_SIZE;
    ast.y = (ast.y % MAP_SIZE + MAP_SIZE) % MAP_SIZE;
  });

  // Check Player-Asteroid Collisions
  for (const pid in players) {
    const player = players[pid];
    if (player.health <= 0 || countdownState.active) continue;

    for (let j = asteroids.length - 1; j >= 0; j--) {
      const ast = asteroids[j];
      const dist = Math.hypot(player.x - ast.x, player.y - ast.y);
      if (dist < PLAYER_RADIUS + ast.radius) {
        const isShielded = player.shieldUntil > now;
        
        if (!isShielded) {
          // Player dies instantly!
          player.health = 0;
          handlePlayerDeath(player.id, 'asteroid');
          
          // Split/destroy asteroid as well
          if (ast.size > 1) {
            spawnAsteroid(ast.x, ast.y, ast.size - 1);
            spawnAsteroid(ast.x, ast.y, ast.size - 1);
          } else {
            rollItemDrop(ast.x, ast.y);
          }
          
          io.emit('hit', {
            x: player.x,
            y: player.y,
            color: 280,
            playerId: 'asteroid',
            damage: 0
          });
          
          asteroids.splice(j, 1);
          break; // Break asteroid loop for this player
        } else {
          // If shielded, bounce player back slightly and push asteroid away
          const angle = Math.atan2(player.y - ast.y, player.x - ast.x);
          player.vx = Math.cos(angle) * 7;
          player.vy = Math.sin(angle) * 7;
          
          // Push asteroid in opposite direction
          ast.vx = -Math.cos(angle) * (5 - ast.size);
          ast.vy = -Math.sin(angle) * (5 - ast.size);
        }
      }
    }
  }

  // 4. Update Bombs
  for (let i = bombs.length - 1; i >= 0; i--) {
    const bomb = bombs[i];
    bomb.x += bomb.vx;
    bomb.y += bomb.vy;
    bomb.vx *= 0.98;
    bomb.vy *= 0.98;
    bomb.timer--;

    if (bomb.timer <= 0) {
      // DETONATION!
      const radius = 180;
      io.emit('bombExploded', {
        x: bomb.x,
        y: bomb.y,
        radius: radius,
        color: bomb.color
      });

      // Hit calculations for players
      for (const pid in players) {
        const player = players[pid];
        if (player.health <= 0) continue;

        const dist = Math.hypot(player.x - bomb.x, player.y - bomb.y);
        if (dist < radius) {
          const isShielded = player.shieldUntil > now;
          if (!isShielded) {
            // Damage scaling based on proximity
            const dmg = Math.floor(65 * (1 - dist / radius));
            player.health -= Math.max(10, dmg);

            io.emit('hit', {
              x: player.x,
              y: player.y,
              color: player.color,
              playerId: player.id,
              damage: dmg
            });

            // Check death
            if (player.health <= 0) {
              player.health = 0;
              handlePlayerDeath(player.id, bomb.ownerId);
            }
          }
        }
      }

      // Hit calculations for Asteroids
      for (let j = asteroids.length - 1; j >= 0; j--) {
        const ast = asteroids[j];
        const dist = Math.hypot(ast.x - bomb.x, ast.y - bomb.y);
        if (dist < radius + ast.radius) {
          // Break/Split Asteroid
          if (ast.size > 1) {
            spawnAsteroid(ast.x, ast.y, ast.size - 1);
            spawnAsteroid(ast.x, ast.y, ast.size - 1);
          } else {
            rollItemDrop(ast.x, ast.y);
          }
          // Spawn explosions
          io.emit('hit', {
            x: ast.x,
            y: ast.y,
            color: 280, // explosion visual color
            playerId: 'asteroid',
            damage: 0
          });
          asteroids.splice(j, 1);
        }
      }

      bombs.splice(i, 1);
    }
  }

  // 5. Update Projectiles
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const proj = projectiles[i];
    proj.x += proj.vx;
    proj.y += proj.vy;
    proj.distanceTraveled += Math.sqrt(proj.vx * proj.vx + proj.vy * proj.vy);

    let removed = false;

    // Boundary check
    if (
      proj.x < 0 || proj.x > MAP_SIZE ||
      proj.y < 0 || proj.y > MAP_SIZE ||
      proj.distanceTraveled >= proj.maxDistance
    ) {
      projectiles.splice(i, 1);
      continue;
    }

    // Check hit on Asteroids
    for (let j = asteroids.length - 1; j >= 0; j--) {
      const ast = asteroids[j];
      const dist = Math.hypot(ast.x - proj.x, ast.y - proj.y);
      if (dist < ast.radius + BULLET_RADIUS) {
        // Split asteroid
        if (ast.size > 1) {
          spawnAsteroid(ast.x, ast.y, ast.size - 1);
          spawnAsteroid(ast.x, ast.y, ast.size - 1);
        } else {
          rollItemDrop(ast.x, ast.y);
        }

        io.emit('hit', {
          x: proj.x,
          y: proj.y,
          color: 280,
          playerId: 'asteroid',
          damage: 0
        });

        asteroids.splice(j, 1);
        projectiles.splice(i, 1);
        removed = true;
        break;
      }
    }

    if (removed) continue;

    // Check hit on Players
    for (const pid in players) {
      const player = players[pid];
      if (player.health <= 0 || player.id === proj.ownerId) continue;

      const dist = Math.hypot(player.x - proj.x, player.y - proj.y);
      if (dist < PLAYER_RADIUS + BULLET_RADIUS) {
        const isShielded = player.shieldUntil > now;
        
        if (!isShielded) {
          player.health -= 20;

          io.emit('hit', {
            x: proj.x,
            y: proj.y,
            color: player.color,
            playerId: player.id,
            damage: 20
          });

          if (player.health <= 0) {
            player.health = 0;
            handlePlayerDeath(player.id, proj.ownerId);
          }
        }

        projectiles.splice(i, 1);
        removed = true;
        break;
      }
    }
  }

  // 6. Check Player-Item Collisions
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    for (const pid in players) {
      const player = players[pid];
      if (player.health <= 0) continue;

      const dist = Math.hypot(player.x - item.x, player.y - item.y);
      if (dist < PLAYER_RADIUS + item.radius) {
        // Collect!
        if (item.type === 'fuel') {
          player.fuel = MAX_FUEL;
        } else if (item.type === 'pw_shield') {
          player.shieldUntil = now + 10000; // 10s active
        } else if (item.type === 'pw_triple') {
          player.tripleShotUntil = now + 15000; // 15s triple
        } else if (item.type === 'pw_bomb') {
          player.bombsCount += 3;
        }

        io.emit('itemCollected', {
          id: item.id,
          playerId: player.id,
          type: item.type
        });

        items.splice(i, 1);
        break;
      }
    }
  }

  // Helper function for player deaths
  function handlePlayerDeath(victimId, killerId) {
    const victim = players[victimId];
    const killer = players[killerId];

    if (killer && killer.id !== victimId) {
      killer.score += 2; // Extra points for player vaporizations!
      checkScoreReset(killer.id);
    }

    io.emit('playerKilled', {
      victimId: victimId,
      victimName: victim.name,
      killerId: killerId || 'environment',
      killerName: killer ? killer.name : 'Asteroid'
    });

    setTimeout(() => {
      if (players[victimId]) {
        const spawn = getRandomSpawn();
        players[victimId].x = spawn.x;
        players[victimId].y = spawn.y;
        players[victimId].health = MAX_HEALTH;
        players[victimId].fuel = MAX_FUEL;
        players[victimId].vx = 0;
        players[victimId].vy = 0;
        players[victimId].shieldUntil = Date.now() + 2000; // 2s spawn shield
        io.emit('playerRespawned', {
          id: victimId,
          x: spawn.x,
          y: spawn.y
        });
      }
    }, 2000);
  }

  // Check if a player reached 10 points
  function checkScoreReset(pid) {
    const p = players[pid];
    if (p && p.score >= 10 && !countdownState.active) {
      countdownState.active = true;
      countdownState.count = 3;
      countdownState.lastTick = now;

      // Broadcast victory / start countdown
      io.emit('gameCountdownStart', {
        winnerId: p.id,
        winnerName: p.name
      });
    }
  }

  // 7. Broadcast state
  const state = {
    players: Object.values(players).map(p => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      angle: p.angle,
      health: p.health,
      fuel: p.fuel,
      score: p.score,
      color: p.color,
      shieldActive: p.shieldUntil > now,
      tripleActive: p.tripleShotUntil > now,
      bombsCount: p.bombsCount
    })),
    projectiles: projectiles.map(p => ({
      id: p.id,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      color: p.color
    })),
    asteroids: asteroids.map(a => ({
      id: a.id,
      x: a.x,
      y: a.y,
      angle: a.angle,
      size: a.size,
      radius: a.radius
    })),
    items: items.map(it => ({
      id: it.id,
      x: it.x,
      y: it.y,
      type: it.type,
      radius: it.radius
    })),
    bombs: bombs.map(b => ({
      id: b.id,
      x: b.x,
      y: b.y,
      color: b.color,
      timer: b.timer
    })),
    countdown: countdownState.active ? countdownState.count : null
  };

  io.emit('gameState', state);
}, 1000 / 60);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
