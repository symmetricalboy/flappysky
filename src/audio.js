/**
 * Procedural Web Audio synthesizer & looping gameplay music for Flappysky
 */

const SFX_STORAGE_KEY = 'flappysky_sound_enabled';
const MUSIC_STORAGE_KEY = 'flappysky_music_enabled';

// Note frequencies (Hz)
const N = {
  G3: 196.00,
  A3: 220.00,
  B3: 246.94,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392.00,
  A4: 440.00,
  B4: 493.88,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  F5: 698.46,
  G5: 783.99,
  A5: 880.00,
  B5: 987.77,
  C6: 1046.50
};

// 64 eighth-note steps (8 bars in 4/4) breezy sky loop
const MELODY_STEPS = [
  // Bar 1 (Cmaj7)
  N.E5, N.G5, N.A5, N.G5, N.E5, N.C5, N.D5, N.E5,
  // Bar 2 (Fmaj7)
  N.F5, N.A5, N.C6, N.A5, N.G5, N.E5, N.D5, N.C5,
  // Bar 3 (Em7 -> Am7)
  N.E5, N.G5, N.B5, N.G5, N.A5, N.E5, N.C5, N.E5,
  // Bar 4 (Dm7 -> G7)
  N.F5, N.E5, N.D5, N.C5, N.D5, null, N.G4, null,
  // Bar 5 (Cmaj7)
  N.E5, N.G5, N.C6, N.B5, N.A5, N.G5, N.E5, N.C5,
  // Bar 6 (Fmaj7)
  N.F5, N.A5, N.G5, N.E5, N.D5, N.F5, N.A5, null,
  // Bar 7 (G6 -> Em7)
  N.G5, N.B5, N.A5, N.G5, N.E5, N.D5, N.C5, N.D5,
  // Bar 8 (Cmaj9 turnaround)
  N.C5, null, N.E5, N.G5, N.C5, null, null, null
];

const BASS_STEPS = [
  // Bar 1: C -> G
  N.C4, null, N.G4, null, N.C4, null, N.G4, null,
  // Bar 2: F -> C
  N.F4, null, N.C4, null, N.F4, null, N.C4, null,
  // Bar 3: E -> A
  N.E4, null, N.B3, null, N.A3, null, N.E4, null,
  // Bar 4: D -> G
  N.D4, null, N.A3, null, N.G3, null, N.D4, null,
  // Bar 5: C -> G
  N.C4, null, N.G4, null, N.E4, null, N.G4, null,
  // Bar 6: F -> D
  N.F4, null, N.C4, null, N.D4, null, N.A3, null,
  // Bar 7: G -> E
  N.G3, null, N.D4, null, N.E4, null, N.B3, null,
  // Bar 8: C turnaround
  N.C4, null, N.G3, null, N.C4, null, null, null
];

const STEP_DURATION = 0.22; // ~136 BPM eighth-notes (light & buoyant)
const SCHEDULE_AHEAD_SEC = 0.16;
const LOOKAHEAD_MS = 50;

export class AudioController {
  constructor() {
    this.ctx = null;

    const savedSfx = localStorage.getItem(SFX_STORAGE_KEY);
    this.sfxEnabled = savedSfx === null ? true : savedSfx === 'true';

    const savedMusic = localStorage.getItem(MUSIC_STORAGE_KEY);
    this.musicEnabled = savedMusic === null ? true : savedMusic === 'true';

    this.musicPlaying = false;
    this.musicStep = 0;
    this.nextNoteTime = 0;
    this.schedulerId = null;
    this.musicMasterGain = null;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.musicMasterGain && this.ctx) {
      this.musicMasterGain = this.ctx.createGain();
      this.musicMasterGain.gain.value = 0.85;
      this.musicMasterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  unlock() {
    if (this.sfxEnabled || this.musicEnabled) {
      this.ensureContext();
    }
  }

  setSfxEnabled(value) {
    this.sfxEnabled = Boolean(value);
    try {
      localStorage.setItem(SFX_STORAGE_KEY, String(this.sfxEnabled));
    } catch {
      // Ignore storage restrictions
    }
    if (this.sfxEnabled) this.ensureContext();
  }

  toggleSfx() {
    this.setSfxEnabled(!this.sfxEnabled);
    if (this.sfxEnabled) this.playMenuTick();
    return this.sfxEnabled;
  }

  setMusicEnabled(value, { shouldPlayNow = false } = {}) {
    this.musicEnabled = Boolean(value);
    try {
      localStorage.setItem(MUSIC_STORAGE_KEY, String(this.musicEnabled));
    } catch {
      // Ignore storage restrictions
    }
    if (!this.musicEnabled) {
      this.stopMusic();
    } else if (shouldPlayNow) {
      this.startMusic();
    }
  }

  toggleMusic({ shouldPlayNow = false } = {}) {
    this.setMusicEnabled(!this.musicEnabled, { shouldPlayNow });
    if (this.sfxEnabled) this.playMenuTick();
    return this.musicEnabled;
  }

  startMusic({ resetPosition = false } = {}) {
    if (!this.musicEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    if (resetPosition) {
      this.musicStep = 0;
    }

    if (this.musicPlaying) return;
    this.musicPlaying = true;
    this.nextNoteTime = ctx.currentTime + 0.04;

    this.schedulerId = window.setInterval(() => {
      this.scheduleMusicNotes();
    }, LOOKAHEAD_MS);
  }

  stopMusic() {
    this.musicPlaying = false;
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
  }

  scheduleMusicNotes() {
    if (!this.musicPlaying || !this.musicEnabled || !this.ctx) return;
    if (this.ctx.state !== 'running') return;

    // Guard against huge catch-up bursts after tab suspension
    if (this.nextNoteTime < this.ctx.currentTime - 0.25) {
      this.nextNoteTime = this.ctx.currentTime + 0.03;
    }

    while (this.nextNoteTime < this.ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      const stepIdx = this.musicStep % MELODY_STEPS.length;
      const leadFreq = MELODY_STEPS[stepIdx];
      const bassFreq = BASS_STEPS[stepIdx];

      if (leadFreq) {
        this.scheduleTone(leadFreq, this.nextNoteTime, STEP_DURATION * 0.88, 'triangle', 0.052);
      }
      if (bassFreq) {
        this.scheduleTone(bassFreq, this.nextNoteTime, STEP_DURATION * 1.65, 'sine', 0.045);
      }

      this.nextNoteTime += STEP_DURATION;
      this.musicStep = (this.musicStep + 1) % MELODY_STEPS.length;
    }
  }

  scheduleTone(freq, startTime, duration, waveType, peakGain) {
    if (!this.ctx || !this.musicMasterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = waveType;
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.0008, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0008, startTime + duration);

    osc.connect(gain);
    gain.connect(this.musicMasterGain);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  playFlap() {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(290, now);
    osc.frequency.exponentialRampToValueAtTime(510, now + 0.085);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.1, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  playScore() {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [659.25, 880]; // E5 -> A5
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + idx * 0.065;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.11, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.17);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.18);
    });
  }

  playLike() {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [587.33, 783.99, 1046.5]; // D5 -> G5 -> C6
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + idx * 0.048;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.13, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.21);
    });
  }

  playMenuTick() {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(540, now);
    osc.frequency.exponentialRampToValueAtTime(680, now + 0.03);

    gain.gain.setValueAtTime(0.055, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  playCrash() {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.24);

    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.27);
  }
}
