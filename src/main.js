import "./style.css";
import { state, save, emitChange, onChange } from "./state.js";
import { t, setLang, getLang, applyI18n } from "./i18n.js";
import { Wheel } from "./wheel.js";
import { AudioEngine } from "./audio.js";
import { Fx, shake } from "./fx.js";
import { Bridge } from "./bridge.js";

const $ = id => document.getElementById(id);
const els = {
  wheel: $("wheel"), go: $("goBtn"), stage: $("stage"), hint: $("stageHint"),
  names: $("namesInput"), add: $("addBtn"), clear: $("clearBtn"),
  rangeMin: $("rangeMin"), rangeMax: $("rangeMax"), gen: $("genBtn"),
  chips: $("chips"), count: $("countBadge"),
  duration: $("durationRange"), durationVal: $("durationVal"),
  confetti: $("confettiRange"), confettiVal: $("confettiVal"),
  bulb: $("bulbRange"), bulbVal: $("bulbVal"),
  light: $("lightToggle"), tick: $("tickToggle"),
  music: { bgm: $("musicBgm"), spin: $("musicSpin"), win: $("musicWin") },
  history: $("historyList"), historyBadge: $("historyBadge"), historyEmpty: $("historyEmpty"),
  exportBtn: $("exportBtn"), resetBtn: $("resetBtn"),
  overlay: $("winnerOverlay"), winnerName: $("winnerName"),
  confirm: $("confirmBtn"), redraw: $("redrawBtn"),
  sound: $("soundBtn"), soundLabel: $("soundLabel"),
  soundOn: $("soundIconOn"), soundOff: $("soundIconOff"),
  lang: $("langBtn"), install: $("installBtn"),
  lamp: $("mcpLamp"), lampText: $("mcpLampText"), mcpDot: $("mcpDot"),
  toasts: $("toasts")
};

setLang(state.settings.lang);
const wheel = new Wheel(els.wheel);
const audio = new AudioEngine();
const fx = new Fx($("dust"), $("confetti"));
wheel.setItems(state.participants);
audio.muted = !state.settings.sound;

let phase = "idle";
let drawSeq = 0;
let winnerIndex = -1;
let winnerName = null;
let drawResolve = null;
let mcpOnline = false;

/* ————— helpers ————— */
function toast(msg, actionLabel, actionFn, ms = 4000) {
  const el = document.createElement("div");
  el.className = "toast";
  const span = document.createElement("span");
  span.textContent = msg;
  el.appendChild(span);
  if (actionLabel) {
    const b = document.createElement("button");
    b.textContent = actionLabel;
    b.onclick = () => { actionFn(); dismiss(); };
    el.appendChild(b);
  }
  els.toasts.appendChild(el);
  const dismiss = () => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 320);
  };
  setTimeout(dismiss, ms);
}

function randomIndex(n) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % n;
}

function updateHint() {
  const n = state.participants.length;
  if (phase === "spinning") els.hint.textContent = t("hintSpinning");
  else if (phase === "revealed") els.hint.textContent = t("hintRevealed");
  else els.hint.textContent = n ? t("hintIdle", { n }) : t("hintEmpty");
  els.go.disabled = phase === "spinning" || phase === "removing" || n === 0;
}

function renderChips() {
  els.chips.textContent = "";
  state.participants.forEach((name, i) => {
    const chip = document.createElement("span");
    chip.className = "chip" + (phase === "revealed" && i === winnerIndex ? " winner-chip" : "");
    const label = document.createElement("span");
    label.textContent = name;
    const x = document.createElement("button");
    x.textContent = "×";
    x.setAttribute("aria-label", `remove ${name}`);
    x.onclick = () => {
      if (!guardEdit()) return;
      state.participants.splice(i, 1);
      wheel.setItems(state.participants);
      emitChange();
    };
    chip.append(label, x);
    els.chips.appendChild(chip);
  });
  els.count.textContent = state.participants.length;
}

function renderHistory() {
  els.history.textContent = "";
  state.history.forEach((h, i) => {
    const li = document.createElement("li");
    const rank = document.createElement("span");
    rank.className = "rank"; rank.textContent = i + 1;
    const name = document.createElement("span");
    name.className = "hname"; name.textContent = h.name;
    const time = document.createElement("time");
    time.textContent = new Date(h.time).toLocaleTimeString(getLang() === "zh" ? "zh-Hant" : "en", { hour: "2-digit", minute: "2-digit" });
    li.append(rank, name, time);
    els.history.appendChild(li);
  });
  els.historyBadge.textContent = state.history.length;
  els.historyEmpty.classList.toggle("hidden", state.history.length > 0);
}

function refreshUI() {
  renderChips();
  renderHistory();
  updateHint();
}
onChange(refreshUI);

function guardEdit() {
  if (phase === "spinning" || phase === "removing") return false;
  if (phase === "revealed") cancelReveal();
  return true;
}

function cancelReveal() {
  els.overlay.classList.add("hidden");
  wheel.highlight = -1;
  winnerIndex = -1; winnerName = null;
  phase = "idle";
  if (drawResolve) { drawResolve({ winner: null, cancelled: true }); drawResolve = null; }
}

function dedupeAdd(list) {
  const seen = new Set(state.participants);
  let added = 0, dup = 0;
  for (const raw of list) {
    const v = String(raw).trim();
    if (!v) continue;
    if (seen.has(v)) { dup++; continue; }
    seen.add(v);
    state.participants.push(v);
    added++;
  }
  return { added, dup };
}

function afterListChange() {
  wheel.setItems(state.participants);
  emitChange();
  bridge.event("participants_changed", { participants: state.participants });
}

/* ————— music sources ————— */
const DEFAULT_TRACKS = { bgm: "ASGism_azes", spin: "IfYPHQ-oU5w" };
const MUSIC_SLOTS = ["bgm", "spin", "win"];

function musicKind(slot) {
  const s = state.settings.music[slot];
  return s ? (s.kind === "youtube" ? "youtube" : "custom") : "synth";
}

function syncMusicUI() {
  for (const slot of MUSIC_SLOTS) {
    const sel = els.music[slot];
    const kind = musicKind(slot);
    sel.textContent = "";
    for (const o of (slot === "win" ? ["synth", "custom"] : ["youtube", "synth", "custom"])) {
      const opt = document.createElement("option");
      opt.value = o;
      opt.textContent = t(o === "youtube" ? "srcYoutube" : o === "synth" ? "srcSynth" : "srcCustom");
      if (o === "custom" && kind !== "custom") opt.disabled = true;
      sel.appendChild(opt);
    }
    sel.value = kind;
  }
}

function applyMusic(slot, spec) {
  audio.setSource(slot, spec);
  state.settings.music[slot] = spec;
  save();
  syncMusicUI();
}

/* ————— draw flow ————— */
function startDraw() {
  if (phase === "spinning" || phase === "removing") return Promise.reject(new Error("Draw already in progress"));
  if (!state.participants.length) return Promise.reject(new Error("No participants on the wheel"));
  if (phase === "revealed") { els.overlay.classList.add("hidden"); wheel.highlight = -1; }
  audio.unlock();
  phase = "spinning";
  updateHint();
  renderChips();
  const idx = randomIndex(state.participants.length);
  const duration = state.settings.duration;
  audio.startSpin(duration);
  shake(els.stage);
  bridge.event("draw_started", { count: state.participants.length });
  const result = new Promise(res => { drawResolve = res; });
  wheel.spinTo(idx, duration,
    () => { if (state.settings.ticks) audio.tick(); },
    i => reveal(i));
  // rAF stops in hidden tabs; guarantee this draw still resolves
  const seq = ++drawSeq;
  setTimeout(() => { if (phase === "spinning" && drawSeq === seq) wheel.finishSpin(); }, duration * 1000 + 2500);
  return result;
}

function reveal(i) {
  const seq = drawSeq;
  phase = "revealed";
  winnerIndex = i;
  winnerName = state.participants[i];
  audio.endSpin();
  const density = state.settings.confetti;
  if (density > 0) fx.cannons(Math.round(30 + density * 2.6));
  els.winnerName.textContent = winnerName;
  updateHint();
  renderChips();
  setTimeout(() => {
    if (phase === "revealed" && drawSeq === seq) els.overlay.classList.remove("hidden");
  }, 500);
  bridge.event("draw_result", { winner: winnerName });
  if (drawResolve) { drawResolve({ winner: winnerName, index: i }); drawResolve = null; }
}

function confirmWinner() {
  if (phase !== "revealed") return Promise.reject(new Error("No pending winner to confirm"));
  const name = winnerName;
  const i = winnerIndex;
  els.overlay.classList.add("hidden");
  phase = "removing";
  updateHint();
  return new Promise(res => {
    wheel.removeAnimated(i, () => {
      state.participants.splice(i, 1);
      state.history.unshift({ name, time: Date.now() });
      winnerIndex = -1; winnerName = null;
      phase = "idle";
      emitChange();
      toast(t("toastRemoved", { name, n: state.participants.length }));
      bridge.event("winner_confirmed", { winner: name, remaining: state.participants.length });
      res({ removed: name, remaining: state.participants.length });
    });
    setTimeout(() => { if (phase === "removing") wheel.finishRemoval(); }, 1500);
  });
}

/* ————— UI events ————— */
els.go.addEventListener("click", () => {
  if (phase === "revealed") { startDraw().catch(() => {}); return; }
  startDraw().catch(e => toast(e.message));
});
els.confirm.addEventListener("click", () => confirmWinner().catch(() => {}));
els.redraw.addEventListener("click", () => startDraw().catch(() => {}));

els.add.addEventListener("click", () => {
  if (!guardEdit()) return;
  const list = els.names.value.split(/[\n,;]+/);
  const { added, dup } = dedupeAdd(list);
  if (!added) { toast(t("toastNeedMore")); return; }
  els.names.value = "";
  afterListChange();
  toast(t("toastAdded", { n: added }) + (dup ? " · " + t("toastDup", { n: dup }) : ""));
});

els.clear.addEventListener("click", () => {
  if (!guardEdit() || !state.participants.length) return;
  const snapshot = state.participants.slice();
  state.participants = [];
  afterListChange();
  toast(t("toastCleared"), t("undo"), () => {
    state.participants = snapshot;
    afterListChange();
  }, 6000);
});

document.querySelectorAll("[data-step]").forEach(btn => {
  btn.addEventListener("click", () => {
    const [which, delta] = btn.dataset.step.split(":");
    const input = which === "min" ? els.rangeMin : els.rangeMax;
    input.value = Math.max(0, (parseInt(input.value) || 0) + parseInt(delta));
  });
});

els.gen.addEventListener("click", () => {
  if (!guardEdit()) return;
  const a = parseInt(els.rangeMin.value), b = parseInt(els.rangeMax.value);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || b - a + 1 > 300) {
    toast(t("toastRangeBad")); return;
  }
  const list = [];
  for (let v = a; v <= b; v++) list.push(String(v));
  const { added } = dedupeAdd(list);
  afterListChange();
  toast(t("toastGenerated", { a, b, n: added }));
});

els.exportBtn.addEventListener("click", () => {
  if (!state.history.length) { toast(t("toastNoHistory")); return; }
  const rows = [[t("csvRank"), t("csvName"), t("csvTime")]];
  state.history.forEach((h, i) => rows.push([i + 1, h.name, new Date(h.time).toLocaleString()]));
  const csv = "" + rows.map(r => r.map(c => `"${String(c).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = "lucky-draw-winners.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(t("toastExported"));
});

els.resetBtn.addEventListener("click", () => {
  if (!guardEdit() || !state.history.length) return;
  const names = state.history.map(h => h.name).reverse();
  state.history = [];
  dedupeAdd(names);
  afterListChange();
  toast(t("toastReset"));
});

/* settings */
function syncSettingsUI() {
  els.duration.value = state.settings.duration;
  els.durationVal.value = state.settings.duration;
  els.durationVal.setAttribute("aria-label", t("spinDuration"));
  els.confetti.value = state.settings.confetti;
  els.confettiVal.textContent = state.settings.confetti;
  els.bulb.value = state.settings.bulbSpeed;
  els.bulbVal.textContent = Number(state.settings.bulbSpeed).toFixed(1) + "×";
  els.light.checked = state.settings.lightShow;
  els.tick.checked = state.settings.ticks;
  document.body.classList.toggle("no-lights", !state.settings.lightShow);
  els.sound.setAttribute("aria-pressed", String(state.settings.sound));
  els.soundLabel.textContent = t(state.settings.sound ? "soundOn" : "soundOff");
  els.soundOn.classList.toggle("hidden", !state.settings.sound);
  els.soundOff.classList.toggle("hidden", state.settings.sound);
  els.lang.textContent = getLang() === "zh" ? "EN" : "繁體";
}
els.duration.addEventListener("input", () => { state.settings.duration = parseFloat(els.duration.value); syncSettingsUI(); save(); });
els.durationVal.addEventListener("change", () => {
  let v = parseFloat(els.durationVal.value);
  if (!Number.isFinite(v)) v = state.settings.duration;
  state.settings.duration = Math.min(12, Math.max(3, Math.round(v * 2) / 2));
  syncSettingsUI();
  save();
});
els.confetti.addEventListener("input", () => { state.settings.confetti = parseInt(els.confetti.value); syncSettingsUI(); save(); });
els.bulb.addEventListener("input", () => { state.settings.bulbSpeed = parseFloat(els.bulb.value); syncSettingsUI(); save(); });
els.light.addEventListener("change", () => { state.settings.lightShow = els.light.checked; syncSettingsUI(); save(); });
els.tick.addEventListener("change", () => { state.settings.ticks = els.tick.checked; save(); });

for (const slot of MUSIC_SLOTS) {
  els.music[slot].addEventListener("change", () => {
    const v = els.music[slot].value;
    let spec;
    if (v === "youtube") spec = { kind: "youtube", videoId: DEFAULT_TRACKS[slot] };
    else if (v === "synth") spec = null;
    else {
      spec = state.settings.music[slot];
      if (!spec || spec.kind !== "audio") { syncMusicUI(); return; }
    }
    applyMusic(slot, spec);
    toast(t("toastMusic", { slot: t(slot === "bgm" ? "bgmSlot" : slot === "spin" ? "spinSlot" : "winSlot") }));
    bridge.event("music_changed", { slot, source: spec || "synth" });
  });
}

els.sound.addEventListener("click", () => {
  state.settings.sound = !state.settings.sound;
  audio.unlock();
  audio.setMuted(!state.settings.sound);
  syncSettingsUI();
  save();
});

els.lang.addEventListener("click", () => {
  state.settings.lang = getLang() === "zh" ? "en" : "zh";
  setLang(state.settings.lang);
  applyI18n();
  syncSettingsUI();
  syncMusicUI();
  refreshUI();
  updateMcpStatus();
  save();
});

/* keyboard */
window.addEventListener("keydown", e => {
  const tag = document.activeElement?.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT") return;
  if (e.code === "Space") { e.preventDefault(); if (phase === "idle" || phase === "revealed") startDraw().catch(() => {}); }
  else if (e.code === "Enter" && phase === "revealed") confirmWinner().catch(() => {});
  else if (e.code === "KeyR" && phase === "revealed") startDraw().catch(() => {});
});

/* audio unlock on first gesture */
const unlockOnce = () => { audio.unlock(); audio.setMuted(!state.settings.sound); };
window.addEventListener("pointerdown", unlockOnce, { once: true });
window.addEventListener("keydown", unlockOnce, { once: true });

/* install prompt */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredPrompt = e;
  els.install.classList.remove("hidden");
});
els.install.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  els.install.classList.add("hidden");
});

/* ————— MCP bridge ————— */
function updateMcpStatus() {
  els.lamp.classList.toggle("online", mcpOnline);
  els.mcpDot.classList.toggle("online", mcpOnline);
  els.lampText.textContent = t(mcpOnline ? "mcpOnline" : "mcpOffline");
}

function parseMusicSource(source) {
  if (!source || source === "synth" || source === "default") return null;
  const yt = String(source).match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/);
  if (yt) return { kind: "youtube", videoId: yt[1] };
  if (/^https?:\/\//.test(source)) return { kind: "audio", url: source };
  throw new Error("source must be 'synth', an http(s) audio URL, or a YouTube link");
}

const commands = {
  get_status: () => ({
    phase,
    participants: state.participants.length,
    history: state.history.length,
    pendingWinner: phase === "revealed" ? winnerName : null,
    music: state.settings.music,
    musicState: audio.musicState(),
    language: getLang(),
    settings: state.settings
  }),
  get_participants: () => ({ participants: state.participants }),
  set_participants: ({ names }) => {
    if (!Array.isArray(names)) throw new Error("names must be an array");
    if (!guardEdit()) throw new Error("Wheel is busy spinning");
    state.participants = [];
    const { added } = dedupeAdd(names);
    afterListChange();
    return { count: added };
  },
  add_participants: ({ names }) => {
    if (!Array.isArray(names)) throw new Error("names must be an array");
    if (!guardEdit()) throw new Error("Wheel is busy spinning");
    const { added, dup } = dedupeAdd(names);
    afterListChange();
    return { added, duplicatesSkipped: dup, count: state.participants.length };
  },
  remove_participants: ({ names }) => {
    if (!guardEdit()) throw new Error("Wheel is busy spinning");
    const set = new Set((names || []).map(String));
    const before = state.participants.length;
    state.participants = state.participants.filter(p => !set.has(p));
    afterListChange();
    return { removed: before - state.participants.length, count: state.participants.length };
  },
  set_number_range: ({ min, max }) => {
    if (!guardEdit()) throw new Error("Wheel is busy spinning");
    const a = Math.trunc(min), b = Math.trunc(max);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || b - a + 1 > 300) throw new Error("Invalid range (max 300 numbers)");
    const list = [];
    for (let v = a; v <= b; v++) list.push(String(v));
    const { added } = dedupeAdd(list);
    afterListChange();
    return { added, count: state.participants.length };
  },
  start_draw: () => startDraw(),
  redraw: () => startDraw(),
  get_result: () => ({ phase, winner: phase === "revealed" ? winnerName : null, lastWinner: state.history[0]?.name || null }),
  confirm_winner: () => confirmWinner(),
  get_history: () => ({ history: state.history }),
  reset_all: () => {
    if (!guardEdit()) throw new Error("Wheel is busy spinning");
    const names = state.history.map(h => h.name).reverse();
    state.history = [];
    dedupeAdd(names);
    afterListChange();
    return { count: state.participants.length };
  },
  set_music: ({ slot, source }) => {
    const spec = parseMusicSource(source);
    applyMusic(slot, spec);
    toast(t("toastMusic", { slot }));
    bridge.event("music_changed", { slot, source: spec || "synth" });
    return { slot, source: spec || "synth" };
  },
  set_settings: args => {
    const s = state.settings;
    if (args.duration != null) s.duration = Math.min(12, Math.max(3, Number(args.duration)));
    if (args.confetti != null) s.confetti = Math.min(100, Math.max(0, Number(args.confetti)));
    if (args.bulbSpeed != null) s.bulbSpeed = Math.min(3, Math.max(0, Number(args.bulbSpeed)));
    if (args.lightShow != null) s.lightShow = !!args.lightShow;
    if (args.ticks != null) s.ticks = !!args.ticks;
    if (args.sound != null) { s.sound = !!args.sound; audio.setMuted(!s.sound); }
    if (args.lang != null && ["en", "zh"].includes(args.lang)) {
      s.lang = args.lang; setLang(args.lang); applyI18n(); updateMcpStatus();
    }
    syncSettingsUI(); refreshUI(); save();
    return { settings: s };
  }
};

const bridge = new Bridge({
  onStatus: online => { mcpOnline = online; updateMcpStatus(); },
  onCommand: (name, args) => {
    const fn = commands[name];
    if (!fn) throw new Error(`Unknown command: ${name}`);
    return fn(args);
  }
});

/* ————— render loop ————— */
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  wheel.render(now, dt, { bulbSpeed: state.settings.bulbSpeed, lightShow: state.settings.lightShow });
  fx.render(now, dt, state.settings.lightShow);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

window.addEventListener("resize", () => { wheel.resize(); fx.resize(); });

/* ————— boot ————— */
for (const slot of MUSIC_SLOTS) audio.setSource(slot, state.settings.music[slot]);
applyI18n();
syncSettingsUI();
syncMusicUI();
refreshUI();
updateMcpStatus();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}