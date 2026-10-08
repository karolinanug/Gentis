// Kito susitikimo kalendorius: kuri narė kada gali, vedančiųjų eilė ir paskirta data.
//   GET                           – narės, jų laisvos dienos, eilė ir paskirtas susitikimas
//   PUT  {dates: [...]}           – išsaugoti savo laisvas dienas (reikia paskyros).
//                                   Kai visos eilės narės pasižymi ir viena diena surenka
//                                   daugiausiai balsų – ji patvirtinama automatiškai.
//   POST {meeting: {...}}         – paskirti / pakeisti susitikimą (null – atšaukti)
//   POST {nextHost: "Vardas"}     – pakeisti kito susitikimo vedančiąją, kol data nepaskirta
//   POST {absent: true|false}     – „šį kartą dalyvauti negalėsiu“ (galioja iki susitikimo pabaigos)
//
// Patvirtinus susitikimą ar pakeitus vedančiąją, jai siunčiamas laiškas (lib/mail.js).

const store = require("../lib/store");
const { checkAccess } = require("../lib/auth");
const { mailEnabled, sendMail } = require("../lib/mail");

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_ORDER = ["Karolina", "Ieva", "Vilma", "Erika", "Dalia"];
const START = "18:30";
const END = "21:30";

const key = (name) => String(name || "").trim().toLowerCase();

async function getRotation() {
  const r = store.parse(await store.cmd("GET", "rotation")) || {};
  const order = Array.isArray(r.order) && r.order.length ? r.order : DEFAULT_ORDER;
  return {
    order,
    next: Number.isInteger(r.next) ? r.next % order.length : 0,
    override: r.override || "",
    lastDate: r.lastDate || "",
  };
}

const saveRotation = (r) => store.cmd("SET", "rotation", JSON.stringify(r));
const hostOf = (r) => r.override || r.order[r.next];

// Praėjęs susitikimas: eilė pasislenka į kitą narę
async function settle(today) {
  const rotation = await getRotation();
  let meeting = store.parse(await store.cmd("GET", "meeting"));
  if (meeting && meeting.date < today) {
    const slot = Number.isInteger(meeting.slot) ? meeting.slot : rotation.next;
    rotation.next = (slot + 1) % rotation.order.length;
    rotation.override = "";
    rotation.lastDate = meeting.date;
    await saveRotation(rotation);
    await store.cmd("DEL", "meeting");
    meeting = null;
  }
  return { rotation, meeting };
}

async function loadPeople(today) {
  const raw = store.toObject(await store.cmd("HGETALL", "users"));
  const avail = store.toObject(await store.cmd("HGETALL", "avail"));
  const users = {};
  for (const [id, json] of Object.entries(raw)) users[id] = store.parse(json) || { name: id };
  const availability = {};
  for (const id of Object.keys(users)) {
    availability[id] = (store.parse(avail[id]) || []).filter((d) => d >= today);
  }
  return { users, availability };
}

// Kurios narės pažymėjo, kad šį kartą negalės (žyma galioja vienam susitikimų ratui)
async function loadAbsent(rotation) {
  const raw = store.toObject(await store.cmd("HGETALL", "absent"));
  return Object.keys(raw).filter((id) => (store.parse(raw[id]) || {}).round === rotation.lastDate);
}

function formatDate(date) {
  const text = new Date(`${date}T12:00:00Z`).toLocaleDateString("lt-LT", {
    month: "long", day: "numeric", weekday: "long", timeZone: "UTC",
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Laiškas vedančiajai. Grąžina true, jei išsiųsta.
async function notifyHost(meeting, users, reason) {
  const host = users[key(meeting.host)];
  if (!host || !host.email || !mailEnabled()) return false;
  const lines = [
    `Sveika, ${host.name}!`,
    "",
    reason,
    "",
    `📅 ${formatDate(meeting.date)}, ${meeting.time || START}–${END}`,
    meeting.place ? `📍 ${meeting.place}` : null,
    "",
    "Tu esi šio susitikimo vedančioji. Temą ir scenarijų gali paruošti svetainėje.",
    "",
    "Genties susitikimas",
  ].filter((l) => l !== null);
  try {
    return await sendMail({
      to: host.email,
      subject: `Genties susitikimas: ${formatDate(meeting.date)}`,
      text: lines.join("\n"),
    });
  } catch (err) {
    console.error("Nepavyko išsiųsti laiško:", err);
    return false;
  }
}

// Kai visos eilės narės pasižymėjo ir viena diena surinko daugiausiai balsų
function autoMeeting(rotation, users, availability, today, absent) {
  const voters = rotation.order.map(key);
  const allVoted = voters.every((id) => users[id] && (absent.includes(id) || availability[id].some((d) => d > rotation.lastDate)));
  if (!allVoted) return null;
  const counts = {};
  for (const dates of Object.values(availability)) {
    for (const d of dates) if (d >= today && d > rotation.lastDate) counts[d] = (counts[d] || 0) + 1;
  }
  const max = Math.max(0, ...Object.values(counts));
  const leaders = Object.keys(counts).filter((d) => counts[d] === max);
  if (!max || leaders.length !== 1) return null;
  return { date: leaders[0], time: START, place: "", host: hostOf(rotation), slot: rotation.next, setBy: "automatiškai", auto: true };
}

// Ar vedančioji jau suplanavo temą šiam susitikimui ir ar ją paskelbė
async function withTopic(meeting) {
  if (!meeting) return meeting;
  const plan = (await store.archiveItems()).find((i) => i.status === "planned" && i.date === meeting.date);
  if (!plan) return { ...meeting, topicState: "none" };
  return plan.revealed
    ? { ...meeting, topicState: "revealed", topic: plan.topic, kind: plan.kind || "pokalbis" }
    : { ...meeting, topicState: "secret" };
}

function view(rotation, users, availability, meeting, user, absent) {
  const members = Object.entries(users)
    .map(([id, u]) => ({ id, name: u.name || id, picture: u.picture || "" }))
    .sort((a, b) => a.name.localeCompare(b.name, "lt"));
  return {
    members,
    availability,
    meeting,
    absent,
    me: user ? user.id : null,
    myEmail: user && users[user.id] ? users[user.id].email || "" : "",
    mailEnabled: mailEnabled(),
    rotation: {
      order: rotation.order,
      next: rotation.next,
      nextHost: meeting ? meeting.host : hostOf(rotation),
      lastDate: rotation.lastDate,
      registered: rotation.order.map((n) => Boolean(users[key(n)])),
      pictures: rotation.order.map((n) => (users[key(n)] && users[key(n)].picture) || ""),
    },
  };
}

module.exports = async (req, res) => {
  if (!store.enabled()) return res.status(503).json({ error: store.MISSING });
  const access = await checkAccess(req);
  if (!access) return res.status(401).json({ error: "Neteisingas genties kodas" });
  const user = access.user;
  const today = store.today();

  try {
    const { rotation, meeting } = await settle(today);
    const { users, availability } = await loadPeople(today);
    const absent = await loadAbsent(rotation);

    // Patvirtina datą automatiškai, jei visos atsakė ir viena diena pirmauja
    const tryAutoConfirm = async () => {
      if (meeting) return { confirmed: null, emailed: false };
      const confirmed = autoMeeting(rotation, users, availability, today, absent);
      if (!confirmed) return { confirmed: null, emailed: false };
      await store.cmd("SET", "meeting", JSON.stringify(confirmed));
      const emailed = await notifyHost(confirmed, users, "Visos narės atsakė, ir kito susitikimo data patvirtinta automatiškai.");
      return { confirmed, emailed };
    };

    if (req.method === "GET") {
      return res.status(200).json(view(rotation, users, availability, await withTopic(meeting), user, absent));
    }

    if (!user) return res.status(401).json({ error: "Prisijunk, kad galėtum žymėti" });

    if (req.method === "PUT") {
      const dates = Array.isArray(req.body && req.body.dates) ? req.body.dates : [];
      const clean = [...new Set(dates.filter((d) => typeof d === "string" && DATE.test(d) && d >= today))]
        .sort()
        .slice(0, 200);
      await store.cmd("HSET", "avail", user.id, JSON.stringify(clean));
      availability[user.id] = clean;
      if (clean.length && absent.includes(user.id)) {
        // pasižymėjo dienas – vadinasi, vis dėlto galės
        await store.cmd("HDEL", "absent", user.id);
        absent.splice(absent.indexOf(user.id), 1);
      }
      const { confirmed, emailed } = await tryAutoConfirm();
      return res.status(200).json({ dates: clean, meeting: confirmed || meeting, autoConfirmed: Boolean(confirmed), emailed, absent });
    }

    if (req.method === "POST" && req.body && "absent" in req.body) {
      if (req.body.absent) {
        await store.cmd("HSET", "absent", user.id, JSON.stringify({ round: rotation.lastDate }));
        await store.cmd("HSET", "avail", user.id, "[]");
        availability[user.id] = [];
        if (!absent.includes(user.id)) absent.push(user.id);
      } else {
        await store.cmd("HDEL", "absent", user.id);
        if (absent.includes(user.id)) absent.splice(absent.indexOf(user.id), 1);
      }
      const { confirmed, emailed } = await tryAutoConfirm();
      const out = view(rotation, users, availability, await withTopic(confirmed || meeting), user, absent);
      return res.status(200).json({ ...out, autoConfirmed: Boolean(confirmed), emailed });
    }

    if (req.method === "POST" && req.body && "nextHost" in req.body) {
      const name = String(req.body.nextHost || "").trim().slice(0, 40);
      rotation.override = name && key(name) !== key(rotation.order[rotation.next]) ? name : "";
      await saveRotation(rotation);
      return res.status(200).json(view(rotation, users, availability, meeting, user, absent));
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
      const host = typeof m.host === "string" && m.host.trim() ? m.host.trim().slice(0, 40) : (meeting ? meeting.host : hostOf(rotation));
      const next = {
        date: m.date,
        time: /^\d{2}:\d{2}$/.test(m.time || "") ? m.time : START,
        place: typeof m.place === "string" ? m.place.trim().slice(0, 120) : "",
        host,
        slot: meeting && Number.isInteger(meeting.slot) ? meeting.slot : rotation.next,
        setBy: user.name,
      };
      await store.cmd("SET", "meeting", JSON.stringify(next));

      let emailed = false;
      if (!meeting) {
        emailed = await notifyHost(next, users, "Kito susitikimo data paskirta.");
      } else if (key(meeting.host) !== key(next.host)) {
        const reason = key(user.name) === key(meeting.host)
          ? `${meeting.host} negalės vesti, todėl šį susitikimą vesi tu.`
          : `Vedančiąją pakeitė ${user.name}: šį susitikimą vesi tu (anksčiau buvo numatyta – ${meeting.host}).`;
        emailed = await notifyHost(next, users, reason);
      } else if (meeting.date !== next.date || meeting.time !== next.time || meeting.place !== next.place) {
        emailed = await notifyHost(next, users, "Susitikimo informacija atnaujinta.");
      }
      return res.status(200).json({ meeting: next, emailed });
    }

    return res.status(405).json({ error: "Netinkamas metodas" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Nepavyko, pabandyk dar kartą" });
  }
};
