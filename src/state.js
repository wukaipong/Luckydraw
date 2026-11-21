const KEY = "circus-lucky-draw-v1";

const SEED = ["Amelia", "Marco", "Priya", "Kenji", "Sofia", "Dmitri", "Luna", "Oscar", "Zara", "Felix", "Nadia", "Hugo"];

export const state = {
  participants: [...SEED],
  history: [],
  settings: {
    duration: 6,
    confetti: 70,
    bulbSpeed: 1,
    lightShow: true,
    ticks: true,
    sound: true,
    lang: "zh",
    tvMode: "auto",
    music: {
      bgm: { kind: "youtube", videoId: "ASGism_azes" },
      spin: { kind: "youtube", videoId: "IfYPHQ-oU5w" },
      win: null
    },
    tracks: [
      { id: "seed-bgm", name: "", videoId: "ASGism_azes" },
      { id: "seed-spin", name: "", videoId: "IfYPHQ-oU5w" }
    ]
  }
};

try {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    if (Array.isArray(saved.participants)) state.participants = saved.participants.map(String);
    if (Array.isArray(saved.history)) state.history = saved.history;
    Object.assign(state.settings, saved.settings || {});
  }
} catch { /* fresh start */ }
if (!Array.isArray(state.settings.tracks)) state.settings.tracks = [];
state.settings.tracks = state.settings.tracks.filter(tr => tr && tr.id && typeof tr.videoId === "string");

let timer = null;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full/blocked */ }
  }, 150);
}
// a tab/TV app killed inside the debounce window must not lose the last mutation
window.addEventListener("pagehide", () => {
  clearTimeout(timer);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full/blocked */ }
});

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); }
export function emitChange() { save(); listeners.forEach(fn => fn()); }