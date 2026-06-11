// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => console.log('Service worker registered successfully', reg))
      .catch((err) => console.error('Service worker registration failed:', err));
  });
}

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
const fuelBar = document.getElementById('fuel-bar');
const scoreCounter = document.getElementById('score-counter');
const leaderboardList = document.getElementById('leaderboard-list');
const killFeed = document.getElementById('kill-feed');
const respawnScreen = document.getElementById('respawn-screen');
const hudPlayerName = document.getElementById('hud-player-name');

// Powerup Badges
const badgeShield = document.getElementById('badge-shield');
const badgeTriple = document.getElementById('badge-triple');
const badgeBomb = document.getElementById('badge-bomb');
const bombCountVal = document.getElementById('bomb-count-val');

// Mobile Controls Elements
const joystickBoundary = document.getElementById('joystick-boundary');
const joystickKnob = document.getElementById('joystick-knob');
const mobileShootBtn = document.getElementById('mobile-shoot-btn');
const mobileBombBtn = document.getElementById('mobile-bomb-btn');

// Countdown Overlay
const countdownScreen = document.getElementById('countdown-screen');
const countdownAnnouncement = document.getElementById('countdown-announcement');
const countdownNumber = document.getElementById('countdown-number');

// Game constants and state variables
let mapSize = 2500;
let localPlayerId = null;
let currentPlayers = [];
let currentProjectiles = [];
let currentAsteroids = [];
let currentItems = [];
let currentBombs = [];
let winnerName = "";

// Camera
const camera = { x: 0, y: 0 };

// Controls state (Asteroids Style)
const keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
let lastKeysState = { ...keys };
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
  for (let i = 0; i < 24; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 8 + 2;
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
    
    // Attiva la modalità a tutto schermo (Fullscreen)
    const docEl = document.documentElement;
    if (docEl.requestFullscreen) {
      docEl.requestFullscreen().catch(err => console.log("Errore Fullscreen:", err));
    } else if (docEl.mozRequestFullScreen) {
      docEl.mozRequestFullScreen();
    } else if (docEl.webkitRequestFullscreen) {
      docEl.webkitRequestFullscreen();
    } else if (docEl.msRequestFullscreen) {
      docEl.msRequestFullscreen();
    }
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
  currentAsteroids = state.asteroids;
  currentItems = state.items;
  currentBombs = state.bombs;

  // Find local player
  const localPlayer = currentPlayers.find(p => p.id === localPlayerId);
  if (localPlayer) {
    // Update local HUD progress bars
    healthBar.style.width = `${localPlayer.health}%`;
    fuelBar.style.width = `${localPlayer.fuel}%`;
    scoreCounter.textContent = localPlayer.score;

    if (localPlayer.health <= 0) {
      respawnScreen.classList.remove('hidden');
    } else {
      respawnScreen.classList.add('hidden');
    }

    // Power-up indicators display
    if (localPlayer.shieldActive) {
      badgeShield.classList.remove('hidden');
    } else {
      badgeShield.classList.add('hidden');
    }

    if (localPlayer.tripleActive) {
      badgeTriple.classList.remove('hidden');
    } else {
      badgeTriple.classList.add('hidden');
    }

    if (localPlayer.bombsCount > 0) {
      badgeBomb.classList.remove('hidden');
      bombCountVal.textContent = localPlayer.bombsCount;
      mobileBombBtn.classList.remove('hidden');
    } else {
      badgeBomb.classList.add('hidden');
      mobileBombBtn.classList.add('hidden');
    }
  }

  // Handle Game Countdown Overlay
  if (state.countdown !== null) {
    countdownScreen.classList.remove('hidden');
    countdownNumber.textContent = state.countdown;
    countdownAnnouncement.innerHTML = `VINCITORE:<br><span style="color: #00f0ff;">${winnerName}</span>`;
  } else {
    countdownScreen.classList.add('hidden');
  }

  // Update Leaderboard
  updateLeaderboard(state.players);
});

// Shot events
socket.on('playerShot', (shot) => {
  spawnSparks(shot.x, shot.y, shot.color);
});

// Hit events
socket.on('hit', (hit) => {
  spawnSparks(hit.x, hit.y, hit.color);
  if (hit.playerId === localPlayerId) {
    screenShake = 15;
  }
});

// Item collected effect
socket.on('itemCollected', (data) => {
  // Spawn sparkling flash at collection point
  const collector = currentPlayers.find(p => p.id === data.playerId);
  if (collector) {
    let hue = 30; // Orange fuel
    if (data.type === 'pw_shield') hue = 190; // Cyan
    if (data.type === 'pw_triple') hue = 290; // Purple
    if (data.type === 'pw_bomb') hue = 0; // Red
    spawnSparks(collector.x, collector.y, hue);
  }
});

// Bomb placed notification
socket.on('bombPlaced', (bomb) => {
  spawnSparks(bomb.x, bomb.y, bomb.color);
});

// Bomb explosion trigger
socket.on('bombExploded', (data) => {
  screenShake = 25;
  // Large visual fire explosion
  for (let i = 0; i < 40; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 8 + 3;
    const dist = Math.random() * 50;
    particles.push(new Particle(
      data.x + Math.cos(angle) * dist,
      data.y + Math.sin(angle) * dist,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      `hsl(${data.color}, 100%, 55%)`,
      Math.random() * 5 + 3,
      1.5,
      Math.random() * 0.04 + 0.02
    ));
  }
});

// Game Reset announcements
socket.on('gameCountdownStart', (data) => {
  winnerName = data.winnerName;
  particles.length = 0; // Clear particles on reset
});

// Death events
socket.on('playerKilled', (data) => {
  const victim = currentPlayers.find(p => p.id === data.victimId);
  if (victim) {
    spawnExplosion(victim.x, victim.y, victim.color);
  }

  const msg = document.createElement('div');
  msg.className = 'kill-msg';
  msg.innerHTML = `<span class="killer">${data.killerName}</span> ha vaporizzato <span class="victim">${data.victimName}</span>`;
  killFeed.appendChild(msg);

  setTimeout(() => {
    msg.remove();
  }, 5000);
});

// Leaderboard updates
function updateLeaderboard(players) {
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

// Inputs tracking (Asteroids Style: Up/Down/Left/Right Arrows)
window.addEventListener('keydown', (e) => {
  if (loginScreen.classList.contains('hidden') === false) return; // ignore before login
  
  const key = e.key;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
    e.preventDefault();
    keys[key] = true;
    sendInputsIfNeeded();
  }

  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    if (!isSpacePressed) {
      isSpacePressed = true;
      socket.emit('shoot');
      spaceInterval = setInterval(() => {
        socket.emit('shoot');
      }, 100);
    }
  }

  if (e.key === 'b' || e.key === 'B') {
    socket.emit('placeBomb');
  }
});

window.addEventListener('keyup', (e) => {
  const key = e.key;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
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
  if (
    keys.ArrowUp !== lastKeysState.ArrowUp ||
    keys.ArrowDown !== lastKeysState.ArrowDown ||
    keys.ArrowLeft !== lastKeysState.ArrowLeft ||
    keys.ArrowRight !== lastKeysState.ArrowRight
  ) {
    socket.emit('playerInput', keys);
    lastKeysState = { ...keys };
  }
}

// Draw Asteroid shape deterministically using its ID
function drawAsteroidShape(ctx, ast) {
  const points = 10;
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    // Seeded offset to keep asteroid shape stable
    const offsetSeed = Math.sin(ast.id * 888 + i * 999) * 0.25 + 0.85;
    const r = ast.radius * offsetSeed;
    
    const vertexX = ast.x + Math.cos(ast.angle + angle) * r;
    const vertexY = ast.y + Math.sin(ast.angle + angle) * r;

    if (i === 0) {
      ctx.moveTo(vertexX - camera.x, vertexY - camera.y);
    } else {
      ctx.lineTo(vertexX - camera.x, vertexY - camera.y);
    }
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// Render/Game Loop
function render() {
  requestAnimationFrame(render);

  ctx.fillStyle = '#070712';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const localPlayer = currentPlayers.find(p => p.id === localPlayerId);
  if (localPlayer) {
    camera.x = localPlayer.x - canvas.width / 2;
    camera.y = localPlayer.y - canvas.height / 2;
  }

  // Handle Screen Shake
  if (screenShake > 0.1) {
    const dx = (Math.random() - 0.5) * screenShake;
    const dy = (Math.random() - 0.5) * screenShake;
    ctx.translate(dx, dy);
    screenShake *= 0.9;
  }

  // 1. Draw starfield
  stars.forEach(star => {
    let relativeX = star.x - camera.x * 0.4;
    let relativeY = star.y - camera.y * 0.4;
    relativeX = (relativeX % mapSize + mapSize) % mapSize;
    relativeY = (relativeY % mapSize + mapSize) % mapSize;

    if (relativeX < 0 || relativeX > canvas.width || relativeY < 0 || relativeY > canvas.height) return;

    ctx.fillStyle = star.color;
    ctx.globalAlpha = star.alpha;
    ctx.fillRect(relativeX, relativeY, star.size, star.size);
  });
  ctx.globalAlpha = 1.0;

  // 2. Draw Arena Grid Borders
  ctx.save();
  ctx.strokeStyle = 'rgba(189, 0, 255, 0.1)';
  ctx.lineWidth = 1;
  const gridSize = 120;
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
  
  // Arena Outer Walls
  ctx.strokeStyle = '#bd00ff';
  ctx.lineWidth = 6;
  ctx.shadowBlur = 15;
  ctx.shadowColor = '#bd00ff';
  ctx.strokeRect(-camera.x, -camera.y, mapSize, mapSize);
  ctx.restore();

  // 3. Collectibles / Items
  currentItems.forEach(item => {
    const rx = item.x - camera.x;
    const ry = item.y - camera.y;
    const radius = item.radius || 24;

    ctx.save();
    
    let color = '#ffae00'; // fuel canister
    let label = 'FUEL';

    if (item.type === 'pw_shield') {
      color = '#00f0ff';
      label = 'SHIELD';
    } else if (item.type === 'pw_triple') {
      color = '#bd00ff';
      label = 'TRIPLE';
    } else if (item.type === 'pw_bomb') {
      color = '#ff3131';
      label = 'BOMB';
    }

    // Outer low-vertex neon ring (Hexagon)
    const sides = 6;
    const pulseRadius = radius + 8 + Math.sin(Date.now() * 0.008) * 2.5;
    const polyColor = item.type === 'fuel' ? '#ff7700' : '#39ff14'; // Orange for FUEL, Green for BONUS
    const angleOffset = (item.id * 45 + Date.now() * 0.0012); // unique phase rotation

    ctx.strokeStyle = polyColor;
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 22;
    ctx.shadowColor = polyColor;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    for (let s = 0; s < sides; s++) {
      const angle = (s / sides) * Math.PI * 2 + angleOffset;
      const px = rx + Math.cos(angle) * pulseRadius;
      const py = ry + Math.sin(angle) * pulseRadius;
      if (s === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.stroke();
    
    // Core item capsule
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = 'rgba(10, 10, 20, 0.9)';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(rx, ry, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Colored glowing border
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.shadowBlur = 30;
    ctx.shadowColor = color;
    ctx.beginPath();
    ctx.arc(rx, ry, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Bold text inside the neon capsule
    ctx.font = 'bold 9px "Orbitron", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 4;
    ctx.shadowColor = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, rx, ry);

    ctx.restore();
  });

  // 4. Update & Draw Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.update();
    if (p.life <= 0) {
      particles.splice(i, 1);
    } else {
      p.draw(ctx, camera.x, camera.y);
    }
  }

  // 5. Draw Bombs
  currentBombs.forEach(bomb => {
    const bx = bomb.x - camera.x;
    const by = bomb.y - camera.y;
    
    ctx.save();
    // Pulse animation based on fuse timer
    const pulse = 1 + Math.sin(bomb.timer * 0.25) * 0.15;
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#ff3131';
    ctx.fillStyle = bomb.timer < 30 ? (bomb.timer % 4 < 2 ? '#ffffff' : '#ff3131') : '#9e0000';
    ctx.strokeStyle = '#ff3131';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(bx, by, bomb.radius * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Small blinking spark on top of bomb
    ctx.fillStyle = '#ffae00';
    ctx.beginPath();
    ctx.arc(bx, by - bomb.radius - 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // 6. Draw Projectiles
  currentProjectiles.forEach(proj => {
    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = `hsl(${proj.color}, 100%, 50%)`;
    ctx.strokeStyle = `hsl(${proj.color}, 100%, 75%)`;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';

    ctx.beginPath();
    const length = 20;
    const speed = Math.hypot(proj.vx, proj.vy);
    const trailX = proj.x - (proj.vx / (speed || 1)) * length;
    const trailY = proj.y - (proj.vy / (speed || 1)) * length;

    ctx.moveTo(proj.x - camera.x, proj.y - camera.y);
    ctx.lineTo(trailX - camera.x, trailY - camera.y);
    ctx.stroke();
    ctx.restore();
  });

  // 7. Draw Asteroids
  currentAsteroids.forEach(ast => {
    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(189, 0, 255, 0.4)';
    ctx.strokeStyle = '#bd00ff';
    ctx.lineWidth = 2.5;
    ctx.fillStyle = '#110c22';

    drawAsteroidShape(ctx, ast);
    ctx.restore();
  });

  // 8. Draw Players
  currentPlayers.forEach(player => {
    if (player.health <= 0) return;

    const shipX = player.x - camera.x;
    const shipY = player.y - camera.y;

    // Thruster visual particles
    const speed = Math.hypot(player.vx, player.vy);
    if (speed > 1 && Math.random() < 0.35) {
      spawnThruster(player.x, player.y, player.angle, player.color);
    }

    // Active PWA Barrier / Shield Circle
    if (player.shieldActive) {
      ctx.save();
      ctx.strokeStyle = '#00f0ff';
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#00f0ff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(shipX, shipY, PLAYER_RADIUS + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Spacecraft Core
    ctx.save();
    ctx.translate(shipX, shipY);

    ctx.shadowBlur = 12;
    ctx.shadowColor = `hsl(${player.color}, 100%, 50%)`;
    ctx.fillStyle = `hsl(${player.color}, 100%, 60%)`;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;

    ctx.rotate(player.angle);
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(-14, -18);
    ctx.lineTo(-6, -6);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-14, 18);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Small cockpit glass
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-4, -5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // 9. Health & Info labels
    ctx.save();
    const uiY = shipY - 35;
    
    ctx.font = 'bold 12px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 3;
    ctx.shadowColor = 'black';
    ctx.fillText(player.name, shipX, uiY - 8);

    // Healthbar draw
    const barW = 40;
    const barH = 5;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(shipX - barW / 2, uiY, barW, barH);

    const healthPercent = player.health / 100;
    ctx.fillStyle = `hsl(${healthPercent * 120}, 100%, 50%)`;
    ctx.fillRect(shipX - barW / 2, uiY, barW * healthPercent, barH);
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(shipX - barW / 2, uiY, barW, barH);

    ctx.restore();
  });

  if (screenShake > 0.1) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

requestAnimationFrame(render);

// --- Mobile Virtual Joystick & Touch Control Logic ---
let joystickActive = false;
let joystickStartPos = { x: 0, y: 0 };
const maxJoystickDist = 45; // Max drift distance for joystick knob

joystickBoundary.addEventListener('touchstart', (e) => {
  joystickActive = true;
  const touch = e.touches[0];
  const rect = joystickBoundary.getBoundingClientRect();
  joystickStartPos = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
  handleJoystickMove(touch.clientX, touch.clientY);
}, { passive: true });

window.addEventListener('touchmove', (e) => {
  if (!joystickActive) return;
  const touch = e.touches[0];
  handleJoystickMove(touch.clientX, touch.clientY);
}, { passive: false });

window.addEventListener('touchend', () => {
  if (!joystickActive) return;
  joystickActive = false;
  
  // Center knob
  joystickKnob.style.transform = 'translate(0px, 0px)';
  
  // Reset emulated key states
  keys.ArrowUp = false;
  keys.ArrowLeft = false;
  keys.ArrowRight = false;
  sendInputsIfNeeded();
});

function handleJoystickMove(clientX, clientY) {
  const dx = clientX - joystickStartPos.x;
  const dy = clientY - joystickStartPos.y;
  const dist = Math.hypot(dx, dy);
  
  const angle = Math.atan2(dy, dx);
  const clampedDist = Math.min(dist, maxJoystickDist);
  
  // Move virtual knob UI
  const knobX = Math.cos(angle) * clampedDist;
  const knobY = Math.sin(angle) * clampedDist;
  joystickKnob.style.transform = `translate(${knobX}px, ${knobY}px)`;
  
  // Input translation
  if (clampedDist > 12) { // Deadzone
    // Pushing joystick out triggers thrust (ArrowUp)
    keys.ArrowUp = clampedDist > maxJoystickDist * 0.35;
    
    // Rotate ship to match joystick angle
    if (localPlayerId) {
      const player = currentPlayers.find(p => p.id === localPlayerId);
      if (player) {
        let diff = angle - player.angle;
        // Normalize angle diff to (-PI, PI]
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        
        const turnDeadzone = 0.18;
        if (diff > turnDeadzone) {
          keys.ArrowRight = true;
          keys.ArrowLeft = false;
        } else if (diff < -turnDeadzone) {
          keys.ArrowLeft = true;
          keys.ArrowRight = false;
        } else {
          keys.ArrowLeft = false;
          keys.ArrowRight = false;
        }
      }
    }
  } else {
    keys.ArrowUp = false;
    keys.ArrowLeft = false;
    keys.ArrowRight = false;
  }
  sendInputsIfNeeded();
}

// Mobile shoot button (continuous fire on hold)
mobileShootBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (!isSpacePressed) {
    isSpacePressed = true;
    socket.emit('shoot');
    spaceInterval = setInterval(() => {
      socket.emit('shoot');
    }, 100);
  }
});

mobileShootBtn.addEventListener('touchend', (e) => {
  e.preventDefault();
  isSpacePressed = false;
  if (spaceInterval) {
    clearInterval(spaceInterval);
    spaceInterval = null;
  }
});

// Mobile bomb button
mobileBombBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  socket.emit('placeBomb');
});
