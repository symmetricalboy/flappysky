import { AudioController } from './audio.js';
import { FlappyskyGame } from './game.js';
import { FlappyskyRenderer } from './renderer.js';
import { initSpatialNav, setRovingFocus } from './spatial-nav.js';

const appShell = document.getElementById('app-shell');
const canvas = document.getElementById('game-canvas');
const hud = document.getElementById('hud');
const hudScore = document.getElementById('hud-score');
const hudBest = document.getElementById('hud-best');
const fsToast = document.getElementById('fs-toast');
const readyBanner = document.getElementById('ready-banner');

const mainMenu = document.getElementById('main-menu');
const pauseMenu = document.getElementById('pause-menu');
const gameoverMenu = document.getElementById('gameover-menu');
const rotateSplash = document.getElementById('rotate-splash');
const liveAnnouncer = document.getElementById('live-announcer');

const btnPlay = document.getElementById('btn-play');
const btnMenuSfx = document.getElementById('btn-menu-sfx');
const btnMenuMusic = document.getElementById('btn-menu-music');
const btnMenuFullscreen = document.getElementById('btn-menu-fullscreen');
const menuBestScore = document.getElementById('menu-best-score');

const btnHudFullscreen = document.getElementById('btn-hud-fullscreen');
const btnHudPause = document.getElementById('btn-hud-pause');

const btnResume = document.getElementById('btn-resume');
const btnPauseRestart = document.getElementById('btn-pause-restart');
const btnPauseSfx = document.getElementById('btn-pause-sfx');
const btnPauseMusic = document.getElementById('btn-pause-music');
const btnPauseFullscreen = document.getElementById('btn-pause-fullscreen');
const btnPauseHome = document.getElementById('btn-pause-home');

const btnRetry = document.getElementById('btn-retry');
const btnGameoverHome = document.getElementById('btn-gameover-home');
const goScore = document.getElementById('go-score');
const goBest = document.getElementById('go-best');
const goPillars = document.getElementById('go-pillars');
const goLikes = document.getElementById('go-likes');
const newBestBadge = document.getElementById('new-best-badge');

const btnRotateFullscreen = document.getElementById('btn-rotate-fullscreen');

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const coarsePointerQuery = window.matchMedia('(pointer: coarse)');
const noHoverQuery = window.matchMedia('(hover: none)');

const audio = new AudioController();
const renderer = new FlappyskyRenderer(canvas);

let spaceFlightLatch = false;
let activePointerId = null;
let toastTimerId = null;

function prefersReducedMotion() {
  return reducedMotionQuery.matches;
}

function isMobileDevice() {
  if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
    if (navigator.userAgentData.mobile) return true;
  }
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) {
    return true;
  }
  return coarsePointerQuery.matches && noHoverQuery.matches;
}

function isPortraitOrientation() {
  return window.innerHeight > window.innerWidth;
}

function isFullscreenActive() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

function showToast(message) {
  fsToast.textContent = message;
  fsToast.hidden = false;
  if (toastTimerId !== null) window.clearTimeout(toastTimerId);
  toastTimerId = window.setTimeout(() => {
    fsToast.hidden = true;
    toastTimerId = null;
  }, 4200);
}

function requestFullscreenAutoMobile() {
  if (navigator.userActivation && !navigator.userActivation.isActive) return;
  if (isFullscreenActive()) return;

  const root = document.documentElement;
  const reqFn = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!reqFn) return;

  Promise.resolve(reqFn.call(root))
    .then(() => {
      if (screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock('landscape').catch(() => {});
      }
      syncFullscreenButtons();
    })
    .catch(() => {});
}

function toggleFullscreen() {
  if (isFullscreenActive()) {
    const exitFn = document.exitFullscreen || document.webkitExitFullscreen;
    if (exitFn) {
      Promise.resolve(exitFn.call(document))
        .catch(() => {})
        .finally(syncFullscreenButtons);
    }
    return;
  }

  const root = document.documentElement;
  const reqFn = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!reqFn) {
    showToast('Full screen is not supported in this browser.');
    return;
  }

  // Invoke synchronously on the user gesture before any audio/DOM work
  Promise.resolve(reqFn.call(root))
    .then(() => {
      if (isMobileDevice() && screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock('landscape').catch(() => {});
      }
      syncFullscreenButtons();
    })
    .catch(() => {
      showToast(
        'Browser blocked Full Screen in this window — press F11 or open http://localhost:3000 in a standard tab.'
      );
      syncFullscreenButtons();
    });
}

function syncFullscreenButtons() {
  const active = String(isFullscreenActive());
  btnMenuFullscreen.setAttribute('aria-pressed', active);
  btnPauseFullscreen.setAttribute('aria-pressed', active);
  btnHudFullscreen.setAttribute('aria-pressed', active);
}

function syncAudioButtons() {
  const sfxOn = String(audio.sfxEnabled);
  btnMenuSfx.setAttribute('aria-pressed', sfxOn);
  btnPauseSfx.setAttribute('aria-pressed', sfxOn);

  const musicOn = String(audio.musicEnabled);
  btnMenuMusic.setAttribute('aria-pressed', musicOn);
  btnPauseMusic.setAttribute('aria-pressed', musicOn);
}

function announcePolite(message) {
  liveAnnouncer.textContent = '';
  requestAnimationFrame(() => {
    liveAnnouncer.textContent = message;
  });
}

function getActiveOverlayNav() {
  if (!rotateSplash.hidden) return null;
  if (!mainMenu.hidden) return mainMenu.querySelector('[data-spatial-nav]');
  if (!pauseMenu.hidden) return pauseMenu.querySelector('[data-spatial-nav]');
  if (!gameoverMenu.hidden) return gameoverMenu.querySelector('[data-spatial-nav]');
  return null;
}

function focusActiveMenuDefault(state) {
  if (!rotateSplash.hidden) {
    btnRotateFullscreen.focus();
    return;
  }
  if (state === 'menu') {
    setRovingFocus(mainMenu.querySelector('[data-spatial-nav]'), btnPlay);
  } else if (state === 'paused') {
    setRovingFocus(pauseMenu.querySelector('[data-spatial-nav]'), btnResume);
  } else if (state === 'gameover') {
    setRovingFocus(gameoverMenu.querySelector('[data-spatial-nav]'), btnRetry);
  }
}

function isGameplayActiveState(state) {
  return state === 'ready' || state === 'playing';
}

const game = new FlappyskyGame({
  audio,
  onScoreChange({ score, best }) {
    hudScore.textContent = String(score);
    hudBest.textContent = String(best);
    menuBestScore.textContent = String(best);
  },
  onGameOver({ score, best, pillars, likes, isNewBest }) {
    goPillars.textContent = String(pillars);
    goLikes.textContent = String(likes);
    goScore.textContent = String(score);
    goBest.textContent = String(best);
    newBestBadge.hidden = !isNewBest;
    menuBestScore.textContent = String(best);

    announcePolite(
      `${pillars} Pillars Cleared plus ${likes} Likes Collected equals ${score} Final Score. Best Score ${best}.`
    );
  },
  onStateChange(state) {
    mainMenu.hidden = state !== 'menu';
    pauseMenu.hidden = state !== 'paused';
    gameoverMenu.hidden = state !== 'gameover';
    readyBanner.hidden = state !== 'ready';

    const showHud = state === 'ready' || state === 'playing' || state === 'paused';
    hud.hidden = !showHud;
    hud.inert = state !== 'ready' && state !== 'playing';

    if (isGameplayActiveState(state)) {
      audio.startMusic({ resetPosition: state === 'ready' });
    } else {
      audio.stopMusic();
    }

    if (state === 'menu') {
      document.title = 'Flappysky | Flutter Through the Blue Sky';
    } else if (state === 'ready' || state === 'playing') {
      document.title = 'Flying | Flappysky';
    } else if (state === 'paused') {
      document.title = 'Paused | Flappysky';
    } else if (state === 'gameover') {
      document.title = 'Flight Complete | Flappysky';
    }

    focusActiveMenuDefault(state);
  }
});

// Initialize high score display & button states
menuBestScore.textContent = String(game.bestScore);
hudBest.textContent = String(game.bestScore);
syncAudioButtons();
syncFullscreenButtons();

// Initialize 2D Arrow-Key Spatial Navigation on all menu containers
for (const navEl of document.querySelectorAll('[data-spatial-nav]')) {
  initSpatialNav(navEl, {
    onNavigate: () => audio.playMenuTick()
  });
}

// Responsive viewport & Mobile Portrait Rotate-to-Landscape Splash Enforcement
function handleViewportAndOrientation() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.resize(w, h, window.devicePixelRatio || 1);
  game.setViewportAspect(w, h);

  const mustRotate = isMobileDevice() && isPortraitOrientation();
  const wasShowingSplash = !rotateSplash.hidden;

  if (mustRotate) {
    if (game.state === 'playing' || game.state === 'ready') {
      game.pause();
    }
    rotateSplash.hidden = false;
    appShell.inert = true;
    if (!wasShowingSplash) {
      btnRotateFullscreen.focus();
      announcePolite('Please rotate your device to landscape mode to play Flappysky.');
    }
  } else {
    rotateSplash.hidden = true;
    appShell.inert = false;
    if (wasShowingSplash) {
      focusActiveMenuDefault(game.state);
    }
  }
}

window.addEventListener('resize', handleViewportAndOrientation);
window.addEventListener('orientationchange', handleViewportAndOrientation);
document.addEventListener('fullscreenchange', syncFullscreenButtons);
document.addEventListener('webkitfullscreenchange', syncFullscreenButtons);

// Menu Button Handlers
function beginFlightFromUI() {
  if (isMobileDevice()) {
    requestFullscreenAutoMobile();
  }
  audio.unlock();
  game.startReady();
}

btnPlay.addEventListener('click', beginFlightFromUI);

btnMenuSfx.addEventListener('click', () => {
  audio.toggleSfx();
  syncAudioButtons();
});

btnPauseSfx.addEventListener('click', () => {
  audio.toggleSfx();
  syncAudioButtons();
});

btnMenuMusic.addEventListener('click', () => {
  audio.toggleMusic({ shouldPlayNow: isGameplayActiveState(game.state) });
  syncAudioButtons();
});

btnPauseMusic.addEventListener('click', () => {
  audio.toggleMusic({ shouldPlayNow: false });
  syncAudioButtons();
});

btnMenuFullscreen.addEventListener('click', () => {
  toggleFullscreen();
  audio.playMenuTick();
});

btnPauseFullscreen.addEventListener('click', () => {
  toggleFullscreen();
  audio.playMenuTick();
});

btnHudFullscreen.addEventListener('click', () => {
  toggleFullscreen();
  audio.playMenuTick();
});

btnRotateFullscreen.addEventListener('click', () => {
  toggleFullscreen();
  audio.unlock();
});

btnHudPause.addEventListener('click', () => {
  audio.playMenuTick();
  game.pause();
});

btnResume.addEventListener('click', () => {
  if (isMobileDevice()) {
    requestFullscreenAutoMobile();
  }
  audio.playMenuTick();
  game.resume();
});

btnPauseRestart.addEventListener('click', beginFlightFromUI);

btnPauseHome.addEventListener('click', () => {
  audio.playMenuTick();
  game.returnToMenu();
});

btnRetry.addEventListener('click', () => {
  if (spaceFlightLatch || performance.now() - game.gameOverTimestamp < 260) {
    return;
  }
  beginFlightFromUI();
});

btnGameoverHome.addEventListener('click', () => {
  if (spaceFlightLatch) return;
  audio.playMenuTick();
  game.returnToMenu();
});

// Keyboard Controls:
// - Arrow keys navigate active menus
// - Spacebar moves butterfly up (tap or hold) & releasing glides down
// - Escape / P pauses & resumes flight
window.addEventListener('keydown', (e) => {
  if (!rotateSplash.hidden) return;

  const activeNav = getActiveOverlayNav();
  if (activeNav && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    if (!activeNav.contains(document.activeElement)) {
      e.preventDefault();
      const currentRoving = activeNav.querySelector('[tabindex="0"]');
      setRovingFocus(activeNav, currentRoving);
      audio.playMenuTick();
    }
    return;
  }

  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    if (game.state === 'playing' || game.state === 'ready') {
      e.preventDefault();
      game.pause();
      return;
    }
    if (game.state === 'paused') {
      e.preventDefault();
      game.resume();
      return;
    }
  }

  if (e.code === 'Space') {
    if (game.state === 'ready' || game.state === 'playing') {
      e.preventDefault();
      if (!e.repeat) {
        spaceFlightLatch = true;
        game.pressStart(prefersReducedMotion());
      }
      return;
    }

    if (spaceFlightLatch) {
      e.preventDefault();
      return;
    }

    if (game.state === 'gameover' && !gameoverMenu.contains(document.activeElement)) {
      e.preventDefault();
      if (performance.now() - game.gameOverTimestamp >= 260) {
        beginFlightFromUI();
      }
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    if (spaceFlightLatch) {
      if (game.state !== 'playing' && game.state !== 'ready') {
        e.preventDefault();
      }
      spaceFlightLatch = false;
    }
    game.pressEnd();
  }
});

// Mouse Click & Touch Controls on Canvas
canvas.addEventListener('pointerdown', (e) => {
  if (!rotateSplash.hidden) return;
  if (game.state !== 'ready' && game.state !== 'playing') return;

  e.preventDefault();

  if (isMobileDevice() && !isFullscreenActive()) {
    requestFullscreenAutoMobile();
  }
  audio.unlock();

  activePointerId = e.pointerId;
  game.pressStart(prefersReducedMotion());
});

window.addEventListener('pointerup', (e) => {
  if (activePointerId === null || e.pointerId === activePointerId) {
    activePointerId = null;
    game.pressEnd();
  }
});

window.addEventListener('pointercancel', () => {
  activePointerId = null;
  game.pressEnd();
});

window.addEventListener('blur', () => {
  spaceFlightLatch = false;
  activePointerId = null;
  game.pressEnd();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && (game.state === 'playing' || game.state === 'ready')) {
    game.pause();
  }
});

// Initial sizing, state sync, and animation loop
handleViewportAndOrientation();
focusActiveMenuDefault(game.state);

let lastTime = performance.now();
function frame(now) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  game.update(dt, { reducedMotion: prefersReducedMotion() });
  renderer.render(game);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
