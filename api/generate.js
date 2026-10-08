// Serverio funkcija (Vercel). Čia saugiai laikomas API raktas –
// jis niekada nepatenka į naršyklę.
//
// Reikalingi aplinkos kintamieji (Vercel → Settings → Environment Variables):
//   ANTHROPIC_API_KEY – tavo raktas iš platform.claude.com
//   GROUP_CODE        – slaptas būrelio kodas (kad svetimi nenaudotų tavo kreditų)
//   CLAUDE_MODEL      – (nebūtina) modelis, numatytasis: claude-haiku-5-5

const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-5-5";

const DEPTH_TEXT = {
  lengvas: "lengvi, žaismingi, juokingi klausimai – be jokio spaudimo atsiverti",
  vidutinis: "subalansuoti klausimai – dalis lengvų, dalis apmąstymų reikalaujančių",
  gilus: "gilūs, asmeniški, apmąstymų reikalaujantys klausimai, bet visada švelnūs ir be spaudimo",
};

function systemPrompt() {
  return [
    "Tu padedi draugių būrelio vedančiajai pasiruošti susitikimui.",
    "Būrelis renkasi kas dvi savaites ir kalbasi viena iš anksto pasirinkta tema.",
    "Rašai taisyklinga, gyva, šilta lietuvių kalba, kreipiesi į moteris.",
    "Klausimai turi būti atviri (ne taip/ne), konkretūs, skatinantys pasakoti istorijas.",
    "Venk banalybių ir kartojimosi. Kiekvienas klausimas – vienas sakinys, ne ilgesnis nei ~25 žodžiai.",
    "Atsakyk TIK galiojančiu JSON, be jokio papildomo teksto ir be ``` žymų.",
  ].join(" ");
}

function scenarioPrompt(topic, depth) {
  return `Tema: "${topic}".
Tonas: ${DEPTH_TEXT[depth] || DEPTH_TEXT.vidutinis}.

Sukurk vakaro scenarijų tokiu JSON formatu:
{
  "intro": "1–2 sakinių įžanga, kurią vedančioji galėtų perskaityti garsiai",
  "warmup": ["2 lengvi apšilimo klausimai"],
  "main": ["6 pagrindiniai klausimai, nuo lengvesnių link gilesnių"],
  "closing": ["1 užbaigimo klausimas, kuris gražiai užbaigia vakarą"]
}`;
}

function replacePrompt(topic, depth, section, current, existing) {
  const names = { warmup: "apšilimo", main: "pagrindinis", closing: "užbaigimo" };
  return `Tema: "${topic}". Tonas: ${DEPTH_TEXT[depth] || DEPTH_TEXT.vidutinis}.
Vedančiajai nepatiko šis ${names[section] || ""} klausimas: "${current}".
Jau esami klausimai (nekartok jų): ${JSON.stringify(existing || [])}.
Pasiūlyk vieną naują, kitokį klausimą. Formatas: {"question": "..."}`;
}

function parseJson(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(cleaned.slice(start, end + 1));
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Naudok POST" });
  }

  const { code, topic, depth, replace } = req.body || {};

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Serveryje nenustatytas ANTHROPIC_API_KEY" });
  }
  if (!process.env.GROUP_CODE || code !== process.env.GROUP_CODE) {
    return res.status(401).json({ error: "Neteisingas būrelio kodas" });
  }
  if (!topic || typeof topic !== "string" || topic.length > 120) {
    return res.status(400).json({ error: "Įvesk temą (iki 120 simbolių)" });
  }

  const userContent = replace
    ? replacePrompt(topic, depth, replace.section, replace.current, replace.existing)
    : scenarioPrompt(topic, depth);

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        system: systemPrompt(),
        messages: [{ role: "user", content: userContent }],
      }),
    });

    const data = await apiRes.json();
    if (!apiRes.ok) {
      console.error("Claude API klaida:", data);
      return res.status(502).json({ error: "AI šiuo metu neatsako, pabandyk dar kartą" });
    }

    const text = (data.content || []).map((b) => b.text || "").join("");
    return res.status(200).json(parseJson(text));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Nepavyko sugeneruoti, pabandyk dar kartą" });
  }
};
