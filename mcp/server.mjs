import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MUSIC_DIR = path.join(__dirname, "..", "music");
fs.mkdirSync(MUSIC_DIR, { recursive: true });
const PORT = Number(process.env.LUCKYDRAW_PORT || 8787);

const MIME = {
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
  ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac", ".webm": "audio/webm"
};

const httpServer = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, appConnected: !!appSocket }));
    return;
  }
  if (url.pathname.startsWith("/music/")) {
    const name = path.basename(decodeURIComponent(url.pathname.slice(7)));
    const file = path.join(MUSIC_DIR, name);
    if (!file.startsWith(MUSIC_DIR) || !fs.existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": fs.statSync(file).size,
      "Accept-Ranges": "bytes"
    });
    fs.createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(404); res.end("not found");
});

let appSocket = null;
const pending = new Map();
let reqId = 0;
let lastEvents = [];

const wss = new WebSocketServer({ server: httpServer });
wss.on("connection", ws => {
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "hello" && msg.role === "app") {
      appSocket = ws;
      console.error(`[luckydraw] PWA connected`);
      return;
    }
    if (msg.type === "response" && pending.has(msg.id)) {
      const { resolve, reject, timer } = pending.get(msg.id);
      clearTimeout(timer);
      pending.delete(msg.id);
      msg.ok ? resolve(msg.data) : reject(new Error(msg.error));
    } else if (msg.type === "event") {
      lastEvents.push({ ...msg, at: Date.now() });
      if (lastEvents.length > 50) lastEvents.shift();
    }
  });
  ws.on("close", () => {
    if (appSocket === ws) appSocket = null;
    console.error(`[luckydraw] PWA disconnected`);
  });
});

function callApp(name, args = {}, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    if (!appSocket || appSocket.readyState !== 1) {
      reject(new Error("PWA is not connected. Open the Lucky Draw app in a browser first (npm run dev / npm run preview)."));
      return;
    }
    const id = ++reqId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for the app to answer "${name}"`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    appSocket.send(JSON.stringify({ type: "command", id, name, args }));
  });
}

const server = new McpServer({ name: "circus-lucky-draw", version: "1.0.0" });

function tool(name, description, schema, fn) {
  server.registerTool(name, { description, inputSchema: schema }, async args => {
    try {
      const data = await fn(args || {});
      return { content: [{ type: "text", text: JSON.stringify(data ?? { ok: true }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: String(err.message || err) }], isError: true };
    }
  });
}

tool("get_status", "Get app connection state, current phase, participant/history counts, pending winner, music slots and settings.", {},
  () => callApp("get_status"));

tool("get_participants", "List every name/number currently on the wheel.", {},
  () => callApp("get_participants"));

tool("set_participants", "Replace the whole wheel with this list of names or numbers (duplicates are skipped).",
  { names: z.array(z.string()).describe("Names or numbers, one entry per item") },
  args => callApp("set_participants", args));

tool("add_participants", "Append names or numbers to the wheel without removing existing ones.",
  { names: z.array(z.string()) },
  args => callApp("add_participants", args));

tool("remove_participants", "Remove specific names/numbers from the wheel.",
  { names: z.array(z.string()) },
  args => callApp("remove_participants", args));

tool("set_number_range", "Add a consecutive number range to the wheel (max 300 numbers).",
  { min: z.number().int(), max: z.number().int() },
  args => callApp("set_number_range", args));

tool("start_draw", "Spin the wheel and wait for the result. Returns the pending winner; the winner is NOT removed until confirm_winner is called.", {},
  () => callApp("start_draw", {}, 90000));

tool("redraw", "Spin again without removing the pending winner. Waits for the new result.", {},
  () => callApp("redraw", {}, 90000));

tool("get_result", "Get the current pending winner (if any) and the last confirmed winner.", {},
  () => callApp("get_result"));

tool("confirm_winner", "Confirm the pending winner: they disappear from the wheel and are recorded in history.", {},
  () => callApp("confirm_winner"));

tool("get_history", "List all confirmed winners with timestamps (newest first).", {},
  () => callApp("get_history"));

tool("reset_all", "Return every confirmed winner to the wheel and clear the history.", {},
  () => callApp("reset_all"));

tool("set_music",
  "Replace a music slot. slot: bgm (idle loop), spin (during draw), win (victory). source: 'synth' for the built-in circus synth, an http(s) audio URL, a local audio file path (copied into music/ and served), or a YouTube link.",
  {
    slot: z.enum(["bgm", "spin", "win"]),
    source: z.string().describe("'synth', audio URL, local file path, or YouTube link")
  },
  async ({ slot, source }) => {
    let finalSource = source;
    if (source !== "synth" && source !== "default" && !/^https?:\/\//.test(source) && !/youtube\.com|youtu\.be/.test(source)) {
      const abs = path.resolve(source);
      if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);
      const dest = path.join(MUSIC_DIR, path.basename(abs));
      if (abs !== dest) fs.copyFileSync(abs, dest);
      finalSource = `http://localhost:${PORT}/music/${encodeURIComponent(path.basename(abs))}`;
    }
    return callApp("set_music", { slot, source: finalSource });
  });

tool("set_settings", "Update show settings: duration (3-12s), confetti (0-100), bulbSpeed (0-3), lightShow, ticks, sound, lang ('en'|'zh').",
  {
    duration: z.number().optional(),
    confetti: z.number().optional(),
    bulbSpeed: z.number().optional(),
    lightShow: z.boolean().optional(),
    ticks: z.boolean().optional(),
    sound: z.boolean().optional(),
    lang: z.enum(["en", "zh"]).optional()
  },
  args => callApp("set_settings", args));

httpServer.listen(PORT, () => {
  console.error(`[luckydraw] bridge listening on ws://localhost:${PORT} (music at /music/)`);
});
httpServer.on("error", err => {
  console.error(`[luckydraw] bridge server error: ${err.message}`);
  process.exit(1);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[luckydraw] MCP server ready on stdio");