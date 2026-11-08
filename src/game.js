/**
 * Core Flappysky Simulation — Classic Physics, Rounded-Rectangle Blue Posts, and Collectible Likes
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
const POST_SPACING = 290;

const POST_POINTS = 1;
const LIKE_POINTS = 1;
const BEST_SCORE_KEY = 'flappysky_best_score';

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function circleIntersectsRoundedRect(cx, cy, crCircle, rx, ry, rw, rh, rCorner) {
  const r = Math.min(rCorner, rw * 0.5, rh * 0.5);
  const closestX = clamp(cx, rx + r, rx + rw - r);
  const closestY = clamp(cy, ry + r, ry + rh - r);
  const dx = cx - closestX;
  const dy = cy - closestY;
  const totalR = crCircle + r;
  return dx * dx + dy * dy < totalR * totalR;
}

export class FlappyskyGame {
  constructor({ audio, onScoreChange, onLikeCollected, onGameOver, onStateChange }) {
    this.audio = audio;
    this.onScoreChange = onScoreChange;
    this.onLikeCollected = onLikeCollected;
    this.onGameOver = onGameOver;
    this.onStateChange = onStateChange;

    this.virtualWidth = 960;
    this.state = 'menu'; // 'menu' | 'ready' | 'playing' | 'paused' | 'gameover'
    this.time = 0;
    this.gameOverTimestamp = 0;

    this.bestScore = this.loadBestScore();
    this.score = 0;
    this.postsCleared = 0;
    this.likesCollected = 0;
    this.isNewBest = false;

    this.isHoldingInput = false;
    this.holdTimer = 0;
    this.nextHoldFlutter = 0;

    // Continuously integrated scroll offsets (prevents stutter when speed changes)
    this.floorFrontScroll = 0;
    this.floorMidScroll = 0;

    this.posts = [];
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

  syncBestScore(externalBest) {
    const parsed = Math.trunc(Number(externalBest) || 0);
    if (parsed > this.bestScore) {
      this.bestScore = parsed;
      this.saveBestScore(this.bestScore);
      if (this.onScoreChange) {
        this.onScoreChange({
          score: this.score,
          likes: this.likesCollected,
          best: this.bestScore
        });
      }
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
    const ramp = Math.min(1, this.postsCleared / 35);
    return BASE_SCROLL_SPEED + (MAX_SCROLL_SPEED - BASE_SCROLL_SPEED) * ramp;
  }

  setState(nextState) {
    this.state = nextState;
    if (this.onStateChange) this.onStateChange(nextState);
  }

  resetRun() {
    this.score = 0;
    this.postsCleared = 0;
    this.likesCollected = 0;
    this.isNewBest = false;
    this.posts = [];
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
      this.spawnSection(startX + i * POST_SPACING);
    }
  }

  spawnSection(x) {
    this.spawnCounter += 1;
    const index = this.spawnCounter;
    const width = 72;
    const halfWidth = width / 2;
    const cornerRadius = 12;

    const paletteIndex = this.paletteCursor % 6;
    this.paletteCursor += 1;

    const minGapY = CEILING_Y + 58 + GAP_HEIGHT / 2;
    const maxGapY = FLOOR_Y - 58 - GAP_HEIGHT / 2;
    const prevGapY =
      this.posts.length > 0
        ? this.posts[this.posts.length - 1].gapY
        : VIRTUAL_HEIGHT * 0.47;
    const maxDelta = 135;
    const targetGapY = clamp(
      prevGapY + (Math.random() * 2 - 1) * maxDelta,
      minGapY,
      maxGapY
    );

    const topEnd = targetGapY - GAP_HEIGHT / 2;
    const bottomStart = targetGapY + GAP_HEIGHT / 2;

    this.posts.push({
      x,
      width,
      halfWidth,
      cornerRadius,
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
        const midX = x + POST_SPACING * 0.5;
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
      this.triggerGameOver(reducedMotion, 'ground');
      return;
    }

    // Scroll posts & Likes
    const speed = this.currentScrollSpeed;
    for (const post of this.posts) {
      post.x -= speed * safeDt;

      if (!post.scored && post.x + post.halfWidth < this.butterfly.x) {
        post.scored = true;
        this.postsCleared += 1;
        this.addPoints(POST_POINTS);
        this.audio.playScore();

        // Blue +1 pop-up when clearing a set of posts
        this.popups.push({
          x: this.butterfly.x + 6,
          y: this.butterfly.y - 24,
          vy: -44,
          life: 1,
          text: `+${POST_POINTS}`,
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
      this.posts.length > 0 ? this.posts[this.posts.length - 1].x : this.butterfly.x;
    if (rightmostX < this.virtualWidth + 240) {
      this.spawnSection(rightmostX + POST_SPACING);
    }

    // Prune off-screen entities
    this.posts = this.posts.filter((p) => p.x + p.halfWidth > -100);
    this.likes = this.likes.filter((lk) => !lk.collected && lk.x + lk.radius > -80);

    // Check collectible Likes
    this.checkLikePickups(reducedMotion);

    // Check Rounded-Rectangle Post Collisions
    if (this.checkPostCollisions()) {
      this.triggerGameOver(reducedMotion, 'post');
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
        if (this.onLikeCollected) {
          this.onLikeCollected({
            likesRun: this.likesCollected,
            score: this.score,
            best: this.bestScore
          });
        }

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

  checkPostCollisions() {
    const bx = this.butterfly.x;
    const by = this.butterfly.y;
    const br = this.butterfly.radius;

    for (const post of this.posts) {
      if (Math.abs(bx - post.x) > post.halfWidth + br + 8) continue;

      const left = post.x - post.halfWidth;

      // Top rounded-rectangle post
      if (
        post.topEnd > 0 &&
        circleIntersectsRoundedRect(
          bx,
          by,
          br,
          left,
          -24,
          post.width,
          post.topEnd + 24,
          post.cornerRadius
        )
      ) {
        return true;
      }

      // Bottom rounded-rectangle post
      if (
        circleIntersectsRoundedRect(
          bx,
          by,
          br,
          left,
          post.bottomStart,
          post.width,
          VIRTUAL_HEIGHT - post.bottomStart + 24,
          post.cornerRadius
        )
      ) {
        return true;
      }
    }

    return false;
  }

  triggerGameOver(reducedMotion = false, cause = 'post') {
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
        posts: this.postsCleared,
        likes: this.likesCollected,
        isNewBest: this.isNewBest,
        cause
      });
    }
  }
}
