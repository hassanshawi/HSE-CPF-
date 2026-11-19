// Safety Equipment Register – Cloudflare Workers edition (free plan, no server to manage)
import seed from "../seed.json";
const enc = new TextEncoder(), COND = ["Good", "Fair", "Needs Repair", "Out of Service", "Missing"];
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sign(env, s) {
  const k = await crypto.subtle.importKey("raw", enc.encode(env.ADMIN_PASSWORD + "|cpf"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(s)));
}
async function isAdmin(env, req) {
  if (!env.ADMIN_PASSWORD) return false;
  const [p, s] = (req.headers.get("authorization") || "").replace(/^Bearer /, "").split(".");
  if (!p || !s || s !== await sign(env, p)) return false;
  try { return JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))).exp > Date.now(); } catch { return false; }
}
const json = (o, c = 200) => new Response(JSON.stringify(o), { status: c, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const getDb = async env => (await env.REG.get("db", "json")) || { ver: 1, items: seed };
const commit = async (env, db) => { db.ver++; db.items.sort((a, b) => a.n - b.n); await env.REG.put("db", JSON.stringify(db)); return db.ver; };
const s = (v, n) => String(v ?? "").trim().slice(0, n);
function clean(r, old) {
  const n = Number(r.n); if (!Number.isInteger(n) || n < 1) throw new Error("Bad item number");
  const type = s(r.type, 60); if (!type) throw new Error("Equipment type required");
  const photo = typeof r.photo === "string" && /^\/photos\/[\w.\-]+$/.test(r.photo) ? r.photo : (old?.photo || "");
  return { n, type, loc: s(r.loc, 40).toUpperCase(), cond: COND.includes(r.cond) ? r.cond : "Good", last: /^\d{4}-\d{2}-\d{2}/.test(r.last || "") ? r.last.slice(0, 10) : "", comment: s(r.comment, 500), photo };
}
export default {
  async fetch(req, env) {
    const u = new URL(req.url), p = u.pathname;
    try {
      if (p.startsWith("/photos/")) {
        const r = await env.REG.getWithMetadata("photo:" + p.slice(8), "arrayBuffer");
        return r.value ? new Response(r.value, { headers: { "Content-Type": r.metadata?.ct || "image/jpeg", "Cache-Control": "public, max-age=2592000, immutable" } }) : new Response("Not found", { status: 404 });
      }
      if (!p.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(req) : new Response("Not found", { status: 404 });
      if (p === "/api/ver") return json({ ver: (await getDb(env)).ver });
      if (p === "/api/items" && req.method === "GET") { const db = await getDb(env); return json({ role: (await isAdmin(env, req)) ? "admin" : "viewer", ver: db.ver, items: db.items }); }
      if (p === "/api/login" && req.method === "POST") {
        if (!env.ADMIN_PASSWORD) return json({ error: "Admin password is not set on the server" }, 500);
        const { password = "" } = await req.json();
        if (await sign(env, "pw:" + password) === await sign(env, "pw:" + env.ADMIN_PASSWORD)) { const pl = btoa(JSON.stringify({ exp: Date.now() + 30 * 864e5 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); return json({ token: pl + "." + await sign(env, pl) }); }
        await new Promise(r => setTimeout(r, 800)); return json({ error: "Wrong password" }, 401);
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
      return json({ error: "Not found" }, 404);
    } catch (e) { return json({ error: e.message }, 400); }
  }
};
