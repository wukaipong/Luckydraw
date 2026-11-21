const COLORS = ["#e8404d", "#f6b93b", "#fdf0d5", "#17606f", "#f7f3c1", "#b3273a", "#3d9be9"];

export class Fx {
  constructor(dustCanvas, confettiCanvas) {
    this.dc = dustCanvas; this.dctx = dustCanvas.getContext("2d");
    this.cc = confettiCanvas; this.cctx = confettiCanvas.getContext("2d");
    this.dust = [];
    this.confetti = [];
    this.tv = document.body.classList.contains("tv");
    this.maxConfetti = this.tv ? 240 : 900;
    this.dustDirty = false;
    this.confDirty = false;
    this.resize();
    this.fillDust();
  }

  setTv(on) {
    this.tv = on;
    this.maxConfetti = on ? 240 : 900;
    this.fillDust();
    this.resize();
  }

  fillDust() {
    this.dust = [];
    if (this.tv) return;
    const n = Math.min(70, Math.floor(window.innerWidth / 18));
    for (let i = 0; i < n; i++) this.dust.push(this.newDust(true));
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.tv ? 1 : 2);
    for (const [c, ctx] of [[this.dc, this.dctx], [this.cc, this.cctx]]) {
      c.width = Math.round(window.innerWidth * dpr);
      c.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.dustDirty = true;
    this.confDirty = true;
  }

  newDust(anywhere) {
    return {
      x: Math.random() * this.w,
      y: anywhere ? Math.random() * this.h : this.h + 10,
      r: 0.8 + Math.random() * 2.2,
      vy: 6 + Math.random() * 16,
      vx: (Math.random() - 0.5) * 8,
      tw: Math.random() * Math.PI * 2,
      ts: 0.5 + Math.random() * 1.5
    };
  }

  burst(x, y, count) {
    if (this.tv) count = Math.round(count * 0.35);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 260 + Math.random() * 620;
      const shape = Math.random();
      this.confetti.push({
        x, y,
        vx: Math.cos(a) * sp * (0.4 + Math.random() * 0.6),
        vy: Math.sin(a) * sp - 320 - Math.random() * 260,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 14,
        w: 6 + Math.random() * 8,
        h: 4 + Math.random() * 10,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        shape: shape < 0.18 ? "coin" : shape < 0.45 ? "circle" : "rect",
        life: 2.4 + Math.random() * 1.6,
        age: 0
      });
    }
    if (this.confetti.length > this.maxConfetti) this.confetti.splice(0, this.confetti.length - this.maxConfetti);
  }

  cannons(count) {
    this.burst(this.w * 0.5, this.h * 0.42, count);
    this.burst(this.w * 0.08, this.h * 0.85, Math.floor(count * 0.4));
    this.burst(this.w * 0.92, this.h * 0.85, Math.floor(count * 0.4));
  }

  render(now, dt, lightsOn) {
    const d = this.dctx;
    if (this.dust.length && lightsOn) {
      d.clearRect(0, 0, this.w, this.h);
      this.dustDirty = true;
      for (let i = 0; i < this.dust.length; i++) {
        const p = this.dust[i];
        p.y -= p.vy * dt; p.x += p.vx * dt; p.tw += p.ts * dt;
        if (p.y < -12 || p.x < -12 || p.x > this.w + 12) this.dust[i] = this.newDust(false);
        const a = 0.18 + 0.3 * (0.5 + 0.5 * Math.sin(p.tw));
        d.beginPath(); d.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        d.fillStyle = `rgba(246,220,150,${a.toFixed(3)})`; d.fill();
      }
    } else if (this.dustDirty) {
      d.clearRect(0, 0, this.w, this.h);
      this.dustDirty = false;
    }

    const c = this.cctx;
    if (!this.confetti.length) {
      if (this.confDirty) { c.clearRect(0, 0, this.w, this.h); this.confDirty = false; }
      return;
    }
    c.clearRect(0, 0, this.w, this.h);
    this.confDirty = true;
    const g = 980, drag = 0.985;
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const p = this.confetti[i];
      p.age += dt;
      if (p.age > p.life || p.y > this.h + 30) { this.confetti.splice(i, 1); continue; }
      p.vy += g * dt;
      p.vx *= drag; p.vy *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const fade = Math.min(1, (p.life - p.age) / 0.5);
      c.save();
      c.translate(p.x, p.y); c.rotate(p.rot);
      c.globalAlpha = fade;
      c.fillStyle = p.color;
      if (p.shape === "rect") {
        c.scale(1, 0.4 + 0.6 * Math.abs(Math.sin(p.rot * 2)));
        c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      } else if (p.shape === "circle") {
        c.beginPath(); c.arc(0, 0, p.w * 0.4, 0, Math.PI * 2); c.fill();
      } else {
        c.scale(1, 0.35 + 0.65 * Math.abs(Math.sin(p.rot * 1.7)));
        c.beginPath(); c.arc(0, 0, p.w * 0.55, 0, Math.PI * 2);
        c.fillStyle = "#f6b93b"; c.fill();
        c.lineWidth = 1.5; c.strokeStyle = "#d99a1f"; c.stroke();
        c.beginPath(); c.arc(0, 0, p.w * 0.3, 0, Math.PI * 2);
        c.strokeStyle = "rgba(255,255,255,.7)"; c.stroke();
      }
      c.restore();
    }
  }
}

export function shake(el) {
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
  setTimeout(() => el.classList.remove("shake"), 550);
}