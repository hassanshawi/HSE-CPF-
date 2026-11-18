// HSE - CPF  |  one safe command for first install AND for every later update.
//   node deploy.mjs                 -> install / update (keeps data + password)
//   node deploy.mjs --reset-password -> only if the admin password is lost
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

process.chdir(dirname(fileURLToPath(import.meta.url)));
const TOML = "wrangler.toml", NAME = "safety-register";
const say = (...a) => console.log(...a), hr = () => say("------------------------------------------------");
const die = m => { say("\n[X] " + m); process.exit(1); };
if (Number(process.versions.node.split(".")[0]) < 18) die("Node.js 18 or newer is required. Install the LTS version from https://nodejs.org");

function wr(args, opt = {}) {
  const r = spawnSync("npx", ["--yes", "wrangler", ...args], { shell: true, encoding: "utf8", input: opt.input, stdio: opt.show ? ["pipe", "inherit", "inherit"] : "pipe", maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: (r.stdout || "") + "", err: (r.stderr || "") + "" };
}
const grab = (t, a, b) => { const i = t.indexOf(a), j = t.lastIndexOf(b); if (i < 0 || j < i) return null; try { return JSON.parse(t.slice(i, j + 1)); } catch { return null; } };
// KV commands: newer wrangler needs --remote to touch the real store, older ones do not know the flag
function kv(args) { let r = wr([...args, "--remote"]); if (r.code && /unknown argument/i.test(r.err + r.out)) r = wr(args); return r; }
const kvGet = (id, key) => { const r = kv(["kv", "key", "get", key, "--namespace-id", id]); return r.code ? null : r.out; };

let RL = null, MUTE = false;
function ask(q, hidden = false) {
  if (!RL) { RL = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY }); const w = RL._writeToOutput; RL._writeToOutput = s => { if (!MUTE) w.call(RL, s); else if (/\r|\n/.test(s)) process.stdout.write("\n"); }; }
  return new Promise(res => { process.stdout.write(q); MUTE = hidden; RL.question("", a => { MUTE = false; res(a.trim()); }); });
}
const askPassword = async () => {
  for (;;) {
    const a = await ask("Choose the ADMIN password (at least 8 characters): ", true);
    if (a.length < 8) { say("Too short, try again."); continue; }
    if (a !== await ask("Type it again to confirm: ", true)) { say("They do not match, try again."); continue; }
    return a;
  }
};

say("\n=== HSE - CPF Safety Register : deploy ===\n");

// 1) Cloudflare login (only if needed)
let who = wr(["whoami"]);
if (/not authenticated|not logged in/i.test(who.out + who.err) || who.code) {
  say("[1/4] Log in to Cloudflare - a browser window opens, click Allow...");
  if (wr(["login"], { show: true }).code) die("Login failed.");
} else say("[1/4] Already logged in to Cloudflare.");

// 2) Find the data store. NEVER create a second one if one already holds data.
say("\n[2/4] Looking for your data store...");
let toml = readFileSync(TOML, "utf8");
const cur = (toml.match(/\bid\s*=\s*"([0-9a-f]{32})"/) || [])[1];
let kvId = cur;
if (cur) say("      Using the data store configured in wrangler.toml (" + cur.slice(0, 8) + "...).");
else {
  const lr = wr(["kv", "namespace", "list"]);
  const all = grab(lr.out, "[", "]");
  if (!all) die("Could not list your Cloudflare data stores:\n" + (lr.err || lr.out));
  const info = all.map(n => {
    const dbRaw = kvGet(n.id, "db"); let db = null; try { db = dbRaw && JSON.parse(dbRaw); } catch {}
    const ph = kv(["kv", "key", "list", "--namespace-id", n.id, "--prefix", "photo:"]);
    return { ...n, db, photos: (grab(ph.out, "[", "]") || []).length, mine: /safety|reg/i.test(n.title) || !!db };
  }).filter(n => n.mine);
  const withData = info.filter(n => n.db);
  if (info.length) { say("      Found:"); info.forEach((n, i) => say(`      [${i + 1}] ${n.title}  |  ${n.db ? `${n.db.items.length} items, edited ${n.db.ver - 1} times, ${n.photos} photos${n.db.ts ? ", last change " + n.db.ts.slice(0, 16).replace("T", " ") : ""}` : "no saved data (sample only)"}`)); }
  if (withData.length === 1) { kvId = withData[0].id; say("      -> Reconnecting to the store that holds your data: " + withData[0].title); }
  else if (withData.length > 1) {
    const best = withData.reduce((a, b) => (b.db.ver > a.db.ver ? b : a));
    const a = await ask(`      Several stores hold data. Press Enter for the most edited one [${info.indexOf(best) + 1}], or type its number: `);
    const pick = a ? info[Number(a) - 1] : best; if (!pick) die("Invalid choice."); kvId = pick.id;
  } else if (info.length) { kvId = info[0].id; say("      -> Using the existing empty store."); }
  else {
    say("      No store yet - creating one (first install only)...");
    const c = wr(["kv", "namespace", "create", "REG"]); const m = (c.out + c.err).match(/[0-9a-f]{32}/);
    if (!m) die("Could not create the data store:\n" + (c.err || c.out)); kvId = m[0];
  }
  toml = toml.replace(/\bid\s*=\s*"[^"]*"/, `id = "${kvId}"`); writeFileSync(TOML, toml);
  writeFileSync("kv-id.txt", kvId + "\n");
  say("      Saved the store id in wrangler.toml (keep this file for every future update).");
}

// 3) Publish the code. Data and password are not touched.
say("\n[3/4] Publishing the app...");
const d = wr(["deploy"], { show: false }); say(d.out + d.err);
if (d.code) die("Deploy failed (see above).");
const url = ((d.out + d.err).match(/https:\/\/[\w.\-]+\.workers\.dev/) || [])[0];

// 4) Password: only ask when there really is none.
say("[4/4] Checking the admin password...");
const hasAuth = !!kvGet(kvId, "auth");
const sl = wr(["secret", "list"]); const hasSecret = (grab(sl.out, "[", "]") || []).some(x => x.name === "ADMIN_PASSWORD");
if (process.argv.includes("--reset-password")) {
  const pw = await askPassword();
  if (wr(["secret", "put", "ADMIN_PASSWORD"], { input: pw }).code) die("Could not save the password.");
  kv(["kv", "key", "delete", "auth", "--namespace-id", kvId]);
  say("      Password reset. Open the app and sign in with the new password.");
} else if (hasAuth) say("      Password is stored with your data - unchanged.");
else if (hasSecret) say("      Existing password kept - unchanged.");
else {
  const pw = await askPassword();
  if (wr(["secret", "put", "ADMIN_PASSWORD"], { input: pw }).code) die("Could not save the password.");
  say("      Password saved.");
}
RL && RL.close();
hr(); say("DONE.  " + (url ? "Your link:  " + url : "Use the https://....workers.dev link printed above.")); hr();
say("Tip: inside the app, Excel menu > Backup, to download a copy of your data any time.\n");
