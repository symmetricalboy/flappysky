/**
 * Spatial 2D Arrow-Key Navigation with Roving Tabindex
 * Implements live bounding-geometry candidate selection scoped to composite menu widgets.
 */

const CANDIDATE_SELECTOR =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)';
const EDGE_TOLERANCE = 2;
const FALLBACK_WEIGHT = 2.5;

function getVisibleCandidates(container) {
  const nodes = Array.from(container.querySelectorAll(CANDIDATE_SELECTOR));
  return nodes.filter((el) =>
    typeof el.checkVisibility === 'function'
      ? el.checkVisibility()
      : el.offsetWidth > 0 || el.offsetHeight > 0
  );
}

export function setRovingFocus(container, target, { focusElement = true } = {}) {
  const candidates = getVisibleCandidates(container);
  if (!candidates.length) return null;

  const active = candidates.includes(target) ? target : candidates[0];
  for (const el of candidates) {
    el.setAttribute('tabindex', el === active ? '0' : '-1');
  }
  if (focusElement) {
    active.focus();
    active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  return active;
}

function findNextCandidate(current, candidates, key) {
  const currRect = current.getBoundingClientRect();
  const currCx = (currRect.left + currRect.right) / 2;
  const currCy = (currRect.top + currRect.bottom) / 2;

  const isHorizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const aligned = [];
  const unaligned = [];

  for (const cand of candidates) {
    if (cand === current) continue;
    const rect = cand.getBoundingClientRect();

    let inDirection = false;
    let gap = 0;

    if (key === 'ArrowRight' && rect.left >= currRect.right - EDGE_TOLERANCE) {
      inDirection = true;
      gap = Math.max(0, rect.left - currRect.right);
    } else if (key === 'ArrowLeft' && rect.right <= currRect.left + EDGE_TOLERANCE) {
      inDirection = true;
      gap = Math.max(0, currRect.left - rect.right);
    } else if (key === 'ArrowDown' && rect.top >= currRect.bottom - EDGE_TOLERANCE) {
      inDirection = true;
      gap = Math.max(0, rect.top - currRect.bottom);
    } else if (key === 'ArrowUp' && rect.bottom <= currRect.top + EDGE_TOLERANCE) {
      inDirection = true;
      gap = Math.max(0, currRect.top - rect.bottom);
    }

    if (!inDirection) continue;

    const candCx = (rect.left + rect.right) / 2;
    const candCy = (rect.top + rect.bottom) / 2;

    const overlapsPerp = isHorizontal
      ? Math.min(rect.bottom, currRect.bottom) > Math.max(rect.top, currRect.top)
      : Math.min(rect.right, currRect.right) > Math.max(rect.left, currRect.left);

    const perpOffset = isHorizontal ? Math.abs(candCy - currCy) : Math.abs(candCx - currCx);

    if (overlapsPerp) {
      aligned.push({ cand, gap, perpOffset });
    } else {
      unaligned.push({ cand, score: gap + FALLBACK_WEIGHT * perpOffset });
    }
  }

  if (aligned.length > 0) {
    aligned.sort((a, b) => a.gap - b.gap || a.perpOffset - b.perpOffset);
    return aligned[0].cand;
  }

  if (unaligned.length > 0) {
    unaligned.sort((a, b) => a.score - b.score);
    return unaligned[0].cand;
  }

  return null;
}

export function initSpatialNav(container, { onNavigate } = {}) {
  setRovingFocus(container, null, { focusElement: false });

  container.addEventListener('focusin', (e) => {
    const candidates = getVisibleCandidates(container);
    if (candidates.includes(e.target)) {
      for (const el of candidates) {
        el.setAttribute('tabindex', el === e.target ? '0' : '-1');
      }
    }
  });

  container.addEventListener('keydown', (e) => {
    if (
      e.defaultPrevented ||
      e.ctrlKey ||
      e.altKey ||
      e.metaKey ||
      e.shiftKey ||
      !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
    ) {
      return;
    }

    const origin = e.composedPath()[0];
    if (
      origin instanceof Element &&
      origin.matches(':read-write, select, input[type="range"], [role="slider"]')
    ) {
      return;
    }

    const candidates = getVisibleCandidates(container);
    const active = document.activeElement;
    if (!candidates.includes(active)) return;

    const next = findNextCandidate(active, candidates, e.key);
    if (!next) {
      // Preserve native boundary scrolling when no spatial candidate exists in pressed direction
      return;
    }

    e.preventDefault();
    setRovingFocus(container, next, { focusElement: true });
    if (onNavigate) onNavigate(next);
  });
}
