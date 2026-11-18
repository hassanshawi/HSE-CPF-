// HSE - CPF Safety Equipment Register – Cloudflare Worker (free plan)
// v2: the admin password, the signing key, the data and the automatic backups all live in the SAME
// KV store. Re-deploying the code can therefore never reset the password or hide the data.
import seed from "../seed.json";

const enc = new TextEncoder();
const COND = ["Good", "Fair", "Needs Repair", "Out of Service", "Missing"];
const MAX_FAILS = 8, LOCK_SECONDS = 600, TOKEN_DAYS = 30, BACKUP_TTL = 60 * 86400, MIN_PW = 8;

const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = t => Uint8Array.from(atob(t.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const rnd = n => b64u(crypto.getRandomValues(new Uint8Array(n)));
const json = (o, c = 200) => new Response(JSON.stringify(o), { status: c, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const s = (v, n) => String(v ?? "").trim().slice(0, n);
const today = () => new Date().toISOString().slice(0, 10);

function same(a, b) { // constant-time string compare
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
async function hmac(keyText, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(keyText), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
async function pbkdf2(pw, salt) {
  const k = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return b64u(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64u(salt), iterations: 100000 }, k, 256));
}
async function makeAuth(pw) {
  const salt = rnd(16);
  return { salt, hash: await pbkdf2(pw, salt), key: rnd(32), changed: new Date().toISOString() };
}
const getAuth = env => env.REG.get("auth", "json");
async function newToken(auth) {
  const p = b64u(enc.encode(JSON.stringify({ exp: Date.now() + TOKEN_DAYS * 864e5 })));
  return p + "." + await hmac(auth.key, p);
}
async function isAdmin(env, req) {
  const [p, sig] = (req.headers.get("authorization") || "").replace(/^Bearer /, "").split(".");
  if (!p || !sig) return false;
  const auth = await getAuth(env);
  if (!auth || !same(sig, await hmac(auth.key, p))) return false;
  try { return JSON.parse(new TextDecoder().decode(unb64u(p))).exp > Date.now(); } catch { return false; }
}

// ---- data ----
async function getDb(env) {
  const db = await env.REG.get("db", "json");
  return db ? { ...db, fresh: false } : { ver: 1, items: seed, fresh: true };
}
async function commit(env, db) {
  db.ver++; db.items.sort((a, b) => a.n - b.n);
  const { fresh, ...store } = db; store.ts = new Date().toISOString();
  await env.REG.put("db", JSON.stringify(store));
  // one automatic snapshot per day, kept 60 days (so a mistake can always be rolled back)
  const bk = "bak:" + today();
  if (!(await env.REG.get(bk, "text"))) await env.REG.put(bk, JSON.stringify({ ver: store.ver, ts: store.ts, items: store.items }), { expirationTtl: BACKUP_TTL });
  return store.ver;
}
function clean(r, old) {
  const n = Number(r.n); if (!Number.isInteger(n) || n < 1) throw new Error("Bad item number");
  const type = s(r.type, 60); if (!type) throw new Error("Equipment type required");
  const photo = typeof r.photo === "string" && /^\/photos\/[\w.\-]+$/.test(r.photo) ? r.photo : (old?.photo || "");
  return { n, type, loc: s(r.loc, 40).toUpperCase(), cond: COND.includes(r.cond) ? r.cond : "Good", last: /^\d{4}-\d{2}-\d{2}/.test(r.last || "") ? r.last.slice(0, 10) : "", comment: s(r.comment, 500), photo };
}
function cleanAll(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 5000) throw new Error("Backup has no items");
  const seen = new Set();
  return rows.map(r => { const it = clean(r, null); if (seen.has(it.n)) throw new Error("Duplicate item number " + it.n); seen.add(it.n); return it; });
}

// ---- login throttling (per IP, stored in KV so it survives across isolates) ----
const ipOf = req => req.headers.get("CF-Connecting-IP") || "x";
const failsOf = async (env, req) => Number(await env.REG.get("fail:" + ipOf(req), "text")) || 0;
const addFail = (env, req, n) => env.REG.put("fail:" + ipOf(req), String(n + 1), { expirationTtl: LOCK_SECONDS });

export default {
  async fetch(req, env) {
    const u = new URL(req.url), p = u.pathname;
    try {
      if (p.startsWith("/photos/")) {
        const r = await env.REG.getWithMetadata("photo:" + p.slice(8), "arrayBuffer");
        if (r.value) return new Response(r.value, { headers: { "Content-Type": r.metadata?.ct || "image/jpeg", "Cache-Control": "public, max-age=2592000, immutable" } });
        return env.ASSETS ? env.ASSETS.fetch(req) : new Response("Not found", { status: 404 }); // built-in photos shipped with the app
      }
      if (!p.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(req) : new Response("Not found", { status: 404 });

      if (p === "/api/ver") return json({ ver: (await getDb(env)).ver });
      if (p === "/api/health") { const db = await getDb(env), a = await getAuth(env); return json({ ok: true, fresh: db.fresh, ver: db.ver, items: db.items.length, passwordInStore: !!a, bootstrapSecret: !!env.ADMIN_PASSWORD }); }
      if (p === "/api/items" && req.method === "GET") { const db = await getDb(env); return json({ role: (await isAdmin(env, req)) ? "admin" : "viewer", ver: db.ver, fresh: db.fresh, items: db.items }); }

      if (p === "/api/login" && req.method === "POST") {
        const fails = await failsOf(env, req);
        if (fails >= MAX_FAILS) return json({ error: "Too many attempts" }, 429);
        const { password = "" } = await req.json();
        let auth = await getAuth(env), ok = false;
        if (auth) ok = same(await pbkdf2(String(password), auth.salt), auth.hash);
        else if (!env.ADMIN_PASSWORD) return json({ error: "Admin password is not set yet. Run the deploy script again." }, 500);
        else if (same(password, env.ADMIN_PASSWORD)) { // first login: move the password into the data store
          auth = await makeAuth(String(password)); await env.REG.put("auth", JSON.stringify(auth)); ok = true;
        }
        if (ok) { if (fails) await env.REG.delete("fail:" + ipOf(req)); return json({ token: await newToken(auth) }); }
        await addFail(env, req, fails); await new Promise(r => setTimeout(r, 800));
        return json({ error: "Wrong password" }, 401);
      }

      if (!(await isAdmin(env, req))) return json({ error: "Admin only" }, 403);
      const db = await getDb(env);

      if (p === "/api/item" && req.method === "POST") { const r = await req.json(), old = db.items.find(i => i.n === Number(r.n)), it = clean(r, old); old ? Object.assign(old, it) : db.items.push(it); return json({ ver: await commit(env, db) }); }
      if (p.startsWith("/api/item/") && req.method === "DELETE") { db.items = db.items.filter(i => i.n !== Number(p.split("/").pop())); return json({ ver: await commit(env, db) }); }
      if (p === "/api/import" && req.method === "POST") { const { rows = [] } = await req.json(); for (const r of rows) { const old = db.items.find(i => i.n === Number(r.n)), it = clean({ ...r, photo: undefined }, old); old ? Object.assign(old, it) : db.items.push(it); } return json({ ver: await commit(env, db) }); }
      if (p === "/api/photo" && req.method === "POST") {
        const { n, dataUrl = "" } = await req.json(), m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl);
        if (!m || !Number.isInteger(Number(n))) return json({ error: "Bad image" }, 400);
        const name = "p" + String(Number(n)).padStart(3, "0") + "_" + Date.now() + "." + (m[1] === "jpeg" ? "jpg" : m[1]);
        await env.REG.put("photo:" + name, Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)), { metadata: { ct: "image/" + m[1] } });
        return json({ url: "/photos/" + name });
      }

      // ---- backup / restore ----
      if (p === "/api/backup" && req.method === "GET") return json({ app: "hse-cpf", exported: new Date().toISOString(), ver: db.ver, items: db.items });
      if (p === "/api/backups" && req.method === "GET") { const l = await env.REG.list({ prefix: "bak:" }); return json({ names: l.keys.map(k => k.name.slice(4)).sort().reverse() }); }
      if (p === "/api/restore" && req.method === "POST") {
        const b = await req.json(); let rows;
        if (b.name) { const snap = await env.REG.get("bak:" + s(b.name, 40), "json"); if (!snap) return json({ error: "Backup not found" }, 404); rows = snap.items; } else rows = b.items;
        const items = cleanAll(rows);
        if (!db.fresh) await env.REG.put("bak:before-restore", JSON.stringify({ ver: db.ver, ts: new Date().toISOString(), items: db.items }), { expirationTtl: BACKUP_TTL });
        db.items = items; return json({ ver: await commit(env, db), count: items.length });
      }

      // ---- change password (current password required) ----
      if (p === "/api/password" && req.method === "POST") {
        const { current = "", next = "" } = await req.json(), auth = await getAuth(env);
        if (!auth || !same(await pbkdf2(String(current), auth.salt), auth.hash)) { await new Promise(r => setTimeout(r, 800)); return json({ error: "Current password is wrong" }, 401); }
        if (String(next).length < MIN_PW) return json({ error: `New password must be at least ${MIN_PW} characters` }, 400);
        const na = await makeAuth(String(next)); await env.REG.put("auth", JSON.stringify(na)); // new signing key signs out every old session
        return json({ token: await newToken(na) });
      }
      return json({ error: "Not found" }, 404);
    } catch (e) { return json({ error: e.message }, 400); }
  }
};
