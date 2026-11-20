export class Bridge {
  constructor({ onCommand, onStatus }) {
    this.onCommand = onCommand;
    this.onStatus = onStatus;
    this.ws = null;
    this.retry = 1000;
    const params = new URLSearchParams(location.search);
    this.url = params.get("bridge") || "ws://localhost:8787";
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

  event(name, data) { this.send({ type: "event", name, data }); }
}