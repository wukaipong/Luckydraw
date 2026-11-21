const SEL = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const DIRS = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0]
};

function candidates(scope) {
  return [...scope.querySelectorAll(SEL)].filter(el => {
    if (el.disabled || el.getAttribute("aria-hidden") === "true") return false;
    // locked TV fields are not stops — the pencil button beside them is
    if (el.readOnly && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return false;
    const r = el.getClientRects();
    return r.length > 0 && r[0].width > 0 && r[0].height > 0;
  });
}

function rectOf(el) {
  const r = el.getBoundingClientRect();
  return { l: r.left, t: r.top, r: r.right, b: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}

function pick(list, from, dir) {
  const [dx, dy] = DIRS[dir];
  const a = rectOf(from);
  let best = null, bestScore = Infinity;
  for (const el of list) {
    if (el === from) continue;
    const b = rectOf(el);
    const px = (b.cx - a.cx) * dx + (b.cy - a.cy) * dy;
    if (px < 8) continue;
    let orth;
    if (dx !== 0) {
      orth = b.t > a.b ? b.t - a.b : a.t > b.b ? a.t - b.b : 0;
      if (orth > 0) continue;
    } else {
      orth = b.l > a.r ? b.l - a.r : a.l > b.r ? a.l - b.r : 0;
    }
    const score = px + orth * 2.5;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

export function focusWithin(scope) {
  const list = candidates(scope);
  if (list.length) list[0].focus();
}

export function initTvNav({ isTv, getScope, onBack }) {
  window.addEventListener("keydown", e => {
    if (!isTv()) return;
    const active = document.activeElement;
    const tag = active?.tagName;
    const type = active?.type;
    const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
    const native = tag === "TEXTAREA" ||
      (tag === "INPUT" && (type === "range" || type === "number" || type === "text") && horizontal);
    const isBack = e.key === "Escape" || e.keyCode === 4 || e.key === "GoBack" || e.key === "BrowserBack" ||
      (e.key === "Backspace" && !native);
    if (isBack) {
      e.preventDefault();
      onBack();
      return;
    }
    if (!DIRS[e.key] || native) return;
    e.preventDefault();
    const scope = getScope();
    const list = candidates(scope);
    const from = list.includes(active) ? active : list[0];
    if (!from) return;
    if (!list.includes(active)) { from.focus(); return; }
    const next = pick(list, from, e.key);
    if (next) {
      next.focus();
      next.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, true);
}