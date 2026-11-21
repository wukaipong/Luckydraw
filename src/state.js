const KEY = "circus-lucky-draw-v1";

const SEED = ["Amelia", "Marco", "Priya", "Kenji", "Sofia", "Dmitri", "Luna", "Oscar", "Zara", "Felix", "Nadia", "Hugo"];

export const LOCAL_SEEDS = [
  { id: "seed-bgm", name: "Circus Music Vol.2 (1 hour)", kind: "local", url: "/music/" + encodeURIComponent("Circus Music Vol.2 (1 hour).mp3") },
  { id: "seed-spin", name: "賭神出場音樂", kind: "local", url: "/music/" + encodeURIComponent("賭神出場音樂.mp3") }
];

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
      bgm: { kind: "audio", url: LOCAL_SEEDS[0].url, trackId: LOCAL_SEEDS[0].id },
      spin: { kind: "audio", url: LOCAL_SEEDS[1].url, trackId: LOCAL_SEEDS[1].id },
      win: null
    },
    tracks: LOCAL_SEEDS.map(tr => ({ ...tr }))
  }
};

try {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    if (Array.isArray(saved.participants)) state.participants = saved.participants.map(String);
    if (Array.isArray(saved.history)) state.history = saved.history;
    Object.assign(state.settings, saved.settings || {});
    if (!state.settings.music || typeof state.settings.music !== "object") {
      state.settings.music = { bgm: null, spin: null, win: null };
    }
  }
} catch { /* fresh start */ }
if (!Array.isArray(state.settings.tracks)) state.settings.tracks = [];
state.settings.tracks = state.settings.tracks.filter(tr => tr && tr.id && (typeof tr.videoId === "string" || typeof tr.url === "string"));
for (const tr of state.settings.tracks) {
  if (!tr.kind) tr.kind = tr.videoId ? "youtube" : /^https?:\/\//i.test(tr.url) ? "url" : "local";
}
// v2: the two seeded YouTube tracks were replaced by the local files in music/
if ((state.settings.libVersion || 1) < 2) {
  const retired = new Set(["ASGism_azes", "IfYPHQ-oU5w"]);
  state.settings.tracks = state.settings.tracks.filter(tr => !(tr.videoId && retired.has(tr.videoId)));
  for (const seed of LOCAL_SEEDS) {
    if (!state.settings.tracks.some(tr => tr.url === seed.url)) state.settings.tracks.push({ ...seed });
  }
  for (const slot of ["bgm", "spin", "win"]) {
    const spec = state.settings.music[slot];
    if (spec && spec.kind === "youtube" && retired.has(spec.videoId)) {
      const seed = LOCAL_SEEDS[slot === "spin" ? 1 : 0];
      state.settings.music[slot] = slot === "win" ? null : { kind: "audio", url: seed.url, trackId: seed.id };
    }
  }
  state.settings.libVersion = 2;
}

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