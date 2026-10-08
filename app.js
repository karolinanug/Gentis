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
  ["juokingas", "Juokingas"],
  ["svajingas", "Svajingas"],
];
const KINDS = [
  ["pokalbis", "💬 Pokalbis"],
  ["veikla", "🎨 Veiklos"],
];
const COUNTS = { pokalbis: [4, 6, 8, 10], veikla: [2, 3, 4, 5] };
const DEFAULT_COUNT = { pokalbis: 6, veikla: 3 };
const COUNT_LABEL = { pokalbis: "Pagrindinių klausimų skaičius", veikla: "Veiklų skaičius" };
// Susitikimai visada 18:30–21:30
const MEETING_START = "18:30";
const MEETING_MINUTES = 180;
const GROUNDING = {
  minutes: 3,
  text: "Atsisėskime patogiai ir užsimerkime. Giliai įkvėpkime per nosį ir lėtai iškvėpkime – tris kartus. Pajuskime, kaip pėdos remiasi į žemę, ir palikime dienos rūpesčius už durų.",
};
const MONTHS_FULL = ["Sausis", "Vasaris", "Kovas", "Balandis", "Gegužė", "Birželis", "Liepa", "Rugpjūtis", "Rugsėjis", "Spalis", "Lapkritis", "Gruodis"];
const SECTIONS = [
  ["warmup", "Apšilimas"],
  ["main", "Pagrindiniai klausimai"],
  ["closing", "Užbaigimas"],
];
const DEFAULT_TIMING = { warmup: 5, main: 10, closing: 5 };
const DEFAULT_ACTIVITY_TIMING = { closing: 10 };

const kindOf = (d) => (d && d.kind === "veikla" ? "veikla" : "pokalbis");
const selectedKind = () => ($("input[name=kind]:checked") || {}).value || "pokalbis";
const sectionsFor = (d) => (kindOf(d) === "veikla" ? [["closing", "Užbaigimas"]] : SECTIONS);

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
  try { state.draft = JSON.parse(ls.get(draftKey())); } catch (e) { state.draft = null; }
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
  chipGroup($("#depths"), "depth", DEPTHS, state.draft?.depth || "vidutinis");
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

function defaultDate() {
  return state.meeting?.date || today();
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
  btn.disabled = true;
  btn.textContent = "Kuriama… (apie 10–20 s)";
  try {
    const scenario = await api("/api/generate", { body: { mode: "scenario", kind, topic, depth, count } });
    const prev = state.draft;
    const defaults = kind === "veikla" ? DEFAULT_ACTIVITY_TIMING : DEFAULT_TIMING;
    if (kind === "veikla") {
      scenario.activities = (scenario.activities || []).map((a) => ({ ...a, minutes: Number(a.minutes) || 30 }));
    }
    state.draft = {
      kind,
      topic,
      depth,
      count,
      scenario,
      timing: prev?.timing && kindOf(prev) === kind ? { ...prev.timing } : { ...defaults },
      date: prev && !prev.id && prev.date ? prev.date : defaultDate(),
    };
    saveDraft();
    renderResult();
    $("#result").scrollIntoView({ behavior: "smooth" });
    if (!state.archive) loadArchive().catch(() => {});
  } catch (e) {
    showError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Kurti scenarijų";
  }
}

// ---------- Scenarijaus rodymas ----------

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

function renderResult() {
  const root = $("#result");
  const d = state.draft;
  if (!d || !d.scenario) { root.replaceChildren(); return; }
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

  root.replaceChildren(...[
    h("h2", { text: d.topic }),
    h("p", { class: "hint", text: "Spustelk ant bet kurio teksto, kad jį pataisytum savais žodžiais." }),
    editable("p", { class: "intro" }, s.intro || "", (v) => { s.intro = v; }),
    kindOf(d) === "veikla" ? activitiesBlock(d) : null,
    sections,
    timingCard(),
    actionsBar(),
    h("div", { id: "invite" }),
  ].flat(Infinity).filter(Boolean));
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
          h("label", { class: "mini inline" },
            h("input", {
              type: "number", min: "0", max: "180", inputmode: "numeric", value: a.minutes || 0,
              oninput: (e) => {
                a.minutes = Math.max(0, Math.min(180, Number(e.target.value) || 0));
                saveDraft();
                updatePlanTotal();
              },
            }),
            "min."
          ),
          h("span", { class: "hint", style: "margin:0" }, "Reikės: "),
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
  let mins = GROUNDING.minutes;
  if (kindOf(d) === "veikla") {
    mins += (d.scenario.activities || []).reduce((sum, a) => sum + (Number(a.minutes) || 0), 0);
    mins += (d.scenario.closing || []).length * (Number(t.closing) || 0);
  } else {
    mins += SECTIONS.reduce((sum, [k]) => sum + (d.scenario[k] || []).length * (Number(t[k]) || 0), 0);
  }
  return mins;
}

let updatePlanTotal = () => {};

function timingCard() {
  const d = state.draft;
  const veikla = kindOf(d) === "veikla";
  d.timing = d.timing || { ...(veikla ? DEFAULT_ACTIVITY_TIMING : DEFAULT_TIMING) };
  const total = h("p", { class: "hint" });
  updatePlanTotal = () => {
    const mins = planMinutes(d);
    const left = MEETING_MINUTES - mins;
    total.textContent =
      `Suplanuota ${fmtMinutes(mins)} iš 3 val. (${MEETING_START}–${endTime(MEETING_START)}), įskaitant ${GROUNDING.minutes} min. įsižeminimą. ` +
      (left >= 0 ? `Laisvo laiko lieka ${fmtMinutes(left)}` : `Viršyta ${fmtMinutes(-left)}`);
    total.classList.toggle("over-plan", left < 0);
  };
  const minutes = (key, label) =>
    h("label", { class: "mini" }, label,
      h("input", {
        type: "number", min: "0", max: "60", inputmode: "numeric", value: d.timing[key] ?? 0,
        oninput: (e) => {
          d.timing[key] = Math.max(0, Math.min(60, Number(e.target.value) || 0));
          saveDraft();
          updatePlanTotal();
        },
      })
    );
  updatePlanTotal();
  return h("div", { class: "card timing" },
    h("h2", { text: "Vakaro planas" }),
    h("div", { class: "row" },
      h("label", { class: "mini" }, "Susitikimo data",
        h("input", { type: "date", value: d.date || "", oninput: (e) => { d.date = e.target.value; saveDraft(); } })
      )
    ),
    veikla
      ? [
          h("p", { class: "hint", style: "margin-top:16px", text: "Veiklų trukmę keisk prie kiekvienos veiklos." }),
          h("div", { class: "row", style: "margin-top:10px" }, minutes("closing", "Užbaigimo klausimui (min.)")),
        ]
      : [
          h("p", { class: "label", style: "margin-top:16px", text: "Minutės vienam klausimui" }),
          h("div", { class: "row" }, minutes("warmup", "Apšilimas"), minutes("main", "Pagrindiniai"), minutes("closing", "Užbaigimas")),
        ],
    total
  );
}
function actionsBar() {
  const d = state.draft;
  const copy = h("button", { class: "secondary", type: "button", text: "Kopijuoti" });
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      copy.textContent = "Nukopijuota ✓";
    } catch (e) {
      copy.textContent = "Nepavyko nukopijuoti";
    }
    setTimeout(() => (copy.textContent = "Kopijuoti"), 2000);
  };
  const save = h("button", { class: "secondary save-btn", type: "button", text: d.id ? "Atnaujinti archyve" : "Išsaugoti archyve" });
  save.onclick = () => saveToArchive(save);
  return h("div", { class: "actions" },
    h("button", { class: "primary small", type: "button", text: "▶ Vedančiosios režimas", onclick: openHost }),
    h("button", { class: "secondary", type: "button", text: "✉ Kvietimo žinutė", onclick: toggleInvite }),
    save,
    d.id && d.date && d.date >= today() ? revealButton(d) : null,
    copy,
    h("button", { class: "secondary", type: "button", text: "Spausdinti", onclick: () => window.print() }),
    h("button", {
      class: "secondary",
      type: "button",
      text: "Naujas scenarijus",
      onclick: () => {
        if (confirm("Išvalyti šį scenarijų ir pradėti naują? Archyve išsaugotas liks.")) {
          clearDraft();
          window.scrollTo(0, 0);
        }
      },
    })
  );
}

function asText() {
  const d = state.draft;
  const lines = [`Tema: ${d.topic}`];
  if (d.date) lines.push(`Data: ${fmtDate(d.date)}, ${MEETING_START}–${endTime(MEETING_START)}`);
  lines.push("", `Įsižeminimas (${GROUNDING.minutes} min.)`, "", d.scenario.intro || "");
  if (kindOf(d) === "veikla") {
    lines.push("", "Veiklos");
    (d.scenario.activities || []).forEach((a, i) => {
      lines.push(`${i + 1}. ${a.title} (${a.minutes || 0} min.)`, `   ${a.description}`);
      if (a.materials) lines.push(`   Reikės: ${a.materials}`);
    });
  }
  for (const [key, title] of sectionsFor(d)) {
    const list = d.scenario[key] || [];
    if (!list.length) continue;
    lines.push("", title);
    list.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
  }
  return lines.join("\n");
}
async function saveToArchive(btn) {
  const d = state.draft;
  if (!d.date) {
    alert("Įrašyk susitikimo datą „Vakaro plane“ – pagal ją tema atsivers kitoms narėms po susitikimo.");
    const input = $("#result .timing input[type=date]");
    if (input) input.focus();
    return;
  }
  btn.disabled = true;
  btn.textContent = "Saugoma…";
  try {
    const { item } = await api("/api/archive", {
      body: { entry: { id: d.id, kind: kindOf(d), date: d.date, topic: d.topic, depth: d.depth, count: d.count, scenario: d.scenario, timing: d.timing } },
    });
    const wasNew = !d.id;
    d.id = item.id;
    d.revealed = item.revealed;
    saveDraft();
    if (wasNew) {
      // atsiranda mygtukas „Paskelbti temą narėms“
      renderResult();
      btn = $("#result .save-btn");
    }
    if (state.archive) {
      state.archive = [item, ...state.archive.filter((i) => i.id !== item.id)];
    }
    btn.textContent = "Išsaugota ✓";
    setTimeout(() => (btn.textContent = "Atnaujinti archyve"), 2000);
  } catch (e) {
    btn.textContent = d.id ? "Atnaujinti archyve" : "Išsaugoti archyve";
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
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
  const go = h("button", { class: "primary small", type: "button", text: "Sukurti žinutę" });
  go.onclick = async () => {
    err.hidden = true;
    go.disabled = true;
    go.textContent = "Rašoma…";
    try {
      const { message } = await api("/api/generate", {
        body: {
          mode: "invite",
          kind: kindOf(d),
          topic: d.topic,
          date: d.date ? fmtDate(d.date) : "",
          time: time.value ? `${time.value}–${endTime(time.value)}` : "",
          place: place.value,
          note: note.value,
          materials: kindOf(d) === "veikla"
            ? (d.scenario.activities || []).map((a) => a.materials).filter(Boolean).join("; ")
            : "",
        },
      });
      out.value = message || "";
      out.hidden = false;
      copy.hidden = false;
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      go.disabled = false;
      go.textContent = "Sukurti kitą variantą";
    }
  };
  box.replaceChildren(
    h("div", { class: "card" },
      h("h2", { text: "Kvietimo žinutė" }),
      h("p", { class: "hint", style: "margin:0 0 14px", text: d.date ? `Data: ${fmtDate(d.date)} (keičiama „Vakaro plane“)` : "Datą gali nurodyti „Vakaro plane“." }),
      h("div", { class: "row" }, h("label", { class: "mini" }, "Laikas", time), h("label", { class: "mini" }, "Vieta", place)),
      h("label", { class: "mini", style: "margin-top:10px" }, "Ką dar pridėti (nebūtina)", note),
      h("div", { class: "actions", style: "margin-top:14px" }, go),
      err,
      h("div", { style: "margin-top:14px" }, out),
      h("div", { class: "actions", style: "margin-top:10px" }, copy)
    )
  );
}

// ---------- Vedančiosios režimas ----------

const host = { slides: [], i: 0, elapsed: 0, total: 0, running: true, notified: false, timer: null, audio: null, lock: null, el: {} };

function openHost() {
  const d = state.draft;
  const s = d.scenario;
  const t = d.timing || {};
  host.slides = [
    { label: "Įsižeminimas", text: GROUNDING.text, min: GROUNDING.minutes, intro: true },
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
  host.i = 0;
  host.total = 0;
  host.running = true;
  resetSlide();

  try { host.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { host.audio = null; }
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

function closeHost() {
  clearInterval(host.timer);
  document.removeEventListener("keydown", hostKeys);
  $("#host").hidden = true;
  document.body.classList.remove("no-scroll");
  if (host.lock) host.lock.release().catch(() => {});
  host.lock = null;
  if (host.audio && host.audio.close) host.audio.close().catch(() => {});
  host.audio = null;
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
  if (n >= host.slides.length) { closeHost(); return; }
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
  if (slide.min && !host.notified && host.elapsed >= slide.min * 60) {
    host.notified = true;
    chime();
    if (navigator.vibrate) navigator.vibrate([150, 100, 150]);
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

function chime() {
  const ctx = host.audio;
  if (!ctx) return;
  if (ctx.resume) ctx.resume();
  const now = ctx.currentTime;
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    const start = now + i * 0.22;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.12, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 1.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 1.5);
  });
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
  const items = state.archive;
  root.replaceChildren(
    items.length
      ? h("div", {}, items.map(archiveCard))
      : h("div", { class: "card" }, h("p", { style: "margin:0", text: "Archyvas dar tuščias. Sukurk scenarijų ir paspausk „Išsaugoti archyve“." }))
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
  const upcoming = item.date >= today();
  const depth = (DEPTHS.find(([v]) => v === item.depth) || [])[1];
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
    h("p", { class: "hint", text: [kindLabel, depth, item.host && `išsaugojo ${item.host}`, upcoming && (item.revealed ? "📣 tema paskelbta narėms" : "🤫 kitoms dar paslaptis")].filter(Boolean).join(" · ") }),
    details,
    h("div", { class: "actions" },
      upcoming ? revealButton(item) : null,
      toggle,
      h("button", { class: "secondary small", type: "button", text: "Atidaryti", onclick: () => openArchived(item) }),
      h("button", { class: "secondary small", type: "button", text: "Ištrinti", onclick: () => deleteArchived(item) })
    )
  );
}

function revealButton(item) {
  const btn = h("button", {
    class: item.revealed ? "secondary small" : "primary small",
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
  state.draft = JSON.parse(JSON.stringify(item));
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
    swapped ? h("p", { class: "hint", style: "text-align:center", text: `Šį kartą vietoj ${scheduled} veda ${host}.` }) : null,
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
      note.textContent = "Išsaugota ✓";
    } catch (e) {
      note.textContent = e.message;
    }
  };
  return h("div", { class: "card" },
    h("h2", { text: "Pranešimai el. paštu" }),
    h("p", { class: "hint", style: "margin:0 0 12px", text: "Kai būsi vedančioji, čia gausi laišką su patvirtinta susitikimo data." }),
    h("div", { class: "row", style: "align-items:end" }, h("label", { class: "mini" }, "Tavo el. paštas", input), h("div", { style: "flex:0 0 auto" }, save)),
    note,
    cal.mailEnabled ? null : h("p", { class: "hint", text: "(Laiškų siuntimas dar neįjungtas serveryje.)" })
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
    h("p", { style: "margin:0 0 12px", text: `Veda: ${m.host || "—"}` }),
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
