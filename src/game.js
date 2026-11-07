/**
 * Core Flappysky Simulation — Classic Physics, Rounded Blue Pillars, and Collectible Likes
 */

export const VIRTUAL_HEIGHT = 540;
export const CLOUD_TILE_WIDTH = 440;

const FLOOR_Y = VIRTUAL_HEIGHT - 38;
const CEILING_Y = 16;

// Classic Flappysky tuning
const GRAVITY = 1060;
const FLAP_VELOCITY = -355;
const BASE_SCROLL_SPEED = 215;
const MAX_SCROLL_SPEED = 295;
const GAP_HEIGHT = 168;
const PILLAR_SPACING = 290;

const PILLAR_POINTS = 1;
const LIKE_POINTS = 1;
const BEST_SCORE_KEY = 'flappysky_best_score';

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function distSqToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq === 0) return apx * apx + apy * apy;
  const t = clamp((apx * abx + apy * aby) / abLenSq, 0, 1);
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

export class FlappyskyGame {
  constructor({ audio, onScoreChange, onGameOver, onStateChange }) {
    this.audio = audio;
    this.onScoreChange = onScoreChange;
    this.onGameOver = onGameOver;
    this.onStateChange = onStateChange;

    this.virtualWidth = 960;
    this.state = 'menu'; // 'menu' | 'ready' | 'playing' | 'paused' | 'gameover'
    this.time = 0;
    this.gameOverTimestamp = 0;

    this.bestScore = this.loadBestScore();
    this.score = 0;
    this.pillarsCleared = 0;
    this.likesCollected = 0;
    this.isNewBest = false;

    this.isHoldingInput = false;
    this.holdTimer = 0;
    this.nextHoldFlutter = 0;

    // Continuously integrated scroll offsets (prevents stutter when speed changes)
    this.floorFrontScroll = 0;
    this.floorMidScroll = 0;

    this.pillars = [];
    this.likes = [];
    this.particles = [];
    this.popups = [];
    this.spawnCounter = 0;
    this.paletteCursor = 0;
    this.flashAlpha = 0;

    this.butterfly = {
      x: 220,
      y: VIRTUAL_HEIGHT * 0.45,
      vy: 0,
      radius: 14,
      tilt: 0,
      wingPhase: 0,
      flapEnergy: 0.25
    };

    this.clouds = this.createInitialClouds();
  }

  loadBestScore() {
    try {
      const raw = localStorage.getItem(BEST_SCORE_KEY);
      const parsed = Number.parseInt(raw || '0', 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch {
      return 0;
    }
  }

  saveBestScore(score) {
    try {
      localStorage.setItem(BEST_SCORE_KEY, String(score));
    } catch {
      // Ignore storage errors
    }
  }

  createInitialClouds() {
    const list = [];
    for (let i = 0; i < 11; i++) {
      list.push({
        x: (i / 11) * 1300,
        y: 42 + ((i * 73) % 330),
        scale: 0.55 + ((i * 37) % 75) / 100,
        layer: i % 3 // 0 = far, 1 = mid, 2 = near
      });
    }
    return list;
  }

  setViewportAspect(width, height) {
    if (height <= 0) return;
    const aspect = width / height;
    this.virtualWidth = clamp(Math.round(VIRTUAL_HEIGHT * aspect), 420, 1440);
    this.butterfly.x = clamp(Math.round(this.virtualWidth * 0.26), 115, 260);
  }

  get currentScrollSpeed() {
    const ramp = Math.min(1, this.pillarsCleared / 35);
    return BASE_SCROLL_SPEED + (MAX_SCROLL_SPEED - BASE_SCROLL_SPEED) * ramp;
  }

  setState(nextState) {
    this.state = nextState;
    if (this.onStateChange) this.onStateChange(nextState);
  }

  resetRun() {
    this.score = 0;
    this.pillarsCleared = 0;
    this.likesCollected = 0;
    this.isNewBest = false;
    this.pillars = [];
    this.likes = [];
    this.particles = [];
    this.popups = [];
    this.spawnCounter = 0;
    this.flashAlpha = 0;

    this.isHoldingInput = false;
    this.holdTimer = 0;
    this.nextHoldFlutter = 0;

    this.butterfly.y = VIRTUAL_HEIGHT * 0.45;
    this.butterfly.vy = 0;
    this.butterfly.tilt = 0;
    this.butterfly.flapEnergy = 0.35;

    if (this.onScoreChange) {
      this.onScoreChange({
        score: this.score,
        likes: this.likesCollected,
        best: this.bestScore
      });
    }
  }

  startReady() {
    this.resetRun();
    this.setState('ready');
  }

  returnToMenu() {
    this.resetRun();
    this.setState('menu');
  }

  pause() {
    if (this.state === 'playing' || this.state === 'ready') {
      this.isHoldingInput = false;
      this.previousPlayState = this.state;
      this.setState('paused');
    }
  }

  resume() {
    if (this.state === 'paused') {
      this.setState(this.previousPlayState || 'playing');
    }
  }

  pressStart(reducedMotion = false) {
    if (this.state === 'ready') {
      this.setState('playing');
      this.seedInitialObstacles();
      this.flap(1.0, reducedMotion);
      this.isHoldingInput = true;
      this.holdTimer = 0;
      this.nextHoldFlutter = 0.185;
      return true;
    }

    if (this.state === 'playing') {
      this.flap(1.0, reducedMotion);
      this.isHoldingInput = true;
      this.holdTimer = 0;
      this.nextHoldFlutter = 0.185;
      return true;
    }

    return false;
  }

  pressEnd() {
    this.isHoldingInput = false;
    this.holdTimer = 0;
  }

  flap(power = 1.0, reducedMotion = false) {
    this.butterfly.vy = FLAP_VELOCITY * power;
    this.butterfly.flapEnergy = 1.0;
    this.audio.playFlap();

    if (!reducedMotion) {
      const count = power >= 0.95 ? 6 : 3;
      for (let i = 0; i < count; i++) {
        const angle = Math.PI * (0.65 + Math.random() * 0.55);
        const speed = 45 + Math.random() * 85;
        this.particles.push({
          x: this.butterfly.x - 10,
          y: this.butterfly.y + 4 + (Math.random() - 0.5) * 10,
          vx: Math.cos(angle) * speed - 40,
          vy: Math.sin(angle) * speed * 0.6 + 25,
          size: 2.5 + Math.random() * 3,
          life: 1,
          decay: 2.1 + Math.random() * 1.1,
          color: i % 2 === 0 ? '#7DD3FC' : '#FFFFFF'
        });
      }
    }
  }

  seedInitialObstacles() {
    const startX = Math.max(this.butterfly.x + 360, this.virtualWidth * 0.72);
    for (let i = 0; i < 4; i++) {
      this.spawnSection(startX + i * PILLAR_SPACING);
    }
  }

  spawnSection(x) {
    this.spawnCounter += 1;
    const index = this.spawnCounter;
    const width = 72;
    const radius = width / 2;

    const paletteIndex = this.paletteCursor % 6;
    this.paletteCursor += 1;

    const minGapY = CEILING_Y + 58 + GAP_HEIGHT / 2;
    const maxGapY = FLOOR_Y - 58 - GAP_HEIGHT / 2;
    const prevGapY =
      this.pillars.length > 0
        ? this.pillars[this.pillars.length - 1].gapY
        : VIRTUAL_HEIGHT * 0.47;
    const maxDelta = 135;
    const targetGapY = clamp(
      prevGapY + (Math.random() * 2 - 1) * maxDelta,
      minGapY,
      maxGapY
    );

    const topEnd = targetGapY - GAP_HEIGHT / 2;
    const bottomStart = targetGapY + GAP_HEIGHT / 2;

    this.pillars.push({
      x,
      width,
      radius,
      gapY: targetGapY,
      gapHeight: GAP_HEIGHT,
      topEnd,
      bottomStart,
      palette: paletteIndex,
      scored: false
    });

    // Spawn a collectible Like (red heart, +1 pt) in ~72% of sections
    if (index === 1 || Math.random() < 0.72) {
      const placeInGap = Math.random() < 0.55;
      if (placeInGap) {
        const offsetY = (Math.random() - 0.5) * (GAP_HEIGHT * 0.42);
        this.likes.push({
          x,
          baseY: targetGapY + offsetY,
          y: targetGapY + offsetY,
          radius: 15,
          phase: Math.random() * Math.PI * 2,
          collected: false
        });
      } else {
        const midX = x + PILLAR_SPACING * 0.5;
        const midY = clamp(
          targetGapY + (Math.random() - 0.5) * 95,
          CEILING_Y + 80,
          FLOOR_Y - 80
        );
        this.likes.push({
          x: midX,
          baseY: midY,
          y: midY,
          radius: 15,
          phase: Math.random() * Math.PI * 2,
          collected: false
        });
      }
    }
  }

  update(dt, { reducedMotion = false } = {}) {
    const safeDt = Math.min(dt, 0.05);
    this.time += safeDt;

    if (this.flashAlpha > 0) {
      this.flashAlpha = Math.max(0, this.flashAlpha - safeDt * 3.2);
    }

    const isPausedOrOver = this.state === 'paused' || this.state === 'gameover';
    const worldScrollSpeed =
      this.state === 'playing'
        ? this.currentScrollSpeed
        : isPausedOrOver
          ? 0
          : reducedMotion
            ? 14
            : 42;

    // Smoothly advance background & bottom cloud layers via integration (zero stutter!)
    const cloudBaseSpeed =
      this.state === 'playing'
        ? this.currentScrollSpeed * 0.24
        : isPausedOrOver
          ? 0
          : reducedMotion
            ? 8
            : 24;

    for (const c of this.clouds) {
      const layerFactor = c.layer === 0 ? 0.45 : c.layer === 1 ? 0.75 : 1.1;
      c.x -= cloudBaseSpeed * layerFactor * safeDt;
      if (c.x < -160) {
        c.x = this.virtualWidth + 140 + Math.random() * 80;
        c.y = 40 + Math.random() * 330;
      }
    }

    this.floorFrontScroll =
      (this.floorFrontScroll + worldScrollSpeed * safeDt) % CLOUD_TILE_WIDTH;
    this.floorMidScroll =
      (this.floorMidScroll + worldScrollSpeed * 0.55 * safeDt) % CLOUD_TILE_WIDTH;

    // Update particles & +1 popups
    this.updateEffects(safeDt);

    if (this.state === 'menu' || this.state === 'ready') {
      const hoverAmp = reducedMotion ? 3 : 9;
      this.butterfly.y = VIRTUAL_HEIGHT * 0.45 + Math.sin(this.time * 3.1) * hoverAmp;
      this.butterfly.vy = 0;
      this.butterfly.tilt = Math.sin(this.time * 3.1 - 0.6) * 0.08;
      const rate = reducedMotion ? 8 : 17;
      this.butterfly.wingPhase += safeDt * rate;
      this.butterfly.flapEnergy = 0.35;
      return;
    }

    if (this.state !== 'playing') {
      return;
    }

    // Sustained flutter when holding Spacebar, Mouse, or Touch beyond tap threshold
    if (this.isHoldingInput) {
      this.holdTimer += safeDt;
      if (this.holdTimer >= this.nextHoldFlutter) {
        this.nextHoldFlutter += 0.155;
        this.flap(0.84, reducedMotion);
      }
    }

    // Butterfly vertical kinematics
    this.butterfly.vy = clamp(this.butterfly.vy + GRAVITY * safeDt, -520, 560);
    this.butterfly.y += this.butterfly.vy * safeDt;

    // Smooth expressive pitch & pleasant wing flutter decay
    const targetTilt = clamp(this.butterfly.vy * 0.00125, -0.46, 0.72);
    this.butterfly.tilt += (targetTilt - this.butterfly.tilt) * Math.min(1, safeDt * 12);
    this.butterfly.flapEnergy = Math.max(0.18, this.butterfly.flapEnergy - safeDt * 1.9);

    const flutterHz = reducedMotion ? 10 : 14 + this.butterfly.flapEnergy * 24;
    this.butterfly.wingPhase += safeDt * flutterHz;

    // Ceiling clamp & cloud-floor collision
    if (this.butterfly.y - this.butterfly.radius < CEILING_Y) {
      this.butterfly.y = CEILING_Y + this.butterfly.radius;
      if (this.butterfly.vy < 0) this.butterfly.vy = 0;
    }

    if (this.butterfly.y + this.butterfly.radius >= FLOOR_Y) {
      this.butterfly.y = FLOOR_Y - this.butterfly.radius;
      this.triggerGameOver(reducedMotion);
      return;
    }

    // Scroll pillars & Likes
    const speed = this.currentScrollSpeed;
    for (const pillar of this.pillars) {
      pillar.x -= speed * safeDt;

      if (!pillar.scored && pillar.x + pillar.radius < this.butterfly.x) {
        pillar.scored = true;
        this.pillarsCleared += 1;
        this.addPoints(PILLAR_POINTS);
        this.audio.playScore();

        // Blue +1 pop-up when clearing a set of pillars
        this.popups.push({
          x: this.butterfly.x + 6,
          y: this.butterfly.y - 24,
          vy: -44,
          life: 1,
          text: `+${PILLAR_POINTS}`,
          color: '#0085FF'
        });
      }
    }

    for (const like of this.likes) {
      like.x -= speed * safeDt;
      like.y = like.baseY + Math.sin(this.time * 4.4 + like.phase) * (reducedMotion ? 2 : 7);
    }

    // Keep horizon populated across any screen aspect ratio
    const rightmostX =
      this.pillars.length > 0 ? this.pillars[this.pillars.length - 1].x : this.butterfly.x;
    if (rightmostX < this.virtualWidth + 240) {
      this.spawnSection(rightmostX + PILLAR_SPACING);
    }

    // Prune off-screen entities
    this.pillars = this.pillars.filter((pl) => pl.x + pl.radius > -100);
    this.likes = this.likes.filter((lk) => !lk.collected && lk.x + lk.radius > -80);

    // Check collectible Likes
    this.checkLikePickups(reducedMotion);

    // Check Rounded Pillar Collisions
    if (this.checkPillarCollisions()) {
      this.triggerGameOver(reducedMotion);
    }
  }

  updateEffects(dt) {
    for (const pt of this.particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.life -= pt.decay * dt;
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);

    for (const pop of this.popups) {
      pop.y += pop.vy * dt;
      pop.life -= dt * 1.18;
    }
    this.popups = this.popups.filter((pop) => pop.life > 0);
  }

  addPoints(delta) {
    this.score += delta;
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      this.isNewBest = true;
      this.saveBestScore(this.bestScore);
    }
    if (this.onScoreChange) {
      this.onScoreChange({
        score: this.score,
        likes: this.likesCollected,
        best: this.bestScore
      });
    }
  }

  checkLikePickups(reducedMotion) {
    const bx = this.butterfly.x;
    const by = this.butterfly.y;
    const br = this.butterfly.radius + 4;

    for (const like of this.likes) {
      if (like.collected) continue;
      const dx = bx - like.x;
      const dy = by - like.y;
      const rSum = br + like.radius;
      if (dx * dx + dy * dy <= rSum * rSum) {
        like.collected = true;
        this.likesCollected += 1;
        this.addPoints(LIKE_POINTS);
        this.audio.playLike();

        // Red +1 pop-up when collecting a Like
        this.popups.push({
          x: like.x,
          y: like.y - 12,
          vy: -44,
          life: 1,
          text: `+${LIKE_POINTS}`,
          color: '#FF1E42'
        });

        if (!reducedMotion) {
          for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const spd = 65 + Math.random() * 70;
            this.particles.push({
              x: like.x,
              y: like.y,
              vx: Math.cos(angle) * spd,
              vy: Math.sin(angle) * spd,
              size: 3.5 + Math.random() * 3,
              life: 1,
              decay: 1.8 + Math.random() * 0.7,
              color: i % 3 === 0 ? '#FFE4E9' : '#FF2442'
            });
          }
        }
      }
    }
  }

  checkPillarCollisions() {
    const bx = this.butterfly.x;
    const by = this.butterfly.y;
    const br = this.butterfly.radius;

    for (const pillar of this.pillars) {
      if (Math.abs(bx - pillar.x) > pillar.radius + br + 8) continue;

      const capRadiusSumSq = (pillar.radius + br) * (pillar.radius + br);

      // Top rounded pillar capsule: vertical spine from -40 to (topEnd - radius)
      const topSpineEnd = pillar.topEnd - pillar.radius;
      if (distSqToSegment(bx, by, pillar.x, -40, pillar.x, topSpineEnd) < capRadiusSumSq) {
        return true;
      }

      // Bottom rounded pillar capsule: vertical spine from (bottomStart + radius) to VIRTUAL_HEIGHT + 40
      const botSpineStart = pillar.bottomStart + pillar.radius;
      if (
        distSqToSegment(bx, by, pillar.x, botSpineStart, pillar.x, VIRTUAL_HEIGHT + 40) <
        capRadiusSumSq
      ) {
        return true;
      }
    }

    return false;
  }

  triggerGameOver(reducedMotion = false) {
    this.isHoldingInput = false;
    this.gameOverTimestamp = performance.now();
    this.flashAlpha = reducedMotion ? 0.15 : 0.45;
    this.audio.playCrash();

    if (!reducedMotion) {
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        const spd = 55 + Math.random() * 110;
        this.particles.push({
          x: this.butterfly.x,
          y: this.butterfly.y,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd,
          size: 3 + Math.random() * 3.5,
          life: 1,
          decay: 1.5 + Math.random() * 0.8,
          color: i % 2 === 0 ? '#0085FF' : '#FFFFFF'
        });
      }
    }

    this.setState('gameover');
    if (this.onGameOver) {
      this.onGameOver({
        score: this.score,
        best: this.bestScore,
        pillars: this.pillarsCleared,
        likes: this.likesCollected,
        isNewBest: this.isNewBest
      });
    }
  }
}
