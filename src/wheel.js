const TAU = Math.PI * 2;
const POINTER = -Math.PI / 2;

const C = {
  navy: "#12384a",
  navyEdge: "#0a2534",
  teal: "#17606f",
  red: "#e8404d",
  redDeep: "#c93341",
  maroon: "#7a1f2b",
  maroonDark: "#5e1620",
  cream: "#fdf0d5",
  cream2: "#f8ecd0",
  gold: "#f6b93b",
  pale: "#f7f3c1"
};

const mod = (a, n) => ((a % n) + n) % n;
const easeOutQuint = t => 1 - Math.pow(1 - t, 5);
const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

export class Wheel {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.items = [];
    this.spans = [];
    this.rotation = 0;
    this.spin = null;
    this.removal = null;
    this.highlight = -1;
    this.mode = "idle";
    this.bulbPhase = 0;
    this.lastTickIdx = -1;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = this.canvas.clientWidth || 600;
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    this.dpr = dpr;
    this.size = size;
  }

  setItems(items) {
    this.items = items.slice();
    const n = Math.max(items.length, 1);
    this.spans = items.map(() => TAU / n);
    this.highlight = -1;
  }

  get busy() { return !!(this.spin || this.removal); }

  finishSpin() {
    if (!this.spin) return;
    const s = this.spin;
    this.spin = null;
    this.rotation = mod(s.to, TAU);
    this.mode = "idle";
    this.highlight = s.index;
    s.onDone && s.onDone(s.index);
  }

  spinTo(index, duration, onTick, onDone) {
    const n = this.items.length;
    if (!n || this.busy) return false;
    const span = TAU / n;
    const center = index * span + span / 2;
    const jitter = (Math.random() - 0.5) * span * 0.6;
    const desired = mod(POINTER - center + jitter, TAU);
    const delta = mod(desired - mod(this.rotation, TAU), TAU);
    const turns = 4 + Math.round(duration * 0.8);
    this.spin = {
      from: this.rotation,
      to: this.rotation + turns * TAU + delta,
      start: performance.now(),
      ms: duration * 1000,
      onTick, onDone, index
    };
    this.mode = "spin";
    this.highlight = -1;
    this.lastTickIdx = -1;
    return true;
  }

  removeAnimated(index, done) {
    if (this.busy || index < 0 || index >= this.items.length) return false;
    const n = this.items.length;
    const rest = n - 1;
    const from = this.spans.slice();
    const to = this.items.map((_, i) => i === index ? 0 : (rest ? TAU / rest : TAU));
    this.removal = { index, from, to, start: performance.now(), ms: 650, done };
    this.highlight = -1;
    return true;
  }

  finishRemoval() {
    if (!this.removal) return;
    const r = this.removal;
    this.removal = null;
    this.items.splice(r.index, 1);
    const n = Math.max(this.items.length, 1);
    this.spans = this.items.map(() => TAU / n);
    r.done && r.done(r.index);
  }

  render(now, dt, opts) {
    const { ctx, dpr, size } = this;
    const R = size / 2;

    if (this.spin) {
      const s = this.spin;
      const t = Math.min((now - s.start) / s.ms, 1);
      this.rotation = s.from + (s.to - s.from) * easeOutQuint(t);
      const n = this.items.length;
      const idx = Math.floor(mod(POINTER - this.rotation, TAU) / (TAU / n));
      if (idx !== this.lastTickIdx) { this.lastTickIdx = idx; s.onTick && s.onTick(); }
      if (t >= 1) {
        this.rotation = mod(s.to, TAU);
        const done = s.onDone, index = s.index;
        this.spin = null;
        this.mode = "idle";
        this.highlight = index;
        done && done(index);
      }
    }
    if (this.removal) {
      const r = this.removal;
      const t = Math.min((now - r.start) / r.ms, 1);
      const e = easeInOut(t);
      this.spans = r.from.map((f, i) => f + (r.to[i] - f) * e);
      if (t >= 1) {
        const done = r.done, index = r.index;
        this.removal = null;
        this.items.splice(index, 1);
        const n = Math.max(this.items.length, 1);
        this.spans = this.items.map(() => TAU / n);
        done && done(index);
      }
    }

    const speed = this.mode === "spin" ? 14 : (opts.bulbSpeed ?? 1) * 5;
    this.bulbPhase += dt * speed;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(R, R);

    // outer navy body
    ctx.beginPath(); ctx.arc(0, 0, R * 0.995, 0, TAU);
    ctx.fillStyle = C.navy; ctx.fill();
    ctx.lineWidth = R * 0.012; ctx.strokeStyle = C.navyEdge; ctx.stroke();

    // cream zigzag band (12 teeth)
    ctx.beginPath();
    for (let k = 0; k < 24; k++) {
      const a = k * Math.PI / 12 - Math.PI / 2;
      const rr = k % 2 === 0 ? R * 0.965 : R * 0.862;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = C.cream2; ctx.fill();
    ctx.lineWidth = R * 0.008; ctx.strokeStyle = "rgba(122,31,43,.25)"; ctx.stroke();

    // teal ring
    ctx.beginPath(); ctx.arc(0, 0, R * 0.845, 0, TAU);
    ctx.lineWidth = R * 0.05; ctx.strokeStyle = C.teal; ctx.stroke();

    // red annulus
    ctx.beginPath(); ctx.arc(0, 0, R * 0.82, 0, TAU);
    ctx.fillStyle = C.red; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, R * 0.82, 0, TAU);
    ctx.lineWidth = R * 0.014; ctx.strokeStyle = C.redDeep; ctx.stroke();

    // rotating wedges
    const n = this.items.length;
    const wr = R * 0.70;
    ctx.save();
    ctx.rotate(this.rotation);
    if (n === 0) {
      for (let i = 0; i < 8; i++) {
        const a0 = i * TAU / 8, a1 = a0 + TAU / 8;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, wr, a0, a1); ctx.closePath();
        ctx.fillStyle = i % 2 ? C.cream : C.red;
        ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
      }
    } else {
      let a = 0;
      const showLabels = n <= 80;
      for (let i = 0; i < n; i++) {
        const span = this.spans[i];
        if (span <= 0.0001) { a += span; continue; }
        const a0 = a, a1 = a + span;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, wr, a0, a1); ctx.closePath();
        const isRed = i % 2 === 0;
        ctx.fillStyle = isRed ? C.red : C.cream;
        ctx.fill();
        ctx.lineWidth = Math.max(1, R * 0.004);
        ctx.strokeStyle = isRed ? C.redDeep : "rgba(217,154,31,.5)";
        ctx.stroke();

        if (this.highlight === i && !this.spin) {
          const pulse = 0.22 + 0.16 * Math.sin(now / 160);
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, wr, a0, a1); ctx.closePath();
          ctx.fillStyle = `rgba(246,185,59,${pulse})`; ctx.fill();
          ctx.lineWidth = R * 0.012; ctx.strokeStyle = C.gold; ctx.stroke();
        }

        if (showLabels && span > 0.045) {
          const mid = a0 + span / 2;
          const maxLen = wr * 0.60;
          let fs = Math.min(R * 0.055, span * wr * 0.42);
          fs = Math.max(fs, R * 0.02);
          ctx.font = `800 ${fs}px Nunito, "Microsoft JhengHei", sans-serif`;
          let label = String(this.items[i]);
          while (label.length > 2 && ctx.measureText(label).width > maxLen) label = label.slice(0, -2) + "…";
          ctx.save();
          ctx.rotate(mid);
          ctx.textBaseline = "middle";
          ctx.fillStyle = isRed ? C.cream : C.maroon;
          if (Math.cos(mid) < 0) { ctx.rotate(Math.PI); ctx.textAlign = "left"; ctx.fillText(label, -wr * 0.94, 0); }
          else { ctx.textAlign = "right"; ctx.fillText(label, wr * 0.94, 0); }
          ctx.restore();
        }
        a = a1;
      }
    }
    // depth shading over the disc
    const g = ctx.createRadialGradient(0, 0, wr * 0.2, 0, 0, wr);
    g.addColorStop(0, "rgba(255,255,255,.10)");
    g.addColorStop(0.75, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,.18)");
    ctx.beginPath(); ctx.arc(0, 0, wr, 0, TAU); ctx.fillStyle = g; ctx.fill();
    ctx.restore();

    // disc rim
    ctx.beginPath(); ctx.arc(0, 0, wr, 0, TAU);
    ctx.lineWidth = R * 0.012; ctx.strokeStyle = C.redDeep; ctx.stroke();

    // bulb rings
    const lightsOn = opts.lightShow !== false;
    this.drawBulbs(ctx, R, 24, R * 0.885, R * 0.034, 0, lightsOn, now);
    this.drawBulbs(ctx, R, 24, R * 0.755, R * 0.023, Math.PI / 24, lightsOn, now);

    // needle (static, pointing up)
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.4)"; ctx.shadowBlur = R * 0.02; ctx.shadowOffsetY = R * 0.008;
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.56);
    ctx.lineTo(R * 0.035, -R * 0.16);
    ctx.lineTo(-R * 0.035, -R * 0.16);
    ctx.closePath();
    ctx.fillStyle = C.maroon; ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.56);
    ctx.lineTo(R * 0.035, -R * 0.16);
    ctx.lineTo(0, -R * 0.16);
    ctx.closePath();
    ctx.fillStyle = C.maroonDark; ctx.fill();
    ctx.restore();

    // hub rings (GO button sits on top)
    ctx.beginPath(); ctx.arc(0, 0, R * 0.245, 0, TAU); ctx.fillStyle = C.teal; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, R * 0.212, 0, TAU); ctx.fillStyle = C.maroon; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, R * 0.185, 0, TAU); ctx.fillStyle = C.cream; ctx.fill();

    ctx.restore();
  }

  drawBulbs(ctx, R, count, radius, br, offset, lightsOn, now) {
    const phase = Math.floor(this.bulbPhase);
    const spinning = this.mode === "spin";
    const winning = this.highlight >= 0 && !this.spin;
    for (let i = 0; i < count; i++) {
      const a = i * TAU / count + offset - Math.PI / 2;
      const x = Math.cos(a) * radius, y = Math.sin(a) * radius;
      const gold = i % 2 === 0;
      let lit;
      if (!lightsOn) lit = 0.55;
      else if (spinning) lit = (i + phase) % 2 === 0 ? 1 : 0.25;
      else if (winning) lit = 0.55 + 0.45 * Math.sin(now / 110 + i);
      else lit = (i + phase) % 3 === 0 ? 1 : 0.4;
      ctx.save();
      if (lit > 0.75 && lightsOn) { ctx.shadowColor = gold ? C.gold : C.pale; ctx.shadowBlur = br * 2.4; }
      ctx.beginPath(); ctx.arc(x, y, br, 0, TAU);
      ctx.fillStyle = gold ? C.gold : C.pale;
      ctx.globalAlpha = lightsOn ? 0.68 + 0.32 * Math.max(0, lit) : 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowColor = "transparent";
      ctx.beginPath(); ctx.arc(x - br * 0.3, y - br * 0.3, br * 0.3, 0, TAU);
      ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.fill();
      ctx.restore();
    }
  }
}