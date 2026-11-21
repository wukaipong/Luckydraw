import "./style.css";
import { state, save, emitChange, onChange } from "./state.js";
import { t, setLang, getLang, applyI18n } from "./i18n.js";
import { Wheel } from "./wheel.js";
import { AudioEngine } from "./audio.js";
import { Fx, shake } from "./fx.js";
import { Bridge } from "./bridge.js";
import { initTvNav, focusWithin } from "./tvnav.js";

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
  trackList: $("trackList"), trackUrl: $("trackUrl"), trackName: $("trackName"), trackAdd: $("trackAddBtn"),
  history: $("historyList"), historyBadge: $("historyBadge"), historyEmpty: $("historyEmpty"),
  exportBtn: $("exportBtn"), resetBtn: $("resetBtn"),
  overlay: $("winnerOverlay"), winnerName: $("winnerName"),
  confirm: $("confirmBtn"), redraw: $("redrawBtn"),
  sound: $("soundBtn"), soundLabel: $("soundLabel"),
  soundOn: $("soundIconOn"), soundOff: $("soundIconOff"),
  soundToggle: $("soundToggle"),
  settingsBtn: $("settingsBtn"), settingsPage: $("settingsPage"),
  settingsScrim: $("settingsScrim"), settingsClose: $("settingsClose"),
  langSelect: $("langSelect"), tvSelect: $("tvSelect"),
  metaCount: $("metaCount"), metaLast: $("metaLast"), mcpEndpoint: $("mcpEndpoint"),
  install: $("installBtn"),
  lamp: $("mcpLamp"), lampText: $("mcpLampText"), mcpDot: $("mcpDot"),
  keygen: $("keygenBtn"), keyOverlay: $("keyOverlay"), keyValue: $("keyValue"),
  keyCopy: $("keyCopyBtn"), keyClose: $("keyCloseBtn"),
  keyList: $("keyList"), keyListEmpty: $("keyListEmpty"),
  keyNameStage: $("keyNameStage"), keyResultStage: $("keyResultStage"),
  keyNameInput: $("keyNameInput"), keyCreate: $("keyCreateBtn"),
  keyCancel: $("keyCancelBtn"), keyLabel: $("keyLabel"),
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
  else els.hint.textContent = n ? t(isTv() ? "hintIdleTv" : "hintIdle", { n }) : t("hintEmpty");
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
  els.metaCount.textContent = t("metaCount", { n: state.participants.length });
  els.metaLast.textContent = state.history.length ? t("metaLast", { name: state.history[0].name }) : t("metaNone");
}
onChange(refreshUI);

/* ————— settings page (gear) ————— */
let settingsOpen = false;
let lastFocus = null;
function openSettings() {
  if (settingsOpen) return;
  settingsOpen = true;
  lastFocus = document.activeElement;
  els.settingsScrim.classList.remove("hidden");
  els.settingsPage.classList.remove("hidden");
  requestAnimationFrame(() => els.settingsPage.classList.add("open"));
  focusWithin(els.settingsPage);
  refreshKeyList();
}
function closeSettings() {
  if (!settingsOpen) return;
  settingsOpen = false;
  els.settingsPage.classList.remove("open");
  setTimeout(() => {
    if (!settingsOpen) {
      els.settingsPage.classList.add("hidden");
      els.settingsScrim.classList.add("hidden");
    }
  }, 320);
  const back = lastFocus && document.contains(lastFocus) && lastFocus !== document.body ? lastFocus : els.settingsBtn;
  back.focus();
}
els.settingsBtn.addEventListener("click", () => (settingsOpen ? closeSettings() : openSettings()));
els.settingsClose.addEventListener("click", closeSettings);
els.settingsScrim.addEventListener("click", closeSettings);

/* ————— TV mode ————— */
function detectTv() {
  const ua = navigator.userAgent;
  return /\bTV\b|Android TV|GoogleTV|Google TV|AFT|BRAVIA|MiBOX|MiTV|SmartTV|Smart-TV|Tizen|Web0S|WEBOS|Roku|CrKey|HbbTV|NETTV/i.test(ua) ||
    (/\bAndroid\b/i.test(ua) && !/\bMobile\b/i.test(ua));
}
function isTv() { return document.body.classList.contains("tv"); }
function applyTv() {
  const on = state.settings.tvMode === "on" || (state.settings.tvMode === "auto" && detectTv());
  const was = isTv();
  document.body.classList.toggle("tv", on);
  if (on && !was) els.go.focus();
  updateHint();
}
initTvNav({
  isTv,
  getScope: () => settingsOpen ? els.settingsPage
    : !els.overlay.classList.contains("hidden") ? els.overlay
    : document,
  onBack: () => {
    if (settingsOpen) closeSettings();
    else if (!els.overlay.classList.contains("hidden")) cancelReveal();
  }
});

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
  audio.playBgm();
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

/* ————— music sources + named YouTube library ————— */
const MUSIC_SLOTS = ["bgm", "spin", "win"];
const YT_RE = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/;
const tracks = () => state.settings.tracks;
const trackById = id => tracks().find(tr => tr.id === id);
const trackByVideo = videoId => tracks().find(tr => tr.videoId === videoId);
const trackByName = name => {
  const n = String(name).trim().toLowerCase();
  return n ? tracks().find(tr => (tr.name || "").toLowerCase() === n) : undefined;
};
const newTrackId = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function fetchTitle(tr) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${tr.videoId}&format=json`, { signal: ctl.signal })
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      if (j && j.title && !tr.name) {
        tr.name = String(j.title).slice(0, 80);
        save(); syncMusicUI();
        const inp = els.trackList.querySelector(`input[data-track="${tr.id}"]`);
        if (inp && document.activeElement !== inp && !inp.value) inp.value = tr.name;
      }
    })
    .catch(() => { /* offline: the videoId stays as the label */ })
    .finally(() => clearTimeout(timer));
}

function ensureTrack(videoId) {
  let tr = trackByVideo(videoId);
  if (!tr) { tr = { id: newTrackId(), name: "", videoId }; tracks().push(tr); save(); }
  if (!tr.name) fetchTitle(tr);
  return tr;
}

function addTrack(source, name = "") {
  const s = String(source).trim();
  const m = s.match(YT_RE) || s.match(/^([\w-]{6,20})$/);
  if (!m) throw new Error(t("trackBadUrl"));
  const existing = trackByVideo(m[1]);
  if (existing) {
    if (name.trim() && !existing.name) { existing.name = name.trim().slice(0, 80); save(); }
    syncMusicUI(); renderTracks();
    return { track: existing, dup: true };
  }
  const tr = { id: newTrackId(), name: name.trim().slice(0, 80), videoId: m[1] };
  tracks().push(tr);
  save();
  if (!tr.name) fetchTitle(tr);
  syncMusicUI(); renderTracks();
  return { track: tr, dup: false };
}

function renameTrack(id, name) {
  const tr = trackById(id);
  if (!tr) throw new Error("Unknown track");
  tr.name = String(name).trim().slice(0, 80);
  save(); syncMusicUI();
  return tr;
}

function removeTrack(id) {
  const i = tracks().findIndex(tr => tr.id === id);
  if (i < 0) throw new Error("Unknown track");
  const [tr] = tracks().splice(i, 1);
  const resetSlots = [];
  for (const slot of MUSIC_SLOTS) {
    const spec = state.settings.music[slot];
    if (spec && spec.kind === "youtube" && (spec.trackId === id || spec.videoId === tr.videoId)) {
      applyMusic(slot, null);
      resetSlots.push(slot);
    }
  }
  save(); syncMusicUI(); renderTracks();
  return { removed: tr, resetSlots };
}

function renderTracks() {
  els.trackList.textContent = "";
  for (const tr of tracks()) {
    const li = document.createElement("li");
    li.className = "track-row";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "track-name";
    inp.dataset.track = tr.id;
    inp.value = tr.name;
    inp.placeholder = tr.videoId;
    inp.setAttribute("aria-label", t("trackNamePh"));
    inp.addEventListener("change", () => renameTrack(tr.id, inp.value));
    const vid = document.createElement("code");
    vid.className = "track-vid";
    vid.textContent = tr.videoId;
    const del = document.createElement("button");
    del.className = "track-del";
    del.textContent = "×";
    del.setAttribute("aria-label", `${t("trackDel")}: ${tr.name || tr.videoId}`);
    del.addEventListener("click", () => {
      const { resetSlots } = removeTrack(tr.id);
      toast(t("trackRemoved") + (resetSlots.length ? " · " + t("trackResetSlots") : ""));
    });
    li.append(inp, vid, del);
    els.trackList.appendChild(li);
  }
}

function musicKind(slot) {
  const s = state.settings.music[slot];
  if (!s) return "synth";
  if (s.kind === "off") return "off";
  return s.kind === "youtube" ? "youtube" : "custom";
}

function syncMusicUI() {
  for (const slot of MUSIC_SLOTS) {
    const sel = els.music[slot];
    const spec = state.settings.music[slot];
    const kind = musicKind(slot);
    sel.textContent = "";
    for (const tr of tracks()) {
      const opt = document.createElement("option");
      opt.value = "yt:" + tr.id;
      opt.textContent = tr.name || tr.videoId;
      sel.appendChild(opt);
    }
    for (const o of ["synth", "custom", "off"]) {
      const opt = document.createElement("option");
      opt.value = o;
      opt.textContent = t(o === "synth" ? "srcSynth" : o === "off" ? "srcOff" : "srcCustom");
      if (o === "custom" && kind !== "custom") opt.disabled = true;
      sel.appendChild(opt);
    }
    if (kind === "youtube") {
      const tr = (spec.trackId && trackById(spec.trackId)) || trackByVideo(spec.videoId);
      sel.value = tr ? "yt:" + tr.id : "synth";
    } else sel.value = kind;
  }
}

function applyMusic(slot, spec) {
  if (spec && spec.kind === "youtube") spec = { ...spec, trackId: ensureTrack(spec.videoId).id };
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
    if (phase === "revealed" && drawSeq === seq) {
      els.overlay.classList.remove("hidden");
      if (isTv()) els.confirm.focus();
    }
  }, 500);
  bridge.event("draw_result", { winner: winnerName });
  if (drawResolve) { drawResolve({ winner: winnerName, index: i }); drawResolve = null; }
}

function confirmWinner() {
  if (phase !== "revealed") return Promise.reject(new Error("No pending winner to confirm"));
  const name = winnerName;
  const i = winnerIndex;
  els.overlay.classList.add("hidden");
  audio.playBgm();
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
      if (isTv()) els.go.focus();
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
  els.soundToggle.checked = state.settings.sound;
  els.langSelect.value = getLang();
  els.tvSelect.value = state.settings.tvMode;
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
    if (v.startsWith("yt:")) {
      const tr = trackById(v.slice(3));
      if (!tr) { syncMusicUI(); return; }
      spec = { kind: "youtube", videoId: tr.videoId, trackId: tr.id };
    } else if (v === "off") spec = { kind: "off" };
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

els.trackAdd.addEventListener("click", () => {
  const url = els.trackUrl.value.trim();
  if (!url) { toast(t("trackBadUrl")); return; }
  try {
    const { track, dup } = addTrack(url, els.trackName.value);
    els.trackUrl.value = "";
    els.trackName.value = "";
    toast(dup ? t("trackDup") : t("trackAdded", { name: track.name || track.videoId }));
  } catch (e) { toast(e.message); }
});
for (const inp of [els.trackUrl, els.trackName]) {
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); els.trackAdd.click(); }
  });
}

els.sound.addEventListener("click", () => {
  state.settings.sound = !state.settings.sound;
  audio.unlock();
  audio.setMuted(!state.settings.sound);
  syncSettingsUI();
  save();
});

els.soundToggle.addEventListener("change", () => {
  state.settings.sound = els.soundToggle.checked;
  audio.unlock();
  audio.setMuted(!state.settings.sound);
  syncSettingsUI();
  save();
});

els.langSelect.addEventListener("change", () => {
  state.settings.lang = els.langSelect.value;
  setLang(state.settings.lang);
  applyI18n();
  syncSettingsUI();
  syncMusicUI();
  renderTracks();
  refreshUI();
  updateMcpStatus();
  save();
});

els.tvSelect.addEventListener("change", () => {
  state.settings.tvMode = els.tvSelect.value;
  applyTv();
  save();
});

/* keyboard */
window.addEventListener("keydown", e => {
  if (e.key === "Escape" && !els.keyOverlay.classList.contains("hidden")) { closeKeyOverlay(); return; }
  if (e.key === "Escape" && settingsOpen) { closeSettings(); return; }
  const tag = document.activeElement?.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
  if (settingsOpen || isTv()) return;
  if (e.code === "Space") { e.preventDefault(); if (phase === "idle" || phase === "revealed") startDraw().catch(() => {}); }
  else if (e.code === "Enter" && phase === "revealed") confirmWinner().catch(() => {});
  else if (e.code === "KeyR" && phase === "revealed") startDraw().catch(() => {});
});

/* audio unlock + playback retry on every gesture until the browser lets sound through */
const gesture = () => { audio.userGesture(); audio.setMuted(!state.settings.sound); };
window.addEventListener("pointerdown", gesture);
window.addEventListener("keydown", gesture);

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
  if (source === "off" || source === "none" || source === "silent") return { kind: "off" };
  const s = String(source).trim();
  if (s.startsWith("track:")) {
    const tr = trackById(s.slice(6));
    if (!tr) throw new Error("Unknown track id");
    return { kind: "youtube", videoId: tr.videoId, trackId: tr.id };
  }
  const named = trackByName(s);
  if (named) return { kind: "youtube", videoId: named.videoId, trackId: named.id };
  const yt = s.match(YT_RE);
  if (yt) return { kind: "youtube", videoId: yt[1] };
  if (s.startsWith("/")) return { kind: "audio", url: new URL(s, location.origin).href };
  if (/^https?:\/\//.test(s)) return { kind: "audio", url: s };
  throw new Error("source must be 'synth', 'off', a saved track name, an http(s) audio URL, or a YouTube link");
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
    return { slot, source: spec && spec.kind === "off" ? "off" : spec || "synth" };
  },
  list_tracks: () => ({ tracks: tracks() }),
  add_track: ({ url, name }) => {
    const { track, dup } = addTrack(url, name || "");
    return { track, alreadyInLibrary: dup };
  },
  rename_track: ({ id, name }) => ({ track: renameTrack(id, name) }),
  remove_track: ({ id }) => removeTrack(id),
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
    if (args.tvMode != null && ["auto", "on", "off"].includes(args.tvMode)) {
      s.tvMode = args.tvMode; applyTv();
    }
    syncSettingsUI(); refreshUI(); save();
    return { settings: s };
  }
};

const bridge = new Bridge({
  onStatus: online => { mcpOnline = online; updateMcpStatus(); if (online && settingsOpen) refreshKeyList(); },
  onCommand: (name, args) => {
    const fn = commands[name];
    if (!fn) throw new Error(`Unknown command: ${name}`);
    return fn(args);
  }
});

/* ————— API key management ————— */
async function refreshKeyList() {
  if (!mcpOnline) {
    els.keyList.innerHTML = "";
    els.keyListEmpty.classList.remove("hidden");
    return;
  }
  try {
    const { keys } = await bridge.request("list_api_keys");
    els.keyList.innerHTML = "";
    for (const k of keys) {
      const li = document.createElement("li");
      li.className = "key-row";
      const name = document.createElement("span");
      name.className = "key-name";
      name.textContent = k.label;
      const id = document.createElement("code");
      id.textContent = k.id;
      const rm = document.createElement("button");
      rm.className = "key-remove";
      rm.textContent = t("keyRemove");
      rm.addEventListener("click", async () => {
        rm.disabled = true;
        try {
          await bridge.request("revoke_api_key", { id: k.id });
          toast(t("keyRemoved", { name: k.label }));
          refreshKeyList();
        } catch (e) { toast(e.message); rm.disabled = false; }
      });
      li.append(name, id, rm);
      els.keyList.appendChild(li);
    }
    els.keyListEmpty.classList.toggle("hidden", keys.length > 0);
  } catch {}
}

function closeKeyOverlay() { els.keyOverlay.classList.add("hidden"); }

els.keygen.addEventListener("click", () => {
  if (!mcpOnline) { toast(t("keygenOffline")); return; }
  els.keyNameInput.value = "";
  els.keyNameStage.classList.remove("hidden");
  els.keyResultStage.classList.add("hidden");
  els.keyOverlay.classList.remove("hidden");
  els.keyNameInput.focus();
});

async function createKey() {
  const label = els.keyNameInput.value.trim();
  if (!label) { toast(t("keyNameRequired")); els.keyNameInput.focus(); return; }
  els.keyCreate.disabled = true;
  try {
    const data = await bridge.request("generate_api_key", { label });
    els.keyLabel.textContent = data.label;
    els.keyValue.textContent = data.key;
    els.keyNameStage.classList.add("hidden");
    els.keyResultStage.classList.remove("hidden");
    els.keyCopy.focus();
    refreshKeyList();
  } catch (e) { toast(e.message); }
  finally { els.keyCreate.disabled = false; }
}
els.keyCreate.addEventListener("click", createKey);
els.keyNameInput.addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); createKey(); }
});
els.keyCopy.addEventListener("click", async () => {
  const key = els.keyValue.textContent;
  let ok = false;
  try { await navigator.clipboard.writeText(key); ok = true; }
  catch {
    const ta = document.createElement("textarea");
    ta.value = key; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand("copy"); } catch {}
    ta.remove();
  }
  if (ok) {
    els.keyCopy.textContent = t("copiedKey");
    setTimeout(() => { els.keyCopy.textContent = t("copyKey"); }, 1500);
  } else {
    toast(t("copyFailed"));
  }
});
els.keyClose.addEventListener("click", closeKeyOverlay);
els.keyCancel.addEventListener("click", closeKeyOverlay);

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
for (const slot of MUSIC_SLOTS) {
  let spec = state.settings.music[slot];
  if (spec && spec.kind === "audio" && /^http:\/\/localhost:\d+\/music\//.test(spec.url) && !spec.url.startsWith(location.origin + "/")) {
    spec = { kind: "audio", url: new URL(new URL(spec.url).pathname, location.origin).href };
    state.settings.music[slot] = spec;
  }
  audio.setSource(slot, spec);
  if (spec && spec.kind === "youtube") state.settings.music[slot] = { ...spec, trackId: ensureTrack(spec.videoId).id };
}
applyI18n();
applyTv();
syncSettingsUI();
syncMusicUI();
renderTracks();
refreshUI();
updateMcpStatus();
els.mcpEndpoint.textContent = bridge.url;
if (isTv()) els.go.focus();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}