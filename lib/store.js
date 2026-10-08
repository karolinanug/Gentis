// Duomenų saugykla – Upstash Redis per REST API (be papildomų paketų).
// Vercel → Storage (arba Marketplace) → Upstash Redis → Connect Project
// automatiškai prideda KV_REST_API_URL ir KV_REST_API_TOKEN.

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const MISSING = "Duomenų saugykla dar neprijungta (Vercel → Storage → Upstash Redis)";

function enabled() {
  return Boolean(URL_ && TOKEN);
}

async function cmd(...args) {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`Redis: ${data.error || res.status}`);
  return data.result;
}

function toObject(flat) {
  const out = {};
  for (let i = 0; i < (flat || []).length; i += 2) out[flat[i]] = flat[i + 1];
  return out;
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

async function archiveItems() {
  const values = await cmd("HVALS", "archive");
  return (values || []).map(parse).filter(Boolean);
}

// Šiandienos data Lietuvos laiku, YYYY-MM-DD
function today() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Vilnius" });
}

module.exports = { enabled, cmd, toObject, parse, archiveItems, today, MISSING };
