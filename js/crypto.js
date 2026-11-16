/* AES-256-GCM decrypt for plan B {v:1,iv,ct} envelopes. Key never leaves the client. */
export function b64ToBytes(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64Url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function importAesKey(raw) {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
}

export async function decryptEnvelope(env, key) {
  if (!env || env.v !== 1 || !env.iv || !env.ct) {
    throw new Error("bad envelope");
  }
  const iv = b64ToBytes(env.iv);
  const ct = b64ToBytes(env.ct);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  const text = new TextDecoder().decode(pt);
  const obj = JSON.parse(text);
  if (obj && typeof obj === "object" && Object.keys(obj).length === 1 && "_" in obj) {
    return obj._;
  }
  return obj;
}
