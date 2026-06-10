// Socket connection
const socket = io();

// Canvas Setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game UI Elements
const loginScreen = document.getElementById('login-screen');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username-input');
const hud = document.getElementById('hud');
const healthBar = document.getElementById('health-bar');
const scoreCounter = document.getElementById('score-counter');
const leaderboardList = document.getElementById('leaderboard-list');
const killFeed = document.getElementById('kill-feed');
const respawnScreen = document.getElementById('respawn-screen');
const hudPlayerName = document.getElementById('hud-player-name');

// Game constants and state variables
let mapSize = 2500;
let localPlayerId = null;
let currentPlayers = [];
let currentProjectiles = [];

// Camera
const camera = { x: 0, y: 0 };

// Controls state
const keys = { w: false, a: false, s: false, d: false };
let lastKeysState = { ...keys };
let mouseX = 0;
let mouseY = 0;
let currentAngle = 0;
let isSpacePressed = false;
let spaceInterval = null;

// Visual Juice
const particles = [];
let screenShake = 0;
const stars = [];

// Generate starry field background
function generateStars() {
  stars.length = 0;
  for (let i = 0; i < 600; i++) {
    stars.push({
      x: Math.random() * mapSize,
      y: Math.random() * mapSize,
      size: Math.random() * 2 + 0.5,
      color: Math.random() > 0.5 ? '#00f0ff' : '#ffffff',
      alpha: Math.random() * 0.7 + 0.3
    });
  }
}

// Particle System
class Particle {
  constructor(x, y, vx, vy, color, size, life, decay) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.size = size;
    this.maxLife = life;
    this.life = life;
    this.decay = decay;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vx *= 0.96; // drag
    this.vy *= 0.96;
    this.life -= this.decay;
  }

  draw(ctx, camX, camY) {
    const alpha = Math.max(0, this.life / this.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.shadowBlur = this.size * 2;
    ctx.shadowColor = this.color;
    ctx.beginPath();
    ctx.arc(this.x - camX, this.y - camY, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function spawnExplosion(x, y, colorHue) {
  const color = `hsl(${colorHue}, 100%, 60%)`;
  for (let i = 0; i < 20; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 6 + 2;
    particles.push(new Particle(
      x, y,
      Math.cos(angle) * speed, Math.sin(angle) * speed,
      color,
      Math.random() * 3 + 2,
      1,
      Math.random() * 0.03 + 0.015
    ));
  }
}

function spawnSparks(x, y, colorHue) {
  const color = `hsl(${colorHue}, 100%, 70%)`;
  for (let i = 0; i < 8; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 4 + 1;
    particles.push(new Particle(
      x, y,
      Math.cos(angle) * speed, Math.sin(angle) * speed,
      color,
      Math.random() * 2 + 1,
      1,
      Math.random() * 0.05 + 0.03
    ));
  }
}

function spawnThruster(x, y, angle, colorHue) {
  // Spawn thruster particles opposite of direction angle
  const oppositeAngle = angle + Math.PI + (Math.random() * 0.4 - 0.2);
  const speed = Math.random() * 3 + 3;
  const color = `hsl(${colorHue}, 100%, 60%)`;
  particles.push(new Particle(
    x, y,
    Math.cos(oppositeAngle) * speed, Math.sin(oppositeAngle) * speed,
    color,
    Math.random() * 3 + 1,
    0.6,
    0.04
  ));
}

// Handle login form submission
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const nickname = usernameInput.value.trim();
  if (nickname) {
    socket.emit('joinGame', { name: nickname });
    loginScreen.classList.add('hidden');
    hud.classList.remove('hidden');
    hudPlayerName.textContent = nickname;
    resizeCanvas();
  }
});

// Setup socket initialization
socket.on('init', (data) => {
  mapSize = data.mapSize;
  localPlayerId = data.playerId;
  generateStars();
});

// Sync server game states
socket.on('gameState', (state) => {
  currentPlayers = state.players;
  currentProjectiles = state.projectiles;

  // Find local player
  const localPlayer = currentPlayers.find(p => p.id === localPlayerId);
  if (localPlayer) {
    // Update local HUD
    healthBar.style.width = `${localPlayer.health}%`;
    scoreCounter.textContent = localPlayer.score;

    if (localPlayer.health <= 0) {
      respawnScreen.classList.remove('hidden');
    } else {
      respawnScreen.classList.add('hidden');
    }
  }

  // Update Leaderboard
  updateLeaderboard(state.players);
});

// Shot events
socket.on('playerShot', (shot) => {
  // Spark effect at the muzzle
  spawnSparks(shot.x, shot.y, shot.color);
});

// Hit events
socket.on('hit', (hit) => {
  spawnSparks(hit.x, hit.y, hit.color);
  if (hit.playerId === localPlayerId) {
    screenShake = 15; // Trigger screen shake
  }
});

// Death events
socket.on('playerKilled', (data) => {
  // Find player death position to show explosion
  const victim = currentPlayers.find(p => p.id === data.victimId);
  if (victim) {
    spawnExplosion(victim.x, victim.y, victim.color);
  }

  // Add kill feed item
  const msg = document.createElement('div');
  msg.className = 'kill-msg';
  msg.innerHTML = `<span class="killer">${data.killerName}</span> ha vaporizzato <span class="victim">${data.victimName}</span>`;
  killFeed.appendChild(msg);

  // Auto clean killfeed item
  setTimeout(() => {
    msg.remove();
  }, 5000);
});

// Leaderboard updates
function updateLeaderboard(players) {
  // Sort players by score
  const sorted = [...players].sort((a, b) => b.score - a.score).slice(0, 10);
  
  leaderboardList.innerHTML = '';
  sorted.forEach((p, index) => {
    const li = document.createElement('li');
    if (p.id === localPlayerId) {
      li.className = 'self';
    }
    
    li.innerHTML = `
      <div style="display: flex; gap: 8px; align-items: center;">
        <span style="color: var(--text-secondary); width: 15px;">${index + 1}.</span>
        <span class="player-name-lbl" style="color: hsl(${p.color}, 100%, 70%)">${p.name}</span>
      </div>
      <span class="player-score-lbl">${p.score}</span>
    `;
    leaderboardList.appendChild(li);
  });
}

// Canvas size adjust
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Inputs tracking
window.addEventListener('keydown', (e) => {
  if (loginScreen.classList.contains('hidden') === false) return; // ignore before login
  
  const key = e.key.toLowerCase();
  if (['w', 'a', 's', 'd'].includes(key)) {
    keys[key] = true;
    sendInputsIfNeeded();
  }

  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    if (!isSpacePressed) {
      isSpacePressed = true;
      socket.emit('shoot');
      // Set up repeated shooting while holding Space
      spaceInterval = setInterval(() => {
        socket.emit('shoot');
      }, 100);
    }
  }
});

window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (['w', 'a', 's', 'd'].includes(key)) {
    keys[key] = false;
    sendInputsIfNeeded();
  }

  if (e.key === ' ' || e.code === 'Space') {
    isSpacePressed = false;
    if (spaceInterval) {
      clearInterval(spaceInterval);
      spaceInterval = null;
    }
  }
});

function sendInputsIfNeeded() {
  // Only send if changes occurred
  if (
    keys.w !== lastKeysState.w ||
    keys.a !== lastKeysState.a ||
    keys.s !== lastKeysState.s ||
    keys.d !== lastKeysState.d
  ) {
    socket.emit('playerInput', keys);
    lastKeysState = { ...keys };
  }
}

// Track mouse position and send target angle to server
window.addEventListener('mousemove', (e) => {
  if (!localPlayerId) return;
  
  mouseX = e.clientX;
  mouseY = e.clientY;

  // Target angle is calculated from center of canvas (the player) to the mouse cursor
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  
  const angle = Math.atan2(mouseY - centerY, mouseX - centerX);
  if (Math.abs(angle - currentAngle) > 0.05) {
    currentAngle = angle;
    socket.emit('playerAngle', angle);
  }
});

// Render/Game Loop
function render() {
  requestAnimationFrame(render);

  // Clear Canvas with sleek cosmic background fade
  ctx.fillStyle = '#070712';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Find local player coordinates
  const localPlayer = currentPlayers.find(p => p.id === localPlayerId);
  
  if (localPlayer) {
    // Smooth camera scroll following local player
    camera.x = localPlayer.x - canvas.width / 2;
    camera.y = localPlayer.y - canvas.height / 2;
  }

  // Handle Screen Shake
  if (screenShake > 0.1) {
    const dx = (Math.random() - 0.5) * screenShake;
    const dy = (Math.random() - 0.5) * screenShake;
    ctx.translate(dx, dy);
    screenShake *= 0.9; // decay
  }

  // 1. Draw starfield
  stars.forEach(star => {
    // Parallax scrolling
    let relativeX = star.x - camera.x * 0.4;
    let relativeY = star.y - camera.y * 0.4;

    // Wrap stars around map to keep background infinite
    relativeX = (relativeX % mapSize + mapSize) % mapSize;
    relativeY = (relativeY % mapSize + mapSize) % mapSize;

    // Skip drawing if outside screen bounds
    if (relativeX < 0 || relativeX > canvas.width || relativeY < 0 || relativeY > canvas.height) return;

    ctx.fillStyle = star.color;
    ctx.globalAlpha = star.alpha;
    ctx.fillRect(relativeX, relativeY, star.size, star.size);
  });
  ctx.globalAlpha = 1.0;

  // 2. Draw Arena Grid Borders
  ctx.save();
  ctx.strokeStyle = 'rgba(189, 0, 255, 0.15)';
  ctx.lineWidth = 1;
  const gridSize = 100;
  const startX = Math.floor(camera.x / gridSize) * gridSize;
  const startY = Math.floor(camera.y / gridSize) * gridSize;
  
  for (let x = startX; x < startX + canvas.width + gridSize; x += gridSize) {
    if (x >= 0 && x <= mapSize) {
      ctx.beginPath();
      ctx.moveTo(x - camera.x, 0 - camera.y);
      ctx.lineTo(x - camera.x, mapSize - camera.y);
      ctx.stroke();
    }
  }
  for (let y = startY; y < startY + canvas.height + gridSize; y += gridSize) {
    if (y >= 0 && y <= mapSize) {
      ctx.beginPath();
      ctx.moveTo(0 - camera.x, y - camera.y);
      ctx.lineTo(mapSize - camera.x, y - camera.y);
      ctx.stroke();
    }
  }
  
  // Arena Border Walls
  ctx.strokeStyle = '#bd00ff';
  ctx.lineWidth = 6;
  ctx.shadowBlur = 15;
  ctx.shadowColor = '#bd00ff';
  ctx.strokeRect(-camera.x, -camera.y, mapSize, mapSize);
  ctx.restore();

  // 3. Update & Draw Local Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.update();
    if (p.life <= 0) {
      particles.splice(i, 1);
    } else {
      p.draw(ctx, camera.x, camera.y);
    }
  }

  // 4. Draw Projectiles
  currentProjectiles.forEach(proj => {
    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = `hsl(${proj.color}, 100%, 50%)`;
    ctx.strokeStyle = `hsl(${proj.color}, 100%, 75%)`;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';

    ctx.beginPath();
    // Draw trail
    const length = 20;
    const speed = Math.hypot(proj.vx, proj.vy);
    const trailX = proj.x - (proj.vx / speed) * length;
    const trailY = proj.y - (proj.vy / speed) * length;

    ctx.moveTo(proj.x - camera.x, proj.y - camera.y);
    ctx.lineTo(trailX - camera.x, trailY - camera.y);
    ctx.stroke();
    ctx.restore();
  });

  // 5. Draw Players
  currentPlayers.forEach(player => {
    if (player.health <= 0) return; // Don't draw dead players

    const shipX = player.x - camera.x;
    const shipY = player.y - camera.y;

    // Draw Thruster tail trails if moving
    if (Math.random() < 0.4) {
      spawnThruster(player.x, player.y, player.angle, player.color);
    }

    ctx.save();
    ctx.translate(shipX, shipY);

    // Dynamic neon glowing body
    ctx.shadowBlur = 12;
    ctx.shadowColor = `hsl(${player.color}, 100%, 50%)`;
    ctx.fillStyle = `hsl(${player.color}, 100%, 60%)`;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;

    // Draw custom Sci-Fi Starfighter geometry
    ctx.rotate(player.angle);
    ctx.beginPath();
    // Center point tip
    ctx.moveTo(22, 0);
    // Top-left wing
    ctx.lineTo(-14, -18);
    // Back engine indent
    ctx.lineTo(-6, -6);
    // Bottom engine indent
    ctx.lineTo(-6, 6);
    // Bottom-right wing
    ctx.lineTo(-14, 18);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Small cockpit glass overlay
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-4, -5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // 6. Draw Player Health bar + Name tag above ship
    ctx.save();
    const uiY = shipY - 35;
    
    // Draw Name Tag
    ctx.font = 'bold 12px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 3;
    ctx.shadowColor = 'black';
    ctx.fillText(player.name, shipX, uiY - 8);

    // Draw Health bar background
    const barW = 40;
    const barH = 5;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(shipX - barW / 2, uiY, barW, barH);

    // Draw Health bar fill
    const healthPercent = player.health / 100;
    const barFillW = barW * healthPercent;
    
    // Smooth transition from Green to Yellow to Red depending on player health
    ctx.fillStyle = `hsl(${healthPercent * 120}, 100%, 50%)`;
    ctx.fillRect(shipX - barW / 2, uiY, barFillW, barH);
    
    // Border around healthbar
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(shipX - barW / 2, uiY, barW, barH);

    ctx.restore();
  });

  // Restore screen shake translation matrix
  if (screenShake > 0.1) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

// Start Render loop
requestAnimationFrame(render);
