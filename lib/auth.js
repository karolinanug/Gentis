// Prieiga: arba teisingas būrelio kodas, arba prisijungusi narė.

const crypto = require("crypto");
const store = require("./store");

const SESSION_TTL = 60 * 60 * 24 * 180; // 180 dienų

function codeOk(code) {
  const group = process.env.GROUP_CODE;
  return Boolean(group) && typeof code === "string" && code === group;
}

function tokenFrom(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return /^[a-f0-9]{48}$/.test(token) ? token : null;
}

async function sessionUser(req) {
  const token = tokenFrom(req);
  if (!token || !store.enabled()) return null;
  try {
    const id = await store.cmd("GET", `sess:${token}`);
    if (!id) return null;
    const user = store.parse(await store.cmd("HGET", "users", id));
    return user ? { id, name: user.name, google: Boolean(user.google), picture: user.picture || "" } : null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Grąžina { user } jei prieiga leidžiama, kitaip null.
async function checkAccess(req) {
  const user = await sessionUser(req);
  const code = (req.body && req.body.code) || req.headers["x-group-code"];
  if (user || codeOk(code)) return { user };
  return null;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString("hex");
}

function passwordMatches(password, salt, hash) {
  const a = Buffer.from(hashPassword(password, salt), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Patikrina Google „Sign in with Google“ ženklą (ID token).
// Grąžina { sub, email, name } arba null.
async function verifyGoogle(credential) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || typeof credential !== "string" || credential.length > 4096) return null;
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!res.ok) return null;
  const info = await res.json();
  const issuerOk = info.iss === "accounts.google.com" || info.iss === "https://accounts.google.com";
  const fresh = Number(info.exp) * 1000 > Date.now();
  if (info.aud !== clientId || !issuerOk || !fresh || !info.sub) return null;
  const picture = /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//.test(info.picture || "") ? info.picture : "";
  return { sub: info.sub, email: info.email || "", name: info.given_name || info.name || "", picture };
}

async function createSession(id) {
  const token = crypto.randomBytes(24).toString("hex");
  await store.cmd("SET", `sess:${token}`, id, "EX", SESSION_TTL);
  return token;
}

module.exports = {
  codeOk,
  tokenFrom,
  sessionUser,
  checkAccess,
  hashPassword,
  passwordMatches,
  createSession,
  verifyGoogle,
};
