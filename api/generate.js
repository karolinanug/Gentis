// Serverio funkcija (Vercel). Čia saugiai laikomas API raktas –
// jis niekada nepatenka į naršyklę.
//
// Reikalingi aplinkos kintamieji (Vercel → Settings → Environment Variables):
//   ANTHROPIC_API_KEY – tavo raktas iš platform.claude.com
//   GROUP_CODE        – slaptas būrelio kodas (kad svetimi nenaudotų tavo kreditų)
//   CLAUDE_MODEL      – (nebūtina) modelis, numatytasis: claude-haiku-5-5
//
// Režimai (body.mode): scenario (numatytasis), replace, topics, invite.
// Formatas (body.kind): pokalbis (numatytasis) arba veikla.

const { checkAccess } = require("../lib/auth");
const store = require("../lib/store");

const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-5-5";

const DEPTH_TEXT = {
  lengvas: "lengvi, žaismingi, juokingi klausimai – be jokio spaudimo atsiverti",
  vidutinis: "subalansuoti klausimai – dalis lengvų, dalis apmąstymų reikalaujančių",
  gilus: "gilūs, asmeniški, apmąstymų reikalaujantys klausimai, bet visada švelnūs ir be spaudimo",
  nostalgiskas: "nostalgiški, šilti klausimai apie prisiminimus, vaikystę, praeities akimirkas ir žmones",
  juokingas: "linksmi, šiek tiek kvailoki klausimai, skatinantys pasakoti juokingas istorijas ir nutikimus",
  svajingas: "svajingi klausimai apie norus, svajones ir „kas būtų, jeigu…“ – lengvi ir įkvepiantys",
};

const MONTHS = [
  "sausio", "vasario", "kovo", "balandžio", "gegužės", "birželio",
  "liepos", "rugpjūčio", "rugsėjo", "spalio", "lapkričio", "gruodžio",
];

function tone(depth) {
  return DEPTH_TEXT[depth] || DEPTH_TEXT.vidutinis;
}

function mainCount(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(10, Math.max(3, n)) : 6;
}

function activityCount(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(6, Math.max(1, n)) : 3;
}

function str(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function systemPrompt() {
  return [
    "Tu padedi draugių būrelio „Gentis“ vedančiajai pasiruošti susitikimui.",
    "Būrelis renkasi kas dvi savaites 18:30–21:30 (3 valandos) ir kalbasi arba užsiima veiklomis viena iš anksto pasirinkta tema.",
    "Kiekvienas susitikimas prasideda 3 minučių įsižeminimu.",
    "Rašai taisyklinga, gyva, šilta lietuvių kalba, kreipiesi į moteris.",
    "Klausimai turi būti atviri (ne taip/ne), konkretūs, skatinantys pasakoti istorijas.",
    "Venk banalybių ir kartojimosi. Kiekvienas klausimas – vienas sakinys, ne ilgesnis nei ~25 žodžiai.",
    "Veiklos turi būti įgyvendinamos namuose ar jaukioje erdvėje 4–12 moterų grupei, su paprastomis, lengvai gaunamomis priemonėmis.",
    "Atsakyk TIK galiojančiu JSON, be jokio papildomo teksto ir be ``` žymų.",
  ].join(" ");
}

function scenarioPrompt(topic, depth, count, avoid) {
  const avoidText = avoid.length
    ? `\nŠia tema būrelis jau kalbėjosi – nekartok šių klausimų ir nekurk labai panašių: ${JSON.stringify(avoid)}.\n`
    : "";
  return `Tema: "${topic}".
Tonas: ${tone(depth)}.
${avoidText}
Sukurk vakaro scenarijų tokiu JSON formatu:
{
  "intro": "1–2 sakinių įžanga, kurią vedančioji galėtų perskaityti garsiai",
  "warmup": ["2 lengvi apšilimo klausimai"],
  "main": ["pagrindiniai klausimai – tiksliai ${count}, nuo lengvesnių link gilesnių"],
  "closing": ["1 užbaigimo klausimas, kuris gražiai užbaigia vakarą"]
}`;
}

function activitiesPrompt(topic, depth, count, avoid) {
  const avoidText = avoid.length
    ? `\nŠia tema būrelis jau darė šias veiklas – nesiūlyk jų ir labai panašių: ${JSON.stringify(avoid)}.\n`
    : "";
  return `Tema: "${topic}".
Tonas: ${tone(depth)}.
${avoidText}
Šį kartą susitikimas – ne pokalbis, o veiklų vakaras. Sukurk tiksliai ${count} veiklas (-ų), susijusias su tema.
Visos veiklos kartu turi tilpti į maždaug 140 minučių (likęs laikas – įsižeminimui, įžangai, pertraukėlei ir užbaigimui).
Veiklos turi būti įvairios (pvz., kūrybinė, judesio, žaidimo, refleksijos), ne vien pokalbiai.

Atsakyk tokiu JSON formatu:
{
  "intro": "1–2 sakinių įžanga, kurią vedančioji galėtų perskaityti garsiai",
  "activities": [
    {
      "title": "trumpas veiklos pavadinimas (2–5 žodžiai)",
      "description": "2–4 sakiniai: kaip vedančioji praveda veiklą, žingsnis po žingsnio",
      "minutes": 30,
      "materials": "ko reikės (trumpai, kableliais) arba tuščia eilutė, jei nieko"
    }
  ],
  "closing": ["1 užbaigimo klausimas, padedantis pasidalinti, ką kiekviena išsinešė iš veiklų"]
}`;
}

function replaceActivityPrompt(topic, depth, current, existing) {
  return `Tema: "${topic}". Tonas: ${tone(depth)}.
Vedančiajai nepatiko ši veikla: "${current}".
Jau numatytos veiklos (nekartok jų): ${JSON.stringify(existing || [])}.
Pasiūlyk vieną naują, kitokią veiklą.
Formatas: {"activity": {"title": "...", "description": "2–4 sakiniai, kaip pravesti", "minutes": 30, "materials": "..."}}`;
}

function replacePrompt(topic, depth, section, current, existing) {
  const names = { warmup: "apšilimo", main: "pagrindinis", closing: "užbaigimo" };
  return `Tema: "${topic}". Tonas: ${tone(depth)}.
Vedančiajai nepatiko šis ${names[section] || ""} klausimas: "${current}".
Jau esami klausimai (nekartok jų): ${JSON.stringify(existing || [])}.
Pasiūlyk vieną naują, kitokį klausimą. Formatas: {"question": "..."}`;
}

function topicsPrompt(past, kind) {
  const now = new Date();
  const pastText = past.length
    ? `Šiomis temomis būrelis jau kalbėjosi – nesiūlyk jų ir labai panašių: ${JSON.stringify(past)}.`
    : "";
  return `Šiandien ${MONTHS[now.getMonth()]} ${now.getDate()} d.
${kind === "veikla"
    ? "Pasiūlyk 6 įvairias temas kitam būrelio VEIKLŲ vakarui (kūrybinėms, judesio, žaidimų ar kitoms bendroms veikloms, ne pokalbiui)."
    : "Pasiūlyk 6 įvairias temas kitam būrelio susitikimui-pokalbiui."} Dalis gali būti susijusios su metų laiku ar artėjančiomis šventėmis Lietuvoje, kitos – visai nesusijusios.
${pastText}
Tema – 1–4 žodžiai. Prie kiekvienos pridėk vieną trumpą sakinį, kodėl ji įdomi${kind === "veikla" ? " ir kokios veiklos galėtų būti" : ""}.
Formatas: {"topics": [{"title": "...", "why": "..."}]}`;
}

function invitePrompt(topic, details) {
  const lines = [
    `Tema: "${topic}"`,
    details.kind === "veikla" && "Tai veiklų vakaras (ne pokalbis) – kvietime tai paminėk",
    details.materials && `Ko reikės veikloms (jei tinka, paprašyk atsinešti): ${details.materials}`,
    details.date && `Data: ${details.date}`,
    details.time && `Laikas: ${details.time}`,
    details.place && `Vieta: ${details.place}`,
    details.note && `Vedančiosios pastaba (būtinai įtrauk): "${details.note}"`,
  ].filter(Boolean);
  return `Parašyk trumpą, šiltą kvietimą į būrelio susitikimą, kurį vedančioji nusiųs narėms per Messenger ar WhatsApp.
${lines.join("\n")}

3–6 sakiniai, gali būti 1–3 jaustukai. Būtinai paminėk datą, laiką ir vietą, jei jie nurodyti.
Neatskleisk konkrečių klausimų – tik sužadink smalsumą temai. Jei tinka, pasiūlyk ką nors apgalvoti ar atsinešti, susijusio su tema.
Formatas: {"message": "..."} (naujas eilutes žymėk \\n)`;
}

function parseJson(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function sameTopic(a, b) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

async function archive() {
  if (!store.enabled()) return [];
  try {
    return await store.archiveItems();
  } catch (err) {
    console.error(err);
    return [];
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Naudok POST" });
  }

  const body = req.body || {};

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Serveryje nenustatytas ANTHROPIC_API_KEY" });
  }
  if (!(await checkAccess(req))) {
    return res.status(401).json({ error: "Neteisingas genties kodas" });
  }

  const mode = body.mode || (body.replace ? "replace" : "scenario");
  const topic = str(body.topic, 200);
  if (mode !== "topics" && (!topic || topic.length > 120)) {
    return res.status(400).json({ error: "Įvesk temą (iki 120 simbolių)" });
  }

  let userContent;
  const kind = body.kind === "veikla" ? "veikla" : "pokalbis";

  if (mode === "topics") {
    const past = [...new Set((await archive()).map((i) => i.topic).filter(Boolean))].slice(0, 60);
    userContent = topicsPrompt(past, kind);
  } else if (mode === "invite") {
    userContent = invitePrompt(topic, {
      kind,
      materials: str(body.materials, 300),
      date: str(body.date, 60),
      time: str(body.time, 20),
      place: str(body.place, 120),
      note: str(body.note, 300),
    });
  } else if (mode === "replace") {
    const r = body.replace || {};
    userContent = r.section === "activities"
      ? replaceActivityPrompt(topic, body.depth, r.current, r.existing)
      : replacePrompt(topic, body.depth, r.section, r.current, r.existing);
  } else if (kind === "veikla") {
    const avoid = (await archive())
      .filter((i) => typeof i.topic === "string" && sameTopic(i.topic, topic))
      .flatMap((i) => ((i.scenario && i.scenario.activities) || []).map((a) => a.title))
      .slice(0, 40);
    userContent = activitiesPrompt(topic, body.depth, activityCount(body.count), avoid);
  } else {
    const avoid = (await archive())
      .filter((i) => typeof i.topic === "string" && sameTopic(i.topic, topic))
      .flatMap((i) => ["warmup", "main", "closing"].flatMap((k) => (i.scenario && i.scenario[k]) || []))
      .slice(0, 60);
    userContent = scenarioPrompt(topic, body.depth, mainCount(body.count), avoid);
  }

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
        max_tokens: 3000,
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
    try {
      return res.status(200).json(parseJson(text));
    } catch (parseErr) {
      console.error("Nepavyko perskaityti JSON. stop_reason:", data.stop_reason, "Tekstas:", text);
      return res.status(502).json({ error: "AI atsakymas netinkamo formato, pabandyk dar kartą" });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Nepavyko sugeneruoti, pabandyk dar kartą" });
  }
};
