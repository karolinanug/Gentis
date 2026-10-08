// Kalendoriaus įvykio failas (.ics) susitikimui – „Pridėti į telefono kalendorių“.
// GET /api/ics?date=YYYY-MM-DD&time=HH:MM&place=...&topic=...&host=...
// Duomenys paimami iš adreso (juos parenka puslapis), todėl prieigos tikrinti nereikia.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const TZ = "Europe/Vilnius";

// Vietos laiką (Vilniuje) paverčia UTC
function vilniusToUtc(date, time) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const asTz = new Date(new Date(guess).toLocaleString("en-US", { timeZone: TZ }));
  const asUtc = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess - (asTz - asUtc));
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
const clip = (s, n) => (typeof s === "string" ? s.trim().slice(0, n) : "");

module.exports = (req, res) => {
  const q = req.query || {};
  const date = DATE.test(q.date || "") ? q.date : null;
  if (!date) return res.status(400).json({ error: "Trūksta datos" });
  const time = TIME.test(q.time || "") ? q.time : "18:30";
  const start = vilniusToUtc(date, time);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const topic = clip(q.topic, 120);
  const host = clip(q.host, 40);
  const place = clip(q.place, 120);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Genties susitikimas//LT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:gentis-${date}@genties-susitikimas`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(topic ? `Genties susitikimas: ${topic}` : "Genties susitikimas")}`,
    place ? `LOCATION:${esc(place)}` : null,
    `DESCRIPTION:${esc([host && `Veda: ${host}`, topic && `Tema: ${topic}`].filter(Boolean).join("\n"))}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Genties susitikimas",
    "TRIGGER:-PT2H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="genties-susitikimas-${date}.ics"`);
  res.setHeader("Cache-Control", "no-store");
  res.end(lines.join("\r\n") + "\r\n");
};
