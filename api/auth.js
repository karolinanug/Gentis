// Narių paskyros: registracija (su būrelio kodu), prisijungimas, atsijungimas,
// prisijungimas su Google (reikia GOOGLE_CLIENT_ID aplinkos kintamojo).

const crypto = require("crypto");
const store = require("../lib/store");
const auth = require("../lib/auth");

module.exports = async (req, res) => {
  // GET /api/auth – greitas patikrinimas naršyklėje, ar nustatytas Google Client ID
  if (req.method === "GET" || (req.body && req.body.action === "config")) {
    return res.status(200).json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Naudok POST" });
  if (!store.enabled()) return res.status(503).json({ error: store.MISSING });

  const { action, name, password, code, credential } = req.body || {};
  const cleanName = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  const id = cleanName.toLowerCase();
  const badName = cleanName.length < 2 || cleanName.length > 40;

  try {
    if (action === "google") {
      const g = await auth.verifyGoogle(credential);
      if (!g) return res.status(401).json({ error: "Nepavyko prisijungti su Google, pabandyk dar kartą" });

      const existing = await store.cmd("HGET", "google", g.sub);
      if (existing) {
        const user = store.parse(await store.cmd("HGET", "users", existing));
        if (user) {
          if (g.picture && user.picture !== g.picture) {
            user.picture = g.picture; // nuotrauka atnaujinama kiekvieną kartą prisijungus
            await store.cmd("HSET", "users", existing, JSON.stringify(user));
          }
          const token = await auth.createSession(existing);
          return res.status(200).json({ token, user: { id: existing, name: user.name, google: true, picture: user.picture || "" } });
        }
      }

      // Pirmas kartas – reikia būrelio kodo ir vardo
      if (!code) return res.status(200).json({ needsSignup: true, suggestedName: g.name });
      if (!auth.codeOk(code)) return res.status(401).json({ error: "Neteisingas genties kodas" });
      if (badName) return res.status(400).json({ error: "Vardas turi būti 2–40 simbolių" });
      const record = JSON.stringify({ name: cleanName, google: g.sub, email: g.email, picture: g.picture });
      const created = await store.cmd("HSETNX", "users", id, record);
      if (!created) {
        return res.status(409).json({
          error: "Toks vardas jau užimtas. Jei tai tavo paskyra – prisijunk slaptažodžiu ir paspausk „Susieti su Google“.",
        });
      }
      await store.cmd("HSET", "google", g.sub, id);
      const token = await auth.createSession(id);
      return res.status(200).json({ token, user: { id, name: cleanName, google: true, picture: g.picture } });
    }

    if (action === "link-google") {
      const me = await auth.sessionUser(req);
      if (!me) return res.status(401).json({ error: "Prisijunk iš naujo" });
      const g = await auth.verifyGoogle(credential);
      if (!g) return res.status(401).json({ error: "Nepavyko patvirtinti Google paskyros" });
      const owner = await store.cmd("HGET", "google", g.sub);
      if (owner && owner !== me.id) {
        return res.status(409).json({ error: "Ši Google paskyra jau susieta su kita nare" });
      }
      const user = store.parse(await store.cmd("HGET", "users", me.id)) || { name: me.name };
      if (user.google && user.google !== g.sub) await store.cmd("HDEL", "google", user.google);
      user.google = g.sub;
      user.email = user.email || g.email;
      if (g.picture) user.picture = g.picture;
      await store.cmd("HSET", "users", me.id, JSON.stringify(user));
      await store.cmd("HSET", "google", g.sub, me.id);
      return res.status(200).json({ user: { ...me, google: true, picture: user.picture || "" } });
    }

    if (action === "me") {
      const user = await auth.sessionUser(req);
      if (!user) return res.status(401).json({ error: "Prisijunk iš naujo" });
      return res.status(200).json({ user });
    }

    if (action === "set-email") {
      const me = await auth.sessionUser(req);
      if (!me) return res.status(401).json({ error: "Prisijunk iš naujo" });
      const email = typeof req.body.email === "string" ? req.body.email.trim().slice(0, 120) : "";
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Neteisingas el. pašto adresas" });
      }
      const user = store.parse(await store.cmd("HGET", "users", me.id)) || { name: me.name };
      user.email = email;
      await store.cmd("HSET", "users", me.id, JSON.stringify(user));
      return res.status(200).json({ email });
    }

    if (action === "logout") {
      const token = auth.tokenFrom(req);
      if (token) await store.cmd("DEL", `sess:${token}`);
      return res.status(200).json({ ok: true });
    }

    if (action === "register") {
      if (!auth.codeOk(code)) return res.status(401).json({ error: "Neteisingas genties kodas" });
      if (badName) return res.status(400).json({ error: "Vardas turi būti 2–40 simbolių" });
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
      if (user && !user.hash) {
        return res.status(401).json({ error: "Ši paskyra naudoja prisijungimą su Google" });
      }
      if (!user || typeof password !== "string" || !auth.passwordMatches(password, user.salt, user.hash)) {
        return res.status(401).json({ error: "Neteisingas vardas arba slaptažodis" });
      }
      const token = await auth.createSession(id);
      return res.status(200).json({ token, user: { id, name: user.name, google: Boolean(user.google) } });
    }

    return res.status(400).json({ error: "Nežinomas veiksmas" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Nepavyko, pabandyk dar kartą" });
  }
};
