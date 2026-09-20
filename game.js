/**
 * Sky Climber - Dikey Sonsuz Platform Jumper Oyunu
 * V4: Kesintisiz Ses Sistemi (Base64 Dual WebAudio + HTML5),
 * Daha Dengeli/Yumuşak Roket Yükselişi (-8.5) ve Roket Zincirleme (Rocket Chaining)
 */

// ==========================================
// SES YÖNETİCİSİ (Base64 Dual WebAudio + HTML5)
// ==========================================
class SoundManager {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.audioElements = {};
    this.muted = false;
    this.rocketAudio = null;
    this.initAudio();
  }

  initAudio() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      try {
        this.ctx = new AudioContext();
      } catch (e) {}
    }

    if (window.SOUND_ASSETS) {
      for (const [key, dataUri] of Object.entries(window.SOUND_ASSETS)) {
        try {
          const a = new Audio(dataUri);
          a.preload = 'auto';
          this.audioElements[key] = a;

          if (this.ctx) {
            this.decodeBase64(key, dataUri);
          }
        } catch (e) {
          console.warn(`Audio error for ${key}:`, e);
        }
      }
    }
  }

  decodeBase64(key, dataUri) {
    try {
      const base64 = dataUri.split(',')[1];
      const binary = atob(base64);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      this.ctx.decodeAudioData(bytes.buffer, (buf) => {
        this.buffers[key] = buf;
      }, (err) => {});
    } catch (err) {}
  }

  unlock() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  play(name, loop = false, volume = 1.0) {
    if (this.muted) return null;
    this.unlock();

    // 1. Web Audio API (Düşük gecikme)
    if (this.ctx && this.buffers[name]) {
      try {
        const source = this.ctx.createBufferSource();
        const gainNode = this.ctx.createGain();
        source.buffer = this.buffers[name];
        source.loop = loop;
        gainNode.gain.value = volume;
        source.connect(gainNode);
        gainNode.connect(this.ctx.destination);
        source.start(0);
        return { source, gainNode, isWebAudio: true };
      } catch (e) {}
    }

    // 2. Doğrudan HTML5 Audio Fallback (Her cihazda %100 çalışır)
    if (this.audioElements[name]) {
      try {
        const a = this.audioElements[name].cloneNode();
        a.volume = Math.min(1.0, Math.max(0, volume));
        a.loop = loop;
        a.play().catch(() => {});
        return { source: a, gainNode: null, isWebAudio: false };
      } catch (e) {}
    }

    return null;
  }

  startRocketSound() {
    if (this.rocketAudio || this.muted) return;
    this.rocketAudio = this.play('rocket', true, 0.7);
  }

  stopRocketSound() {
    if (this.rocketAudio) {
      try {
        if (this.rocketAudio.isWebAudio && this.rocketAudio.source.stop) {
          this.rocketAudio.source.stop();
        } else if (this.rocketAudio.source.pause) {
          this.rocketAudio.source.pause();
        }
      } catch (e) {}
      this.rocketAudio = null;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted && this.rocketAudio) {
      this.stopRocketSound();
    }
    return this.muted;
  }
}

// ==========================================
// PARTİKÜL SİSTEMİ
// ==========================================
class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  emit(x, y, count, config) {
    for (let i = 0; i < count; i++) {
      const angle = config.angle !== undefined ? config.angle + (Math.random() - 0.5) * (config.spread || 0.5) : Math.random() * Math.PI * 2;
      const speed = (config.speed || 3) * (0.5 + Math.random());
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        decay: config.decay || 0.03 + Math.random() * 0.02,
        size: (config.size || 4) * (0.8 + Math.random() * 0.5),
        color: Array.isArray(config.color) ? config.color[Math.floor(Math.random() * config.color.length)] : config.color || '#fff'
      });
    }
  }

  update() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  draw(ctx, cameraY) {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y - cameraY, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

// ==========================================
// OYUN MOTORU & YÖNETİMİ
// ==========================================
class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.width = this.canvas.width;
    this.height = this.canvas.height;

    this.sound = new SoundManager();
    this.particles = new ParticleSystem();

    // Oyun Durumları
    this.state = 'START';
    this.score = 0;
    this.highScore = parseInt(localStorage.getItem('skyclimber_highscore') || '0', 10);
    this.scores = JSON.parse(localStorage.getItem('skyclimber_scores') || '[]');
    this.lastCheckpointHeight = 0;
    this.lastCheckpointScore = 0;
    this.rocketChainCount = 0;

    // GitHub Skor Senkronizasyonu
    this.SCORES_RAW_URL = 'https://raw.githubusercontent.com/solomonboneyards/sky-climber-game/main/scores.json';
    this.SCORES_API_URL = 'https://api.github.com/repos/solomonboneyards/sky-climber-game/contents/scores.json';
    this.GITHUB_TOKEN = '';
    this.scoresSha = null;
    this.syncingScores = false;
    this.loadConfig().then(() => this.loadOnlineScores());

    // Oyuncu Fizik Ayarları
    this.player = {
      x: this.width / 2 - 19,
      y: this.height - 130,
      width: 38,
      height: 38,
      vx: 0,
      vy: 0,
      jumpSpeed: -12.0,
      gravity: 0.36,
      accel: 0.44,
      maxSpeed: 5.0,
      friction: 0.86,
      facing: 'right',
      squish: 1.0,
      hasShield: false,
      shieldTimer: 0,
      rocketTimer: 0,
      maxRocketTimer: 260,
      invulnerableTimer: 0,
      lives: 3,
      maxLives: 3,
      doubleJumpCharges: 0,
      maxDoubleJumpCharges: 3,
      canDoubleJump: false,
      hasDoubleJumped: false
    };

    // Kontroller
    this.keys = { left: false, right: false };
    this.touchLeft = false;
    this.touchRight = false;

    // Kamera & İlerleme
    this.cameraY = 0;
    this.targetCameraY = 0;
    this.highestY = this.player.y;
    this.highestPlatformY = this.height - 120;
    this.nextCheckpointDistance = 300;

    // Oyun Nesneleri
    this.platforms = [];
    this.items = [];
    this.enemies = [];
    this.floatingTexts = [];

    // Görsel Uzay Nesneleri
    this.initCosmicAssets();

    this.initDOM();
    this.initEvents();
    this.updateTouchControlsPointerEvents();
    this.renderScoreboard(this.startScoresList);
    if (this.scores.length > 0) this.startScoreboard.classList.remove('hidden');

    this.lastTime = performance.now();
    requestAnimationFrame(this.loop.bind(this));
  }

  initCosmicAssets() {
    this.clouds = [];
    for (let i = 0; i < 8; i++) {
      this.clouds.push({
        x: Math.random() * this.width,
        y: -i * 220,
        scale: 0.7 + Math.random() * 0.6,
        speed: 0.15 + Math.random() * 0.2
      });
    }

    this.stars = [];
    for (let i = 0; i < 100; i++) {
      this.stars.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height * 2,
        size: Math.random() * 1.8 + 0.8,
        speed: Math.random() * 0.25 + 0.05,
        alpha: Math.random() * 0.5 + 0.5
      });
    }

    this.planets = [
      { name: 'Moon', meter: 800, x: 85, size: 42, type: 'moon' },
      { name: 'EarthGlow', meter: 1300, x: 210, size: 280, type: 'earth_horizon' },
      { name: 'Mars', meter: 2200, x: 320, size: 55, type: 'mars' },
      { name: 'Jupiter', meter: 3600, x: 100, size: 90, type: 'jupiter' },
      { name: 'Saturn', meter: 5200, x: 300, size: 70, type: 'saturn' },
      { name: 'Nebula', meter: 7000, x: 180, size: 140, type: 'nebula' }
    ];

    this.comets = [];
  }

  initDOM() {
    this.hudScore = document.getElementById('score-val');
    this.hudCP = document.getElementById('cp-val');
    this.hudLives = document.getElementById('lives-val');
    this.hudJump = document.getElementById('jump-val');
    this.soundBtn = document.getElementById('sound-btn');
    this.pauseBtn = document.getElementById('pause-btn');
    this.rocketBarContainer = document.getElementById('rocket-bar-container');
    this.rocketBarFill = document.getElementById('rocket-bar-fill');

    this.startScreen = document.getElementById('start-screen');
    this.gameOverScreen = document.getElementById('game-over-screen');
    this.pauseScreen = document.getElementById('pause-screen');

    this.startBtn = document.getElementById('start-btn');
    this.restartBtn = document.getElementById('restart-btn');
    this.reviveCpBtn = document.getElementById('revive-cp-btn');
    this.resumeBtn = document.getElementById('resume-btn');
    this.pauseRestartBtn = document.getElementById('pause-restart-btn');

    this.finalScoreEl = document.getElementById('final-score');
    this.highScoreEl = document.getElementById('high-score');
    this.lastCpScoreEl = document.getElementById('last-cp-score');
    this.cpRow = document.getElementById('cp-row');

    this.nameEntryScreen = document.getElementById('name-entry-screen');
    this.nameEntryScore = document.getElementById('name-entry-score');
    this.nameInputs = [
      document.getElementById('name-input-1'),
      document.getElementById('name-input-2'),
      document.getElementById('name-input-3')
    ];
    this.nameSubmitBtn = document.getElementById('name-submit-btn');
    this.startScoreboard = document.getElementById('start-scoreboard');
    this.startScoresList = document.getElementById('start-scores-list');
    this.gameoverScoresList = document.getElementById('gameover-scores-list');
  }

  initEvents() {
    window.addEventListener('keydown', (e) => {
      this.sound.unlock();
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.keys.left = true;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.keys.right = true;
      if (e.code === 'KeyP') this.togglePause();
      if ((e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') && this.state === 'PLAYING') {
        this.tryDoubleJump();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.keys.left = false;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.keys.right = false;
    });

    // Double jump on tap in upper screen area (mobile)
    this.canvas.addEventListener('touchstart', (e) => {
      if (this.state !== 'PLAYING') return;
      const rect = this.canvas.getBoundingClientRect();
      const touchY = e.touches[0].clientY - rect.top;
      // Only trigger if tap is in upper 60% of screen (not on touch controls)
      if (touchY < rect.height * 0.6) {
        this.tryDoubleJump();
      }
    }, { passive: true });

    // Herhangi bir ekrana dokunmada sesi anında aktif et
    ['touchstart', 'touchend', 'click', 'pointerdown'].forEach(evt => {
      window.addEventListener(evt, () => this.sound.unlock(), { passive: true });
    });

    const touchLeft = document.getElementById('touch-left');
    const touchRight = document.getElementById('touch-right');

    const handleTouch = (isLeft, active) => {
      if (isLeft) this.touchLeft = active;
      else this.touchRight = active;
    };

    ['touchstart', 'mousedown'].forEach(evt => {
      touchLeft.addEventListener(evt, (e) => { e.preventDefault(); this.sound.unlock(); handleTouch(true, true); });
      touchRight.addEventListener(evt, (e) => { e.preventDefault(); this.sound.unlock(); handleTouch(false, true); });
    });

    ['touchend', 'touchcancel', 'mouseup', 'mouseleave'].forEach(evt => {
      touchLeft.addEventListener(evt, () => handleTouch(true, false));
      touchRight.addEventListener(evt, () => handleTouch(false, false));
    });

    this.startBtn.addEventListener('click', (e) => { e.stopPropagation(); this.sound.unlock(); this.startNewGame(false); });
    this.startBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); e.preventDefault(); this.sound.unlock(); this.startNewGame(false); }, { passive: false });
    this.restartBtn.addEventListener('click', (e) => { e.stopPropagation(); this.sound.unlock(); this.startNewGame(false); });
    this.restartBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); e.preventDefault(); this.sound.unlock(); this.startNewGame(false); }, { passive: false });
    this.reviveCpBtn.addEventListener('click', (e) => { e.stopPropagation(); this.sound.unlock(); this.reviveFromCheckpoint(); });
    this.reviveCpBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); e.preventDefault(); this.sound.unlock(); this.reviveFromCheckpoint(); }, { passive: false });
    this.resumeBtn.addEventListener('click', () => this.togglePause());
    this.resumeBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); e.preventDefault(); this.togglePause(); }, { passive: false });
    this.pauseRestartBtn.addEventListener('click', () => { this.togglePause(); this.startNewGame(false); });
    this.pauseRestartBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); e.preventDefault(); this.togglePause(); this.startNewGame(false); }, { passive: false });

    // İsim girme input otomatik geçiş ve kaydetme
    this.nameInputs.forEach((input, idx) => {
      input.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1);
        if (e.target.value && idx < 2) this.nameInputs[idx + 1].focus();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && idx > 0) this.nameInputs[idx - 1].focus();
        if (e.key === 'Enter') this.submitNameEntry();
      });
    });
    this.nameSubmitBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); this.submitNameEntry(); });
    this.nameSubmitBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); e.preventDefault(); this.submitNameEntry(); }, { passive: false });

    this.soundBtn.addEventListener('click', () => {
      const muted = this.sound.toggleMute();
      this.soundBtn.textContent = muted ? '🔇' : '🔊';
    });

    this.pauseBtn.addEventListener('click', () => this.togglePause());
  }

  updateTouchControlsPointerEvents() {
    const touchControls = document.getElementById('touch-controls');
    if (touchControls) {
      if (this.state === 'PLAYING') {
        touchControls.style.display = 'flex';
        touchControls.style.pointerEvents = 'auto';
      } else {
        touchControls.style.display = 'none';
        touchControls.style.pointerEvents = 'none';
      }
    }
  }

  startNewGame(fromCheckpoint = false) {
    this.state = 'PLAYING';
    this.startScreen.classList.add('hidden');
    this.gameOverScreen.classList.add('hidden');
    this.pauseScreen.classList.add('hidden');
    this.updateTouchControlsPointerEvents();

    if (!fromCheckpoint) {
      this.score = 0;
      this.lastCheckpointHeight = 0;
      this.lastCheckpointScore = 0;
      this.rocketChainCount = 0;
      this.highestY = this.height - 120;
      this.cameraY = 0;
      this.targetCameraY = 0;

      this.player.x = this.width / 2 - 19;
      this.player.y = this.height - 120;
      this.player.vx = 0;
      this.player.vy = this.player.jumpSpeed;
      this.player.hasShield = false;
      this.player.rocketTimer = 0;
      this.player.invulnerableTimer = 0;
      this.player.lives = this.player.maxLives;
      this.player.doubleJumpCharges = 0;
      this.player.canDoubleJump = false;
      this.player.hasDoubleJumped = false;

      this.initWorld();
    }

    this.sound.play('jump');
    this.updateHUD();
  }

  reviveFromCheckpoint() {
    this.state = 'PLAYING';
    this.gameOverScreen.classList.add('hidden');
    this.updateTouchControlsPointerEvents();

    const targetY = -this.lastCheckpointHeight * 4;
    this.score = this.lastCheckpointScore;
    this.cameraY = targetY + 350;
    this.targetCameraY = this.cameraY;
    this.highestY = targetY;
    this.rocketChainCount = 0;

    this.player.x = this.width / 2 - 19;
    this.player.y = targetY;
    this.player.vx = 0;
    this.player.vy = this.player.jumpSpeed;
    this.player.hasShield = true;
    this.player.invulnerableTimer = 180;
    this.player.lives = this.player.maxLives;
    this.player.doubleJumpCharges = 0;
    this.player.canDoubleJump = false;
    this.player.hasDoubleJumped = false;

    this.platforms = [];
    this.items = [];
    this.enemies = [];

    // Checkpoint Güvenlik Tabanı
    this.platforms.push({
      x: 0,
      y: targetY + 60,
      width: this.width,
      height: 25,
      type: 'CHECKPOINT',
      activated: true,
      meter: this.lastCheckpointHeight
    });
    this.platforms.push({
      x: 30,
      y: targetY + 120,
      width: this.width - 60,
      height: 20,
      type: 'NORMAL'
    });

    this.highestPlatformY = targetY;
    this.ensurePlatformsAhead(1800);

    this.addFloatingText("🚩 CHECKPOINT'TEN DEVAM!", this.width / 2, this.player.y - 40, '#38bdf8');
    this.sound.play('jump');
    this.updateHUD();
  }

  initWorld() {
    this.platforms = [];
    this.items = [];
    this.enemies = [];
    this.floatingTexts = [];

    // Sağlam Çimenli Başlangıç Tabanı
    this.platforms.push({
      x: 0,
      y: this.height - 35,
      width: this.width,
      height: 40,
      type: 'GROUND'
    });

    // Başlangıç basamağı
    this.platforms.push({
      x: this.width / 2 - 60,
      y: this.height - 110,
      width: 120,
      height: 18,
      type: 'NORMAL'
    });

    this.highestPlatformY = this.height - 110;
    this.ensurePlatformsAhead(2000);
  }

  ensurePlatformsAhead(requiredDistance = 1600) {
    const targetCeiling = Math.min(this.player.y, this.cameraY) - requiredDistance;

    let lastPlatformX = this.width / 2;
    while (this.highestPlatformY > targetCeiling) {
      const gap = 55 + Math.random() * 25;
      this.highestPlatformY -= gap;
      lastPlatformX = this.spawnPlatformAt(this.highestPlatformY, lastPlatformX);
    }
  }

  spawnPlatformAt(y, lastPlatformX = this.width / 2) {
    const meter = Math.floor(-y / 4);
    const isCpZone = meter > 100 && (meter % this.nextCheckpointDistance < 50);

    if (isCpZone && !this.platforms.some(p => p.type === 'CHECKPOINT' && Math.abs(p.y - y) < 220)) {
      this.platforms.push({
        x: this.width / 2 - 100,
        y: y,
        width: 200,
        height: 28,
        type: 'CHECKPOINT',
        activated: meter <= this.lastCheckpointHeight,
        meter: Math.round(meter / 300) * 300
      });
      return this.width / 2;
    }

    const pWidth = 70 + Math.random() * 16;
    // Yeni platformu son platformun X'sine yakın yerleştir (max 120px öteleme)
    const maxOffset = 120;
    let pX = lastPlatformX + (Math.random() - 0.5) * maxOffset * 2;
    // Ekran sınırları içinde tut
    pX = Math.max(10, Math.min(this.width - pWidth - 10, pX));

    const rand = Math.random();
    let type = 'NORMAL';
    if (rand < 0.22 && meter > 120) {
      type = 'MOVING';
    } else if (rand < 0.36 && meter > 250) {
      type = 'BREAKING';
    }

    const platform = {
      x: pX,
      y: y,
      width: pWidth,
      height: 16,
      type: type,
      vx: (Math.random() > 0.5 ? 1 : -1) * (1.0 + Math.random() * 1.2),
      broken: false,
      breakAlpha: 1.0
    };
    this.platforms.push(platform);

    // Platform üzerine Bonus Item ekleme (Roket şansı %20'ye yükseltildi!)
    if (type !== 'BREAKING' && Math.random() < 0.42) {
      const itemRand = Math.random();
      let itemType = 'COIN';
      if (itemRand < 0.14) itemType = 'ROCKET';
      else if (itemRand < 0.28) itemType = 'SPRING';
      else if (itemRand < 0.36) itemType = 'SHIELD';
      else if (itemRand < 0.41 && this.player.lives < this.player.maxLives) itemType = 'LIFE';
      else if (itemRand < 0.44) itemType = 'DOUBLE_JUMP';

      this.items.push({
        platform: platform,
        relX: pWidth / 2,
        x: pX + pWidth / 2,
        y: y - 20,
        type: itemType,
        collected: false
      });
    }

    // Boşlukta Düşman
    if (meter > 180 && Math.random() < 0.08 && !this.enemies.some(e => Math.abs(e.y - y) < 220)) {
      this.enemies.push({
        x: Math.random() * (this.width - 40),
        y: y - 50,
        width: 36,
        height: 36,
        vx: (Math.random() > 0.5 ? 1 : -1) * (0.9 + Math.random() * 1.1),
        flap: 0,
        alive: true
      });
    }

    return pX + pWidth / 2; // Platform merkezini döndür
  }

  togglePause() {
    if (this.state === 'PLAYING') {
      this.state = 'PAUSED';
      this.pauseScreen.classList.remove('hidden');
      this.sound.stopRocketSound();
      this.updateTouchControlsPointerEvents();
    } else if (this.state === 'PAUSED') {
      this.state = 'PLAYING';
      this.pauseScreen.classList.add('hidden');
      if (this.player.rocketTimer > 0) this.sound.startRocketSound();
      this.updateTouchControlsPointerEvents();
    }
  }

  tryDoubleJump() {
    const p = this.player;
    if (p.rocketTimer > 0) return;
    if (p.doubleJumpCharges <= 0) return;

    p.vy = p.jumpSpeed * 1.15;
    p.doubleJumpCharges--;
    p.hasDoubleJumped = true;
    this.sound.play('spring');
    this.addFloatingText(`✨ ÇİFT ZIPLAMA! (${p.doubleJumpCharges} kaldı)`, p.x, p.y - 30, '#a855f7');
    this.particles.emit(p.x + p.width / 2, p.y + p.height, 15, {
      angle: -Math.PI / 2,
      spread: 0.8,
      speed: 4,
      size: 4,
      color: ['#a855f7', '#d946ef', '#f0abfc', '#ffffff']
    });
    this.updateHUD();
  }

  // ==========================================
  // OYUN DÖNGÜSÜ
  // ==========================================
  loop(currentTime) {
    const dt = Math.min((currentTime - this.lastTime) / 1000, 0.05);
    this.lastTime = currentTime;

    if (this.state === 'PLAYING') {
      this.update(dt);
    }

    this.draw();
    requestAnimationFrame(this.loop.bind(this));
  }

  update(dt) {
    const p = this.player;

    // 1. Yatay Hareket (Roket sırasındayken de rahatça yönlendirilebilir)
    const moveLeft = this.keys.left || this.touchLeft;
    const moveRight = this.keys.right || this.touchRight;

    if (moveLeft && !moveRight) {
      p.vx = Math.max(p.vx - p.accel, -p.maxSpeed);
      p.facing = 'left';
    } else if (moveRight && !moveLeft) {
      p.vx = Math.min(p.vx + p.accel, p.maxSpeed);
      p.facing = 'right';
    } else {
      p.vx *= p.friction;
    }

    p.x += p.vx;

    // Ekran Geçişi
    if (p.x < -p.width / 2) p.x = this.width - p.width / 2;
    else if (p.x > this.width - p.width / 2) p.x = -p.width / 2;

    // 2. Dikey Hareket (KONTROLLÜ VE DAHA YUMUŞAK ROKET: vy = -6.5)
    if (p.rocketTimer > 0) {
      p.rocketTimer--;
      p.vy = -6.5; // -8.5 yerine -6.5 ile daha yavaş, kontrollü yükseliş - bonusları rahat toplama!
      this.sound.startRocketSound();

      this.particles.emit(p.x + p.width / 2, p.y + p.height, 4, {
        angle: Math.PI / 2,
        spread: 0.6,
        speed: 5,
        size: 5,
        color: ['#f97316', '#eab308', '#ef4444', '#ffffff', '#38bdf8']
      });

      this.rocketBarContainer.classList.remove('hidden');
      this.rocketBarFill.style.width = `${(p.rocketTimer / p.maxRocketTimer) * 100}%`;

      if (p.rocketTimer <= 0) {
        this.sound.stopRocketSound();
        this.rocketBarContainer.classList.add('hidden');
        this.rocketChainCount = 0;
      }
    } else {
      p.vy += p.gravity;
    }

    p.y += p.vy;

    if (p.invulnerableTimer > 0) p.invulnerableTimer--;
    p.squish += (1.0 - p.squish) * 0.15;

    // 3. Platform & Taban Çarpışmaları
    if (p.vy > 0 && p.rocketTimer <= 0) {
      for (const plat of this.platforms) {
        if (plat.broken) continue;

        const playerBottom = p.y + p.height;
        const prevBottom = playerBottom - p.vy;

        if (
          playerBottom >= plat.y &&
          prevBottom <= plat.y + 14 &&
          p.x + p.width * 0.75 >= plat.x &&
          p.x + p.width * 0.25 <= plat.x + plat.width
        ) {
          p.vy = p.jumpSpeed;
          p.squish = 0.68;
          this.sound.play('jump');

          this.particles.emit(p.x + p.width / 2, plat.y, 6, {
            angle: -Math.PI / 2,
            spread: 1.0,
            speed: 2.5,
            size: 3,
            color: '#38bdf8'
          });

          if (plat.type === 'BREAKING') {
            plat.broken = true;
          } else if (plat.type === 'CHECKPOINT' && !plat.activated) {
            this.activateCheckpoint(plat);
          }
          // Platforma basınca çift zıplama hakkı yenilenir
          p.hasDoubleJumped = false;
          // Her platforma bastığında %35 şansla 1 çift zıplama hakkı kazan
          if (p.doubleJumpCharges < p.maxDoubleJumpCharges && Math.random() < 0.35) {
            p.doubleJumpCharges++;
            this.addFloatingText("✨ +1 ÇİFT ZIPLAMA", p.x, p.y - 20, '#d946ef');
          }
          break;
        }
      }
    }

    // 4. Bonus Eşya Toplama (ROKET ZİNCİRLEME DESTEĞİ İLE)
    for (const item of this.items) {
      if (item.collected) continue;
      if (item.platform) {
        item.x = item.platform.x + item.relX;
        item.y = item.platform.y - 18;
      }

      const dx = (p.x + p.width / 2) - item.x;
      const dy = (p.y + p.height / 2) - item.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 34) {
        item.collected = true;
        this.applyItem(item);
      }
    }

    // 5. Düşman Çarpışmaları
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const dx = (p.x + p.width / 2) - (enemy.x + enemy.width / 2);
      const dy = (p.y + p.height / 2) - (enemy.y + enemy.height / 2);
      const dist = Math.hypot(dx, dy);

      if (dist < 32) {
        if (p.rocketTimer > 0) {
          enemy.alive = false;
          this.sound.play('hit_enemy');
          this.addFloatingText("+200 🚀", enemy.x, enemy.y, '#f97316');
          this.particles.emit(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2, 16, {
            speed: 5,
            color: ['#f43f5e', '#e11d48', '#881337']
          });
          continue;
        }

        if (p.invulnerableTimer > 0) continue;

        if (p.vy > 0 && (p.y + p.height) < enemy.y + enemy.height * 0.75) {
          enemy.alive = false;
          p.vy = p.jumpSpeed * 1.15;
          this.sound.play('hit_enemy');
          this.addFloatingText("+250 ⭐", enemy.x, enemy.y, '#f59e0b');
          this.particles.emit(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2, 14, {
            speed: 4,
            color: ['#fbbf24', '#f59e0b', '#fff']
          });
          continue;
        }

        if (p.hasShield) {
          p.hasShield = false;
          enemy.alive = false;
          p.invulnerableTimer = 60;
          this.sound.play('hit_enemy');
          this.addFloatingText("KALKAN KIRILDI! 🛡️", p.x, p.y - 20, '#38bdf8');
          this.particles.emit(p.x + p.width / 2, p.y + p.height / 2, 18, {
            speed: 6,
            color: ['#38bdf8', '#0284c7', '#ffffff']
          });
          continue;
        }

        this.loseLife();
        return;
      }
    }

    // 6. Platform ve Düşman Hareketi
    for (const plat of this.platforms) {
      if (plat.type === 'MOVING') {
        plat.x += plat.vx;
        if (plat.x <= 5 || plat.x + plat.width >= this.width - 5) {
          plat.vx *= -1;
        }
      }
      if (plat.broken) {
        plat.breakAlpha -= 0.06;
      }
    }

    for (const enemy of this.enemies) {
      enemy.x += enemy.vx;
      if (enemy.x <= 10 || enemy.x + enemy.width >= this.width - 10) {
        enemy.vx *= -1;
      }
      enemy.flap += 0.15;
    }

    // 7. Kamera Takibi
    if (p.y < this.height * 0.5 + this.cameraY) {
      this.targetCameraY = p.y - this.height * 0.5;
    }
    this.cameraY += (this.targetCameraY - this.cameraY) * 0.14;

    // Skor (İrtifa)
    if (p.y < this.highestY) {
      this.highestY = p.y;
      this.score = Math.floor(Math.abs(this.highestY - (this.height - 120)) / 4);
      if (this.score > this.highScore) {
        this.highScore = this.score;
        localStorage.setItem('skyclimber_highscore', this.highScore.toString());
      }
    }

    // 8. Sonsuz Platform Üretimi
    this.ensurePlatformsAhead(1600);

    this.platforms = this.platforms.filter(pl => pl.type === 'GROUND' || (pl.y < this.cameraY + this.height + 100 && pl.breakAlpha > 0));
    this.items = this.items.filter(it => it.y < this.cameraY + this.height + 100 && !it.collected);
    this.enemies = this.enemies.filter(en => en.y < this.cameraY + this.height + 100 && en.alive);

    // 9. Düşme Kontrolü
    if (p.y > this.cameraY + this.height + 80) {
      this.loseLife();
      return;
    }

    // 10. Kayan Yıldızlar
    if (this.score > 800 && Math.random() < 0.015 && this.comets.length < 3) {
      this.comets.push({
        x: Math.random() * this.width,
        y: this.cameraY - 50,
        vx: (Math.random() > 0.5 ? 1 : -1) * (4 + Math.random() * 4),
        vy: 4 + Math.random() * 4,
        length: 25 + Math.random() * 25,
        alpha: 1.0
      });
    }

    for (let i = this.comets.length - 1; i >= 0; i--) {
      const c = this.comets[i];
      c.x += c.vx;
      c.y += c.vy;
      c.alpha -= 0.02;
      if (c.alpha <= 0) this.comets.splice(i, 1);
    }

    // 11. Uçuşan Metinler & Partiküller
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y -= 1.2;
      ft.alpha -= 0.02;
      if (ft.alpha <= 0) this.floatingTexts.splice(i, 1);
    }

    this.particles.update();
    this.updateHUD();
  }

  activateCheckpoint(plat) {
    plat.activated = true;
    this.lastCheckpointHeight = plat.meter || Math.floor(-plat.y / 4);
    this.lastCheckpointScore = this.score;
    this.sound.play('checkpoint');

    this.addFloatingText(`🚩 CHECKPOINT: ${this.lastCheckpointHeight}m!`, this.width / 2, plat.y - 30, '#10b981');
    
    this.particles.emit(plat.x + plat.width / 2, plat.y, 30, {
      speed: 6,
      size: 5,
      color: ['#10b981', '#38bdf8', '#f59e0b', '#ec4899', '#ffffff']
    });
  }

  applyItem(item) {
    const p = this.player;

    if (item.type === 'COIN') {
      this.score += 100;
      this.sound.play('coin');
      this.addFloatingText("+100 ⭐", item.x, item.y, '#eab308');
      this.particles.emit(item.x, item.y, 10, { color: ['#facc15', '#fef08a'], speed: 3 });

    } else if (item.type === 'SPRING') {
      p.vy = -19.5;
      p.squish = 0.5;
      this.sound.play('spring');
      this.addFloatingText("BOING! 🌀", item.x, item.y, '#38bdf8');
      this.particles.emit(item.x, item.y, 12, { color: '#38bdf8', speed: 4 });

    } else if (item.type === 'ROCKET') {
      if (p.rocketTimer > 0) {
        // ==========================================
        // ROKET ZİNCİRLEME (CHAINING)!
        // Roket içindeyken yeni roket toplanırsa süre EKLENİR (max'a kadar)!
        // ==========================================
        this.rocketChainCount++;
        const addTime = 180; // 3 saniye ekstra süre
        p.rocketTimer = Math.min(p.rocketTimer + addTime, p.maxRocketTimer);
        this.score += 300 * this.rocketChainCount;
        this.sound.play('rocket');
        this.addFloatingText(`ROKET ZİNCİRİ! x${this.rocketChainCount + 1} +3s 🚀🔥`, item.x, item.y, '#f97316');
        this.particles.emit(item.x, item.y, 35, { color: ['#f97316', '#fbbf24', '#ffffff', '#ef4444'], speed: 8 });
      } else {
        p.rocketTimer = p.maxRocketTimer;
        this.rocketChainCount = 0;
        this.sound.play('rocket');
        this.addFloatingText("ROKET GÜCÜ! 🚀", item.x, item.y, '#f97316');
        this.particles.emit(item.x, item.y, 25, { color: ['#f97316', '#fbbf24', '#ffffff'], speed: 6 });
      }

    } else if (item.type === 'SHIELD') {
      p.hasShield = true;
      this.sound.play('coin');
      this.addFloatingText("KALKAN KAZANILDI! 🛡️", item.x, item.y, '#38bdf8');
      this.particles.emit(item.x, item.y, 14, { color: ['#38bdf8', '#bae6fd'], speed: 4 });
    } else if (item.type === 'LIFE') {
      if (p.lives < p.maxLives) {
        p.lives++;
        this.sound.play('coin');
        this.addFloatingText("❤️ +1 CAN!", item.x, item.y, '#10b981');
        this.particles.emit(item.x, item.y, 18, { color: ['#10b981', '#34d399', '#fff'], speed: 5 });
      } else {
        this.score += 500;
        this.sound.play('coin');
        this.addFloatingText("+500 ⭐ (CAN DOLU)", item.x, item.y, '#fbbf24');
        this.particles.emit(item.x, item.y, 12, { color: ['#fbbf24', '#fef08a'], speed: 3 });
      }
      this.updateHUD();
    } else if (item.type === 'DOUBLE_JUMP') {
      if (p.doubleJumpCharges < p.maxDoubleJumpCharges) {
        p.doubleJumpCharges++;
        p.canDoubleJump = true;
        this.sound.play('coin');
        this.addFloatingText("✨ ÇİFT ZIPLAMA +1!", item.x, item.y, '#a855f7');
        this.particles.emit(item.x, item.y, 18, { color: ['#a855f7', '#d946ef', '#f0abfc', '#fff'], speed: 5 });
      } else {
        this.score += 300;
        this.sound.play('coin');
        this.addFloatingText("+300 ⭐ (ÇİFT ZIPLAMA DOLU)", item.x, item.y, '#fbbf24');
        this.particles.emit(item.x, item.y, 12, { color: ['#fbbf24', '#fef08a'], speed: 3 });
      }
      this.updateHUD();
    }
  }

  addFloatingText(text, x, y, color = '#fff') {
    this.floatingTexts.push({ text, x, y, alpha: 1.0, color });
  }

  loseLife() {
    const p = this.player;
    p.lives--;
    this.sound.play('hit_enemy');
    p.invulnerableTimer = 120;
    p.vy = p.jumpSpeed * 1.2;
    p.hasShield = false;

    this.addFloatingText(`❤️ CAN KAYBEDİLDİ! KALAN: ${p.lives}`, p.x, p.y - 30, '#ef4444');
    this.particles.emit(p.x + p.width / 2, p.y + p.height / 2, 20, {
      speed: 6,
      color: ['#ef4444', '#f87171', '#fff']
    });

    if (p.lives <= 0) {
      this.gameOver();
    }
    this.updateHUD();
  }

  gameOver() {
    this.state = 'GAMEOVER';
    this.sound.stopRocketSound();
    this.sound.play('game_over');
    this.updateTouchControlsPointerEvents();

    this.finalScoreEl.textContent = `${this.score}m`;
    this.highScoreEl.textContent = `${this.highScore}m`;

    const isNewRecord = this.isNewRecord(this.score);
    if (isNewRecord) {
      this.nameEntryScore.textContent = `${this.score}m`;
      this.nameEntryScreen.classList.remove('hidden');
      this.nameInputs[0].value = '';
      this.nameInputs[1].value = '';
      this.nameInputs[2].value = '';
      setTimeout(() => this.nameInputs[0].focus(), 100);
      return;
    }

    if (this.lastCheckpointHeight > 0) {
      this.reviveCpBtn.classList.remove('hidden');
      this.reviveCpBtn.textContent = `🚩 ${this.lastCheckpointHeight}m CHECKPOINT'TEN DEVAM ET`;
      this.cpRow.classList.remove('hidden');
      this.lastCpScoreEl.textContent = `${this.lastCheckpointHeight}m`;
    } else {
      this.reviveCpBtn.classList.add('hidden');
      this.cpRow.classList.add('hidden');
    }

    this.rocketBarContainer.classList.add('hidden');
    this.renderScoreboard(this.gameoverScoresList);
    this.gameOverScreen.classList.remove('hidden');
  }

  isNewRecord(score) {
    return score > 0 && (this.scores.length < 10 || score > this.scores[this.scores.length - 1].score);
  }

  async loadConfig() {
    try {
      const res = await fetch('config.json?t=' + Date.now());
      if (res.ok) {
        const cfg = await res.json();
        if (cfg.SCORES_RAW_URL) this.SCORES_RAW_URL = cfg.SCORES_RAW_URL;
        if (cfg.SCORES_API_URL) this.SCORES_API_URL = cfg.SCORES_API_URL;
        if (cfg.GITHUB_TOKEN) this.GITHUB_TOKEN = cfg.GITHUB_TOKEN;
      }
    } catch (e) {
      console.log('Config yüklenemedi, varsayılan URL kullanılıyor');
    }
  }

  async loadOnlineScores() {
    try {
      const res = await fetch(this.SCORES_RAW_URL + '?t=' + Date.now());
      if (res.ok) {
        const onlineScores = await res.json();
        if (Array.isArray(onlineScores) && onlineScores.length > 0) {
          this.scores = onlineScores;
          localStorage.setItem('skyclimber_scores', JSON.stringify(this.scores));
        }
      }
      const apiRes = await fetch(this.SCORES_API_URL, {
        headers: { 'Authorization': 'token ' + this.GITHUB_TOKEN, 'Accept': 'application/vnd.github+json' }
      });
      if (apiRes.ok) {
        const data = await apiRes.json();
        this.scoresSha = data.sha;
      }
      this.renderScoreboard(this.startScoresList);
      if (this.scores.length > 0) this.startScoreboard.classList.remove('hidden');
    } catch (e) {
      console.log('Online skor yüklenemedi:', e);
    }
  }

  async pushOnlineScores() {
    if (this.syncingScores) return;
    this.syncingScores = true;
    try {
      if (!this.scoresSha) {
        const apiRes = await fetch(this.SCORES_API_URL, {
          headers: { 'Authorization': 'token ' + this.GITHUB_TOKEN, 'Accept': 'application/vnd.github+json' }
        });
        if (apiRes.ok) {
          const data = await apiRes.json();
          this.scoresSha = data.sha;
        }
      }
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(this.scores, null, 2))));
      const body = { message: 'Update scores - ' + this.score + 'm', content: content };
      if (this.scoresSha) body.sha = this.scoresSha;
      const res = await fetch(this.SCORES_API_URL, {
        method: 'PUT',
        headers: {
          'Authorization': 'token ' + this.GITHUB_TOKEN,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const data = await res.json();
        this.scoresSha = data.content ? data.content.sha : this.scoresSha;
        console.log('Skorlar GitHub\'a push edildi!');
      }
    } catch (e) {
      console.log('GitHub push hatası:', e);
    }
    this.syncingScores = false;
  }

  saveScore(name) {
    this.scores.push({ name: name.toUpperCase(), score: this.score, date: Date.now() });
    this.scores.sort((a, b) => b.score - a.score);
    if (this.scores.length > 10) this.scores.length = 10;
    localStorage.setItem('skyclimber_scores', JSON.stringify(this.scores));
    this.pushOnlineScores();
  }

  renderScoreboard(targetEl) {
    if (!targetEl || this.scores.length === 0) return;
    targetEl.innerHTML = '';
    this.scores.forEach((s, i) => {
      const medals = ['🥇', '🥈', '🥉'];
      const rank = i < 3 ? medals[i] : `#${i + 1}`;
      const row = document.createElement('div');
      row.className = 'score-row';
      row.innerHTML = `<span class="score-rank">${rank}</span><span class="score-name">${s.name}</span><span class="score-points">${s.score}m</span>`;
      targetEl.appendChild(row);
    });
  }

  submitNameEntry() {
    const name = (this.nameInputs[0].value + this.nameInputs[1].value + this.nameInputs[2].value).toUpperCase();
    if (name.length < 3) {
      this.nameInputs.forEach(inp => { if (!inp.value) inp.focus(); });
      return;
    }
    this.saveScore(name);
    this.nameEntryScreen.classList.add('hidden');

    if (this.lastCheckpointHeight > 0) {
      this.reviveCpBtn.classList.remove('hidden');
      this.reviveCpBtn.textContent = `🚩 ${this.lastCheckpointHeight}m CHECKPOINT'TEN DEVAM ET`;
      this.cpRow.classList.remove('hidden');
      this.lastCpScoreEl.textContent = `${this.lastCheckpointHeight}m`;
    } else {
      this.reviveCpBtn.classList.add('hidden');
      this.cpRow.classList.add('hidden');
    }

    this.rocketBarContainer.classList.add('hidden');
    this.renderScoreboard(this.gameoverScoresList);
    this.gameOverScreen.classList.remove('hidden');
  }

  updateHUD() {
    this.hudScore.textContent = this.score;
    this.hudCP.textContent = `${this.lastCheckpointHeight}m`;
    if (this.hudLives) {
      this.hudLives.textContent = '❤️'.repeat(this.player.lives) + '🖤'.repeat(this.player.maxLives - this.player.lives);
    }
    if (this.hudJump) {
      const charges = this.player.doubleJumpCharges;
      this.hudJump.textContent = charges > 0 ? '✨' + '⚡'.repeat(charges) : '';
    }
  }

  // ==========================================
  // ÇİZİM FONKSİYONLARI (RENDER)
  // ==========================================
  draw() {
    this.ctx.clearRect(0, 0, this.width, this.height);

    this.drawDynamicBackground();
    this.drawStars();
    this.drawComets();
    this.drawPlanets();
    this.drawClouds();

    for (const plat of this.platforms) {
      this.drawPlatform(plat);
    }

    for (const item of this.items) {
      if (!item.collected) this.drawItem(item);
    }

    for (const enemy of this.enemies) {
      if (enemy.alive) this.drawEnemy(enemy);
    }

    this.particles.draw(this.ctx, this.cameraY);

    if (this.state === 'PLAYING' || this.state === 'PAUSED') {
      this.drawPlayer();
    }

    for (const ft of this.floatingTexts) {
      this.ctx.save();
      this.ctx.globalAlpha = Math.max(0, ft.alpha);
      this.ctx.font = 'bold 15px "Segoe UI", sans-serif';
      this.ctx.fillStyle = ft.color;
      this.ctx.textAlign = 'center';
      this.ctx.shadowColor = 'rgba(0,0,0,0.8)';
      this.ctx.shadowBlur = 6;
      this.ctx.fillText(ft.text, ft.x, ft.y - this.cameraY);
      this.ctx.restore();
    }
  }

  drawDynamicBackground() {
    this.ctx.save();
    const altitude = this.score;
    let topColor = '#0f172a';
    let bottomColor = '#1e293b';

    if (altitude < 350) {
      topColor = '#38bdf8';
      bottomColor = '#bae6fd';
    } else if (altitude < 900) {
      const t = (altitude - 350) / 550;
      topColor = this.lerpColor('#38bdf8', '#312e81', t);
      bottomColor = this.lerpColor('#bae6fd', '#f97316', t);
    } else if (altitude < 2000) {
      const t = (altitude - 900) / 1100;
      topColor = this.lerpColor('#312e81', '#0b0f19', t);
      bottomColor = this.lerpColor('#f97316', '#1e1b4b', t);
    } else if (altitude < 4500) {
      const t = (altitude - 2000) / 2500;
      topColor = this.lerpColor('#0b0f19', '#030712', t);
      bottomColor = this.lerpColor('#1e1b4b', '#1e1035', t);
    } else {
      topColor = '#020617';
      bottomColor = '#090514';
    }

    const grad = this.ctx.createLinearGradient(0, 0, 0, this.height);
    grad.addColorStop(0, topColor);
    grad.addColorStop(1, bottomColor);
    this.ctx.fillStyle = grad;
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.ctx.restore();
  }

  drawStars() {
    if (this.score < 250) return;
    this.ctx.save();
    const starAlpha = Math.min(1.0, (this.score - 250) / 500);

    for (const star of this.stars) {
      const renderY = ((star.y - this.cameraY * star.speed) % this.height + this.height) % this.height;
      this.ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha * starAlpha})`;
      this.ctx.beginPath();
      this.ctx.arc(star.x, renderY, star.size, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  drawComets() {
    for (const c of this.comets) {
      const ry = c.y - this.cameraY;
      this.ctx.save();
      this.ctx.globalAlpha = c.alpha;
      const grad = this.ctx.createLinearGradient(c.x, ry, c.x - c.vx * 3, ry - c.vy * 3);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.4, '#38bdf8');
      grad.addColorStop(1, 'transparent');
      this.ctx.strokeStyle = grad;
      this.ctx.lineWidth = 2.5;
      this.ctx.beginPath();
      this.ctx.moveTo(c.x, ry);
      this.ctx.lineTo(c.x - c.vx * 3, ry - c.vy * 3);
      this.ctx.stroke();
      this.ctx.restore();
    }
  }

  drawPlanets() {
    for (const p of this.planets) {
      const targetWorldY = -p.meter * 4;
      const ry = (targetWorldY - this.cameraY) * 0.45 + (this.height * 0.4);

      if (ry < -200 || ry > this.height + 200) continue;

      this.ctx.save();

      if (p.type === 'moon') {
        this.ctx.fillStyle = '#f8fafc';
        this.ctx.beginPath();
        this.ctx.arc(p.x, ry, p.size, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = '#cbd5e1';
        this.ctx.beginPath();
        this.ctx.arc(p.x - 12, ry - 8, 8, 0, Math.PI * 2);
        this.ctx.arc(p.x + 10, ry + 12, 10, 0, Math.PI * 2);
        this.ctx.arc(p.x - 5, ry + 15, 6, 0, Math.PI * 2);
        this.ctx.fill();

      } else if (p.type === 'earth_horizon') {
        const earthGrad = this.ctx.createRadialGradient(p.x, ry + 220, 50, p.x, ry + 220, p.size);
        earthGrad.addColorStop(0, '#0284c7');
        earthGrad.addColorStop(0.7, '#0369a1');
        earthGrad.addColorStop(0.9, '#38bdf8');
        earthGrad.addColorStop(1, 'transparent');
        this.ctx.fillStyle = earthGrad;
        this.ctx.beginPath();
        this.ctx.arc(p.x, ry + 220, p.size, 0, Math.PI * 2);
        this.ctx.fill();

      } else if (p.type === 'mars') {
        const marsGrad = this.ctx.createRadialGradient(p.x - 15, ry - 15, 5, p.x, ry, p.size);
        marsGrad.addColorStop(0, '#f87171');
        marsGrad.addColorStop(0.8, '#b91c1c');
        marsGrad.addColorStop(1, '#450a0a');
        this.ctx.fillStyle = marsGrad;
        this.ctx.beginPath();
        this.ctx.arc(p.x, ry, p.size, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = 'rgba(255,255,255,0.7)';
        this.ctx.beginPath();
        this.ctx.ellipse(p.x, ry - p.size + 6, 14, 5, 0, 0, Math.PI * 2);
        this.ctx.fill();

      } else if (p.type === 'jupiter') {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(p.x, ry, p.size, 0, Math.PI * 2);
        this.ctx.clip();

        const jupGrad = this.ctx.createLinearGradient(0, ry - p.size, 0, ry + p.size);
        jupGrad.addColorStop(0, '#d97706');
        jupGrad.addColorStop(0.2, '#fde68a');
        jupGrad.addColorStop(0.4, '#b45309');
        jupGrad.addColorStop(0.6, '#fef3c7');
        jupGrad.addColorStop(0.8, '#92400e');
        jupGrad.addColorStop(1, '#d97706');
        this.ctx.fillStyle = jupGrad;
        this.ctx.fillRect(p.x - p.size, ry - p.size, p.size * 2, p.size * 2);

        this.ctx.fillStyle = '#b91c1c';
        this.ctx.beginPath();
        this.ctx.ellipse(p.x + 22, ry + 15, 14, 9, 0, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();

      } else if (p.type === 'saturn') {
        this.ctx.strokeStyle = 'rgba(251, 191, 36, 0.75)';
        this.ctx.lineWidth = 14;
        this.ctx.beginPath();
        this.ctx.ellipse(p.x, ry, p.size * 1.8, p.size * 0.45, -0.35, Math.PI, Math.PI * 2);
        this.ctx.stroke();

        const satGrad = this.ctx.createRadialGradient(p.x - 10, ry - 10, 8, p.x, ry, p.size);
        satGrad.addColorStop(0, '#fef08a');
        satGrad.addColorStop(0.8, '#d97706');
        satGrad.addColorStop(1, '#78350f');
        this.ctx.fillStyle = satGrad;
        this.ctx.beginPath();
        this.ctx.arc(p.x, ry, p.size, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.beginPath();
        this.ctx.ellipse(p.x, ry, p.size * 1.8, p.size * 0.45, -0.35, 0, Math.PI);
        this.ctx.stroke();

      } else if (p.type === 'nebula') {
        const nebGrad = this.ctx.createRadialGradient(p.x, ry, 10, p.x, ry, p.size);
        nebGrad.addColorStop(0, 'rgba(168, 85, 247, 0.6)');
        nebGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.35)');
        nebGrad.addColorStop(1, 'transparent');
        this.ctx.fillStyle = nebGrad;
        this.ctx.beginPath();
        this.ctx.arc(p.x, ry, p.size, 0, Math.PI * 2);
        this.ctx.fill();
      }

      this.ctx.restore();
    }
  }

  drawClouds() {
    if (this.score > 700) return;
    const cloudAlpha = Math.max(0, 1.0 - this.score / 600);

    for (const c of this.clouds) {
      const ry = (c.y - this.cameraY * c.speed);
      if (ry < -60 || ry > this.height + 60) continue;

      this.ctx.save();
      this.ctx.globalAlpha = cloudAlpha * 0.65;
      this.ctx.fillStyle = '#ffffff';

      this.ctx.beginPath();
      this.ctx.arc(c.x, ry, 22 * c.scale, 0, Math.PI * 2);
      this.ctx.arc(c.x + 20 * c.scale, ry - 10 * c.scale, 26 * c.scale, 0, Math.PI * 2);
      this.ctx.arc(c.x + 45 * c.scale, ry, 20 * c.scale, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }
  }

  drawPlatform(plat) {
    const ry = plat.y - this.cameraY;
    if (ry < -50 || ry > this.height + 50) return;

    this.ctx.save();
    if (plat.broken) {
      this.ctx.globalAlpha = Math.max(0, plat.breakAlpha);
    }

    const r = 6;
    if (plat.type === 'GROUND') {
      const grad = this.ctx.createLinearGradient(0, ry, 0, ry + plat.height);
      grad.addColorStop(0, '#22c55e');
      grad.addColorStop(0.25, '#16a34a');
      grad.addColorStop(0.4, '#854d0e');
      grad.addColorStop(1, '#57300a');
      this.ctx.fillStyle = grad;
      this.ctx.fillRect(plat.x, ry, plat.width, plat.height);

      this.ctx.fillStyle = '#4ade80';
      for (let x = 0; x < plat.width; x += 15) {
        this.ctx.beginPath();
        this.ctx.arc(x + 7, ry, 5, 0, Math.PI);
        this.ctx.fill();
      }

    } else if (plat.type === 'CHECKPOINT') {
      const isActive = plat.activated;
      const pulse = isActive ? 0 : Math.sin(Date.now() / 300) * 0.3 + 0.7;
      const baseColor1 = isActive ? '#10b981' : '#38bdf8';
      const baseColor2 = isActive ? '#047857' : '#0284c7';
      const glowColor = isActive ? '#10b981' : '#ef4444';

      const grad = this.ctx.createLinearGradient(plat.x, ry, plat.x, ry + plat.height);
      grad.addColorStop(0, baseColor1);
      grad.addColorStop(1, baseColor2);
      this.ctx.fillStyle = grad;
      this.drawRoundedRect(plat.x, ry, plat.width, plat.height, r);
      this.ctx.fill();

      // Pulse glow effect
      if (!isActive) {
        this.ctx.shadowColor = glowColor;
        this.ctx.shadowBlur = 20 * pulse;
        this.ctx.fill();
        this.ctx.shadowBlur = 0;
      }

      // Golden border
      this.ctx.strokeStyle = isActive ? '#fbbf24' : '#f97316';
      this.ctx.lineWidth = 3;
      this.ctx.stroke();

      // Flag pole - center
      const flagPoleX = plat.x + plat.width / 2;
      this.ctx.fillStyle = '#cbd5e1';
      this.ctx.fillRect(flagPoleX - 2, ry - 45, 4, 45);

      // Flag - animated
      this.ctx.fillStyle = glowColor;
      this.ctx.beginPath();
      this.ctx.moveTo(flagPoleX + 2, ry - 45);
      this.ctx.lineTo(flagPoleX + 30, ry - 35);
      this.ctx.lineTo(flagPoleX + 2, ry - 25);
      this.ctx.closePath();
      this.ctx.fill();

      // Checkpoint text
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = 'bold 14px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(`🚩 CHECKPOINT ${plat.meter || Math.floor(-plat.y / 4)}m`, plat.x + plat.width / 2, ry + 18);

      // Arrow indicators pointing up
      if (!isActive) {
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        this.ctx.font = '20px sans-serif';
        this.ctx.fillText('▼', plat.x + plat.width / 2 - 30, ry - 55);
        this.ctx.fillText('▼', plat.x + plat.width / 2 + 30, ry - 55);
      }

    } else if (plat.type === 'MOVING') {
      const grad = this.ctx.createLinearGradient(plat.x, ry, plat.x, ry + plat.height);
      grad.addColorStop(0, '#60a5fa');
      grad.addColorStop(1, '#2563eb');
      this.ctx.fillStyle = grad;
      this.drawRoundedRect(plat.x, ry, plat.width, plat.height, r);
      this.ctx.fill();

      this.ctx.fillStyle = 'rgba(255,255,255,0.8)';
      this.ctx.font = 'bold 10px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('◄ ►', plat.x + plat.width / 2, ry + 12);

    } else if (plat.type === 'BREAKING') {
      this.ctx.fillStyle = '#92400e';
      this.drawRoundedRect(plat.x, ry, plat.width, plat.height, r);
      this.ctx.fill();
      
      this.ctx.strokeStyle = '#451a03';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(plat.x + 15, ry + 3);
      this.ctx.lineTo(plat.x + 35, ry + 13);
      this.ctx.lineTo(plat.x + 55, ry + 4);
      this.ctx.stroke();

    } else {
      const grad = this.ctx.createLinearGradient(plat.x, ry, plat.x, ry + plat.height);
      grad.addColorStop(0, '#4ade80');
      grad.addColorStop(1, '#16a34a');
      this.ctx.fillStyle = grad;
      this.drawRoundedRect(plat.x, ry, plat.width, plat.height, r);
      this.ctx.fill();

      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      this.ctx.fillRect(plat.x + 5, ry + 2, plat.width - 10, 3);
    }

    this.ctx.restore();
  }

  drawItem(item) {
    const ry = item.y - this.cameraY;
    if (ry < -35 || ry > this.height + 35) return;

    this.ctx.save();
    this.ctx.translate(item.x, ry);

    if (item.type === 'COIN') {
      this.drawStar(0, 0, 5, 11, 5.5, '#fbbf24', '#f59e0b');

    } else if (item.type === 'SPRING') {
      this.ctx.strokeStyle = '#38bdf8';
      this.ctx.lineWidth = 3.5;
      this.ctx.lineCap = 'round';
      this.ctx.beginPath();
      this.ctx.moveTo(-10, 8);
      this.ctx.lineTo(10, 8);
      this.ctx.moveTo(-8, 8);
      this.ctx.lineTo(8, 2);
      this.ctx.lineTo(-8, -4);
      this.ctx.lineTo(8, -10);
      this.ctx.stroke();

      this.ctx.fillStyle = '#0284c7';
      this.ctx.fillRect(-10, -12, 20, 3.5);

    } else if (item.type === 'ROCKET') {
      this.ctx.fillStyle = '#ef4444';
      this.ctx.beginPath();
      this.ctx.moveTo(-10, 6);
      this.ctx.lineTo(-14, 12);
      this.ctx.lineTo(-6, 10);
      this.ctx.fill();

      this.ctx.beginPath();
      this.ctx.moveTo(10, 6);
      this.ctx.lineTo(14, 12);
      this.ctx.lineTo(6, 10);
      this.ctx.fill();

      const bodyGrad = this.ctx.createLinearGradient(-7, 0, 7, 0);
      bodyGrad.addColorStop(0, '#f1f5f9');
      bodyGrad.addColorStop(0.5, '#ffffff');
      bodyGrad.addColorStop(1, '#cbd5e1');
      this.ctx.fillStyle = bodyGrad;
      this.ctx.beginPath();
      this.ctx.ellipse(0, 0, 7, 12, 0, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.fillStyle = '#ef4444';
      this.ctx.beginPath();
      this.ctx.moveTo(-6, -6);
      this.ctx.lineTo(0, -15);
      this.ctx.lineTo(6, -6);
      this.ctx.closePath();
      this.ctx.fill();

      this.ctx.fillStyle = '#38bdf8';
      this.ctx.beginPath();
      this.ctx.arc(0, -2, 3.5, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.fillStyle = '#f97316';
      this.ctx.beginPath();
      this.ctx.moveTo(-4, 10);
      this.ctx.lineTo(0, 15);
      this.ctx.lineTo(4, 10);
      this.ctx.fill();

    } else if (item.type === 'SHIELD') {
      this.ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
      this.ctx.strokeStyle = '#38bdf8';
      this.ctx.lineWidth = 2.5;
      this.ctx.beginPath();
      this.ctx.moveTo(0, -12);
      this.ctx.lineTo(10, -6);
      this.ctx.lineTo(10, 4);
      this.ctx.lineTo(0, 12);
      this.ctx.lineTo(-10, 4);
      this.ctx.lineTo(-10, -6);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      this.ctx.fillStyle = '#ffffff';
      this.ctx.beginPath();
      this.ctx.arc(0, -1, 3, 0, Math.PI * 2);
      this.ctx.fill();
    } else if (item.type === 'LIFE') {
      const pulse = Math.sin(Date.now() / 200) * 0.2 + 1.0;
      this.ctx.save();
      this.ctx.scale(pulse, pulse);

      this.ctx.fillStyle = 'rgba(16, 185, 129, 0.3)';
      this.ctx.strokeStyle = '#10b981';
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.moveTo(0, -12);
      this.ctx.lineTo(10, -4);
      this.ctx.lineTo(10, 6);
      this.ctx.lineTo(0, 14);
      this.ctx.lineTo(-10, 6);
      this.ctx.lineTo(-10, -4);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      this.ctx.fillStyle = '#ef4444';
      this.ctx.beginPath();
      this.ctx.moveTo(0, -8);
      this.ctx.lineTo(7, -2);
      this.ctx.lineTo(7, 8);
      this.ctx.lineTo(0, 12);
      this.ctx.lineTo(-7, 8);
      this.ctx.lineTo(-7, -2);
      this.ctx.closePath();
      this.ctx.fill();

      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = 'bold 14px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('❤', 0, 4);

      this.ctx.restore();
    } else if (item.type === 'DOUBLE_JUMP') {
      const pulse = Math.sin(Date.now() / 180) * 0.15 + 1.0;
      this.ctx.save();
      this.ctx.scale(pulse, pulse);

      // Wings
      this.ctx.fillStyle = 'rgba(168, 85, 247, 0.3)';
      this.ctx.strokeStyle = '#a855f7';
      this.ctx.lineWidth = 2.5;
      this.ctx.beginPath();
      this.ctx.moveTo(-12, -2);
      this.ctx.bezierCurveTo(-18, -8, -18, 6, -12, 2);
      this.ctx.bezierCurveTo(-6, 4, -6, -4, -12, -2);
      this.ctx.fill();
      this.ctx.stroke();

      this.ctx.beginPath();
      this.ctx.moveTo(12, -2);
      this.ctx.bezierCurveTo(18, -8, 18, 6, 12, 2);
      this.ctx.bezierCurveTo(6, 4, 6, -4, 12, -2);
      this.ctx.fill();
      this.ctx.stroke();

      // Center star
      this.ctx.fillStyle = '#a855f7';
      this.ctx.beginPath();
      this.ctx.moveTo(0, -10);
      this.ctx.lineTo(3, -2);
      this.ctx.lineTo(10, -1);
      this.ctx.lineTo(4, 4);
      this.ctx.lineTo(6, 11);
      this.ctx.lineTo(0, 7);
      this.ctx.lineTo(-6, 11);
      this.ctx.lineTo(-4, 4);
      this.ctx.lineTo(-10, -1);
      this.ctx.lineTo(-3, -2);
      this.ctx.closePath();
      this.ctx.fill();

      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = 'bold 12px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('2x', 0, 3);

      this.ctx.restore();
    }

    this.ctx.restore();
  }

  drawStar(cx, cy, spikes, outerRadius, innerRadius, fill1, fill2) {
    let rot = Math.PI / 2 * 3;
    let x = cx;
    let y = cy;
    let step = Math.PI / spikes;

    this.ctx.beginPath();
    this.ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
      x = cx + Math.cos(rot) * outerRadius;
      y = cy + Math.sin(rot) * outerRadius;
      this.ctx.lineTo(x, y);
      rot += step;

      x = cx + Math.cos(rot) * innerRadius;
      y = cy + Math.sin(rot) * innerRadius;
      this.ctx.lineTo(x, y);
      rot += step;
    }
    this.ctx.lineTo(cx, cy - outerRadius);
    this.ctx.closePath();

    const grad = this.ctx.createRadialGradient(cx, cy, innerRadius * 0.5, cx, cy, outerRadius);
    grad.addColorStop(0, fill1);
    grad.addColorStop(1, fill2);
    this.ctx.fillStyle = grad;
    this.ctx.fill();
    this.ctx.strokeStyle = '#d97706';
    this.ctx.lineWidth = 1.2;
    this.ctx.stroke();
  }

  drawEnemy(enemy) {
    const ry = enemy.y - this.cameraY;
    if (ry < -40 || ry > this.height + 40) return;

    this.ctx.save();
    const wingY = Math.sin(enemy.flap) * 4;

    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    this.ctx.beginPath();
    this.ctx.ellipse(enemy.x + 5, ry + 12 + wingY, 9, 5, -0.4, 0, Math.PI * 2);
    this.ctx.ellipse(enemy.x + enemy.width - 5, ry + 12 + wingY, 9, 5, 0.4, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.fillStyle = '#ec4899';
    this.ctx.beginPath();
    this.ctx.arc(enemy.x + enemy.width / 2, ry + enemy.height / 2, 16, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.fillStyle = '#ffffff';
    this.ctx.beginPath();
    this.ctx.arc(enemy.x + enemy.width / 2, ry + enemy.height / 2 - 2, 8, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.fillStyle = '#831843';
    this.ctx.beginPath();
    this.ctx.arc(enemy.x + enemy.width / 2 + (enemy.vx > 0 ? 3 : -3), ry + enemy.height / 2 - 2, 4, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.fillStyle = '#fbbf24';
    this.ctx.beginPath();
    this.ctx.moveTo(enemy.x + 10, ry + 4);
    this.ctx.lineTo(enemy.x + 13, ry - 3);
    this.ctx.lineTo(enemy.x + 16, ry + 4);
    this.ctx.moveTo(enemy.x + enemy.width - 10, ry + 4);
    this.ctx.lineTo(enemy.x + enemy.width - 13, ry - 3);
    this.ctx.lineTo(enemy.x + enemy.width - 16, ry + 4);
    this.ctx.fill();

    this.ctx.restore();
  }

  drawPlayer() {
    const p = this.player;
    const rx = p.x + p.width / 2;
    const ry = p.y + p.height / 2 - this.cameraY;

    this.ctx.save();
    this.ctx.translate(rx, ry);

    if (p.invulnerableTimer > 0 && Math.floor(p.invulnerableTimer / 4) % 2 === 0) {
      this.ctx.globalAlpha = 0.4;
    }

    const scaleX = (p.facing === 'left' ? -1 : 1) * (2.0 - p.squish);
    const scaleY = p.squish;
    this.ctx.scale(scaleX, scaleY);

    if (p.hasShield) {
      this.ctx.strokeStyle = '#38bdf8';
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, 26, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
      this.ctx.fill();
    }

    if (p.rocketTimer > 0) {
      this.ctx.fillStyle = '#64748b';
      this.ctx.fillRect(-18, -10, 8, 22);
      this.ctx.fillStyle = '#ef4444';
      this.ctx.beginPath();
      this.ctx.moveTo(-18, -10);
      this.ctx.lineTo(-14, -18);
      this.ctx.lineTo(-10, -10);
      this.ctx.fill();
    }

    const bodyGrad = this.ctx.createLinearGradient(0, -16, 0, 16);
    bodyGrad.addColorStop(0, '#a3e635');
    bodyGrad.addColorStop(1, '#65a30d');
    this.ctx.fillStyle = bodyGrad;
    this.ctx.beginPath();
    this.ctx.ellipse(0, 0, 16, 17, 0, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.fillStyle = '#d9f99d';
    this.ctx.beginPath();
    this.ctx.ellipse(4, 3, 9, 10, 0, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.fillStyle = '#ffffff';
    this.ctx.beginPath();
    this.ctx.arc(6, -4, 6.5, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.fillStyle = '#0f172a';
    this.ctx.beginPath();
    this.ctx.arc(8, -4, 3.5, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.fillStyle = '#ffffff';
    this.ctx.beginPath();
    this.ctx.arc(9.5, -5.5, 1.5, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.fillStyle = '#4d7c0f';
    this.ctx.beginPath();
    this.ctx.ellipse(-6, 16, 4, 3, 0, 0, Math.PI * 2);
    this.ctx.ellipse(6, 16, 4, 3, 0, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.restore();
  }

  drawRoundedRect(x, y, w, h, r) {
    this.ctx.beginPath();
    this.ctx.moveTo(x + r, y);
    this.ctx.lineTo(x + w - r, y);
    this.ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    this.ctx.lineTo(x + w, y + h - r);
    this.ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.ctx.lineTo(x + r, y + h);
    this.ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    this.ctx.lineTo(x, y + r);
    this.ctx.quadraticCurveTo(x, y, x + r, y);
    this.ctx.closePath();
  }

  lerpColor(a, b, amount) {
    const ah = parseInt(a.replace(/#/g, ''), 16);
    const ar = ah >> 16, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
    const bh = parseInt(b.replace(/#/g, ''), 16);
    const br = bh >> 16, bg = (bh >> 8) & 0xff, bb = bh & 0xff;
    const rr = Math.round(ar + amount * (br - ar));
    const rg = Math.round(ag + amount * (bg - ag));
    const rb = Math.round(ab + amount * (bb - ab));
    return `#${((1 << 24) + (rr << 16) + (rg << 8) + rb).toString(16).slice(1)}`;
  }
}

window.addEventListener('load', () => {
  window.game = new Game();
});
