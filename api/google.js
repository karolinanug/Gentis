// Google prisijungimo grįžimo adresas (nukreipimo režimas).
// Google čia atsiunčia formą su `credential`; patikriname CSRF slapuką ir
// grąžiname narę į puslapį su ženklu adreso fragmente (#google=…).
// Pats ženklas tikrinamas /api/auth (action: "google" arba "link-google").
//
// Google Cloud Console → Clients → Authorized redirect URIs turi būti:
//   https://<tavo-adresas>/api/google

function cookie(req, name) {
  if (req.cookies && req.cookies[name]) return req.cookies[name];
  const match = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function redirect(res, location) {
  res.statusCode = 303;
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

module.exports = (req, res) => {
  if (req.method !== "POST") return redirect(res, "/");
  const body = req.body || {};
  const csrf = cookie(req, "g_csrf_token");
  if (!csrf || csrf !== body.g_csrf_token || typeof body.credential !== "string") {
    return redirect(res, "/#google-error");
  }
  return redirect(res, `/#google=${encodeURIComponent(body.credential)}`);
};
