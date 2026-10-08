// Narių paskyros: registracija (su būrelio kodu), prisijungimas, atsijungimas.

const crypto = require("crypto");
const store = require("../lib/store");
const auth = require("../lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Naudok POST" });
  if (!store.enabled()) return res.status(503).json({ error: store.MISSING });

  const { action, name, password, code } = req.body || {};
  const cleanName = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  const id = cleanName.toLowerCase();

  try {
    if (action === "me") {
      const user = await auth.sessionUser(req);
      if (!user) return res.status(401).json({ error: "Prisijunk iš naujo" });
      return res.status(200).json({ user });
    }

    if (action === "logout") {
      const token = auth.tokenFrom(req);
      if (token) await store.cmd("DEL", `sess:${token}`);
      return res.status(200).json({ ok: true });
    }

    if (action === "register") {
      if (!auth.codeOk(code)) return res.status(401).json({ error: "Neteisingas būrelio kodas" });
      if (cleanName.length < 2 || cleanName.length > 40) {
        return res.status(400).json({ error: "Vardas turi būti 2–40 simbolių" });
      }
      if (typeof password !== "string" || password.length < 6 || password.length > 100) {
        return res.status(400).json({ error: "Slaptažodis turi būti bent 6 simbolių" });
      }
      const salt = crypto.randomBytes(16).toString("hex");
      const record = JSON.stringify({ name: cleanName, salt, hash: auth.hashPassword(password, salt) });
      const created = await store.cmd("HSETNX", "users", id, record);
      if (!created) return res.status(409).json({ error: "Toks vardas jau užimtas – prisijunk arba pasirink kitą" });
      const token = await auth.createSession(id);
      return res.status(200).json({ token, user: { id, name: cleanName } });
    }

    if (action === "login") {
      const user = id && store.parse(await store.cmd("HGET", "users", id));
      if (!user || typeof password !== "string" || !auth.passwordMatches(password, user.salt, user.hash)) {
        return res.status(401).json({ error: "Neteisingas vardas arba slaptažodis" });
      }
      const token = await auth.createSession(id);
      return res.status(200).json({ token, user: { id, name: user.name } });
    }

    return res.status(400).json({ error: "Nežinomas veiksmas" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Nepavyko, pabandyk dar kartą" });
  }
};
