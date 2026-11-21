const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

// Original calliope waltz, 16 bars of 3/4 in C major
const MELODY = [
  [76,1],[79,1],[84,1], [83,1.5],[79,.5],[76,1], [77,1],[81,1],[84,1], [83,2],[79,1],
  [76,1],[79,1],[84,1], [86,1.5],[83,.5],[79,1], [81,1],[77,1],[74,1], [84,3],
  [81,1],[84,1],[89,1], [88,1.5],[84,.5],[81,1], [79,1],[83,1],[86,1], [84,2],[76,1],
  [77,1],[81,1],[84,1], [86,1],[83,1],[79,1], [81,1],[77,1],[74,1], [84,3]
];
const BASS_ROOTS = [48,48,53,55,48,55,53,48,53,53,55,48,53,55,53,48];
const BEAT = 60 / 165;
const LOOP_BEATS = 48;

// Triumphant winner march, 4 bars of 4/4 in C major — loops until the winner is confirmed
const WIN_MELODY = [
  [0,72,1],[1,76,1],[2,79,1],[3,84,1.8],[5,83,.5],[5.5,81,.5],[6,79,1],[7,81,1],
  [8,84,1],[9,88,1],[10,88,1.8],[12,86,1],[13,84,1],[14,83,1],[15,79,1]
];
const WIN_BASS = [48,48,53,55];
const WIN_BEAT = 60 / 138;
const WIN_LOOP = 16;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.unlocked = false;
    this.muted = false;
    this.slots = { bgm: null, spin: null, win: null };
    this.custom = { bgm: null, spin: null, win: null };
    this.failed = { bgm: false, spin: false, win: false };
    // playVideo() outside a user gesture can be refused; blocked slots fall back to synth and retry on the next gesture
    this.blocked = { bgm: false, spin: false, win: false };
    // muted autoplay is allowed before any gesture; the first gesture unmutes these slots
    this.autoMuted = { bgm: false, spin: false, win: false };
    this.watchTimer = null;
    this.desired = "bgm";
    this.bgmTimer = null;
    this.spinTimer = null;
    this.winTimer = null;
    this.spinNodes = [];
    this.winNodes = [];
    this.bgmBeat = 0;
    this.bgmNext = 0;
    this.ytApi = null;
    this.melodyAt = new Map();
    let b = 0;
    for (const [m, d] of MELODY) {
      const key = Math.round(b * 2) / 2;
      if (!this.melodyAt.has(key)) this.melodyAt.set(key, []);
      this.melodyAt.get(key).push([m, d]);
      b += d;
    }
    this.winMelodyAt = new Map();
    for (const [beat, m, d] of WIN_MELODY) {
      if (!this.winMelodyAt.has(beat)) this.winMelodyAt.set(beat, []);
      this.winMelodyAt.get(beat).push([m, d]);
    }
  }

  unlock() {
    if (this.unlocked) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
    this.bgmBus = this.ctx.createGain(); this.bgmBus.connect(this.master);
    this.spinBus = this.ctx.createGain(); this.spinBus.connect(this.master);
    this.winBus = this.ctx.createGain(); this.winBus.connect(this.master);
    this.sfxBus = this.ctx.createGain(); this.sfxBus.connect(this.master);
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.unlocked = true;
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.route();
  }

  musicState() {
    const out = {
      desired: this.desired,
      active: { bgm: !!this.bgmTimer, spin: !!this.spinTimer, win: !!this.winTimer }
    };
    for (const slot of ["bgm", "spin", "win"]) {
      const c = this.custom[slot];
      out[slot] = {
        source: this.slots[slot] ? this.slots[slot].kind : "synth",
        failed: this.failed[slot],
        blocked: this.blocked[slot],
        autoMuted: this.autoMuted[slot],
        muted: c && c.kind === "youtube" && c.ready ? c.player.isMuted() : null,
        ready: c ? (c.kind === "youtube" ? c.ready : true) : true,
        playerState: c && c.kind === "youtube" && c.ready ? c.player.getPlayerState() : null,
        videoId: c && c.kind === "youtube" ? c.videoId : null,
        loop: c ? (c.kind === "audio" ? c.el.loop : c.ready ? c.loop : null) : null
      };
    }
    return out;
  }

  setMuted(m) {
    this.muted = m;
    if (!m) for (const slot of Object.keys(this.autoMuted)) this.autoMuted[slot] = false;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
    for (const slot of Object.keys(this.custom)) {
      const c = this.custom[slot];
      if (!c) continue;
      if (c.kind === "audio") c.el.muted = m;
      if (c.kind === "youtube" && c.ready) m ? c.player.mute() : c.player.unMute();
    }
  }

  setSource(slot, spec) {
    if (!["bgm", "spin", "win"].includes(slot)) throw new Error("bad slot");
    const old = this.custom[slot];
    if (old) {
      if (old.kind === "audio") { old.el.pause(); old.el.src = ""; }
      if (old.kind === "youtube" && old.player) { try { old.player.destroy(); } catch {} }
      this.custom[slot] = null;
    }
    this.slots[slot] = spec || null;
    this.failed[slot] = false;
    this.blocked[slot] = false;
    this.autoMuted[slot] = false;
    if (spec && spec.kind === "audio") {
      const el = new Audio(spec.url);
      el.loop = true;
      el.preload = "auto";
      el.muted = this.muted;
      el.addEventListener("error", () => {
        this.failed[slot] = true;
        if (this.unlocked && this.desired === slot) this.route();
      });
      this.custom[slot] = { kind: "audio", el };
    } else if (spec && spec.kind === "youtube") {
      const entry = { kind: "youtube", videoId: spec.videoId, ready: false, player: null, loop: true };
      this.custom[slot] = entry;
      this.ensureYtApi().then(() => {
        const div = document.createElement("div");
        document.getElementById("ytHost").appendChild(div);
        entry.player = new window.YT.Player(div, {
          width: 200, height: 120, videoId: spec.videoId,
          playerVars: { autoplay: 0, controls: 0, loop: 1, playlist: spec.videoId, playsinline: 1 },
          events: {
            onReady: () => {
              entry.ready = true;
              this.muted ? entry.player.mute() : entry.player.unMute();
              entry.player.setVolume(70);
              if (this.desired === slot) this.route();
            },
            onError: () => {
              this.failed[slot] = true;
              if (this.unlocked && this.desired === slot) this.route();
            }
          }
        });
      }).catch(() => {
        this.failed[slot] = true;
        if (this.unlocked && this.desired === slot) this.route();
      });
    }
    if (this.unlocked) this.route();
  }

  ensureYtApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (this.ytApi) return this.ytApi;
    this.ytApi = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev && prev(); resolve(); };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.onerror = () => reject(new Error("YouTube API unavailable"));
      document.head.appendChild(s);
      setTimeout(() => {
        window.YT && window.YT.Player ? resolve() : reject(new Error("YouTube API timeout"));
      }, 12000);
    });
    return this.ytApi;
  }

  stopAll() {
    clearTimeout(this.watchTimer);
    clearInterval(this.bgmTimer); this.bgmTimer = null;
    clearInterval(this.spinTimer); this.spinTimer = null;
    clearInterval(this.winTimer); this.winTimer = null;
    for (const n of this.spinNodes) { try { n.stop(); } catch {} }
    this.spinNodes = [];
    for (const n of this.winNodes) { try { n.stop(); } catch {} }
    this.winNodes = [];
    if (this.ctx) {
      this.bgmBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      this.spinBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      this.winBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    }
    for (const slot of Object.keys(this.custom)) {
      const c = this.custom[slot];
      if (!c) continue;
      if (c.kind === "audio") c.el.pause();
      if (c.kind === "youtube" && c.ready) c.player.pauseVideo();
    }
  }

  route() {
    this.stopAll();
    const slot = this.desired;
    if (this.slots[slot] && this.slots[slot].kind === "off") return;
    const c = this.custom[slot];
    if (c && !this.failed[slot] && !this.blocked[slot]) {
      if (c.kind === "audio") {
        if (!this.unlocked) return;
        c.el.currentTime = 0;
        c.el.play().catch(() => {
          if (this.custom[slot] !== c || this.desired !== slot) return;
          this.blocked[slot] = true;
          this.route();
        });
        return;
      }
      if (c.kind === "youtube" && c.ready) {
        if (!this.unlocked) {
          // no gesture yet: unmuted autoplay would be refused, so run muted and unmute on the first gesture
          c.player.mute();
          this.autoMuted[slot] = true;
          try { c.player.seekTo(0, true); } catch {}
          c.player.playVideo();
          this.watchPlayback(slot);
          return;
        }
        if (!this.muted && this.autoMuted[slot]) { c.player.unMute(); c.player.setVolume(70); this.autoMuted[slot] = false; }
        try { c.player.seekTo(0, true); } catch {}
        c.player.playVideo();
        this.watchPlayback(slot);
        return;
      }
      // custom source still loading: keep the show audible with the synth meanwhile
    }
    if (!this.unlocked) return;
    if (slot === "bgm") this.startSynthBgm();
    else if (slot === "spin") this.startSynthSpin();
    else if (slot === "win") this.startSynthWin();
  }

  watchPlayback(slot) {
    const c = this.custom[slot];
    this.watchTimer = setTimeout(() => {
      if (this.desired !== slot || this.custom[slot] !== c || this.failed[slot]) return;
      if (!c || c.kind !== "youtube" || !c.ready) return;
      const st = c.player.getPlayerState();
      if (st === 1 || st === 3) return;
      this.blocked[slot] = true;
      this.autoMuted[slot] = false;
      this.route();
    }, 900);
  }

  userGesture() {
    this.unlock();
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    const slot = this.desired;
    if (this.blocked[slot]) { this.blocked[slot] = false; this.route(); return; }
    const c = this.custom[slot];
    if (!c || this.failed[slot]) return;
    if (c.kind === "youtube" && c.ready) {
      if (this.autoMuted[slot] && !this.muted) { c.player.unMute(); c.player.setVolume(70); this.autoMuted[slot] = false; }
      const st = c.player.getPlayerState();
      if (st !== 1 && st !== 3) { c.player.playVideo(); this.watchPlayback(slot); }
    } else if (c.kind === "audio" && c.el.paused) {
      c.el.play().catch(() => {});
    }
  }

  playBgm() { this.desired = "bgm"; this.route(); }

  startSpin(duration) {
    this.spinDuration = duration;
    this.desired = "spin";
    this.route();
  }

  endSpin() {
    this.desired = "win";
    this.route();
  }

  /* ————— synth: calliope waltz BGM ————— */
  startSynthBgm() {
    const ctx = this.ctx;
    this.bgmBus.gain.setTargetAtTime(0.9, ctx.currentTime, 0.4);
    this.bgmNext = ctx.currentTime + 0.1;
    this.bgmBeat = 0;
    this.bgmTimer = setInterval(() => {
      while (this.bgmNext < ctx.currentTime + 0.4) {
        this.scheduleBgmBeat(this.bgmBeat % LOOP_BEATS, this.bgmNext);
        this.bgmBeat++;
        this.bgmNext += BEAT;
      }
    }, 100);
  }

  scheduleBgmBeat(beat, when) {
    const bar = Math.floor(beat / 3);
    const inBar = beat % 3;
    const root = BASS_ROOTS[bar];
    if (inBar === 0) this.tone(root, when, BEAT * 0.85, "triangle", 0.14, this.bgmBus);
    else {
      this.tone(root + 7, when, BEAT * 0.4, "triangle", 0.055, this.bgmBus);
      this.tone(root + 12, when, BEAT * 0.4, "triangle", 0.05, this.bgmBus);
      this.tone(root + 16, when, BEAT * 0.4, "triangle", 0.04, this.bgmBus);
    }
    const notes = this.melodyAt.get(beat);
    if (notes) for (const [m, d] of notes) this.calliope(m, when, d * BEAT);
  }

  calliope(midi, when, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.11, when + 0.02);
    g.gain.setValueAtTime(0.11, when + Math.max(0.03, dur - 0.05));
    g.gain.linearRampToValueAtTime(0, when + dur);
    g.connect(this.bgmBus);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.5;
    const lfoG = ctx.createGain(); lfoG.gain.value = 9;
    lfo.connect(lfoG);
    for (const [type, vol] of [["square", 0.35], ["triangle", 0.8]]) {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = midiHz(midi);
      lfoG.connect(o.detune);
      const og = ctx.createGain(); og.gain.value = vol;
      o.connect(og); og.connect(g);
      o.start(when); o.stop(when + dur + 0.02);
    }
    lfo.start(when); lfo.stop(when + dur + 0.02);
  }

  tone(midi, when, dur, type, vol, bus) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = midiHz(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    o.connect(g); g.connect(bus);
    o.start(when); o.stop(when + dur + 0.02);
  }

  /* ————— synth: rising spin tension ————— */
  startSynthSpin() {
    const ctx = this.ctx;
    const dur = this.spinDuration || 6;
    this.spinBus.gain.setTargetAtTime(0.9, ctx.currentTime, 0.1);
    // riser noise sweep
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(250, ctx.currentTime);
    bp.frequency.exponentialRampToValueAtTime(3800, ctx.currentTime + dur);
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.001, ctx.currentTime);
    rg.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + dur);
    src.connect(bp); bp.connect(rg); rg.connect(this.spinBus);
    src.start(); this.spinNodes.push(src);

    let next = ctx.currentTime + 0.05;
    let step = 0;
    const start = ctx.currentTime;
    this.spinTimer = setInterval(() => {
      while (next < ctx.currentTime + 0.3) {
        const prog = Math.min((next - start) / dur, 1);
        const beatDur = 0.24 - 0.13 * prog;
        const root = 60 + Math.floor(step / 4);
        const arp = [0, 4, 7, 12][step % 4];
        this.tone(root + arp, next, beatDur * 0.9, "sawtooth", 0.05, this.spinBus);
        if (step % 2 === 0) this.kick(next);
        else this.snare(next, 0.05 + 0.05 * prog);
        step++;
        next += beatDur;
      }
    }, 80);
  }

  kick(when, bus = this.spinBus) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, when);
    o.frequency.exponentialRampToValueAtTime(45, when + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.14);
    o.connect(g); g.connect(bus);
    o.start(when); o.stop(when + 0.16);
  }

  snare(when, vol, bus = this.spinBus) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.09);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(when); s.stop(when + 0.1);
  }

  /* ————— synth: winner march, loops until confirmed ————— */
  startSynthWin() {
    const ctx = this.ctx;
    this.winBus.gain.setTargetAtTime(0.9, ctx.currentTime, 0.15);
    this.winNext = ctx.currentTime + 0.05;
    this.winStep = 0;
    this.winTimer = setInterval(() => {
      while (this.winNext < ctx.currentTime + 0.4) {
        this.scheduleWinBeat(this.winStep, this.winNext);
        this.winStep++;
        this.winNext += WIN_BEAT;
      }
    }, 100);
  }

  scheduleWinBeat(step, when) {
    const s = step % WIN_LOOP;
    const root = WIN_BASS[Math.floor(s / 4)];
    if (s % 2 === 0) this.tone(root, when, WIN_BEAT * 0.8, "triangle", 0.13, this.winBus);
    else this.tone(root + 7, when, WIN_BEAT * 0.35, "triangle", 0.05, this.winBus);
    if (s % 4 === 0) this.kick(when, this.winBus);
    if (s % 4 === 2) this.snare(when, 0.045, this.winBus);
    const notes = this.winMelodyAt.get(s);
    if (notes) for (const [m, d] of notes) this.brass(m, when, d * WIN_BEAT, 0.09, true, this.winBus);
    if (step % 32 === 0) this.cheer(when);
  }

  cheer(when) {
    const ctx = this.ctx;
    const c = ctx.createBufferSource(); c.buffer = this.noiseBuf; c.loop = true;
    const cf = ctx.createBiquadFilter(); cf.type = "bandpass"; cf.frequency.value = 1100; cf.Q.value = 0.6;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.001, when);
    cg.gain.exponentialRampToValueAtTime(0.07, when + 0.5);
    cg.gain.exponentialRampToValueAtTime(0.001, when + 1.9);
    c.connect(cf); cf.connect(cg); cg.connect(this.winBus);
    c.start(when); c.stop(when + 2);
    this.winNodes.push(c);
  }

  tick() {
    if (!this.unlocked || this.muted) return;
    const ctx = this.ctx;
    const when = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = 1500 + Math.random() * 300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.035);
    o.connect(g); g.connect(this.sfxBus);
    o.start(when); o.stop(when + 0.05);
  }

  brass(midi, when, dur, vol, vibrato = false, bus = this.sfxBus) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.03);
    g.gain.setValueAtTime(vol, when + dur - 0.08);
    g.gain.linearRampToValueAtTime(0, when + dur);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2600;
    g.connect(lp); lp.connect(bus);
    for (const type of ["sawtooth", "square"]) {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = midiHz(midi);
      const og = ctx.createGain(); og.gain.value = type === "sawtooth" ? 0.7 : 0.3;
      o.connect(og); og.connect(g);
      if (vibrato) {
        const l = ctx.createOscillator(); l.frequency.value = 6;
        const lg = ctx.createGain(); lg.gain.value = 14;
        l.connect(lg); lg.connect(o.detune);
        l.start(when); l.stop(when + dur);
      }
      o.start(when); o.stop(when + dur + 0.02);
    }
  }
}