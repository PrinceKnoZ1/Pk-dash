import { b64ToBytes, decryptEnvelope, importAesKey } from "./crypto.js";

function parseHash() {
  const raw = (location.hash || "").replace(/^#/, "");
  return new URLSearchParams(raw);
}

export function hashParams() {
  return parseHash();
}

export function setHashParams(mutator) {
  const h = parseHash();
  mutator(h);
  const next = h.toString();
  if (next !== rawHash()) history.replaceState(null, "", "#" + next);
}

function rawHash() {
  return (location.hash || "").replace(/^#/, "");
}

export function createStore() {
  const h = parseHash();
  const p = h.get("p");
  const k = h.get("k");
  const api = (h.get("api") || "").trim();
  const t = h.get("t");
  const hasStatic = !!(p && k && /^[A-Za-z0-9_-]{20,}$/.test(p));
  const hasApi = !!(t || api);
  const mode = hasApi && !hasStatic ? "api" : hasStatic ? "static" : "locked";
  const writable = mode === "api";
  const apiBase = (api || (mode === "api" ? "" : "")).replace(/\/$/, "");

  const cache = new Map();
  const lastGood = { state: null, at: 0 };
  let keyPromise = null;
  let error = null;
  let listeners = new Set();

  function emit() {
    for (const fn of listeners) fn();
  }

  async function getKey() {
    if (!k) return null;
    if (!keyPromise) keyPromise = importAesKey(b64ToBytes(k));
    return keyPromise;
  }

  function headers() {
    const out = { Accept: "application/json" };
    if (t) {
      out["X-App-Token"] = t;
    }
    return out;
  }

  async function fetchApi(path, opts = {}) {
    const url = (apiBase || "") + path;
    const r = await fetch(url, {
      cache: "no-store",
      ...opts,
      headers: { ...headers(), ...(opts.headers || {}) },
    });
    if (!r.ok) {
      const err = new Error("HTTP " + r.status);
      err.status = r.status;
      try { err.body = await r.json(); } catch { /* ignore */ }
      throw err;
    }
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("image/")) return r;
    return r.json();
  }

  async function fetchEnc(rel) {
    const url = `d/${p}/${rel}.enc.json?t=${Date.now()}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      const err = new Error("HTTP " + r.status);
      err.status = r.status;
      throw err;
    }
    const env = await r.json();
    const key = await getKey();
    return decryptEnvelope(env, key);
  }

  async function get(rel) {
    if (mode === "locked") throw new Error("locked");
    if (mode === "api") {
      const map = {
        state: "/api/state",
        activity: "/api/activity",
        orders: "/api/orders",
        account: "/api/account",
        settings: "/api/settings",
      };
      if (rel in map) return fetchApi(map[rel]);
      if (rel.startsWith("chart/")) return fetchApi("/api/chart?range=" + encodeURIComponent(rel.slice(6)));
      if (rel.startsWith("bots/")) return fetchApi("/api/bots/" + rel.slice(5) + "/decisions");
      if (rel.startsWith("coin/")) return fetchApi("/api/coin/" + rel.slice(5));
      if (rel.startsWith("audit/")) return fetchApi("/api/audit/" + rel.slice(6));
      if (rel === "manifest") return { screen: null };
      throw new Error("unknown " + rel);
    }
    return fetchEnc(rel);
  }

  async function refreshState() {
    try {
      const state = await get("state");
      cache.set("state", state);
      lastGood.state = state;
      lastGood.at = Date.now();
      error = null;
      emit();
      return state;
    } catch (err) {
      error = err;
      emit();
      throw err;
    }
  }

  async function load(rel, { force = false } = {}) {
    if (!force && cache.has(rel)) return cache.get(rel);
    const data = await get(rel);
    cache.set(rel, data);
    return data;
  }

  function screenSrc() {
    if (mode === "api") return (apiBase || "") + "/api/screen.jpg";
    if (p) return `d/${p}/screen.jpg`;
    return null;
  }

  async function fetchScreenBlob() {
    const src = screenSrc();
    if (!src) return null;
    const opts = { cache: "no-store" };
    if (mode === "api") opts.headers = headers();
    const r = await fetch(src, opts);
    if (!r.ok) return null;
    return r.blob();
  }

  async function write(path, body) {
    if (!writable) {
      const err = new Error("read-only");
      err.status = 405;
      throw err;
    }
    return fetchApi(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  }

  function refreshMs(state) {
    const s = Number((state && state.refreshS) || 15);
    return Math.max(5, Math.min(300, s)) * 1000;
  }

  return {
    mode,
    writable,
    p,
    apiBase,
    cache,
    lastGood,
    get error() { return error; },
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    get,
    load,
    refreshState,
    fetchScreenBlob,
    screenSrc,
    write,
    refreshMs,
    page: () => parseHash().get("page") || "home",
    mint: () => parseHash().get("mint") || "",
  };
}
