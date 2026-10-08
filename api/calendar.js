// Kito susitikimo kalendorius: kuri narė kada gali + paskirta data.
//   GET                      – narės, jų laisvos dienos ir paskirtas susitikimas
//   PUT  {dates: [...]}      – išsaugoti savo laisvas dienas (reikia paskyros)
//   POST {meeting: {...}}    – paskirti susitikimą (null – atšaukti)

const store = require("../lib/store");
const { checkAccess } = require("../lib/auth");

const DATE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = async (req, res) => {
  if (!store.enabled()) return res.status(503).json({ error: store.MISSING });
  const access = await checkAccess(req);
  if (!access) return res.status(401).json({ error: "Neteisingas genties kodas" });
  const user = access.user;
  const today = store.today();

  try {
    if (req.method === "GET") {
      const users = store.toObject(await store.cmd("HGETALL", "users"));
      const avail = store.toObject(await store.cmd("HGETALL", "avail"));
      const members = Object.entries(users)
        .map(([id, raw]) => ({ id, name: (store.parse(raw) || {}).name || id }))
        .sort((a, b) => a.name.localeCompare(b.name, "lt"));
      const availability = {};
      for (const m of members) {
        availability[m.id] = (store.parse(avail[m.id]) || []).filter((d) => d >= today);
      }
      let meeting = store.parse(await store.cmd("GET", "meeting"));
      if (meeting && meeting.date < today) meeting = null;
      return res.status(200).json({ members, availability, meeting, me: user ? user.id : null });
    }

    if (!user) return res.status(401).json({ error: "Prisijunk, kad galėtum žymėti" });

    if (req.method === "PUT") {
      const dates = Array.isArray(req.body && req.body.dates) ? req.body.dates : [];
      const clean = [...new Set(dates.filter((d) => typeof d === "string" && DATE.test(d) && d >= today))]
        .sort()
        .slice(0, 200);
      await store.cmd("HSET", "avail", user.id, JSON.stringify(clean));
      return res.status(200).json({ dates: clean });
    }

    if (req.method === "POST") {
      const m = req.body && req.body.meeting;
      if (!m) {
        await store.cmd("DEL", "meeting");
        return res.status(200).json({ meeting: null });
      }
      if (!DATE.test(m.date || "") || m.date < today) {
        return res.status(400).json({ error: "Pasirink būsimą datą" });
      }
      const meeting = {
        date: m.date,
        time: /^\d{2}:\d{2}$/.test(m.time || "") ? m.time : "",
        place: typeof m.place === "string" ? m.place.trim().slice(0, 120) : "",
        setBy: user.name,
      };
      await store.cmd("SET", "meeting", JSON.stringify(meeting));
      return res.status(200).json({ meeting });
    }

    return res.status(405).json({ error: "Netinkamas metodas" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Nepavyko, pabandyk dar kartą" });
  }
};
