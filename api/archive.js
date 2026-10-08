// Buvusių susitikimų archyvas.
//   GET              – visi įrašai
//   POST {entry}     – išsaugoti naują arba atnaujinti (jei yra entry.id)
//   DELETE ?id=...   – ištrinti

const crypto = require("crypto");
const store = require("../lib/store");
const { checkAccess } = require("../lib/auth");

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function cleanList(list) {
  return Array.isArray(list)
    ? list.filter((q) => typeof q === "string").map((q) => q.slice(0, 500)).slice(0, 20)
    : [];
}

module.exports = async (req, res) => {
  if (!store.enabled()) return res.status(503).json({ error: store.MISSING });
  const access = await checkAccess(req);
  if (!access) return res.status(401).json({ error: "Neteisingas būrelio kodas" });

  try {
    if (req.method === "GET") {
      const items = await store.archiveItems();
      items.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.savedAt || 0) - (a.savedAt || 0));
      return res.status(200).json({ items });
    }

    if (req.method === "POST") {
      const entry = (req.body && req.body.entry) || {};
      const topic = typeof entry.topic === "string" ? entry.topic.trim().slice(0, 120) : "";
      const s = entry.scenario || {};
      if (!topic) return res.status(400).json({ error: "Trūksta temos" });

      const id = typeof entry.id === "string" && /^[a-f0-9]{16}$/.test(entry.id)
        ? entry.id
        : crypto.randomBytes(8).toString("hex");
      const old = store.parse(await store.cmd("HGET", "archive", id));
      const t = entry.timing || {};
      const item = {
        id,
        topic,
        date: DATE.test(entry.date || "") ? entry.date : store.today(),
        depth: typeof entry.depth === "string" ? entry.depth.slice(0, 20) : "vidutinis",
        count: Number(entry.count) || undefined,
        scenario: {
          intro: typeof s.intro === "string" ? s.intro.slice(0, 1000) : "",
          warmup: cleanList(s.warmup),
          main: cleanList(s.main),
          closing: cleanList(s.closing),
        },
        timing: {
          warmup: Math.min(60, Math.max(0, Number(t.warmup) || 0)),
          main: Math.min(60, Math.max(0, Number(t.main) || 0)),
          closing: Math.min(60, Math.max(0, Number(t.closing) || 0)),
        },
        host: (old && old.host) || (access.user && access.user.name) || "",
        savedAt: Date.now(),
      };
      await store.cmd("HSET", "archive", id, JSON.stringify(item));
      return res.status(200).json({ item });
    }

    if (req.method === "DELETE") {
      const id = String((req.query && req.query.id) || "");
      if (!/^[a-f0-9]{16}$/.test(id)) return res.status(400).json({ error: "Blogas įrašo ID" });
      await store.cmd("HDEL", "archive", id);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Netinkamas metodas" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Nepavyko, pabandyk dar kartą" });
  }
};
