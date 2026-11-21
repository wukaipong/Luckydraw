import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TRACKS_FILE = process.env.LUCKYDRAW_TRACKS_FILE || path.join(__dirname, "tracks.json");

function load() {
  try { return JSON.parse(fs.readFileSync(TRACKS_FILE, "utf8")).tracks || []; }
  catch { return []; }
}

function save(tracks) {
  fs.writeFileSync(TRACKS_FILE, JSON.stringify({ tracks }, null, 2));
}

function sanitize(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id.slice(0, 40) : "";
  const url = typeof raw.url === "string" ? raw.url.slice(0, 2000) : "";
  const videoId = typeof raw.videoId === "string" ? raw.videoId.slice(0, 20) : "";
  if (!id || (!url && !videoId)) return null;
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 80) : "";
  const kind = videoId ? "youtube" : /^https?:\/\//i.test(url) ? "url" : "local";
  return videoId ? { id, name, kind, videoId } : { id, name, kind, url };
}

export function getTracks() {
  return load();
}

export function addTrack(raw) {
  const tr = sanitize(raw);
  if (!tr) throw new Error("Invalid track");
  const tracks = load();
  const dup = tracks.find(x => x.id === tr.id || (tr.url && x.url === tr.url) || (tr.videoId && x.videoId === tr.videoId));
  if (!dup) { tracks.push(tr); save(tracks); }
  return tracks;
}

export function removeTrack(id) {
  const tracks = load();
  const next = tracks.filter(tr => tr.id !== id);
  if (next.length !== tracks.length) save(next);
  return next;
}

export function renameTrack(id, name) {
  const tracks = load();
  const tr = tracks.find(x => x.id === id);
  if (!tr) throw new Error(`No track with id "${id}"`);
  tr.name = String(name ?? "").trim().slice(0, 80);
  save(tracks);
  return tracks;
}