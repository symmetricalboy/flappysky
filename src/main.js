import { AudioController } from './audio.js';
import { FlappyskyGame } from './game.js';
import { FlappyskyRenderer } from './renderer.js';
import { initSpatialNav, setRovingFocus } from './spatial-nav.js';
import { OpenGamingClient } from './achievements.js';

// Progressive enhancement feature detections (`declarative-dialog-popover-control`, `persistent-toast-notifications`, `light-dismiss-a-dialog`)
if (!('commandForElement' in HTMLButtonElement.prototype)) {
  import('https://esm.run/invokers-polyfill').catch(() => {});

  document.addEventListener('click', (event) => {
    if ('commandForElement' in HTMLButtonElement.prototype) return;
    const btn = event.composedPath().find((el) => el?.matches?.('button[commandfor]'));
    if (!btn) return;
    const target = document.getElementById(btn.getAttribute('commandfor'));
    const cmd = btn.getAttribute('command');
    if (!target || !cmd) return;
    if (cmd === 'show-modal' && typeof target.showModal === 'function' && !target.open) {
      target.showModal();
    } else if (cmd === 'close' && typeof target.close === 'function' && target.open) {
      target.close();
    } else if (cmd === 'hide-popover' && typeof target.hidePopover === 'function') {
      target.hidePopover();
    }
  });
}

if (!('popover' in HTMLElement.prototype)) {
  import('https://unpkg.com/@oddbird/popover-polyfill@latest/dist/popover.min.js').catch(() => {});
}

if (!('closedBy' in HTMLDialogElement.prototype)) {
  const outsideDialogBox = (e, dialog) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (e) => {
      pressedOutside = e.target === dialog && outsideDialogBox(e, dialog);
    });
    dialog.addEventListener('pointerup', (e) => {
      if (pressedOutside && e.target === dialog && outsideDialogBox(e, dialog)) {
        dialog.close();
      }
      pressedOutside = false;
    });
  }
}

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
const fullscreenSplash = document.getElementById('fullscreen-splash');
const liveAnnouncer = document.getElementById('live-announcer');

const btnPlay = document.getElementById('btn-play');
const btnMenuSfx = document.getElementById('btn-menu-sfx');
const btnMenuMusic = document.getElementById('btn-menu-music');
const btnMenuFullscreen = document.getElementById('btn-menu-fullscreen');
const menuBestScore = document.getElementById('menu-best-score');
const menuAchCount = document.getElementById('menu-ach-count');
const menuAccountDot = document.getElementById('menu-account-dot');
const menuAccountLabel = document.getElementById('menu-account-label');
const menuOpengamingLink = document.getElementById('menu-opengaming-link');

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
const goPosts = document.getElementById('go-posts');
const goLikes = document.getElementById('go-likes');
const newBestBadge = document.getElementById('new-best-badge');
const goSyncPill = document.getElementById('go-sync-pill');
const goUnlocksStrip = document.getElementById('go-unlocks-strip');
const goUnlocksList = document.getElementById('go-unlocks-list');

const btnRotateFullscreen = document.getElementById('btn-rotate-fullscreen');
const btnEnterFullscreen = document.getElementById('btn-enter-fullscreen');

// Open Gaming Modal Dialogs & Controls
const achievementsDialog = document.getElementById('achievements-dialog');
const leaderboardDialog = document.getElementById('leaderboard-dialog');
const authDialog = document.getElementById('auth-dialog');
const achToastStack = document.getElementById('ach-toast-stack');

const achCompletionSummary = document.getElementById('ach-completion-summary');
const achSyncTitle = document.getElementById('ach-sync-title');
const achSyncDesc = document.getElementById('ach-sync-desc');
const btnAchOpenAuth = document.getElementById('btn-ach-open-auth');
const achViewProfileLink = document.getElementById('ach-view-profile-link');
const statFlights = document.getElementById('stat-flights');
const statLikes = document.getElementById('stat-likes');
const statBest = document.getElementById('stat-best');
const achievementsListEl = document.getElementById('achievements-list');

const leaderboardTbody = document.getElementById('leaderboard-tbody');
const lbStatusMsg = document.getElementById('lb-status-msg');
const btnLbRefresh = document.getElementById('btn-lb-refresh');
const lbExplorerLink = document.getElementById('lb-explorer-link');

const authErrorBanner = document.getElementById('auth-error-banner');
const authConnectedPanel = document.getElementById('auth-connected-panel');
const authFormsPanel = document.getElementById('auth-forms-panel');
const authUserAvatar = document.getElementById('auth-user-avatar');
const authUserName = document.getElementById('auth-user-name');
const authUserHandle = document.getElementById('auth-user-handle');
const authUserDid = document.getElementById('auth-user-did');
const authOpengamingProfile = document.getElementById('auth-opengaming-profile');
const btnAuthSyncNow = document.getElementById('btn-auth-sync-now');
const btnAuthLogout = document.getElementById('btn-auth-logout');

const oauthLoginForm = document.getElementById('oauth-login-form');
const oauthHandleInput = document.getElementById('oauth-handle-input');
const btnOauthSubmit = document.getElementById('btn-oauth-submit');

const appPwForm = document.getElementById('app-pw-form');
const appPwIdentifier = document.getElementById('app-pw-identifier');
const appPwSecret = document.getElementById('app-pw-secret');
const btnToggleAppPw = document.getElementById('btn-toggle-app-pw');
const btnAppPwSubmit = document.getElementById('btn-app-pw-submit');

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const coarsePointerQuery = window.matchMedia('(pointer: coarse)');
const noHoverQuery = window.matchMedia('(hover: none)');
const standaloneDisplayQuery = window.matchMedia(
  '(display-mode: fullscreen), (display-mode: standalone)'
);

const audio = new AudioController();
const renderer = new FlappyskyRenderer(canvas);

let spaceFlightLatch = false;
let activePointerId = null;
let toastTimerId = null;
let currentAchFilter = 'all';
let currentLbScope = 'public';
let toastCounter = 0;

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
  return Boolean(
    document.fullscreenElement ||
      document.webkitFullscreenElement ||
      standaloneDisplayQuery.matches ||
      navigator.standalone === true
  );
}

function canRequestFullscreen() {
  const root = document.documentElement;
  if (typeof root.requestFullscreen === 'function') {
    return document.fullscreenEnabled !== false;
  }
  if (typeof root.webkitRequestFullscreen === 'function') {
    return document.webkitFullscreenEnabled !== false;
  }
  return false;
}

function isMobileGateOpen() {
  return !rotateSplash.hidden || !fullscreenSplash.hidden;
}

function isAnyModalDialogOpen() {
  return Boolean(achievementsDialog.open || leaderboardDialog.open || authDialog.open);
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

function formatShortTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function restackAchievementToasts() {
  const activeToasts = Array.from(achToastStack.querySelectorAll('.ach-toast'));
  activeToasts.forEach((el, idx) => {
    el.style.setProperty('--toast-offset', `${idx * 78}px`);
  });
}

function showAchievementUnlockToast(ach) {
  audio.playAchievement();

  toastCounter += 1;
  const toastId = `ach-toast-${toastCounter}`;
  const toast = document.createElement('div');
  toast.id = toastId;
  toast.className = 'ach-toast';
  toast.setAttribute('popover', 'manual');

  const icon = document.createElement('img');
  icon.className = 'ach-toast-icon';
  icon.src = `.${ach.iconPath}`;
  icon.alt = '';
  icon.width = 44;
  icon.height = 44;

  const body = document.createElement('div');
  body.className = 'ach-toast-body';

  const kicker = document.createElement('span');
  kicker.className = 'ach-toast-kicker';
  kicker.textContent = `Achievement Unlocked · ${ach.tier.toUpperCase()}`;

  const title = document.createElement('strong');
  title.className = 'ach-toast-title';
  title.textContent = ach.title;

  const desc = document.createElement('span');
  desc.className = 'ach-toast-desc';
  desc.textContent = ach.description;

  body.append(kicker, title, desc);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ach-toast-close';
  closeBtn.setAttribute('popovertarget', toastId);
  closeBtn.setAttribute('popovertargetaction', 'hide');
  closeBtn.setAttribute('aria-label', `Dismiss ${ach.title} notification`);
  closeBtn.textContent = '✕';

  const removeToast = () => {
    try {
      if (typeof toast.hidePopover === 'function') {
        toast.hidePopover();
      }
    } catch {
      // Ignore already hidden popover
    }
    toast.remove();
    restackAchievementToasts();
  };

  closeBtn.addEventListener('click', removeToast);
  toast.append(icon, body, closeBtn);
  achToastStack.append(toast);
  restackAchievementToasts();

  if (typeof toast.showPopover === 'function') {
    try {
      toast.showPopover();
    } catch {
      toast.classList.add(':popover-open');
    }
  } else {
    toast.classList.add(':popover-open');
  }

  announcePolite(`Achievement unlocked: ${ach.title}. ${ach.description}`);
  window.setTimeout(removeToast, 4600);
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
      handleViewportAndOrientation();
    })
    .catch(() => {
      showToast(
        isMobileDevice()
          ? 'Browser blocked Fullscreen — open Flappysky in Chrome or your system browser.'
          : 'Browser blocked Full Screen in this window — press F11 or open http://localhost:3000 in a standard tab.'
      );
      syncFullscreenButtons();
      handleViewportAndOrientation();
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
  if (isMobileGateOpen() || isAnyModalDialogOpen()) return null;
  if (!mainMenu.hidden) return mainMenu.querySelector('[data-spatial-nav]');
  if (!pauseMenu.hidden) return pauseMenu.querySelector('[data-spatial-nav]');
  if (!gameoverMenu.hidden) return gameoverMenu.querySelector('[data-spatial-nav]');
  return null;
}

function focusActiveMenuDefault(state) {
  if (isAnyModalDialogOpen()) return;
  if (!rotateSplash.hidden) {
    btnRotateFullscreen.focus();
    return;
  }
  if (!fullscreenSplash.hidden) {
    btnEnterFullscreen.focus();
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

function renderOpenGamingUI(summary) {
  menuAchCount.textContent = `${summary.unlockedCount}/${summary.totalAchievements}`;
  achCompletionSummary.textContent = `${summary.unlockedCount} of ${summary.totalAchievements} unlocked (${summary.completionPercent}%)${summary.completed ? ' · 100% Complete!' : ''}`;

  statFlights.textContent = String(summary.stats.gamesPlayed);
  statLikes.textContent = String(summary.stats.totalLikes);
  statBest.textContent = String(Math.max(summary.stats.bestScore, game.bestScore));

  const appViewBase = summary.appViewUrl || 'https://opengaming.games';
  menuOpengamingLink.href = appViewBase;
  lbExplorerLink.href = appViewBase;

  if (summary.authenticated && summary.user) {
    const cleanHandle = summary.user.handle.replace(/^@+/, '');
    menuAccountDot.dataset.connected = 'true';
    menuAccountLabel.textContent = summary.syncing
      ? `@${cleanHandle} · Syncing…`
      : `@${cleanHandle}`;

    achSyncTitle.textContent = `Connected as @${cleanHandle}`;
    achSyncDesc.textContent = summary.syncing
      ? 'Signing and writing Open Gaming records to your PDS…'
      : 'Your achievements & personal-best high score sync automatically to your ATProto PDS.';
    btnAchOpenAuth.textContent = 'Account';

    const profileHref = `${appViewBase}/?actor=${encodeURIComponent(cleanHandle)}`;
    achViewProfileLink.href = profileHref;
    achViewProfileLink.hidden = false;
    authOpengamingProfile.href = profileHref;

    authConnectedPanel.hidden = false;
    authFormsPanel.hidden = true;
    authUserName.textContent = summary.user.displayName || cleanHandle;
    authUserHandle.textContent = `@${cleanHandle}`;
    authUserDid.textContent = summary.user.did;
    authUserAvatar.src =
      summary.user.avatar && /^https?:\/\//i.test(summary.user.avatar)
        ? summary.user.avatar
        : './favicon.svg';
  } else {
    menuAccountDot.dataset.connected = 'false';
    menuAccountLabel.textContent = 'Connect ATProto';

    achSyncTitle.textContent = 'Playing in Guest Mode';
    achSyncDesc.textContent =
      'Connect your Bluesky / ATProto account to sign & publish achievements and high scores to your PDS.';
    btnAchOpenAuth.textContent = 'Connect ATProto';
    achViewProfileLink.hidden = true;

    authConnectedPanel.hidden = true;
    authFormsPanel.hidden = false;
  }

  // Render filtered achievement list
  achievementsListEl.replaceChildren();
  const filtered = summary.items.filter((item) => {
    if (currentAchFilter === 'unlocked') return item.unlocked;
    if (currentAchFilter === 'locked') return !item.unlocked;
    return true;
  });

  if (filtered.length === 0) {
    const emptyLi = document.createElement('li');
    emptyLi.className = 'og-status-note';
    emptyLi.textContent =
      currentAchFilter === 'unlocked'
        ? 'No achievements unlocked yet — press Start to take your first flight!'
        : 'Every single Flappysky achievement is unlocked — 100% Complete!';
    achievementsListEl.append(emptyLi);
    return;
  }

  for (const item of filtered) {
    const li = document.createElement('li');
    li.className = 'ach-card';
    li.dataset.unlocked = String(item.unlocked);

    const isSecretLocked = item.hidden && !item.unlocked;

    const icon = document.createElement('img');
    icon.className = 'ach-icon';
    icon.src = isSecretLocked
      ? './assets/achievements/locked-secret.svg'
      : `.${item.iconPath}`;
    icon.alt = '';
    icon.width = 52;
    icon.height = 52;
    icon.loading = 'lazy';

    const body = document.createElement('div');
    body.className = 'ach-body';

    const titleRow = document.createElement('div');
    titleRow.className = 'ach-title-row';

    const title = document.createElement('strong');
    title.className = 'ach-title';
    title.textContent = isSecretLocked ? 'Hidden Achievement' : item.title;

    const tierPill = document.createElement('span');
    tierPill.className = 'tier-pill';
    tierPill.dataset.tier = item.tier;
    tierPill.textContent = item.tier;

    titleRow.append(title, tierPill);

    const desc = document.createElement('p');
    desc.className = 'ach-desc';
    desc.textContent = isSecretLocked
      ? 'Keep flying through the Blue Sky to uncover this secret achievement.'
      : item.unlocked
        ? item.description
        : item.requirement || item.description;

    body.append(titleRow, desc);

    if (item.stepsNeeded && !item.unlocked && !isSecretLocked) {
      const progRow = document.createElement('div');
      progRow.className = 'ach-progress-row';

      const progBar = document.createElement('progress');
      progBar.className = 'ach-progress-bar';
      progBar.max = item.stepsNeeded;
      progBar.value = item.progress?.currentSteps || 0;
      progBar.setAttribute('aria-label', `${item.title} progress`);

      const progLabel = document.createElement('span');
      progLabel.className = 'ach-progress-label';
      progLabel.textContent = `${item.progress?.currentSteps || 0} / ${item.stepsNeeded}`;

      progRow.append(progBar, progLabel);
      body.append(progRow);
    }

    if (item.unlocked) {
      const metaRow = document.createElement('div');
      metaRow.className = 'ach-meta-row';

      const timeSpan = document.createElement('span');
      timeSpan.textContent = formatShortTimestamp(item.unlockedAt) || 'Unlocked';
      metaRow.append(timeSpan);

      if (item.verifiedOnPds) {
        const proofLink = document.createElement('a');
        proofLink.className = 'proof-pill';
        const cleanHandle = summary.user?.handle?.replace(/^@+/, '') || '';
        proofLink.href = cleanHandle
          ? `${appViewBase}/?actor=${encodeURIComponent(cleanHandle)}`
          : appViewBase;
        proofLink.target = '_blank';
        proofLink.rel = 'noopener noreferrer';
        proofLink.setAttribute('aria-label', `Verified ATProto proof for ${item.title}`);
        proofLink.textContent = 'Proof';
        metaRow.append(proofLink);
      }

      body.append(metaRow);
    }

    li.append(icon, body);
    achievementsListEl.append(li);
  }
}

function renderRunUnlocksOnGameOver(runUnlocks) {
  goUnlocksList.replaceChildren();
  if (!runUnlocks || runUnlocks.length === 0) {
    goUnlocksStrip.hidden = true;
    return;
  }

  for (const ach of runUnlocks) {
    const li = document.createElement('li');
    li.className = 'go-unlock-chip';

    const img = document.createElement('img');
    img.src = `.${ach.iconPath}`;
    img.alt = '';
    img.width = 22;
    img.height = 22;

    const span = document.createElement('span');
    span.textContent = ach.title;

    li.append(img, span);
    goUnlocksList.append(li);
  }
  goUnlocksStrip.hidden = false;
}

async function loadAndRenderLeaderboard() {
  lbStatusMsg.hidden = false;
  lbStatusMsg.textContent = 'Loading verified All-Time Best Scores…';
  leaderboardTbody.replaceChildren();

  if (currentLbScope === 'social' && !openGaming.authenticated) {
    lbStatusMsg.textContent =
      'Connect your ATProto account first to filter the leaderboard by pilots you follow.';
    return;
  }

  try {
    const data = await openGaming.fetchLeaderboard(currentLbScope);
    const entries = data.entries || [];
    const appViewBase = openGaming.getSummary().appViewUrl || 'https://opengaming.games';

    if (entries.length === 0) {
      lbStatusMsg.textContent =
        currentLbScope === 'social'
          ? 'No verified scores yet among accounts you follow — set a score to claim #1!'
          : 'No verified ATProto scores recorded yet — connect your account and fly to claim #1!';
      return;
    }

    lbStatusMsg.hidden = true;
    for (const entry of entries) {
      const tr = document.createElement('tr');
      tr.dataset.viewer = String(Boolean(entry.isViewer));

      const rankTd = document.createElement('td');
      const rankBadge = document.createElement('span');
      rankBadge.className = 'lb-rank-badge';
      rankBadge.dataset.rank = String(entry.rank);
      rankBadge.textContent = `#${entry.rank}`;
      rankTd.append(rankBadge);

      const pilotTh = document.createElement('th');
      pilotTh.scope = 'row';
      const pilotCell = document.createElement('div');
      pilotCell.className = 'lb-pilot-cell';

      const avatar = document.createElement('img');
      avatar.className = 'lb-avatar';
      avatar.src =
        entry.avatar && /^https?:\/\//i.test(entry.avatar) ? entry.avatar : './favicon.svg';
      avatar.alt = '';
      avatar.width = 30;
      avatar.height = 30;
      avatar.loading = 'lazy';

      const meta = document.createElement('div');
      meta.className = 'lb-pilot-meta';
      const nameStrong = document.createElement('strong');
      nameStrong.textContent = entry.displayName || entry.handle || entry.did;
      const handleSpan = document.createElement('span');
      handleSpan.className = 'lb-pilot-handle';
      const cleanHandle = String(entry.handle || entry.did).replace(/^@+/, '');
      handleSpan.textContent = cleanHandle.startsWith('did:') ? cleanHandle : `@${cleanHandle}`;

      meta.append(nameStrong, handleSpan);
      pilotCell.append(avatar, meta);
      pilotTh.append(pilotCell);

      const scoreTd = document.createElement('td');
      const scoreStrong = document.createElement('strong');
      scoreStrong.className = 'lb-score-val';
      scoreStrong.textContent = entry.displayScore || `${entry.score} pts`;
      scoreTd.append(scoreStrong);

      const proofTd = document.createElement('td');
      const proofLink = document.createElement('a');
      proofLink.className = 'proof-pill';
      proofLink.href = `${appViewBase}/?actor=${encodeURIComponent(cleanHandle)}`;
      proofLink.target = '_blank';
      proofLink.rel = 'noopener noreferrer';
      proofLink.setAttribute('aria-label', `Verified ATProto score proof for ${cleanHandle}`);
      proofLink.textContent = 'Proof';
      proofTd.append(proofLink);

      tr.append(rankTd, pilotTh, scoreTd, proofTd);
      leaderboardTbody.append(tr);
    }
  } catch {
    lbStatusMsg.hidden = false;
    lbStatusMsg.textContent = 'Could not reach leaderboard service right now.';
  }
}

const game = new FlappyskyGame({
  audio,
  onScoreChange({ score, likes, best }) {
    hudScore.textContent = String(score);
    hudBest.textContent = String(best);
    menuBestScore.textContent = String(best);
    if (game.state === 'playing') {
      openGaming.checkLiveFlightMilestones({ score, likesRun: likes });
    }
  },
  onLikeCollected({ likesRun, score }) {
    if (game.state === 'playing') {
      openGaming.checkLiveFlightMilestones({ score, likesRun });
    }
  },
  onGameOver({ score, best, posts, likes, isNewBest, cause }) {
    goPosts.textContent = String(posts);
    goLikes.textContent = String(likes);
    goScore.textContent = String(score);
    goBest.textContent = String(best);
    newBestBadge.hidden = !isNewBest;
    menuBestScore.textContent = String(best);
    goSyncPill.hidden = !openGaming.authenticated;
    if (openGaming.authenticated) {
      goSyncPill.textContent = 'Syncing to PDS…';
    }

    announcePolite(
      `${posts} Posts Cleared plus ${likes} Likes Collected equals ${score} Final Score. Best Score ${best}.`
    );

    openGaming
      .recordCompletedRun({
        score,
        posts,
        likes,
        cause,
        platform: isMobileDevice() ? 'mobile' : 'desktop'
      })
      .then(({ runUnlocks }) => {
        renderRunUnlocksOnGameOver(runUnlocks);
      });
  },
  onStateChange(state) {
    mainMenu.hidden = state !== 'menu';
    pauseMenu.hidden = state !== 'paused';
    gameoverMenu.hidden = state !== 'gameover';
    readyBanner.hidden = state !== 'ready';

    const activeFlight = isGameplayActiveState(state);
    document.body.dataset.flightActive = String(activeFlight);

    const showHud = state === 'ready' || state === 'playing' || state === 'paused';
    hud.hidden = !showHud;
    hud.inert = state !== 'ready' && state !== 'playing';

    if (activeFlight) {
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

const openGaming = new OpenGamingClient({
  onStateUpdate(summary) {
    if (summary.stats.bestScore > game.bestScore) {
      game.syncBestScore(summary.stats.bestScore);
    }
    renderOpenGamingUI(summary);
  },
  onAchievementUnlocked(ach) {
    showAchievementUnlockToast(ach);
  },
  onSyncStatus({ state }) {
    if (state === 'synced') {
      goSyncPill.hidden = false;
      goSyncPill.textContent = 'Synced to PDS';
    } else if (state === 'error') {
      goSyncPill.hidden = false;
      goSyncPill.textContent = 'Saved Locally';
    }
  }
});

// Initialize high score display, Open Gaming state & button states
menuBestScore.textContent = String(game.bestScore);
hudBest.textContent = String(game.bestScore);
renderOpenGamingUI(openGaming.getSummary());
syncAudioButtons();
syncFullscreenButtons();

openGaming.init().then((summary) => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('auth') || params.has('auth_error')) {
    const authErr = params.get('auth_error');
    const authOk = params.get('auth') === 'connected';
    window.history.replaceState({}, '', window.location.pathname);

    if (authErr) {
      authErrorBanner.textContent = authErr;
      authErrorBanner.hidden = false;
      if (!authDialog.open) authDialog.showModal();
    } else if (authOk && summary.user) {
      showToast(`Connected as @${summary.user.handle.replace(/^@+/, '')} — syncing records to your PDS!`);
    }
  }
});

// Achievement filter radio pills
for (const radio of document.querySelectorAll('input[name="ach-filter"]')) {
  radio.addEventListener('change', () => {
    if (radio.checked) {
      currentAchFilter = radio.value;
      renderOpenGamingUI(openGaming.getSummary());
    }
  });
}

// Leaderboard scope radio pills + auto-load when leaderboard dialog opens
for (const radio of document.querySelectorAll('input[name="lb-scope"]')) {
  radio.addEventListener('change', () => {
    if (radio.checked) {
      currentLbScope = radio.value;
      loadAndRenderLeaderboard();
    }
  });
}

btnLbRefresh.addEventListener('click', () => {
  audio.playMenuTick();
  loadAndRenderLeaderboard();
});

const lbOpenObserver = new MutationObserver(() => {
  if (leaderboardDialog.open) {
    loadAndRenderLeaderboard();
  }
});
lbOpenObserver.observe(leaderboardDialog, { attributes: true, attributeFilter: ['open'] });

for (const modal of [achievementsDialog, leaderboardDialog, authDialog]) {
  modal.addEventListener('close', () => {
    modal.returnValue = '';
    if (modal === authDialog) {
      authErrorBanner.hidden = true;
    }
  });
}

// ATProto OAuth & App Password form handlers
oauthLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authErrorBanner.hidden = true;
  const handle = oauthHandleInput.value.trim();
  if (!handle) return;

  btnOauthSubmit.disabled = true;
  btnOauthSubmit.textContent = 'Redirecting to PDS…';
  try {
    await openGaming.startOAuthLogin(handle);
  } catch (err) {
    authErrorBanner.textContent = err?.message || 'Unable to start OAuth sign-in.';
    authErrorBanner.hidden = false;
    btnOauthSubmit.disabled = false;
    btnOauthSubmit.textContent = 'Continue with ATProto OAuth';
  }
});

btnToggleAppPw.addEventListener('click', () => {
  const showing = appPwSecret.type === 'text';
  appPwSecret.type = showing ? 'password' : 'text';
  btnToggleAppPw.setAttribute('aria-pressed', String(!showing));
  btnToggleAppPw.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  btnToggleAppPw.textContent = showing ? 'Show' : 'Hide';
});

appPwForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authErrorBanner.hidden = true;

  const identifier = appPwIdentifier.value.trim();
  const password = appPwSecret.value.trim();
  if (!identifier || !password) return;

  btnAppPwSubmit.disabled = true;
  btnAppPwSubmit.textContent = 'Signing in & syncing…';
  try {
    const res = await openGaming.loginWithAppPassword(identifier, password);
    appPwSecret.value = '';
    if (authDialog.open) authDialog.close();
    showToast(`Signed in as @${res.user.handle.replace(/^@+/, '')} — achievements synced to your PDS!`);
  } catch (err) {
    authErrorBanner.textContent = err?.message || 'App Password sign-in failed.';
    authErrorBanner.hidden = false;
  } finally {
    btnAppPwSubmit.disabled = false;
    btnAppPwSubmit.textContent = 'Sign In with App Password';
  }
});

btnAuthSyncNow.addEventListener('click', async () => {
  btnAuthSyncNow.disabled = true;
  btnAuthSyncNow.textContent = 'Syncing…';
  const res = await openGaming.syncToPds({ run: null });
  btnAuthSyncNow.disabled = false;
  btnAuthSyncNow.textContent = 'Sync Progress to PDS';
  if (res) {
    showToast('All unlocked achievements & personal best synced to your ATProto PDS!');
  }
});

btnAuthLogout.addEventListener('click', async () => {
  await openGaming.logout();
  if (authDialog.open) authDialog.close();
  showToast('Signed out of ATProto.');
});

// Initialize 2D Arrow-Key Spatial Navigation on all menu containers
for (const navEl of document.querySelectorAll('[data-spatial-nav]')) {
  initSpatialNav(navEl, {
    onNavigate: () => audio.playMenuTick()
  });
}

// Responsive viewport & Mobile Portrait / Fullscreen Gate Enforcement
function handleViewportAndOrientation() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.resize(w, h, window.devicePixelRatio || 1);
  game.setViewportAspect(w, h);

  const mobile = isMobileDevice();
  const mustRotate = mobile && isPortraitOrientation();
  const mustEnterFullscreen =
    mobile && !mustRotate && canRequestFullscreen() && !isFullscreenActive();

  const wasShowingRotate = !rotateSplash.hidden;
  const wasShowingFullscreen = !fullscreenSplash.hidden;
  const wasGated = wasShowingRotate || wasShowingFullscreen;

  if (mustRotate) {
    if (game.state === 'playing' || game.state === 'ready') {
      game.pause();
    }
    rotateSplash.hidden = false;
    fullscreenSplash.hidden = true;
    appShell.inert = true;
    if (!wasShowingRotate) {
      btnRotateFullscreen.focus();
      announcePolite('Please rotate your device to landscape mode to play Flappysky.');
    }
  } else if (mustEnterFullscreen) {
    if (game.state === 'playing' || game.state === 'ready') {
      game.pause();
    }
    rotateSplash.hidden = true;
    fullscreenSplash.hidden = false;
    appShell.inert = true;
    if (!wasShowingFullscreen) {
      btnEnterFullscreen.focus();
      announcePolite('Tap Enter Fullscreen to play Flappysky.');
    }
  } else {
    rotateSplash.hidden = true;
    fullscreenSplash.hidden = true;
    appShell.inert = false;
    if (wasGated) {
      focusActiveMenuDefault(game.state);
    }
  }
}

function handleFullscreenStateChange() {
  syncFullscreenButtons();
  handleViewportAndOrientation();
}

window.addEventListener('resize', handleViewportAndOrientation);
window.addEventListener('orientationchange', handleViewportAndOrientation);
document.addEventListener('fullscreenchange', handleFullscreenStateChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenStateChange);
standaloneDisplayQuery.addEventListener('change', handleFullscreenStateChange);

// Menu Button Handlers
function beginFlightFromUI() {
  if (isMobileGateOpen() || isAnyModalDialogOpen()) return;
  if (isMobileDevice()) {
    requestFullscreenAutoMobile();
  }
  openGaming.resetRunTracking();
  goUnlocksStrip.hidden = true;
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

btnEnterFullscreen.addEventListener('click', () => {
  toggleFullscreen();
  audio.unlock();
  audio.playMenuTick();
});

btnHudPause.addEventListener('click', () => {
  audio.playMenuTick();
  game.pause();
});

btnResume.addEventListener('click', () => {
  if (isMobileGateOpen()) return;
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
// - Never intercept keys when a modal <dialog> is open
// - Arrow keys navigate active menus
// - Spacebar moves butterfly up (tap or hold) & releasing glides down
// - Escape / P pauses & resumes flight
window.addEventListener('keydown', (e) => {
  if (isMobileGateOpen() || isAnyModalDialogOpen()) return;

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
  if (isAnyModalDialogOpen()) return;
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
  if (isMobileGateOpen() || isAnyModalDialogOpen()) return;
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
