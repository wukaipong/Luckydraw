import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const KEY_FILE = process.env.LUCKYDRAW_KEY_FILE || path.join(__dirname, "api-keys.json");

const hash = key => crypto.createHash("sha256").update(key).digest("hex");

function load() {
  try { return JSON.parse(fs.readFileSync(KEY_FILE, "utf8")).keys || []; }
  catch { return []; }
}

function save(keys) {
  fs.writeFileSync(KEY_FILE, JSON.stringify({ keys }, null, 2));
}

export function generateKey(label = "") {
  const key = "ld_" + crypto.randomBytes(24).toString("base64url");
  const keys = load();
  const entry = {
    id: key.slice(0, 11),
    label: label || `key-${keys.length + 1}`,
    hash: hash(key),
    createdAt: new Date().toISOString()
  };
  keys.push(entry);
  save(keys);
  return { key, entry };
}

export function listKeys() {
  return load().map(({ hash: _hash, ...rest }) => rest);
}

export function revokeKeyById(id) {
  const keys = load();
  const next = keys.filter(k => k.id !== id);
  if (next.length === keys.length) return false;
  save(next);
  return true;
}

export function revokeKey(idOrLabel) {
  const keys = load();
  const next = keys.filter(k => k.id !== idOrLabel && k.label !== idOrLabel);
  if (next.length === keys.length) return false;
  save(next);
  return true;
}

export function verifyKey(key) {
  if (!key || typeof key !== "string") return false;
  const presented = Buffer.from(hash(key));
  return load().some(k => {
    const stored = Buffer.from(String(k.hash));
    return stored.length === presented.length && crypto.timingSafeEqual(stored, presented);
  });
}