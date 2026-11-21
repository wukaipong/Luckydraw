import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { verifyKey, generateKey, listKeys, revokeKeyById } from "./keys.mjs";

if (!verifyKey(process.env.LUCKYDRAW_API_KEY)) {
  console.error("[luckydraw] MCP requires a valid API key.");
  console.error("[luckydraw] Generate one:  npm run mcp:keygen");
  console.error("[luckydraw] Then launch with env  LUCKYDRAW_API_KEY=<key>  (stdio),");
  console.error("[luckydraw] or send  Authorization: Bearer <key>  to the HTTP /mcp endpoint.");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MUSIC_DIR = path.join(__dirname, "..", "music");
const DIST_DIR = path.join(__dirname, "..", "dist");
fs.mkdirSync(MUSIC_DIR, { recursive: true });
const PORT = Number(process.env.LUCKYDRAW_PORT || 4173);
const ADMIN_PIN = (process.env.LUCKYDRAW_ADMIN_PIN || "").trim();
console.error(ADMIN_PIN
  ? "[luckydraw] Remote API-key management enabled (admin PIN required)."
  : "[luckydraw] Remote API-key management disabled — set LUCKYDRAW_ADMIN_PIN to enable it.");

const PIN_MAX_FAILS = 5;
const PIN_LOCKOUT_MS = 10 * 60 * 1000;
const pinFails = new Map();

function pinMatches(candidate) {
  if (!ADMIN_PIN || typeof candidate !== "string" || !candidate) return false;
  const digest = value => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(candidate), digest(ADMIN_PIN));
}

function pinRetryAfter(ip) {
  const entry = pinFails.get(ip);
  if (!entry) return 0;
  const now = Date.now();
  if (entry.until > now) return entry.until - now;
  if (entry.resetAt <= now) pinFails.delete(ip);
  return 0;
}

function pinNoteFailure(ip) {
  const now = Date.now();
  let entry = pinFails.get(ip);
  if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + PIN_LOCKOUT_MS, until: 0 };
  entry.count += 1;
  if (entry.count >= PIN_MAX_FAILS) { entry.until = now + PIN_LOCKOUT_MS; entry.count = 0; }
  pinFails.set(ip, entry);
  if (pinFails.size > 500) for (const [key, value] of pinFails) if (value.resetAt <= now) pinFails.delete(key);
}

function clientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "";
}

const MIME = {
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
  ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac", ".webm": "audio/webm",
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ico": "image/x-icon"
};

function serveFile(res, file, cache) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Length": fs.statSync(file).size,
    "Cache-Control": cache
  });
  fs.createReadStream(file).pipe(res);
}

const mcpSessions = new Map();

function mcpAuthorized(req) {
  const auth = req.headers.authorization || "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : req.headers["x-api-key"];
  return verifyKey(key);
}

function jsonReply(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function handleMcp(req, res) {
  if (!mcpAuthorized(req)) {
    jsonReply(res, 401, { error: "Invalid or missing API key. Generate one with: npm run mcp:keygen" });
    return;
  }
  const sessionId = req.headers["mcp-session-id"];
  const session = sessionId ? mcpSessions.get(sessionId) : undefined;
  if (req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body;
    try { body = JSON.parse(raw); }
    catch { jsonReply(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }); return; }
    if (session) { await session.handleRequest(req, res, body); return; }
    if (!sessionId && isInitializeRequest(body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: sid => mcpSessions.set(sid, transport)
      });
      transport.onclose = () => { if (transport.sessionId) mcpSessions.delete(transport.sessionId); };
      await createMcpServer().connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }
    jsonReply(res, 400, { jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: missing or unknown session. Send an initialize request first." }, id: null });
    return;
  }
  if (req.method === "GET" || req.method === "DELETE") {
    if (!session) { jsonReply(res, 400, { error: "Missing or unknown MCP session" }); return; }
    await session.handleRequest(req, res);
    return;
  }
  res.writeHead(405); res.end();
}

const httpServer = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key, Mcp-Session-Id"
    });
    res.end();
    return;
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/mcp") { await handleMcp(req, res); return; }
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
    if (req.method === "HEAD") { res.end(); return; }
    fs.createReadStream(file).pipe(res);
    return;
  }
  if (url.pathname === "/download/luckydraw-tv.apk") {
    const file = path.join(__dirname, "..", "apk", "luckydraw-tv.apk");
    if (!fs.existsSync(file)) { res.writeHead(404); res.end("APK not built yet"); return; }
    res.writeHead(200, {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": fs.statSync(file).size,
      "Content-Disposition": "attachment; filename=luckydraw-tv.apk",
      "Cache-Control": "no-cache"
    });
    fs.createReadStream(file).pipe(res);
    return;
  }
  const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  const file = path.join(DIST_DIR, rel);
  if (file.startsWith(DIST_DIR) && rel && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const immutable = rel.startsWith("assets/");
    const noCache = rel === "sw.js" || rel === "index.html" || rel === "manifest.webmanifest";
    serveFile(res, file, immutable ? "public, max-age=31536000, immutable" : noCache ? "no-cache" : "public, max-age=3600");
    return;
  }
  const index = path.join(DIST_DIR, "index.html");
  if (fs.existsSync(index)) { serveFile(res, index, "no-cache"); return; }
  res.writeHead(404); res.end("not found — run npm run build first");
});

let appSocket = null;
const pending = new Map();
let reqId = 0;
let lastEvents = [];

const wss = new WebSocketServer({ server: httpServer });
wss.on("connection", (ws, req) => {
  // Tunnel traffic (cloudflared) arrives from loopback but carries proxy headers.
  const addr = req.socket.remoteAddress || "";
  const isLocal = /^(::1|::ffff:127\.|127\.)/.test(addr) && !req.headers["cf-connecting-ip"] && !req.headers["x-forwarded-for"];
  const ip = clientIp(req);
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "hello" && msg.role === "app") {
      appSocket = ws;
      console.error(`[luckydraw] PWA connected`);
      return;
    }
    if (msg.type === "request" && ["generate_api_key", "list_api_keys", "revoke_api_key"].includes(msg.name)) {
      const reply = ok => ws.send(JSON.stringify({ type: "response", id: msg.id, ...ok }));
      if (!isLocal) {
        if (!ADMIN_PIN) {
          reply({ ok: false, code: "PIN_DISABLED", error: "Remote API-key management is disabled — set LUCKYDRAW_ADMIN_PIN on the server" });
          return;
        }
        const retryAfter = pinRetryAfter(ip);
        if (retryAfter > 0) {
          reply({ ok: false, code: "PIN_LOCKED", error: `Too many wrong PIN attempts — try again in ${Math.max(1, Math.ceil(retryAfter / 60000))} min` });
          return;
        }
        const pin = msg.args?.adminPin;
        if (!pin) { reply({ ok: false, code: "PIN_REQUIRED", error: "Admin PIN required" }); return; }
        if (!pinMatches(pin)) {
          pinNoteFailure(ip);
          reply({ ok: false, code: "PIN_BAD", error: "Wrong admin PIN" });
          return;
        }
        pinFails.delete(ip);
      }
      try {
        if (msg.name === "generate_api_key") {
          const label = typeof msg.args?.label === "string" ? msg.args.label.trim() : "";
          if (!label) throw new Error("A name is required for the new API key");
          const { key, entry } = generateKey(label);
          console.error(`[luckydraw] API key generated via UI (${entry.id} "${entry.label}")`);
          reply({ ok: true, data: { key, id: entry.id, label: entry.label } });
        } else if (msg.name === "list_api_keys") {
          reply({ ok: true, data: { keys: listKeys() } });
        } else {
          const id = String(msg.args?.id || "");
          if (!revokeKeyById(id)) throw new Error(`No API key with id "${id}"`);
          console.error(`[luckydraw] API key revoked via UI (${id})`);
          reply({ ok: true, data: { revoked: id } });
        }
      } catch (err) {
        reply({ ok: false, error: String(err.message || err) });
      }
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

const TOOLS = [];

function tool(name, description, schema, fn) {
  TOOLS.push([name, description, schema, fn]);
}

function createMcpServer() {
  const server = new McpServer({ name: "circus-lucky-draw", version: "1.0.0" });
  for (const [name, description, schema, fn] of TOOLS) {
    server.registerTool(name, { description, inputSchema: schema }, async args => {
      try {
        const data = await fn(args || {});
        return { content: [{ type: "text", text: JSON.stringify(data ?? { ok: true }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: String(err.message || err) }], isError: true };
      }
    });
  }
  return server;
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
  "Replace a music slot. slot: bgm (idle loop), spin (during draw), win (victory). source: 'synth' for the built-in circus synth, 'off' to silence that slot, a saved YouTube track name (or track:<id>), an http(s) audio URL, a local audio file path (copied into music/ and served), or a YouTube link (auto-saved into the named library).",
  {
    slot: z.enum(["bgm", "spin", "win"]),
    source: z.string().describe("'synth', 'off', saved track name, audio URL, local file path, or YouTube link")
  },
  async ({ slot, source }) => {
    let finalSource = source;
    const reserved = ["synth", "default", "off", "none", "silent"].includes(source);
    const looksLikePath = /[\\/]/.test(source) || /^[A-Za-z]:/.test(source) || fs.existsSync(path.resolve(source));
    if (!reserved && !/^https?:\/\//.test(source) && !/youtube\.com|youtu\.be/.test(source) && looksLikePath) {
      const abs = path.resolve(source);
      if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);
      const dest = path.join(MUSIC_DIR, path.basename(abs));
      if (abs !== dest) fs.copyFileSync(abs, dest);
      finalSource = `/music/${encodeURIComponent(path.basename(abs))}`;
    }
    return callApp("set_music", { slot, source: finalSource });
  });

tool("list_tracks", "List the saved track library (id, name, kind: local/url/youtube, plus videoId or url). Every music slot can pick any of these tracks by name.", {},
  () => callApp("list_tracks"));

tool("add_track", "Save a track into the named library so any music slot can select it: a file name inside the server's music/ folder, an http(s) audio URL, or a YouTube link. name is optional; empty names auto-fill from the file name or video title.",
  { url: z.string(), name: z.string().optional() },
  args => callApp("add_track", args));

tool("rename_track", "Rename a saved YouTube track (the name shown in every slot dropdown).",
  { id: z.string(), name: z.string() },
  args => callApp("rename_track", args));

tool("remove_track", "Delete a saved track (local, URL or YouTube). Slots using it fall back to the circus synth.",
  { id: z.string() },
  args => callApp("remove_track", args));

tool("set_settings", "Update show settings: duration (3-12s), confetti (0-100), bulbSpeed (0-3), lightShow, ticks, sound, lang ('en'|'zh'), tvMode ('auto'|'on'|'off' for Android TV remote layout).",
  {
    duration: z.number().optional(),
    confetti: z.number().optional(),
    bulbSpeed: z.number().optional(),
    lightShow: z.boolean().optional(),
    ticks: z.boolean().optional(),
    sound: z.boolean().optional(),
    lang: z.enum(["en", "zh"]).optional(),
    tvMode: z.enum(["auto", "on", "off"]).optional()
  },
  args => callApp("set_settings", args));

httpServer.listen(PORT, () => {
  console.error(`[luckydraw] bridge listening on ws://localhost:${PORT} (music at /music/, MCP at /mcp — API key required)`);
});
httpServer.on("error", err => {
  console.error(`[luckydraw] bridge server error: ${err.message}`);
  process.exit(1);
});

const transport = new StdioServerTransport();
await createMcpServer().connect(transport);
console.error("[luckydraw] MCP server ready on stdio (API key verified)");