/**
 * 2D Canvas Renderer for Flappysky
 * Draws Bluesky atmosphere, fluffy layered clouds, rounded blue pillars,
 * collectible red Likes, +1 popups, and an animated blue butterfly.
 */

import { CLOUD_TILE_WIDTH, VIRTUAL_HEIGHT } from './game.js';

const BLUESKY_PILLAR_PALETTES = [
  // 0: Classic Bluesky Azure
  { light: '#54B6FF', mid: '#0085FF', dark: '#0056C7', band: '#0043A4', rim: '#B8E2FF' },
  // 1: Cerulean Breeze
  { light: '#6AD4FF', mid: '#0EA5E9', dark: '#0369A1', band: '#075985', rim: '#CFF0FF' },
  // 2: Cobalt Sky
  { light: '#6BA9FF', mid: '#2563EB', dark: '#1E40AF', band: '#172E82', rim: '#C7DFFF' },
  // 3: Periwinkle Drift
  { light: '#83C5FF', mid: '#3B82F6', dark: '#1D4ED8', band: '#1A3BA8', rim: '#DCEBFF' },
  // 4: Glacier Blue
  { light: '#47C6FF', mid: '#0284C7', dark: '#065A8C', band: '#09446B', rim: '#D4F2FF' },
  // 5: Deep Sapphire
  { light: '#5CA0FF', mid: '#1463DC', dark: '#0A3B91', band: '#062869', rim: '#ABD0FF' }
];

// Asymmetric multi-puff cloud formations per 440px tile (matches background cloud style)
const BACK_CLOUD_CLUSTERS = [
  { x: 35, y: 8, scale: 0.92 },
  { x: 165, y: 14, scale: 0.78 },
  { x: 285, y: 6, scale: 1.02 },
  { x: 395, y: 13, scale: 0.84 }
];

const FRONT_CLOUD_CLUSTERS = [
  { x: 10, y: 16, scale: 0.88 },
  { x: 122, y: 11, scale: 1.04 },
  { x: 248, y: 17, scale: 0.85 },
  { x: 348, y: 12, scale: 0.98 }
];

export class FlappyskyRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.pixelWidth = 960;
    this.pixelHeight = 540;
  }

  resize(width, height, dpr = 1) {
    this.dpr = Math.min(dpr || 1, 2.5);
    this.pixelWidth = Math.max(1, Math.floor(width));
    this.pixelHeight = Math.max(1, Math.floor(height));
    this.canvas.width = Math.floor(this.pixelWidth * this.dpr);
    this.canvas.height = Math.floor(this.pixelHeight * this.dpr);
  }

  render(game) {
    const ctx = this.ctx;
    const vw = game.virtualWidth;
    const vh = VIRTUAL_HEIGHT;
    const scale = (this.pixelHeight * this.dpr) / vh;

    ctx.save();
    ctx.scale(scale, scale);

    this.drawSkyBackdrop(ctx, vw, vh, game.time);
    this.drawClouds(ctx, game.clouds);

    // Back layer of bottom cloud sea (soft parallax behind pillars)
    this.drawBackCloudBed(ctx, vw, vh, game.floorMidScroll);

    // Obstacles: Rounded Bluesky pillars
    for (const pillar of game.pillars) {
      this.drawRoundedPillarPair(ctx, pillar, vh);
    }

    // Collectibles: Likes (Red Hearts)
    for (const like of game.likes) {
      if (!like.collected) {
        this.drawLikeHeart(ctx, like, game.time);
      }
    }

    // Foreground fluffy cloud bed along bottom boundary
    this.drawFrontCloudBed(ctx, vw, vh, game.floorFrontScroll);

    // Particles
    this.drawParticles(ctx, game.particles);

    // Player: Bluesky Butterfly
    this.drawBlueskyButterfly(ctx, game.butterfly, game.time);

    // Floating +1 Score Popups (Blue for Pillars, Red for Likes)
    this.drawPopups(ctx, game.popups);

    // Soft impact flash
    if (game.flashAlpha > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${game.flashAlpha.toFixed(3)})`;
      ctx.fillRect(0, 0, vw, vh);
    }

    ctx.restore();
  }

  drawSkyBackdrop(ctx, vw, vh, time) {
    const skyGrad = ctx.createLinearGradient(0, 0, 0, vh);
    skyGrad.addColorStop(0, '#38B6FF');
    skyGrad.addColorStop(0.45, '#7DD3FC');
    skyGrad.addColorStop(0.85, '#CBEBFF');
    skyGrad.addColorStop(1, '#EAF7FF');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, vw, vh);

    // Subtle sunlit upper-right glow
    const sunX = vw * 0.82;
    const sunY = 82 + Math.sin(time * 0.4) * 4;
    const sunGlow = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 210);
    sunGlow.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
    sunGlow.addColorStop(0.45, 'rgba(224, 245, 255, 0.22)');
    sunGlow.addColorStop(1, 'rgba(224, 245, 255, 0)');
    ctx.fillStyle = sunGlow;
    ctx.fillRect(sunX - 220, 0, 440, 310);
  }

  drawCloudClusterShape(ctx) {
    ctx.beginPath();
    ctx.arc(0, 0, 28, 0, Math.PI * 2);
    ctx.arc(26, -8, 34, 0, Math.PI * 2);
    ctx.arc(58, -2, 29, 0, Math.PI * 2);
    ctx.arc(82, 8, 22, 0, Math.PI * 2);
    ctx.arc(-22, 9, 20, 0, Math.PI * 2);
    ctx.fill();
  }

  drawClouds(ctx, clouds) {
    for (const c of clouds) {
      const alpha = c.layer === 0 ? 0.42 : c.layer === 1 ? 0.68 : 0.88;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(c.scale, c.scale);
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      this.drawCloudClusterShape(ctx);
      ctx.restore();
    }
  }

  drawBackCloudBed(ctx, vw, vh, scrollX) {
    const baseLine = vh - 46;
    ctx.save();
    ctx.fillStyle = 'rgba(214, 240, 255, 0.82)';
    ctx.fillRect(0, baseLine + 10, vw, vh - baseLine);

    for (let tileX = -CLOUD_TILE_WIDTH - scrollX; tileX < vw + CLOUD_TILE_WIDTH; tileX += CLOUD_TILE_WIDTH) {
      for (const cl of BACK_CLOUD_CLUSTERS) {
        ctx.save();
        ctx.translate(tileX + cl.x, baseLine + cl.y);
        ctx.scale(cl.scale, cl.scale * 0.88);
        this.drawCloudClusterShape(ctx);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  drawFrontCloudBed(ctx, vw, vh, scrollX) {
    const floorTop = vh - 38;

    ctx.save();
    // Solid soft cloud-white lower fill so pillars tuck cleanly into the cloud bed
    const baseGrad = ctx.createLinearGradient(0, floorTop, 0, vh);
    baseGrad.addColorStop(0, '#FFFFFF');
    baseGrad.addColorStop(1, '#E6F4FF');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, floorTop + 8, vw, vh - floorTop);

    // Fluffy multi-lobe cloud clusters matching the sky clouds
    ctx.fillStyle = '#FFFFFF';
    for (let tileX = -CLOUD_TILE_WIDTH - scrollX; tileX < vw + CLOUD_TILE_WIDTH; tileX += CLOUD_TILE_WIDTH) {
      for (const cl of FRONT_CLOUD_CLUSTERS) {
        ctx.save();
        ctx.translate(tileX + cl.x, floorTop + cl.y);
        ctx.scale(cl.scale, cl.scale * 0.82);
        this.drawCloudClusterShape(ctx);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  drawRoundedPillarPair(ctx, pillar, vh) {
    const pal = BLUESKY_PILLAR_PALETTES[pillar.palette] || BLUESKY_PILLAR_PALETTES[0];
    const r = pillar.radius;
    const left = pillar.x - r;

    this.drawSingleRoundedPillar(ctx, left, -24, pillar.width, pillar.topEnd + 24, r, 'bottom', pal);
    this.drawSingleRoundedPillar(
      ctx,
      left,
      pillar.bottomStart,
      pillar.width,
      vh - pillar.bottomStart + 24,
      r,
      'top',
      pal
    );
  }

  drawSingleRoundedPillar(ctx, x, y, width, height, radius, roundedEnd, pal) {
    if (height <= 0) return;
    const cx = x + radius;

    ctx.save();

    // Soft ambient shadow
    ctx.shadowColor = 'rgba(7, 38, 84, 0.18)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 3;

    ctx.beginPath();
    if (roundedEnd === 'bottom') {
      const capCy = y + height - radius;
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, capCy);
      ctx.arc(cx, capCy, radius, 0, Math.PI, false);
      ctx.closePath();
    } else {
      const capCy = y + radius;
      ctx.moveTo(x, y + height);
      ctx.lineTo(x, capCy);
      ctx.arc(cx, capCy, radius, Math.PI, 0, false);
      ctx.lineTo(x + width, y + height);
      ctx.closePath();
    }

    // Cylindrical horizontal 3D blue shading
    const cylGrad = ctx.createLinearGradient(x, 0, x + width, 0);
    cylGrad.addColorStop(0, pal.mid);
    cylGrad.addColorStop(0.24, pal.light);
    cylGrad.addColorStop(0.58, pal.mid);
    cylGrad.addColorStop(0.9, pal.dark);
    cylGrad.addColorStop(1, pal.band);

    ctx.fillStyle = cylGrad;
    ctx.fill();

    // Outer rounded pillar contour before clipping interior details
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = pal.band;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.clip();

    // Decorative Bluesky architectural ring band near the dome cap
    ctx.fillStyle = pal.band;
    ctx.globalAlpha = 0.24;
    if (roundedEnd === 'bottom') {
      const bandY = y + height - radius - 14;
      ctx.fillRect(x, bandY, width, 8);
    } else {
      const bandY = y + radius + 6;
      ctx.fillRect(x, bandY, width, 8);
    }

    // Soft vertical specular highlight gleam along left-front of rounded pillar
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = pal.rim;
    const gleamX = x + width * 0.2;
    if (roundedEnd === 'bottom') {
      ctx.beginPath();
      ctx.roundRect(gleamX, y, 10, Math.max(8, height - radius * 0.42), 5);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.roundRect(gleamX, y + radius * 0.42, 10, Math.max(8, height - radius * 0.42), 5);
      ctx.fill();
    }

    ctx.restore();
  }

  drawLikeHeart(ctx, like, time) {
    const pulse = 1 + Math.sin(time * 5.2 + like.phase) * 0.08;
    ctx.save();
    ctx.translate(like.x, like.y);
    ctx.scale(pulse, pulse);

    // Warm rosy aura ring
    const aura = ctx.createRadialGradient(0, 0, 3, 0, 0, 24);
    aura.addColorStop(0, 'rgba(255, 36, 66, 0.32)');
    aura.addColorStop(1, 'rgba(255, 36, 66, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fill();

    // Plump Like heart path
    ctx.beginPath();
    ctx.moveTo(0, 13);
    ctx.bezierCurveTo(-18, 2, -19, -13, -8.5, -13);
    ctx.bezierCurveTo(-3, -13, -0.5, -8.5, 0, -5.5);
    ctx.bezierCurveTo(0.5, -8.5, 3, -13, 8.5, -13);
    ctx.bezierCurveTo(19, -13, 18, 2, 0, 13);
    ctx.closePath();

    const heartGrad = ctx.createLinearGradient(-10, -14, 10, 14);
    heartGrad.addColorStop(0, '#FF5C77');
    heartGrad.addColorStop(0.45, '#FF1E42');
    heartGrad.addColorStop(1, '#C80E2E');
    ctx.fillStyle = heartGrad;
    ctx.fill();

    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Glossy specular shine on upper-left lobe
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.beginPath();
    ctx.ellipse(-6.5, -7.5, 3.8, 2.1, -0.55, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawBlueskyButterfly(ctx, b, time) {
    ctx.save();
    ctx.translate(b.x, b.y);

    // Subtle vertical body bob synced with wing downstroke + pitch tilt
    const strokeLift = -Math.sin(b.wingPhase) * 2.2;
    ctx.translate(0, strokeLift);
    ctx.rotate(0.28 + b.tilt * 0.85);

    const flapWave = 0.5 + 0.5 * Math.sin(b.wingPhase);
    const trailWave = 0.5 + 0.5 * Math.sin(b.wingPhase - 0.45);

    // 3/4 perspective wing spans so the iconic Bluesky butterfly silhouette stays full & lush
    const leftWingSpan = 0.55 + flapWave * 0.54;
    const rightWingSpan = 0.44 + trailWave * 0.48;
    const wingPitch = (flapWave - 0.5) * 0.16;

    // Soft sky-blue flight aura
    const glow = ctx.createRadialGradient(0, 0, 3, 0, 0, 32);
    glow.addColorStop(0, 'rgba(0, 133, 255, 0.28)');
    glow.addColorStop(1, 'rgba(0, 133, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 32, 0, Math.PI * 2);
    ctx.fill();

    // Leading (Right / Farther 3/4) Bluesky Wing
    ctx.save();
    ctx.rotate(-wingPitch * 0.8);
    ctx.scale(rightWingSpan, 0.96 + trailWave * 0.08);
    this.drawBlueskyHalfWing(ctx, 1, {
      top: '#4DB8FF',
      mid: '#0077F0',
      deep: '#004BB8',
      sheen: 0.22
    });
    ctx.restore();

    // Trailing (Left / Nearer 3/4) Bluesky Wing
    ctx.save();
    ctx.rotate(wingPitch);
    ctx.scale(leftWingSpan, 0.98 + flapWave * 0.08);
    this.drawBlueskyHalfWing(ctx, -1, {
      top: '#75D0FF',
      mid: '#0085FF',
      deep: '#0057D9',
      sheen: 0.36
    });
    ctx.restore();

    // Central Sapphire Body & Delicate Antennae
    const antSway = Math.sin(time * 8.5) * 0.9;
    ctx.strokeStyle = '#072B61';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-1.2, -10);
    ctx.quadraticCurveTo(-6 + antSway, -19, -9 + antSway, -20);
    ctx.moveTo(1.2, -10);
    ctx.quadraticCurveTo(6 - antSway, -19, 9 - antSway, -20);
    ctx.stroke();

    ctx.fillStyle = '#5CC8FF';
    ctx.beginPath();
    ctx.arc(-9 + antSway, -20, 1.7, 0, Math.PI * 2);
    ctx.arc(9 - antSway, -20, 1.7, 0, Math.PI * 2);
    ctx.fill();

    // Sleek tapered thorax/abdomen
    ctx.fillStyle = '#072B61';
    ctx.beginPath();
    ctx.roundRect(-2.6, -11, 5.2, 25, 2.6);
    ctx.fill();

    // Tiny white highlight dot on head
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0.8, -8.5, 1.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawBlueskyHalfWing(ctx, dir, colors) {
    ctx.save();
    ctx.scale(dir, 1);

    const grad = ctx.createLinearGradient(0, -24, 30, 22);
    grad.addColorStop(0, colors.top);
    grad.addColorStop(0.52, colors.mid);
    grad.addColorStop(1, colors.deep);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.bezierCurveTo(8, -20, 27, -30, 31, -18);
    ctx.bezierCurveTo(34, -7, 25, 5, 13, 8);
    ctx.bezierCurveTo(22, 11, 26, 21, 18, 25);
    ctx.bezierCurveTo(10, 29, 3, 19, 0, 10);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    // Soft inner sky-light petal sheen
    ctx.fillStyle = `rgba(255, 255, 255, ${colors.sheen})`;
    ctx.beginPath();
    ctx.moveTo(3, -3);
    ctx.bezierCurveTo(9, -14, 20, -21, 23, -14);
    ctx.bezierCurveTo(25, -8, 18, 1, 9, 4);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  drawParticles(ctx, particles) {
    for (const pt of particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, pt.life));
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * (0.5 + pt.life * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawPopups(ctx, popups) {
    for (const pop of popups) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, pop.life));
      ctx.font = '900 22px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = '#FFFFFF';
      ctx.strokeText(pop.text, pop.x, pop.y);
      ctx.fillStyle = pop.color || '#0085FF';
      ctx.fillText(pop.text, pop.x, pop.y);
      ctx.restore();
    }
  }
}
