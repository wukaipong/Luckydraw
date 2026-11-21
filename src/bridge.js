export class Bridge {
  constructor({ onCommand, onStatus }) {
    this.onCommand = onCommand;
    this.onStatus = onStatus;
    this.ws = null;
    this.retry = 1000;
    this.reqId = 0;
    this.pending = new Map();
    const params = new URLSearchParams(location.search);
    const devPort = location.port === "5173";
    this.url = params.get("bridge") || (devPort
      ? "ws://localhost:4173"
      : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`);
    this.connect();
  }

  connect() {
    try { this.ws = new WebSocket(this.url); }
    catch { this.scheduleRetry(); return; }
    this.ws.onopen = () => {
      this.retry = 1000;
      this.onStatus(true);
      this.send({ type: "hello", role: "app" });
    };
    this.ws.onmessage = async ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "response" && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        msg.ok ? resolve(msg.data) : reject(new Error(msg.error));
        return;
      }
      if (msg.type !== "command") return;
      try {
        const data = await this.onCommand(msg.name, msg.args || {});
        this.send({ type: "response", id: msg.id, ok: true, data: data ?? null });
      } catch (err) {
        this.send({ type: "response", id: msg.id, ok: false, error: String(err.message || err) });
      }
    };
    this.ws.onclose = () => { this.onStatus(false); this.scheduleRetry(); };
    this.ws.onerror = () => { try { this.ws.close(); } catch {} };
  }

  scheduleRetry() {
    setTimeout(() => this.connect(), this.retry);
    this.retry = Math.min(this.retry * 1.5, 6000);
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  request(name, args = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("MCP bridge is not connected"));
        return;
      }
      const id = ++this.reqId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for "${name}"`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ type: "request", id, name, args });
    });
  }

  event(name, data) { this.send({ type: "event", name, data }); }
}