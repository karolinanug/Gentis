// Buvusių susitikimų archyvas.
// Būsimo susitikimo tema – staigmena: ją mato tik išsaugojusi narė.
// Kai vedančioji paskelbia temą, kitos mato jos pavadinimą;
// klausimai visoms atsiveria kitą dieną po susitikimo.
//   GET                          – visi įrašai (būsimų svetimų – be klausimų)
//   POST {entry}                 – išsaugoti naują arba atnaujinti (jei yra entry.id)
//   POST {reveal: {id, revealed}} – paskelbti temą narėms arba vėl paslėpti
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

function isOwner(item, user) {
  if (!user) return false;
  if (item.hostId) return item.hostId === user.id;
  return Boolean(item.host) && item.host.toLowerCase() === user.name.toLowerCase();
}

function isVisible(item, user, today) {
  return (item.date || "") < today || isOwner(item, user);
}

function masked(item) {
  const out = { id: item.id, date: item.date, host: item.host, hidden: true };
  if (item.revealed) {
    out.topic = item.topic;
    out.revealed = true;
  }
  return out;
}

module.exports = async (req, res) => {
  if (!store.enabled()) return res.status(503).json({ error: store.MISSING });
  const access = await checkAccess(req);
  if (!access) return res.status(401).json({ error: "Neteisingas būrelio kodas" });

  try {
    if (req.method === "GET") {
      const today = store.today();
      const items = (await store.archiveItems()).map((i) => (isVisible(i, access.user, today) ? i : masked(i)));
      items.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.savedAt || 0) - (a.savedAt || 0));
      return res.status(200).json({ items });
    }

    if (req.method === "POST" && req.body && req.body.reveal) {
      const { id, revealed } = req.body.reveal;
      const item = typeof id === "string" && /^[a-f0-9]{16}$/.test(id) && store.parse(await store.cmd("HGET", "archive", id));
      if (!item) return res.status(404).json({ error: "Įrašas nerastas" });
      if (!isOwner(item, access.user)) {
        return res.status(403).json({ error: "Temą gali paskelbti tik ją išsaugojusi vedančioji" });
      }
      item.revealed = Boolean(revealed);
      await store.cmd("HSET", "archive", id, JSON.stringify(item));
      return res.status(200).json({ item });
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
      if (old && !isVisible(old, access.user, store.today())) {
        return res.status(403).json({ error: "Šį susitikimą ruošia kita narė" });
      }
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
        hostId: (old && old.hostId) || (access.user && access.user.id) || "",
        revealed: Boolean(old && old.revealed),
        savedAt: Date.now(),
      };
      await store.cmd("HSET", "archive", id, JSON.stringify(item));
      return res.status(200).json({ item });
    }

    if (req.method === "DELETE") {
      const id = String((req.query && req.query.id) || "");
      if (!/^[a-f0-9]{16}$/.test(id)) return res.status(400).json({ error: "Blogas įrašo ID" });
      const item = store.parse(await store.cmd("HGET", "archive", id));
      if (item && !isVisible(item, access.user, store.today())) {
        return res.status(403).json({ error: "Šį susitikimą ruošia kita narė" });
      }
      await store.cmd("HDEL", "archive", id);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Netinkamas metodas" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Nepavyko, pabandyk dar kartą" });
  }
};
