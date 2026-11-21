import { t, getLang } from "./i18n.js";

// UI personalization only: the profile is decoded client-side and stored locally,
// so it is not a trust boundary — never gate sensitive data or actions on it.
const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
const USER_KEY = "circus-lucky-draw-user";

let slot = null;
let notify = () => {};
let current = null;
let gsiInitialized = false;

export function getUser() { return current; }

function decodeJwtPayload(token) {
  const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
  const json = decodeURIComponent(atob(padded).split("").map(c =>
    "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join(""));
  return JSON.parse(json);
}

function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Google Identity Services failed to load"));
    document.head.appendChild(s);
  });
}

async function ensureGsi() {
  await loadGsi();
  if (!gsiInitialized) {
    window.google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: onCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    gsiInitialized = true;
  }
}

function onCredential(response) {
  try {
    const p = decodeJwtPayload(response.credential);
    current = { sub: p.sub, name: p.name || p.email || "", email: p.email || "", picture: p.picture || "" };
    localStorage.setItem(USER_KEY, JSON.stringify(current));
    render();
    notify(t("signedIn", { name: current.name }));
  } catch {
    notify(t("loginFailed"));
  }
}

export function signOut() {
  current = null;
  localStorage.removeItem(USER_KEY);
  if (window.google?.accounts?.id) window.google.accounts.id.disableAutoSelect();
  render();
  notify(t("signedOut"));
}

function renderChip() {
  const chip = document.createElement("div");
  chip.className = "user-chip";
  chip.setAttribute("aria-label", t("account"));
  if (current.picture) {
    const img = document.createElement("img");
    img.className = "user-avatar";
    img.src = current.picture;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    chip.appendChild(img);
  } else {
    const av = document.createElement("span");
    av.className = "user-avatar user-initial";
    av.textContent = (current.name || "?").charAt(0).toUpperCase();
    chip.appendChild(av);
  }
  const name = document.createElement("span");
  name.className = "user-name";
  name.textContent = current.name;
  name.title = current.email || current.name;
  chip.appendChild(name);
  const out = document.createElement("button");
  out.type = "button";
  out.className = "user-out";
  out.textContent = t("signOut");
  out.addEventListener("click", signOut);
  chip.appendChild(out);
  slot.appendChild(chip);
}

function render() {
  if (!slot) return;
  slot.textContent = "";
  if (current) { slot.classList.remove("hidden"); renderChip(); return; }
  // No client_id configured → keep the login UI hidden so the app still works.
  if (!CLIENT_ID) { slot.classList.add("hidden"); return; }
  slot.classList.remove("hidden");
  ensureGsi().then(() => {
    if (current || !slot) return;
    slot.textContent = "";
    window.google.accounts.id.renderButton(slot, {
      theme: "filled_black", size: "medium", shape: "pill",
      text: "signin_with", locale: getLang() === "zh" ? "zh-Hant" : "en",
    });
  }).catch(() => slot.classList.add("hidden"));
}

export function refreshAuth() { render(); }

export function initAuth(el, { onNotify } = {}) {
  slot = el;
  notify = onNotify || (() => {});
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) current = JSON.parse(raw);
  } catch { current = null; }
  render();
}