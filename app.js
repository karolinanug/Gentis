"use strict";

// ---------- Pagalbinės funkcijos ----------

const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
}

// Narės ratukas: Google nuotrauka arba pirmoji vardo raidė
const AVATAR_COLORS = ["#b5654a", "#7a8f5a", "#5f7fa3", "#a3708f", "#c08a3e", "#6f8f8a"];
function avatar(name, picture, size = 36) {
  const letter = (name || "?").trim().charAt(0).toUpperCase();
  const color = AVATAR_COLORS[[...(name || "")].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  const el = h("span", { class: "avatar", style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;background:${color}`, title: name || "" }, letter);
  if (picture) {
    const img = h("img", { src: picture, alt: "", referrerpolicy: "no-referrer", loading: "lazy" });
    img.onerror = () => img.remove();
    el.append(img);
  }
  return el;
}

const ls = {
  get(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  },
  set(k, v) {
    try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {}
  },
};

const pad = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const today = () => isoDate(new Date());
const fmtDate = (s) => {
  if (!s) return "";
  const text = parseIso(s).toLocaleDateString("lt-LT", { month: "long", day: "numeric", weekday: "long" });
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const fmtClock = (sec) => `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
const fmtMinutes = (m) => (m >= 60 ? `${Math.floor(m / 60)} val. ${m % 60} min.` : `${m} min.`);

// ---------- Nustatymai ----------

const DEPTHS = [
  ["lengvas", "Lengvas"],
  ["vidutinis", "Vidutinis"],
  ["gilus", "Gilus"],
  ["nostalgiskas", "Nostalgiškas"],
];
// Seni tonai (archyve) – kaip juos rodyti
const OLD_DEPTHS = { juokingas: "Juokingas", svajingas: "Svajingas" };
const KINDS = [
  ["pokalbis", "💬 Pokalbis"],
  ["veikla", "🎨 Veiklos"],
];
const COUNTS = { pokalbis: [4, 6, 8, 10], veikla: [2, 3, 4, 5] };
const DEFAULT_COUNT = { pokalbis: 6, veikla: 3 };
const COUNT_LABEL = { pokalbis: "Klausimų skaičius", veikla: "Veiklų skaičius" };
// Susitikimai visada 18:30–21:30
const MEETING_START = "18:30";
const MEETING_MINUTES = 180;
const GROUNDING = {
  minutes: 3,
  text: "Atsisėskime patogiai ir užsimerkime. Giliai įkvėpkime per nosį ir lėtai iškvėpkime – tris kartus. Pajuskime, kaip pėdos remiasi į žemę, ir palikime dienos rūpesčius už durų.",
};
// Kiekvieno susitikimo pradžia: įsižeminimas ir du pasisakymų ratai
// Kiekvieno susitikimo pabaiga: uždarantis ratas
const CLOSING_ROUND = { key: "roundEnd", questions: ["Kaip jaučiuosi dabar?", "Ką išsinešu iš šio susitikimo?"], minutes: 15 };
const ROUNDS = [
  { key: "round1", questions: ["Kaip šiandien jaučiuosi?", "Kas įvyko nuo praeito susitikimo?", "Ko tikiuosi iš šiandienos susitikimo?"], minutes: 20 },
  { key: "round2", questions: ["Jei dirbčiau vidinį darbą, kokia tema kalbėčiau?"], minutes: 10 },
];
const MONTHS_FULL = ["Sausis", "Vasaris", "Kovas", "Balandis", "Gegužė", "Birželis", "Liepa", "Rugpjūtis", "Rugsėjis", "Spalis", "Lapkritis", "Gruodis"];
// Seni scenarijai turėjo apšilimą ir užbaigimą; dabar klausimai – viename sąraše („main“)
const SECTIONS = [
  ["warmup", "Apšilimas"],
  ["main", "Klausimai"],
  ["closing", "Užbaigimas"],
];
const DEFAULT_TIMING = { main: 10, round1: 20, round2: 10, roundEnd: 15 };
const DEFAULT_ACTIVITY_TIMING = { round1: 20, round2: 10, roundEnd: 15 };
const roundMinutes = (d, r) => (d.timing && d.timing[r.key] != null ? Number(d.timing[r.key]) || 0 : r.minutes);

const kindOf = (d) => (d && d.kind === "veikla" ? "veikla" : "pokalbis");
const selectedKind = () => ($("input[name=kind]:checked") || {}).value || "pokalbis";
const sectionsFor = (d) => (kindOf(d) === "veikla" ? [] : [["main", "Klausimai"]]);

// Pokalbio klausimus sujungia į vieną sąrašą (seniems scenarijams)
function normalize(d) {
  if (!d || !d.scenario || kindOf(d) === "veikla") return d;
  const s = d.scenario;
  if ((s.warmup || []).length || (s.closing || []).length) {
    s.main = [...(s.warmup || []), ...(s.main || []), ...(s.closing || [])];
    s.warmup = [];
    s.closing = [];
  }
  return d;
}

function endTime(start) {
  const [hh, mm] = (start || MEETING_START).split(":").map(Number);
  const total = hh * 60 + mm + MEETING_MINUTES;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

const state = {
  code: ls.get("burelioKodas") || "",
  token: ls.get("sesija") || "",
  me: null,
  draft: null, // kiekvienos narės juodraštis atskiras – žr. loadDraft()
  archive: null,
  calendar: null,
  meeting: null,
  calStatus: "",
  googleClientId: null,
};

const draftKey = () => `juodrastis:${state.me ? state.me.id : ""}`;

function saveDraft() {
  if (!state.me) return;
  ls.set(draftKey(), state.draft ? JSON.stringify(state.draft) : null);
}

function clearDraft() {
  state.draft = null;
  saveDraft();
  $("#topic").value = "";
  renderResult();
}

function loadDraft() {
  // Senas bendras juodraštis (iki atskirų juodraščių) – nežinia, kieno, todėl išmetamas
  ls.set("juodrastis", null);
  state.notice = "";
  try { state.draft = normalize(JSON.parse(ls.get(draftKey()))); } catch (e) { state.draft = null; }
  $("#topic").value = state.draft ? state.draft.topic || "" : "";
  $("#suggestions").hidden = true;
  showError("");
  renderChips();
  renderResult();
}

const hasAccess = () => Boolean(state.me || state.code);

async function api(path, { method = "POST", body } = {}) {
  const headers = { "content-type": "application/json" };
  if (state.code) headers["x-group-code"] = state.code;
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    const err = new Error(data.error || "Kažkas nepavyko, pabandyk dar kartą");
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- Skirtukai ----------

function showTab() {
  const tab = location.hash.slice(1) || "scenarijus";
  for (const sec of document.querySelectorAll(".tab")) sec.hidden = sec.id !== `tab-${tab}`;
  for (const a of document.querySelectorAll(".tabs a")) {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  if (tab === "archyvas") renderArchive();
  if (tab === "kalendorius") renderCalendar();
}

// ---------- Scenarijaus forma ----------

function chipGroup(root, name, options, selected) {
  root.replaceChildren(
    ...options.map(([value, label]) => {
      const id = `${name}-${value}`;
      return [
        h("input", { type: "radio", name, id, value, checked: String(value) === String(selected) }),
        h("label", { for: id, text: label }),
      ];
    }).flat()
  );
}

function renderChips() {
  const kind = kindOf(state.draft);
  chipGroup($("#kinds"), "kind", KINDS, kind);
  const depth = DEPTHS.some(([v]) => v === state.draft?.depth) ? state.draft.depth : "vidutinis";
  chipGroup($("#depths"), "depth", DEPTHS, depth);
  renderCounts(kind, state.draft?.count);
}

function renderCounts(kind, selected) {
  const options = COUNTS[kind];
  const value = options.includes(Number(selected)) ? selected : DEFAULT_COUNT[kind];
  chipGroup($("#counts"), "count", options.map((n) => [n, String(n)]), value);
  $("#count-label").textContent = COUNT_LABEL[kind];
}
function updateCodeField() {
  $("#code-field").hidden = Boolean(state.me);
}

function showError(msg) {
  $("#error").textContent = msg || "";
  $("#error").hidden = !msg;
}

function rememberCode() {
  if (state.me) return true;
  const code = $("#code").value.trim();
  if (!code) {
    showError("Įvesk genties kodą");
    $("#code").focus();
    return false;
  }
  state.code = code;
  ls.set("burelioKodas", code);
  return true;
}

function checkTopicUsed() {
  const note = $("#topic-note");
  const topic = $("#topic").value.trim().toLowerCase();
  const used = topic && (state.archive || []).filter((i) => i.topic && i.topic.trim().toLowerCase() === topic);
  if (used && used.length) {
    note.textContent = `Šia tema jau buvote susitikusios: ${used.map((i) => fmtDate(i.date)).join("; ")}. Klausimai ir veiklos nesikartos.`;
    note.hidden = false;
  } else {
    note.hidden = true;
  }
}

async function suggestTopics() {
  showError("");
  if (!rememberCode()) return;
  const btn = $("#suggest");
  const box = $("#suggestions");
  btn.disabled = true;
  btn.textContent = "Galvojama…";
  try {
    const { topics = [] } = await api("/api/generate", { body: { mode: "topics", kind: selectedKind() } });
    box.replaceChildren(
      ...topics.map((t) =>
        h("button", {
          type: "button",
          class: "suggestion",
          onclick: () => {
            $("#topic").value = t.title;
            box.hidden = true;
            checkTopicUsed();
          },
        }, h("strong", { text: t.title }), h("span", { text: t.why || "" }))
      )
    );
    box.hidden = !topics.length;
  } catch (e) {
    showError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ Pasiūlyk temų";
  }
}

// Susitikimo data: ta, kuri patvirtinta kalendoriuje (balsavimu ar ranka)
function meetingDate() {
  return state.meeting?.date || "";
}

// Nupieštas katinėlis (žiūri į dešinę). Kojos, uodega ir kūnas animuojami CSS.
const CAT_SVG = `
<svg viewBox="0 0 64 42" width="58" height="38" xmlns="http://www.w3.org/2000/svg">
  <g class="cat-bob">
    <path class="cat-tail" d="M16 19 C 9 18, 5 13, 6 5" fill="none" stroke="#c8743f" stroke-width="4" stroke-linecap="round"/>
    <g stroke-linecap="round" stroke-width="4">
      <line class="leg leg-far leg-b" x1="20" y1="22" x2="20" y2="34" stroke="#a85f33"/>
      <line class="leg leg-far leg-a" x1="41" y1="22" x2="41" y2="34" stroke="#a85f33"/>
    </g>
    <ellipse cx="30" cy="20" rx="16" ry="8.5" fill="#d9894f"/>
    <path d="M24 12.5 q1.5 4 0 8 M30 11.8 q1.5 4 0 8.5 M36 12.5 q1.5 4 0 8" fill="none" stroke="#b5683a" stroke-width="1.6" stroke-linecap="round"/>
    <g stroke-linecap="round" stroke-width="4">
      <line class="leg leg-a" x1="18" y1="23" x2="18" y2="35" stroke="#d9894f"/>
      <line class="leg leg-b" x1="39" y1="23" x2="39" y2="35" stroke="#d9894f"/>
    </g>
    <path d="M42 9 L44 1.5 L48.5 7.5 Z" fill="#c8743f"/>
    <path d="M50 7.5 L54.5 1.5 L55.5 9.5 Z" fill="#c8743f"/>
    <circle cx="49" cy="14" r="8.5" fill="#d9894f"/>
    <path d="M44.5 4.5 L45 7.5 L47 6.5 Z M52.5 6.8 L54 4 L54.4 7.8 Z" fill="#f0b9a0"/>
    <ellipse class="cat-eye" cx="52" cy="12.5" rx="1.3" ry="1.6" fill="#2e2622"/>
    <path d="M56.2 15.2 l1.6 -0.6 l-0.4 1.5 Z" fill="#e58a8a"/>
    <path d="M55 17.5 q1.5 1 3 0" fill="none" stroke="#2e2622" stroke-width="0.9" stroke-linecap="round"/>
    <path d="M57 15.5 l5 -1 M57 16.5 l5 0.8" stroke="#f7f1ea" stroke-width="0.7" stroke-linecap="round"/>
  </g>
</svg>`;

// Katinėlis, bėgantis įkrovimo juosta
function catLoader(text) {
  const fill = h("span", { class: "cat-fill" });
  const cat = h("span", { class: "cat", "aria-hidden": "true" });
  cat.innerHTML = CAT_SVG;
  const el = h("div", { class: "cat-loader", role: "status" },
    h("p", { class: "cat-text", text }),
    h("div", { class: "cat-track" }, fill, cat)
  );
  const set = (v) => { fill.style.width = `${v}%`; cat.style.left = `${v}%`; };
  const started = Date.now();
  const timer = setInterval(() => set(92 * (1 - Math.exp(-(Date.now() - started) / 7000))), 150);
  set(0);
  el.finish = () => new Promise((resolve) => { clearInterval(timer); set(100); setTimeout(resolve, 450); });
  el.stop = () => clearInterval(timer);
  return el;
}

async function generate(ev) {
  ev.preventDefault();
  showError("");
  if (!rememberCode()) return;
  const topic = $("#topic").value.trim();
  const kind = selectedKind();
  const depth = $("input[name=depth]:checked").value;
  const count = Number($("input[name=count]:checked").value);
  const btn = $("#go");
  const loader = catLoader("Kuriama");
  btn.hidden = true;
  btn.after(loader);
  try {
    const scenario = await api("/api/generate", { body: { mode: "scenario", kind, topic, depth, count } });
    await loader.finish();
    const prev = state.draft;
    const defaults = kind === "veikla" ? DEFAULT_ACTIVITY_TIMING : DEFAULT_TIMING;
    if (kind === "veikla") {
      scenario.activities = (scenario.activities || []).map((a) => ({ ...a, minutes: Number(a.minutes) || 30 }));
    }
    state.notice = "";
    state.draft = normalize({
      stage: "review",
      kind,
      topic,
      depth,
      count,
      scenario,
      timing: prev?.timing && kindOf(prev) === kind ? { ...defaults, ...prev.timing } : { ...defaults },
      date: meetingDate(),
    });
    saveDraft();
    renderResult();
    $("#result").scrollIntoView({ behavior: "smooth" });
    if (!state.archive) loadArchive().catch(() => {});
  } catch (e) {
    loader.stop();
    showError(e.message);
  } finally {
    loader.remove();
    btn.hidden = false;
  }
}

// ---------- Scenarijaus eiga: peržiūra → nustatymai → paruošta ----------

function editable(tag, props, text, onchange) {
  return h(tag, {
    ...props,
    contenteditable: "true",
    text,
    oninput: (e) => { onchange(e.currentTarget.textContent); saveDraft(); },
    onblur: (e) => { onchange(e.currentTarget.textContent.trim()); saveDraft(); },
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } },
  });
}

const STAGES = [["review", "Klausimai"], ["config", "Nustatymai"], ["ready", "Paruošta"]];

function stepper(stage) {
  const idx = STAGES.findIndex(([k]) => k === stage);
  return h("ol", { class: "stepper" }, STAGES.map(([k, label], i) =>
    h("li", { class: [i < idx && "done", i === idx && "now"].filter(Boolean).join(" ") },
      h("span", { class: "step-dot", text: i < idx ? "✓" : String(i + 1) }),
      h("span", { text: label })
    )
  ));
}

function setStage(stage) {
  state.draft.stage = stage;
  saveDraft();
  renderResult();
  $("#result").scrollIntoView({ behavior: "smooth" });
}

function renderResult() {
  const root = $("#result");
  const d = state.draft;
  const stage = d ? d.stage || "review" : null;
  // Kol scenarijus peržiūrimas, forma lieka (galima kurti iš naujo); vėliau – paslepiama
  $("#form").hidden = Boolean(d && stage !== "review");
  if (!d || !d.scenario) {
    root.replaceChildren(...(state.notice ? [h("div", { class: "card notice", text: state.notice })] : []));
    return;
  }
  const kindLabel = kindOf(d) === "veikla" ? "veiklos" : "klausimai";
  const body = stage === "config" ? renderConfig(d) : stage === "ready" ? renderReady(d) : renderReview(d, kindLabel);
  root.replaceChildren(...[stepper(stage), body].flat(Infinity).filter(Boolean));
}

function contentBlocks(d) {
  const s = d.scenario;
  const sections = sectionsFor(d).map(([key, title]) => {
    const list = s[key] || [];
    if (!list.length) return null;
    return [
      h("h2", { text: title }),
      h("ol", {}, list.map((q, i) =>
        h("li", {},
          editable("span", {}, q, (v) => { list[i] = v; }),
          h("button", { class: "swap", type: "button", text: "Kitas", onclick: (e) => swap(key, i, e.currentTarget) })
        )
      )),
    ];
  });
  return [kindOf(d) === "veikla" ? activitiesBlock(d) : null, sections];
}

// Nekeičiama kiekvieno susitikimo pradžia ir pabaiga
function openingBlock() {
  return h("div", { class: "opening" },
    h("p", { class: "label", text: "Vakaro pradžia (kiekvieną kartą)" }),
    h("ol", { class: "opening-list" },
      h("li", { class: "plain" }, h("span", {}, h("strong", { text: "Įsižeminimas" }), ` · ${GROUNDING.minutes} min.`)),
      ROUNDS.map((r, i) => h("li", { class: "plain" }, h("span", {}, h("strong", { text: `${i + 1} ratas: ` }), r.questions.join(" ")))),
    )
  );
}

function closingBlock() {
  return h("div", { class: "opening" },
    h("p", { class: "label", text: "Vakaro pabaiga (kiekvieną kartą)" }),
    h("ol", { class: "opening-list" },
      h("li", { class: "plain" }, h("span", {}, h("strong", { text: "Uždarantis ratas: " }), CLOSING_ROUND.questions.join(" ")))
    )
  );
}

function renderReview(d, kindLabel) {
  return [
    h("h2", { text: d.topic }),
    openingBlock(),
    h("p", { class: "hint", text: "Spustelk ant bet kurio teksto, kad jį pataisytum savais žodžiais, arba spausk „Kitas“." }),
    editable("p", { class: "intro" }, d.scenario.intro || "", (v) => { d.scenario.intro = v; }),
    contentBlocks(d),
    closingBlock(),
    h("div", { class: "actions" },
      h("button", { class: "primary small", type: "button", text: `✓ ${kindLabel === "veiklos" ? "Veiklos" : "Klausimai"} tinka`, onclick: () => setStage("config") }),
      newScenarioButton()
    ),
  ];
}

function activitiesBlock(d) {
  const list = d.scenario.activities || [];
  return [
    h("h2", { text: "Veiklos" }),
    list.map((a, i) =>
      h("div", { class: "activity" },
        h("div", { class: "activity-head" },
          h("span", { class: "activity-num", text: `${i + 1}.` }),
          editable("h3", {}, a.title || "", (v) => { a.title = v; }),
          h("button", { class: "swap", type: "button", text: "Kita", onclick: (e) => swap("activities", i, e.currentTarget) })
        ),
        editable("p", { class: "activity-desc" }, a.description || "", (v) => { a.description = v; }),
        h("div", { class: "activity-meta" },
          h("span", { class: "hint", style: "margin:0", text: `~${a.minutes || 0} min. · Reikės:` }),
          editable("span", { class: "materials" }, a.materials || "—", (v) => { a.materials = v === "—" ? "" : v; })
        )
      )
    ),
  ];
}

async function swap(section, index, btn) {
  const d = state.draft;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const isActivity = section === "activities";
    const existing = isActivity
      ? (d.scenario.activities || []).map((a) => a.title)
      : SECTIONS.flatMap(([k]) => d.scenario[k] || []);
    const current = isActivity ? d.scenario.activities[index].title : d.scenario[section][index];
    const data = await api("/api/generate", {
      body: { mode: "replace", kind: kindOf(d), topic: d.topic, depth: d.depth, replace: { section, current, existing } },
    });
    if (isActivity) {
      if (!data.activity || !data.activity.title) throw new Error("Nepavyko gauti naujos veiklos");
      d.scenario.activities[index] = { ...data.activity, minutes: Number(data.activity.minutes) || 30 };
    } else {
      if (!data.question) throw new Error("Nepavyko gauti naujo klausimo");
      d.scenario[section][index] = data.question;
    }
    saveDraft();
    renderResult();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = label;
    alert(e.message);
  }
}

// Kiek minučių suplanuota (su įsižeminimu)
function planMinutes(d) {
  const t = d.timing || {};
  let mins = GROUNDING.minutes + [...ROUNDS, CLOSING_ROUND].reduce((sum, r) => sum + roundMinutes(d, r), 0);
  if (kindOf(d) === "veikla") {
    mins += (d.scenario.activities || []).reduce((sum, a) => sum + (Number(a.minutes) || 0), 0);
  } else {
    mins += SECTIONS.reduce((sum, [k]) => sum + (d.scenario[k] || []).length * (Number(t[k]) || 0), 0);
  }
  return mins;
}

function dateLine(d) {
  return d.date
    ? `📅 ${fmtDate(d.date)}, ${MEETING_START}–${endTime(MEETING_START)}`
    : "📅 Data dar nenubalsuota – kai bus patvirtinta kalendoriuje, atsiras čia automatiškai.";
}

function renderConfig(d) {
  const veikla = kindOf(d) === "veikla";
  d.timing = d.timing || { ...(veikla ? DEFAULT_ACTIVITY_TIMING : DEFAULT_TIMING) };
  if (!d.date && meetingDate()) d.date = meetingDate();
  const total = h("p", { class: "hint" });
  const update = () => {
    const mins = planMinutes(d);
    const left = MEETING_MINUTES - mins;
    total.textContent =
      `Suplanuota ${fmtMinutes(mins)} iš 3 val., įskaitant įsižeminimą ir ratus. ` +
      (left >= 0 ? `Laisvo laiko lieka ${fmtMinutes(left)}` : `Viršyta ${fmtMinutes(-left)}`);
    total.classList.toggle("over-plan", left < 0);
  };
  const number = (value, onInput, max = 60) => h("input", {
    type: "number", min: "0", max: String(max), inputmode: "numeric", value: value ?? 0,
    oninput: (e) => { onInput(Math.max(0, Math.min(max, Number(e.target.value) || 0))); saveDraft(); update(); },
  });
  update();

  const confirmBtn = h("button", { class: "primary small", type: "button", text: "✓ Patvirtinti" });
  confirmBtn.onclick = () => confirmPlan(confirmBtn);

  const roundRow = (r, i) => h("label", { class: "mini inline-row" },
    h("span", { text: `${i + 1} ratas: ${r.questions[0]}${r.questions.length > 1 ? " …" : ""}` }),
    number(roundMinutes(d, r), (v) => { d.timing[r.key] = v; }, 90)
  );
  return h("div", { class: "card" },
    h("h2", { text: d.topic }),
    h("p", { class: "meeting-line", text: dateLine(d) }),
    h("p", { class: "label", style: "margin-top:16px", text: "Vakaro pradžia (min.)" }),
    h("div", { class: "mini inline-row" }, h("span", { text: "Įsižeminimas" }), h("span", { class: "fixed-min", text: String(GROUNDING.minutes) })),
    ROUNDS.map(roundRow),
    veikla
      ? [
          h("p", { class: "label", style: "margin-top:16px", text: "Veiklų trukmė (min.)" }),
          (d.scenario.activities || []).map((a) =>
            h("label", { class: "mini inline-row" }, h("span", { text: a.title }), number(a.minutes, (v) => { a.minutes = v; }, 180))
          ),
        ]
      : [
          h("label", { class: "mini inline-row", style: "margin-top:16px" },
            h("span", { class: "label", style: "margin:0", text: "Vieno klausimo trukmė (min.)" }),
            number(d.timing.main, (v) => { d.timing.main = v; })
          ),
        ],
    h("p", { class: "label", style: "margin-top:16px", text: "Vakaro pabaiga (min.)" }),
    h("label", { class: "mini inline-row" },
      h("span", { text: `Uždarantis ratas: ${CLOSING_ROUND.questions.join(" ")}` }),
      number(roundMinutes(d, CLOSING_ROUND), (v) => { d.timing[CLOSING_ROUND.key] = v; }, 90)
    ),
    total,
    h("div", { class: "actions" },
      h("button", { class: "secondary", type: "button", text: `← Atgal prie ${veikla ? "veiklų" : "klausimų"}`, onclick: () => setStage("review") }),
      confirmBtn
    )
  );
}

const entryOf = (d, status) => ({
  id: d.id, status, kind: kindOf(d), date: d.date || "", topic: d.topic, depth: d.depth, count: d.count, scenario: d.scenario, timing: d.timing,
});

async function confirmPlan(btn) {
  const d = state.draft;
  btn.disabled = true;
  btn.textContent = "Saugoma…";
  try {
    const { item } = await api("/api/archive", { body: { entry: entryOf(d, "planned") } });
    d.id = item.id;
    d.revealed = item.revealed;
    setStage("ready");
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "✓ Patvirtinti";
    alert(e.message);
  }
}

// Suplanuotą susitikimą tyliai atnaujina serveryje (pvz., kai paaiškėja data)
function syncPlan() {
  const d = state.draft;
  if (d && d.id && d.stage === "ready") api("/api/archive", { body: { entry: entryOf(d, "planned") } }).catch(() => {});
}

function renderReady(d) {
  const count = kindOf(d) === "veikla"
    ? `${(d.scenario.activities || []).length} veiklos`
    : `${SECTIONS.reduce((n, [k]) => n + (d.scenario[k] || []).length, 0)} klausimai`;
  const preview = h("details", { class: "preview" },
    h("summary", { text: "Peržiūrėti programą" }),
    openingBlock(),
    d.scenario.intro ? h("p", { class: "hint", style: "font-style:italic", text: d.scenario.intro }) : null,
    (d.scenario.activities || []).length
      ? [h("h3", { text: "Veiklos" }), h("ol", {}, d.scenario.activities.map((a) => h("li", { class: "plain", text: `${a.title} (${a.minutes || 0} min.)` })))]
      : null,
    sectionsFor(d).map(([k, title]) => (d.scenario[k] || []).length
      ? [h("h3", { text: title }), h("ol", {}, d.scenario[k].map((q) => h("li", { class: "plain", text: q })))]
      : null),
    closingBlock()
  );
  return [
    h("div", { class: "card ready" },
      h("p", { class: "label", text: kindOf(d) === "veikla" ? "🎨 Veiklų vakaras" : "💬 Pokalbis" }),
      h("h2", { text: d.topic }),
      h("p", { class: "meeting-line", text: dateLine(d) }),
      h("p", { class: "hint", text: `${count} · planas ${fmtMinutes(planMinutes(d))}` }),
      h("p", { class: "topic-state", text: d.revealed ? "📣 Tema paskelbta narėms" : "🤫 Tema kol kas paslaptis" }),
      h("div", { class: "actions" },
        h("button", { class: "primary small", type: "button", text: "▶ Pradėti susitikimą", onclick: openHost }),
        revealButton(d),
        h("button", { class: "secondary", type: "button", text: "✉ Kvietimas narėms", onclick: toggleInvite })
      ),
      h("div", { id: "invite" }),
      preview,
      h("div", { class: "actions subtle" },
        h("button", { class: "link", type: "button", text: "✏️ Redaguoti", onclick: () => setStage("review") }),
        newScenarioButton()
      )
    ),
  ];
}

function newScenarioButton() {
  return h("button", {
    class: "link",
    type: "button",
    text: "Naujas scenarijus",
    onclick: async () => {
      const d = state.draft;
      const planned = d && d.id;
      if (!confirm(planned ? "Pradėti naują scenarijų? Šis suplanuotas susitikimas bus ištrintas." : "Išvalyti šį scenarijų ir pradėti naują?")) return;
      if (planned) {
        try { await api(`/api/archive?id=${encodeURIComponent(d.id)}`, { method: "DELETE" }); } catch (e) {}
        if (state.archive) state.archive = state.archive.filter((i) => i.id !== d.id);
      }
      clearDraft();
      window.scrollTo(0, 0);
    },
  });
}

async function completeMeeting() {
  const d = state.draft;
  const { item } = await api("/api/archive", { body: { entry: { ...entryOf(d, "done"), date: d.date || today() } } });
  if (state.archive) state.archive = [item, ...state.archive.filter((i) => i.id !== item.id)];
  clearDraft();
  state.notice = `Susitikimas „${item.topic}“ išsaugotas archyve 💛`;
  renderResult();
}

// ---------- Kvietimo žinutė ----------

function toggleInvite() {
  const box = $("#invite");
  if (box.childElementCount) { box.replaceChildren(); return; }
  const d = state.draft;
  const m = state.meeting && state.meeting.date === d.date ? state.meeting : null;
  const time = h("input", { type: "time", value: m?.time || MEETING_START });
  const place = h("input", { type: "text", placeholder: "pvz., pas Rūtą, Vilniaus g. 5", value: m?.place || "" });
  const note = h("input", { type: "text", placeholder: "pvz., atsineškite po vaikystės nuotrauką" });
  const out = h("textarea", { rows: "8", hidden: true });
  const err = h("p", { class: "error", hidden: true });
  const copy = h("button", { class: "secondary", type: "button", text: "Kopijuoti žinutę", hidden: true });
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(out.value); copy.textContent = "Nukopijuota ✓"; } catch (e) { out.select(); }
    setTimeout(() => (copy.textContent = "Kopijuoti žinutę"), 2000);
  };
  const share = navigator.share
    ? h("button", { class: "secondary", type: "button", text: "Dalintis…", hidden: true, onclick: () => navigator.share({ text: out.value }).catch(() => {}) })
    : null;
  const go = h("button", { class: "primary small", type: "button", text: "Sukurti žinutę" });
  go.onclick = async () => {
    err.hidden = true;
    go.hidden = true;
    const loader = catLoader("Rašoma");
    go.after(loader);
    try {
      const { message } = await api("/api/generate", {
        body: {
          mode: "invite",
          kind: kindOf(d),
          topic: d.revealed ? d.topic : `${d.topic} (tema dar slapta – kvietime jos neminėk, tik užsimink, kad bus staigmena)`,
          date: d.date ? fmtDate(d.date) : "",
          time: time.value ? `${time.value}–${endTime(time.value)}` : "",
          place: place.value,
          note: note.value,
          materials: kindOf(d) === "veikla"
            ? (d.scenario.activities || []).map((a) => a.materials).filter(Boolean).join("; ")
            : "",
        },
      });
      await loader.finish();
      out.value = message || "";
      out.hidden = false;
      copy.hidden = false;
      if (share) share.hidden = false;
      go.textContent = "Sukurti kitą variantą";
    } catch (e) {
      loader.stop();
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      loader.remove();
      go.hidden = false;
    }
  };
  box.replaceChildren(
    h("div", { class: "invite-box" },
      h("p", { class: "hint", style: "margin:0 0 12px", text: d.revealed ? "Kvietime bus paminėta tema." : "Tema dar slapta – kvietime ji nebus atskleista." }),
      h("div", { class: "row" }, h("label", { class: "mini" }, "Pradžia", time), h("label", { class: "mini" }, "Vieta", place)),
      h("label", { class: "mini", style: "margin-top:10px" }, "Ką dar pridėti (nebūtina)", note),
      h("div", { class: "actions", style: "margin-top:14px" }, go),
      err,
      h("div", { style: "margin-top:14px" }, out),
      h("div", { class: "actions", style: "margin-top:10px" }, copy, share)
    )
  );
}

// ---------- Vedančiosios režimas ----------

const host = { slides: [], i: 0, elapsed: 0, total: 0, running: true, notified: false, timer: null, audio: null, lock: null, el: {} };

// Jei telefonas buvo priartinęs vaizdą, grąžina normalų mastelį
function resetZoom() {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const original = meta.getAttribute("content");
  meta.setAttribute("content", `${original}, maximum-scale=1`);
  setTimeout(() => meta.setAttribute("content", original), 400);
}

function openHost() {
  resetZoom();
  const d = state.draft;
  const s = d.scenario;
  const t = d.timing || {};
  host.slides = [
    { label: "Įsižeminimas", text: GROUNDING.text, min: GROUNDING.minutes, intro: true },
    ...ROUNDS.map((r, i) => ({
      label: `Pasisakymų ratas · ${i + 1}/${ROUNDS.length}`,
      text: r.questions.join("\n"),
      sub: "Kiekviena pasisako iš eilės.",
      min: roundMinutes(d, r),
    })),
    { label: "Įžanga", text: s.intro || d.topic, min: 0, intro: true },
  ];
  if (kindOf(d) === "veikla") {
    const acts = s.activities || [];
    acts.forEach((a, i) => host.slides.push({
      label: `Veikla · ${i + 1}/${acts.length}`,
      text: a.title,
      sub: [a.description, a.materials && `Reikės: ${a.materials}`].filter(Boolean).join("\n\n"),
      min: Number(a.minutes) || 0,
    }));
  }
  for (const [key, title] of sectionsFor(d)) {
    const list = s[key] || [];
    list.forEach((q, i) => host.slides.push({ label: `${title} · ${i + 1}/${list.length}`, text: q, min: Number(t[key]) || 0 }));
  }
  host.slides.push({
    label: "Uždarantis ratas",
    text: CLOSING_ROUND.questions.join("\n"),
    sub: "Kiekviena pasisako iš eilės.",
    min: roundMinutes(d, CLOSING_ROUND),
  });
  host.i = 0;
  host.total = 0;
  host.running = true;
  resetSlide();

  unlockSounds();
  if (navigator.wakeLock) navigator.wakeLock.request("screen").then((l) => (host.lock = l)).catch(() => {});

  const el = host.el;
  el.label = h("span", { class: "host-label" });
  el.total = h("span", {});
  el.q = h("p", { class: "host-q" });
  el.sub = h("p", { class: "host-sub" });
  el.notice = h("div", { class: "host-notice", hidden: true, text: "Laikas pereiti toliau" });
  el.bar = h("span", {});
  el.barWrap = h("div", { class: "bar" }, el.bar);
  el.clock = h("span", { class: "clock" });
  el.prev = h("button", { class: "secondary", type: "button", text: "← Atgal", onclick: () => move(-1) });
  el.pause = h("button", { class: "secondary", type: "button", onclick: togglePause });
  el.next = h("button", { class: "next", type: "button", onclick: () => move(1) });

  $("#host").replaceChildren(
    h("div", { class: "host-top" },
      el.label, el.total,
      soundButton(),
      h("button", { class: "host-close", type: "button", "aria-label": "Uždaryti", text: "✕", onclick: closeHost })
    ),
    h("div", { class: "host-body" }, h("div", {}, el.q, el.sub)),
    el.notice,
    h("div", { class: "host-timer" }, el.barWrap, el.clock),
    h("div", { class: "host-nav" }, el.prev, el.pause, el.next)
  );
  $("#host").hidden = false;
  document.body.classList.add("no-scroll");
  document.addEventListener("keydown", hostKeys);
  host.timer = setInterval(tick, 1000);
  renderHost();
}

// Paskutinė skaidrė: ar susitikimas įvyko? Tada – į archyvą
function showFinish() {
  clearInterval(host.timer);
  const err = h("p", { class: "error", hidden: true });
  const yes = h("button", { class: "next", type: "button", text: "✓ Taip, susitikimas įvyko" });
  yes.onclick = async () => {
    yes.disabled = true;
    yes.textContent = "Saugoma…";
    try {
      await completeMeeting();
      closeHost();
      location.hash = "#scenarijus";
      window.scrollTo(0, 0);
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      yes.disabled = false;
      yes.textContent = "✓ Taip, susitikimas įvyko";
    }
  };
  $("#host").replaceChildren(
    h("div", { class: "host-top" },
      h("span", { class: "host-label", text: "Pabaiga" }),
      h("span", { text: `Vakaras ${fmtClock(host.total)}` }),
      h("button", { class: "host-close", type: "button", "aria-label": "Uždaryti", text: "✕", onclick: closeHost })
    ),
    h("div", { class: "host-body" },
      h("div", { class: "finish" },
        h("p", { class: "host-q", text: "Ačiū už vakarą 💛" }),
        h("p", { class: "host-sub", text: "Ar susitikimas įvyko? Patvirtinus jis bus išsaugotas archyve, o tema ir klausimai atsivers visoms." }),
        h("div", { class: "finish-actions" },
          yes,
          h("button", { class: "secondary", type: "button", text: "Grįžti į susitikimą", onclick: () => { closeHost(); openHost(); host.i = host.slides.length - 1; renderHost(); } }),
          h("button", { class: "secondary", type: "button", text: "Uždaryti neišsaugant", onclick: closeHost })
        ),
        err
      )
    )
  );
}

function closeHost() {
  clearInterval(host.timer);
  document.removeEventListener("keydown", hostKeys);
  $("#host").hidden = true;
  document.body.classList.remove("no-scroll");
  if (host.lock) host.lock.release().catch(() => {});
  host.lock = null;

}

function hostKeys(e) {
  if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); move(1); }
  else if (e.key === "ArrowLeft") move(-1);
  else if (e.key === "Escape") closeHost();
}

function resetSlide() {
  host.elapsed = 0;
  host.notified = false;
}

function move(delta) {
  const n = host.i + delta;
  if (n >= host.slides.length) { showFinish(); return; }
  if (n < 0) return;
  host.i = n;
  resetSlide();
  renderHost();
}

function togglePause() {
  host.running = !host.running;
  renderClock();
}

function tick() {
  if (!host.running) return;
  host.elapsed++;
  host.total++;
  const slide = host.slides[host.i];
  if (slide.min) {
    const left = slide.min * 60 - host.elapsed;
    if (left > 0 && left <= 5) {
      playSound("tick"); // paskutinės 5 sekundės
    } else if (left === 0 && !host.notified) {
      host.notified = true;
      playSound("end");
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]);
    }
  }
  renderClock();
}

function renderHost() {
  const slide = host.slides[host.i];
  const el = host.el;
  el.label.textContent = slide.label;
  el.q.textContent = slide.text;
  el.q.classList.toggle("intro-slide", Boolean(slide.intro));
  el.sub.textContent = slide.sub || "";
  el.sub.hidden = !slide.sub;
  el.prev.disabled = host.i === 0;
  el.next.textContent = host.i === host.slides.length - 1 ? "Pabaiga" : "Toliau →";
  renderClock();
}

function renderClock() {
  const slide = host.slides[host.i];
  const el = host.el;
  el.total.textContent = `Vakaras ${fmtClock(host.total)}`;
  el.pause.textContent = host.running ? "Pauzė" : "Tęsti";
  if (slide.min) {
    const limit = slide.min * 60;
    const left = limit - host.elapsed;
    el.clock.textContent = left >= 0 ? fmtClock(left) : `+${fmtClock(-left)}`;
    el.clock.classList.toggle("over", left < 0);
    el.bar.style.width = `${Math.min(100, (host.elapsed / limit) * 100)}%`;
    el.barWrap.hidden = false;
  } else {
    el.clock.textContent = fmtClock(host.elapsed);
    el.clock.classList.remove("over");
    el.barWrap.hidden = true;
  }
  el.notice.hidden = !host.notified;
}

// ---------- Garsai ----------
// Naudojami <audio> elementai (ne Web Audio), nes iPhone juos groja patikimiau.
// Garsai sugeneruojami čia pat kaip WAV failai.

function makeWav(notes, gap = 0) {
  const rate = 22050;
  const parts = notes.map(([freq, dur]) => {
    const n = Math.floor(rate * dur);
    const out = new Float32Array(n + Math.floor(rate * gap));
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const env = Math.min(1, t / 0.01) * Math.exp(-3 * t / dur);
      out[i] = env * (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(4 * Math.PI * freq * t)) * 0.6;
    }
    return out;
  });
  const total = parts.reduce((a, p) => a + p.length, 0);
  const buf = new ArrayBuffer(44 + total * 2);
  const v = new DataView(buf);
  const str = (o, x) => [...x].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + total * 2, true); str(8, "WAVEfmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, total * 2, true);
  let o = 44;
  for (const p of parts) for (const x of p) { v.setInt16(o, Math.max(-1, Math.min(1, x)) * 32767, true); o += 2; }
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

const sounds = {};
let soundOn = ls.get("garsas") !== "off";

function unlockSounds() {
  // Leidžia grojant net kai iPhone begarsio režimo jungiklis įjungtas (Safari 17+)
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
  if (!sounds.tick) {
    sounds.tick = new Audio(makeWav([[880, 0.18]]));
    sounds.end = new Audio(makeWav([[659.25, 0.35], [783.99, 0.35], [1046.5, 0.9]]));
  }
  // Pirmas grojimas turi įvykti paspaudus mygtuką – tada telefonas leidžia groti ir vėliau
  for (const a of Object.values(sounds)) {
    a.muted = true;
    a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
  }
}

function playSound(name) {
  const a = sounds[name];
  if (!soundOn || !a) return;
  try {
    a.currentTime = 0;
    a.play().catch(() => {});
  } catch (e) {}
}

function soundButton() {
  const btn = h("button", { class: "host-close", type: "button" });
  const paint = () => {
    btn.textContent = soundOn ? "🔔" : "🔕";
    btn.setAttribute("aria-label", soundOn ? "Išjungti garsą" : "Įjungti garsą");
  };
  btn.onclick = () => {
    soundOn = !soundOn;
    ls.set("garsas", soundOn ? null : "off");
    paint();
    if (soundOn) playSound("tick");
  };
  paint();
  return btn;
}

// ---------- Archyvas ----------

async function loadArchive() {
  const { items } = await api("/api/archive", { method: "GET" });
  state.archive = items;
  // Juodraštis, kuris iš tikrųjų yra kitos narės dar slaptas susitikimas, – išvalomas
  const d = state.draft;
  if (d && d.id && items.some((i) => i.id === d.id && i.hidden)) clearDraft();
  checkTopicUsed();
  return items;
}

function renderGate(root, title, then) {
  const input = h("input", { type: "password", autocomplete: "current-password" });
  const err = h("p", { class: "error", hidden: true });
  const form = h("form", { class: "card" },
    h("h2", { text: title }),
    h("label", { class: "mini" }, "Genties kodas", input),
    h("div", { class: "actions" }, h("button", { class: "primary small", type: "submit", text: "Tęsti" })),
    err,
    h("p", { class: "hint", text: "Arba prisijunk skiltyje „Kalendorius“." })
  );
  form.onsubmit = (e) => {
    e.preventDefault();
    state.code = input.value.trim();
    ls.set("burelioKodas", state.code);
    $("#code").value = state.code;
    then();
  };
  root.replaceChildren(form);
}

async function renderArchive() {
  const root = $("#tab-archyvas");
  if (!hasAccess()) return renderGate(root, "Archyvas", renderArchive);
  root.replaceChildren(h("p", { class: "hint", text: "Kraunama…" }));
  try {
    await loadArchive();
  } catch (e) {
    if (e.status === 401 && !state.me) {
      state.code = "";
      ls.set("burelioKodas", null);
      return renderGate(root, "Archyvas", renderArchive);
    }
    root.replaceChildren(h("p", { class: "error", text: e.message }));
    return;
  }
  const items = state.archive.filter((i) => i.status !== "planned");
  root.replaceChildren(
    items.length
      ? h("div", {}, items.map(archiveCard))
      : h("div", { class: "card" }, h("p", { style: "margin:0", text: "Archyvas dar tuščias. Susitikimas čia atsiras, kai vedančioji jo pabaigoje patvirtins, kad jis įvyko." }))
  );
}

function archiveCard(item) {
  if (item.hidden) {
    return h("article", { class: "card item secret" },
      h("p", { class: "date", text: fmtDate(item.date) }),
      h("h3", { text: item.topic ? `📣 ${item.topic}` : "🤫 Tema – staigmena" }),
      h("p", { class: "hint", text: `${item.host ? `Veda ${item.host}. ` : ""}${item.topic ? "Visa programa" : "Tema ir programa"} atsivers po susitikimo.` })
    );
  }
  item = normalize(JSON.parse(JSON.stringify(item)));
  const depth = (DEPTHS.find(([v]) => v === item.depth) || [])[1] || OLD_DEPTHS[item.depth];
  const kindLabel = kindOf(item) === "veikla" ? "🎨 Veiklos" : "💬 Pokalbis";
  const acts = item.scenario.activities || [];
  const details = h("div", { class: "details", hidden: true },
    item.scenario.intro ? h("p", { class: "hint", style: "font-style:italic", text: item.scenario.intro }) : null,
    acts.length
      ? [h("h3", { text: "Veiklos" }), h("ol", {}, acts.map((a) =>
          h("li", { class: "plain" }, h("div", {},
            h("strong", { text: `${a.title} (${a.minutes || 0} min.)` }),
            h("p", { class: "hint", style: "margin:2px 0 0", text: a.description }),
            a.materials ? h("p", { class: "hint", style: "margin:2px 0 0", text: `Reikės: ${a.materials}` }) : null
          ))
        ))]
      : null,
    sectionsFor(item).map(([k, title]) => {
      const list = item.scenario[k] || [];
      return list.length ? [h("h3", { text: title }), h("ol", {}, list.map((q) => h("li", { class: "plain", text: q })))] : null;
    })
  );
  const toggleText = kindOf(item) === "veikla" ? "Veiklos" : "Klausimai";
  const toggle = h("button", { class: "secondary small", type: "button", text: toggleText });
  toggle.onclick = () => {
    details.hidden = !details.hidden;
    toggle.textContent = details.hidden ? toggleText : "Slėpti";
  };
  return h("article", { class: "card item" },
    h("p", { class: "date", text: fmtDate(item.date) }),
    h("h3", { text: item.topic }),
    h("p", { class: "hint", text: [kindLabel, depth, item.host && `vedė ${item.host}`].filter(Boolean).join(" · ") }),
    details,
    h("div", { class: "actions" },
      toggle,
      h("button", { class: "secondary small", type: "button", text: "Naudoti dar kartą", onclick: () => openArchived(item) }),
      h("button", { class: "secondary small", type: "button", text: "Ištrinti", onclick: () => deleteArchived(item) })
    )
  );
}

function revealButton(item) {
  const btn = h("button", {
    class: "secondary",
    type: "button",
    text: item.revealed ? "Vėl paslėpti temą" : "📣 Paskelbti temą narėms",
  });
  btn.onclick = async () => {
    const reveal = !item.revealed;
    const question = reveal
      ? `Paskelbti temą „${item.topic}“ kitoms narėms? Klausimai liks paslėpti iki susitikimo.`
      : "Vėl paslėpti temą nuo kitų narių?";
    if (!confirm(question)) return;
    btn.disabled = true;
    try {
      const { item: saved } = await api("/api/archive", { body: { reveal: { id: item.id, revealed: reveal } } });
      if (state.archive) state.archive = state.archive.map((i) => (i.id === saved.id ? saved : i));
      if (state.draft && state.draft.id === saved.id) { state.draft.revealed = saved.revealed; saveDraft(); renderResult(); }
      if (!$("#tab-archyvas").hidden) renderArchive();
    } catch (e) {
      btn.disabled = false;
      alert(e.message);
    }
  };
  return btn;
}

function openArchived(item) {
  if (state.draft && state.draft.id && !confirm("Dabartinis scenarijus bus pakeistas. Tęsti?")) return;
  const copy = JSON.parse(JSON.stringify(item));
  state.draft = normalize({
    stage: "review", kind: copy.kind, topic: copy.topic, depth: copy.depth, count: copy.count,
    scenario: copy.scenario, timing: copy.timing, date: meetingDate(),
  });
  state.notice = "";
  saveDraft();
  $("#topic").value = item.topic;
  renderChips();
  renderResult();
  location.hash = "#scenarijus";
  window.scrollTo(0, 0);
}

async function deleteArchived(item) {
  if (!confirm(`Ištrinti „${item.topic}“ iš archyvo?`)) return;
  try {
    await api(`/api/archive?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
    state.archive = state.archive.filter((i) => i.id !== item.id);
    if (state.draft && state.draft.id === item.id) { delete state.draft.id; saveDraft(); renderResult(); }
    renderArchive();
  } catch (e) {
    alert(e.message);
  }
}

// ---------- Paskyros ----------

function setSession(token, user) {
  state.token = token || "";
  state.me = user || null;
  ls.set("sesija", token || null);
  updateCodeField();
}

// Google „Sign in with Google“ mygtukas. Skriptas įkeliamas tik kai reikia.
// Google prisijungimas nukreipimo režimu: puslapis pereina į Google ir grįžta
// per /api/google su ženklu adreso fragmente (#google=…). Taip veikia ir telefonuose,
// kur iššokantis langas dažnai lieka baltas.
let googleScript = null;
let googleReturn = null; // { credential } arba { error: true }, kai ką tik grįžome iš Google

const session = {
  get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} },
};

function readGoogleReturn() {
  const hash = location.hash;
  if (hash.startsWith("#google=")) googleReturn = { credential: decodeURIComponent(hash.slice(8)) };
  else if (hash === "#google-error") googleReturn = { error: true };
  else return;
  googleReturn.intent = session.get("googleIntent") || "login";
  session.set("googleIntent", null);
  const back = session.get("googleBack") || "";
  session.set("googleBack", null);
  history.replaceState(null, "", location.pathname + location.search + back);
}

function loadGoogle() {
  if (!googleScript) {
    googleScript = new Promise((resolve, reject) => {
      const tag = h("script", { src: "https://accounts.google.com/gsi/client", async: true });
      tag.onload = () => {
        window.google.accounts.id.initialize({
          client_id: state.googleClientId,
          ux_mode: "redirect",
          login_uri: `${location.origin}/api/google`,
        });
        resolve(window.google);
      };
      tag.onerror = () => { googleScript = null; reject(new Error("Nepavyko įkelti Google prisijungimo")); };
      document.head.append(tag);
    });
  }
  return googleScript;
}

function googleButton(intent, onError) {
  session.set("googleIntent", intent);
  session.set("googleBack", intent === "link" ? location.hash : "");
  const box = h("div", { class: "google-btn" });
  loadGoogle()
    .then((google) => {
      google.accounts.id.renderButton(box, {
        theme: matchMedia("(prefers-color-scheme: dark)").matches ? "filled_black" : "outline",
        size: "large",
        shape: "pill",
        text: "continue_with",
        locale: "lt",
      });
    })
    .catch(onError);
  return box;
}

const GOOGLE_ERROR = "Nepavyko prisijungti su Google, pabandyk dar kartą";

function googleCard(fail) {
  const card = h("div", { class: "card google-card" }, h("p", { class: "label", text: "Greičiausia – su Google" }));
  const onCredential = async (credential) => {
    try {
      const r = await api("/api/auth", { body: { action: "google", credential } });
      if (r.token) { setSession(r.token, r.user); enterApp(); return; }
      if (r.needsSignup) showSignup(credential, r.suggestedName);
    } catch (x) { fail(x); }
  };
  const showSignup = (credential, suggested) => {
    const name = h("input", { type: "text", required: true, maxlength: "40", value: suggested || "" });
    const code = h("input", { type: "password", required: true, value: state.code });
    const form = h("form", {},
      h("p", { class: "hint", style: "margin:0 0 12px", text: "Pirmas kartas – dar trūksta dviejų dalykų:" }),
      h("label", { class: "mini" }, "Vardas (taip tave matys kitos)", name),
      h("label", { class: "mini", style: "margin-top:10px" }, "Genties kodas", code),
      h("div", { class: "actions" }, h("button", { class: "primary small", type: "submit", text: "Baigti registraciją" }))
    );
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api("/api/auth", { body: { action: "google", credential, name: name.value, code: code.value.trim() } });
        state.code = code.value.trim();
        ls.set("burelioKodas", state.code);
        setSession(r.token, r.user);
        enterApp();
      } catch (x) { fail(x); }
    };
    card.replaceChildren(h("h2", { text: "Sveika!" }), form);
  };
  card.append(googleButton("login", fail));
  if (googleReturn && googleReturn.intent === "login") {
    const ret = googleReturn;
    googleReturn = null;
    if (ret.error) fail(new Error(GOOGLE_ERROR));
    else onCredential(ret.credential);
  }
  return card;
}

function renderAuth(root) {
  const err = h("p", { class: "error", hidden: true });
  const fail = (e) => { err.textContent = e.message; err.hidden = false; };

  const lName = h("input", { type: "text", autocomplete: "username", required: true });
  const lPass = h("input", { type: "password", autocomplete: "current-password", required: true });
  const login = h("form", {},
    h("label", { class: "mini" }, "Vardas", lName),
    h("label", { class: "mini", style: "margin-top:10px" }, "Slaptažodis", lPass),
    h("button", { class: "primary", style: "margin-top:16px", type: "submit", text: "Prisijungti" })
  );
  login.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    try {
      const r = await api("/api/auth", { body: { action: "login", name: lName.value, password: lPass.value } });
      setSession(r.token, r.user);
      enterApp();
    } catch (x) { fail(x); }
  };

  const rName = h("input", { type: "text", autocomplete: "username", required: true, maxlength: "40" });
  const rPass = h("input", { type: "password", autocomplete: "new-password", required: true, minlength: "6" });
  const rCode = h("input", { type: "password", required: true, value: state.code });
  const register = h("form", { hidden: true },
    h("label", { class: "mini" }, "Vardas (taip tave matys kitos)", rName),
    h("label", { class: "mini", style: "margin-top:10px" }, "Slaptažodis (bent 6 simboliai)", rPass),
    h("label", { class: "mini", style: "margin-top:10px" }, "Genties kodas", rCode),
    h("button", { class: "primary", style: "margin-top:16px", type: "submit", text: "Susikurti paskyrą" })
  );
  register.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    try {
      const r = await api("/api/auth", { body: { action: "register", name: rName.value, password: rPass.value, code: rCode.value.trim() } });
      state.code = rCode.value.trim();
      ls.set("burelioKodas", state.code);
      setSession(r.token, r.user);
      enterApp();
    } catch (x) { fail(x); }
  };

  const title = h("h2", { text: "Prisijungti" });
  const toggle = h("button", { class: "link", type: "button" });
  const setMode = (signup) => {
    login.hidden = signup;
    register.hidden = !signup;
    title.textContent = signup ? "Nauja paskyra" : "Prisijungti";
    toggle.textContent = signup ? "Jau turi paskyrą? Prisijunk" : "Neturi paskyros? Susikurk";
    err.hidden = true;
  };
  toggle.onclick = () => setMode(register.hidden);
  setMode(false);

  root.replaceChildren(...[
    h("h1", { text: "Genties susitikimas" }),
    h("p", { class: "lead", text: "Mūsų susitikimų planavimas: temos, klausimai ir kito susitikimo data." }),
    state.googleClientId ? googleCard(fail) : null,
    h("div", { class: "card" },
      title,
      login,
      register,
      err,
      h("p", { style: "margin:16px 0 0;text-align:center" }, toggle)
    ),
    h("p", { class: "hint", style: "text-align:center" }, h("a", { href: "privacy.html", text: "Privatumo politika" })),
  ].filter(Boolean));
}

// ---------- Kalendorius ----------

async function loadCalendar() {
  state.calendar = await api("/api/calendar", { method: "GET" });
  state.meeting = state.calendar.meeting;
  syncDraftDate();
}

// Kai balsavimu patvirtinama data, ji įrašoma į vedančiosios planą
function syncDraftDate() {
  const d = state.draft;
  const m = state.meeting;
  if (!d || !m || !m.date || d.date === m.date || !state.me) return;
  if ((m.host || "").toLowerCase() !== state.me.name.toLowerCase()) return;
  d.date = m.date;
  saveDraft();
  syncPlan();
  renderResult();
}

async function renderCalendar() {
  const root = $("#tab-kalendorius");
  if (!state.me) return showAuth();
  root.replaceChildren(h("p", { class: "hint", text: "Kraunama…" }));
  try {
    await loadCalendar();
  } catch (e) {
    if (e.status === 401) return showAuth();
    root.replaceChildren(h("p", { class: "error", text: e.message }));
    return;
  }
  drawCalendar();
}

async function logout() {
  try { await api("/api/auth", { body: { action: "logout" } }); } catch (e) {}
  showAuth();
}

function showLinkGoogle() {
  const box = $("#link-google");
  if (box.childElementCount) { box.replaceChildren(); return; }
  const err = h("p", { class: "error", hidden: true });
  const fail = (e) => { err.textContent = e.message; err.hidden = false; };
  box.replaceChildren(
    h("div", { class: "card" },
      h("p", { class: "hint", style: "margin:0 0 12px", text: "Susiejus kitą kartą galėsi prisijungti vienu paspaudimu." }),
      googleButton("link", fail),
      err
    )
  );
}

async function finishLinkGoogle(ret) {
  const box = $("#link-google");
  const note = (text, isErr) =>
    box.replaceChildren(h("p", { class: isErr ? "error" : "hint", style: "margin:0 0 16px", text }));
  if (ret.error) return note(GOOGLE_ERROR, true);
  try {
    const r = await api("/api/auth", { body: { action: "link-google", credential: ret.credential } });
    state.me = r.user;
    renderUserBar();
    note("Google paskyra susieta ✓");
  } catch (e) {
    note(e.message, true);
  }
}

let saveTimer = null;
function setCalStatus(text, isErr) {
  state.calStatus = text;
  const el = $("#cal-status");
  if (el) { el.textContent = text; el.classList.toggle("err", Boolean(isErr)); }
}
function scheduleSave() {
  clearTimeout(saveTimer);
  setCalStatus("Saugoma…");
  saveTimer = setTimeout(async () => {
    try {
      const r = await api("/api/calendar", { method: "PUT", body: { dates: state.calendar.availability[state.me.id] || [] } });
      if (r.autoConfirmed) {
        state.calendar.meeting = r.meeting;
        state.meeting = r.meeting;
        state.calStatus = `🎉 Visos pasižymėjo – data patvirtinta automatiškai: ${fmtDate(r.meeting.date)}.` +
          (r.emailed ? ` Vedančiajai ${r.meeting.host} išsiųstas laiškas.` : "");
        drawCalendar();
      } else {
        setCalStatus("Išsaugota ✓");
      }
    } catch (e) {
      setCalStatus(e.message, true);
    }
  }, 700);
}

async function setMeeting(meeting) {
  try {
    const r = await api("/api/calendar", { body: { meeting } });
    state.calendar.meeting = r.meeting;
    state.meeting = r.meeting;
    if (r.meeting) state.calendar.rotation.nextHost = r.meeting.host;
    state.calStatus = r.emailed ? `Vedančiajai ${r.meeting.host} išsiųstas laiškas ✉` : "";
    drawCalendar();
  } catch (e) {
    alert(e.message);
  }
}

async function setNextHost(name) {
  try {
    const r = await api("/api/calendar", { body: { nextHost: name } });
    state.calendar = r;
    drawCalendar();
  } catch (e) {
    alert(e.message);
  }
}

// Vedančiosios pasirinkimas: eilės narės + kitos užsiregistravusios
function hostSelect(cal, current, onChange) {
  const names = [...cal.rotation.order];
  for (const m of cal.members) if (!names.some((n) => n.toLowerCase() === m.name.toLowerCase())) names.push(m.name);
  const select = h("select", { class: "host-select", "aria-label": "Vedančioji" },
    names.map((n) => h("option", { value: n, selected: n.toLowerCase() === String(current).toLowerCase(), text: n }))
  );
  select.onchange = () => onChange(select.value);
  return select;
}

function rotationCard(cal) {
  const r = cal.rotation;
  const scheduled = r.order[r.next];
  const host = r.nextHost;
  const swapped = host && host.toLowerCase() !== scheduled.toLowerCase();
  const n = r.order.length;
  // Rodoma nuo tos, kuri veda kitą, toliau ratu
  const items = r.order.map((name, i) => ({ name, i, pos: (i - r.next + n) % n })).sort((a, b) => a.pos - b.pos);
  return h("div", { class: "card" },
    h("h2", { text: "Vedančiųjų eilė" }),
    h("ol", { class: "rot" }, items.map(({ name, i, pos }) =>
      h("li", { class: ["rot-item", pos === 0 && "current", !r.registered[i] && "unregistered"].filter(Boolean).join(" "), title: r.registered[i] ? name : `${name} – dar neturi paskyros` },
        h("span", { class: "rot-avatar" },
          avatar(name, r.pictures ? r.pictures[i] : "", pos === 0 ? 56 : 44),
          h("span", { class: "rot-num", text: String(pos + 1) })
        ),
        h("span", { class: "rot-name", text: name })
      )
    )),
    swapped ? h("p", { class: "hint", style: "text-align:center", text: `Šį kartą veda ${host} (pagal eilę – ${scheduled}).` }) : null,
    h("div", { class: "row", style: "margin-top:14px;align-items:end" },
      h("label", { class: "mini" }, "Kitą susitikimą veda",
        hostSelect(cal, host, (name) => {
          if (cal.meeting) {
            if (confirm(`Pakeisti vedančiąją į ${name}? Jai bus išsiųstas laiškas.`)) setMeeting({ ...cal.meeting, host: name });
            else drawCalendar();
          } else {
            setNextHost(name);
          }
        })
      )
    ),
    h("p", { class: "hint", text: "Jei vedančioji negali – pasirink kitą narę. Po susitikimo eilė eina toliau." })
  );
}

function emailCard(cal) {
  const input = h("input", { type: "email", value: cal.myEmail || "", placeholder: "vardas@gmail.com", autocomplete: "email" });
  const note = h("p", { class: "hint" });
  const save = h("button", { class: "secondary small", type: "button", text: "Išsaugoti" });
  save.onclick = async () => {
    try {
      const r = await api("/api/auth", { body: { action: "set-email", email: input.value } });
      cal.myEmail = r.email;
      state.editEmail = false;
      drawCalendar();
    } catch (e) {
      note.textContent = e.message;
    }
  };
  if (cal.myEmail && !state.editEmail) {
    return h("p", { class: "hint email-line" },
      `✉ Pranešimai siunčiami: ${cal.myEmail} · `,
      h("button", { class: "link", type: "button", text: "keisti", onclick: () => { state.editEmail = true; drawCalendar(); } })
    );
  }
  return h("div", { class: "card" },
    h("h2", { text: "Pranešimai el. paštu" }),
    h("p", { class: "hint", style: "margin:0 0 12px", text: "Kai būsi vedančioji, čia gausi laišką su patvirtinta susitikimo data." }),
    h("div", { class: "row", style: "align-items:end" }, h("label", { class: "mini" }, "Tavo el. paštas", input), h("div", { style: "flex:0 0 auto" }, save)),
    note
  );
}

function meetingCard(cal) {
  const m = cal.meeting;
  if (!m) {
    return h("div", { class: "card meeting empty" },
      h("p", { text: "Kitas susitikimas dar nepaskirtas. Pasižymėk, kada gali. Kai pasižymės visos, daugiausiai balsų surinkusi diena patvirtinama automatiškai." })
    );
  }
  const time = h("input", { type: "time", value: m.time || MEETING_START });
  const place = h("input", { type: "text", value: m.place || "", placeholder: "pvz., pas Rūtą" });
  return h("div", { class: "card meeting" },
    h("p", { class: "label", text: "Kitas susitikimas" }),
    h("p", { class: "big", text: `${fmtDate(m.date)}, ${m.time || MEETING_START}–${endTime(m.time || MEETING_START)}` }),
    h("p", { style: "margin:0 0 4px", text: `Veda: ${m.host || "—"}` }),
    h("p", { style: "margin:0 0 12px", text:
      m.topicState === "revealed" ? `Tema: ${m.topic}${m.kind === "veikla" ? " (veiklų vakaras)" : ""}`
      : m.topicState === "secret" ? "Tema: 🤫 staigmena"
      : "Tema dar nesuplanuota" }),
    h("div", { class: "row" }, h("label", { class: "mini" }, "Pradžia", time), h("label", { class: "mini" }, "Vieta", place)),
    h("div", { class: "actions" },
      h("button", { class: "secondary small", type: "button", text: "Išsaugoti", onclick: () => setMeeting({ ...m, time: time.value, place: place.value }) }),
      h("button", { class: "secondary small", type: "button", text: "Atšaukti susitikimą", onclick: () => confirm("Atšaukti paskirtą susitikimą?") && setMeeting(null) })
    ),
    m.setBy ? h("p", { class: "hint", text: m.auto ? "Patvirtinta automatiškai pagal balsus" : `Paskyrė ${m.setBy}` }) : null
  );
}

function drawCalendar() {
  const cal = state.calendar;
  const meId = state.me.id;
  const t = today();
  const members = cal.members;
  const nameOf = (id) => (members.find((m) => m.id === id) || {}).name || id;
  const mine = new Set(cal.availability[meId] || []);
  const after = cal.rotation.lastDate || "";

  const byDate = {};
  for (const [id, dates] of Object.entries(cal.availability)) {
    for (const d of dates) if (d > after) (byDate[d] = byDate[d] || []).push(id);
  }

  // Mėnesio vaizdas: šis mėnuo ir dar 3 į priekį
  const offset = state.calMonth || 0;
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const days = [];
  for (let n = 1; n <= daysInMonth; n++) days.push(new Date(first.getFullYear(), first.getMonth(), n));
  const max = Math.max(0, ...days.filter((d) => isoDate(d) >= t).map((d) => (byDate[isoDate(d)] || []).length));

  const toggle = (iso) => {
    if (mine.has(iso)) mine.delete(iso); else mine.add(iso);
    cal.availability[meId] = [...mine].sort();
    state.calStatus = "";
    drawCalendar();
    scheduleSave();
  };

  const go = (delta) => { state.calMonth = Math.max(0, Math.min(3, offset + delta)); drawCalendar(); };
  const monthHead = h("div", { class: "cal-head" },
    h("button", { type: "button", class: "cal-nav", "aria-label": "Ankstesnis mėnuo", text: "‹", disabled: offset <= 0, onclick: () => go(-1) }),
    h("strong", { text: `${MONTHS_FULL[first.getMonth()]} ${first.getFullYear()}` }),
    h("button", { type: "button", class: "cal-nav", "aria-label": "Kitas mėnuo", text: "›", disabled: offset >= 3, onclick: () => go(1) })
  );

  const blanks = Array.from({ length: lead }, () => h("span", { class: "day blank" }));
  const cells = blanks.concat(days.map((d) => {
    const iso = isoDate(d);
    const count = (byDate[iso] || []).length;
    const past = iso < t;
    const cls = [
      "day",
      mine.has(iso) && "mine",
      iso === t && "today",
      !past && max > 0 && count === max && "best",
      cal.meeting?.date === iso && "meeting",
    ].filter(Boolean).join(" ");
    return h("button", {
      type: "button",
      class: cls,
      disabled: past,
      "aria-pressed": String(mine.has(iso)),
      "aria-label": `${fmtDate(iso)}: gali ${count}`,
      title: count ? (byDate[iso] || []).map(nameOf).join(", ") : "",
      onclick: () => toggle(iso),
    },
      h("span", { class: "n", text: String(d.getDate()) }),
      h("span", { class: "dots" },
        count > 5 ? h("span", { class: "dots-n", text: String(count) }) : Array.from({ length: count }, () => h("i", {}))
      )
    );
  }));

  const ranked = Object.entries(byDate)
    .filter(([d]) => d >= t)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 5);

  // Balsavimo būsena pagal eilės nares
  const voted = (name) => (cal.availability[name.toLowerCase()] || []).some((d) => d > after);
  const order = cal.rotation.order;
  const missing = order.filter((n) => !voted(n));
  const tie = ranked.length > 1 && ranked[0][1].length === ranked[1][1].length;
  const voteNote = cal.meeting
    ? null
    : missing.length
      ? `Pasižymėjo ${order.length - missing.length} iš ${order.length}. Dar laukiama: ${missing.join(", ")}.`
      : tie
        ? "Visos pasižymėjo, bet kelios dienos surinko po lygiai balsų – paskirkite vieną iš jų ranka."
        : null;

  $("#tab-kalendorius").replaceChildren(...[
    meetingCard(cal),
    h("div", { class: "card" },
      h("h2", { text: "Kada gali?" }),
      h("p", { class: "hint", style: "margin:0 0 12px", text: `Spustelk dienas, kai gali ateiti (${MEETING_START}–${endTime(MEETING_START)}). Taškeliai po data rodo, kiek narių tą dieną gali.` }),
      monthHead,
      h("div", { class: "cal" },
        ["Pr", "An", "Tr", "Kt", "Pn", "Še", "Sk"].map((w) => h("span", { class: "wd", text: w })),
        cells
      ),
      h("p", { class: "legend" },
        h("span", {}, h("i", { class: "l-mine" }), "tu gali"),
        h("span", {}, h("i", { class: "l-best" }), "tinka daugiausiai"),
        h("span", {}, h("b", { class: "l-dot" }), "viena narė"),
        h("span", { text: "★ susitikimas" })
      ),
      h("p", { class: "status", id: "cal-status", text: state.calStatus })
    ),
    h("div", { class: "card" },
      h("h2", { text: "Geriausios dienos" }),
      voteNote ? h("p", { class: "hint", style: "margin:0 0 10px", text: voteNote }) : null,
      ranked.length
        ? h("ol", { class: "best-list" }, ranked.map(([d, ids]) =>
            h("li", {},
              h("div", {},
                h("span", { class: "stack" }, ids.map((id) => {
                  const m = members.find((x) => x.id === id) || {};
                  return avatar(m.name || id, m.picture, 24);
                })),
                h("strong", { text: fmtDate(d) }),
                h("p", { class: "hint", style: "margin:2px 0 0", text: `${ids.length} iš ${Math.max(order.length, ids.length)}: ${ids.map(nameOf).join(", ")}` })
              ),
              cal.meeting?.date === d
                ? h("span", { class: "hint", text: "★ Paskirta" })
                : h("button", {
                    class: "secondary small",
                    type: "button",
                    text: "Paskirti",
                    onclick: () => setMeeting({ date: d, time: cal.meeting?.time || MEETING_START, place: cal.meeting?.place || "" }),
                  })
            )
          ))
        : h("p", { class: "hint", style: "margin:0", text: "Dar niekas nepasižymėjo." })
    ),
    rotationCard(cal),
    emailCard(cal),
  ].filter(Boolean));
}

// ---------- Prisijungimas / programa ----------

function renderUserBar() {
  $("#userbar").replaceChildren(...[
    avatar(state.me.name, state.me.picture, 26),
    h("span", { text: state.me.name }),
    state.googleClientId && !state.me.google
      ? h("button", { class: "link", type: "button", text: "Susieti su Google", onclick: showLinkGoogle })
      : null,
    h("button", { class: "link", type: "button", text: "Atsijungti", onclick: logout }),
  ].filter(Boolean));
}

function showAuth() {
  setSession(null, null);
  state.archive = null;
  state.calendar = null;
  state.meeting = null;
  state.draft = null;
  $("#topic").value = "";
  renderResult();
  $("#app").hidden = true;
  $("#auth").hidden = false;
  renderAuth($("#auth"));
}

function enterApp() {
  $("#auth").hidden = true;
  $("#auth").replaceChildren();
  $("#app").hidden = false;
  $("#link-google").replaceChildren();
  renderUserBar();
  updateCodeField();
  loadDraft();
  showTab();
  if (!state.archive) loadArchive().catch(() => {});
  if (!state.calendar) loadCalendar().catch(() => {});
}

// ---------- Paleidimas ----------

async function init() {
  readGoogleReturn();
  renderChips();
  $("#code").value = state.code;
  $("#form").addEventListener("submit", generate);
  $("#kinds").addEventListener("change", () => {
    renderCounts(selectedKind());
    $("#suggestions").hidden = true;
  });
  $("#suggest").addEventListener("click", suggestTopics);
  $("#topic").addEventListener("input", checkTopicUsed);

  try {
    state.googleClientId = (await api("/api/auth", { body: { action: "config" } })).googleClientId;
  } catch (e) {}

  if (state.token) {
    try {
      state.me = (await api("/api/auth", { body: { action: "me" } })).user;
    } catch (e) {
      state.me = null;
    }
  }
  renderResult();
  window.addEventListener("hashchange", () => { if (state.me) showTab(); });
  if (state.me) {
    enterApp();
    if (googleReturn && googleReturn.intent === "link") {
      const ret = googleReturn;
      googleReturn = null;
      finishLinkGoogle(ret);
    }
  } else {
    if (googleReturn) googleReturn.intent = "login";
    showAuth();
  }
}

init();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
