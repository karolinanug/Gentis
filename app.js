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
const COUNTS = [4, 6, 8, 10];
const MONTHS_SHORT = ["sau", "vas", "kov", "bal", "geg", "bir", "lie", "rgp", "rgs", "spa", "lap", "gru"];
const SECTIONS = [
  ["warmup", "Apšilimas"],
  ["main", "Pagrindiniai klausimai"],
  ["closing", "Užbaigimas"],
];
const DEFAULT_TIMING = { warmup: 5, main: 10, closing: 5 };

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
  chipGroup($("#depths"), "depth", DEPTHS, state.draft?.depth || "vidutinis");
  chipGroup($("#counts"), "count", COUNTS.map((n) => [n, String(n)]), state.draft?.count || 6);
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
    note.textContent = `Šia tema jau kalbėjotės: ${used.map((i) => fmtDate(i.date)).join("; ")}. Klausimai nesikartos.`;
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
    const { topics = [] } = await api("/api/generate", { body: { mode: "topics" } });
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
  const depth = $("input[name=depth]:checked").value;
  const count = Number($("input[name=count]:checked").value);
  const btn = $("#go");
  btn.disabled = true;
  btn.textContent = "Kuriama… (apie 10–20 s)";
  try {
    const scenario = await api("/api/generate", { body: { mode: "scenario", topic, depth, count } });
    const prev = state.draft;
    state.draft = {
      topic,
      depth,
      count,
      scenario,
      timing: prev?.timing ? { ...prev.timing } : { ...DEFAULT_TIMING },
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

  const sections = SECTIONS.map(([key, title]) => {
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
    sections,
    timingCard(),
    actionsBar(),
    h("div", { id: "invite" }),
  ].flat(Infinity).filter(Boolean));
}

async function swap(section, index, btn) {
  const d = state.draft;
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const existing = SECTIONS.flatMap(([k]) => d.scenario[k] || []);
    const data = await api("/api/generate", {
      body: {
        mode: "replace",
        topic: d.topic,
        depth: d.depth,
        replace: { section, current: d.scenario[section][index], existing },
      },
    });
    if (!data.question) throw new Error("Nepavyko gauti naujo klausimo");
    d.scenario[section][index] = data.question;
    saveDraft();
    renderResult();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Kitas";
    alert(e.message);
  }
}

function timingCard() {
  const d = state.draft;
  d.timing = d.timing || { ...DEFAULT_TIMING };
  const total = h("p", { class: "hint" });
  const update = () => {
    const mins = SECTIONS.reduce((sum, [k]) => sum + (d.scenario[k] || []).length * (Number(d.timing[k]) || 0), 0);
    total.textContent = mins
      ? `Iš viso klausimams apie ${fmtMinutes(mins)} Vedančiosios režime laikmatis švelniai primins, kada pereiti prie kito klausimo.`
      : "Laikmatis išjungtas (visur 0 min.).";
  };
  const minutes = (key, label) =>
    h("label", { class: "mini" }, label,
      h("input", {
        type: "number", min: "0", max: "60", inputmode: "numeric", value: d.timing[key],
        oninput: (e) => {
          d.timing[key] = Math.max(0, Math.min(60, Number(e.target.value) || 0));
          saveDraft();
          update();
        },
      })
    );
  update();
  return h("div", { class: "card timing" },
    h("h2", { text: "Vakaro planas" }),
    h("div", { class: "row" },
      h("label", { class: "mini" }, "Susitikimo data",
        h("input", { type: "date", value: d.date || "", oninput: (e) => { d.date = e.target.value; saveDraft(); } })
      )
    ),
    h("p", { class: "label", style: "margin-top:16px", text: "Minutės vienam klausimui" }),
    h("div", { class: "row" }, minutes("warmup", "Apšilimas"), minutes("main", "Pagrindiniai"), minutes("closing", "Užbaigimas")),
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
  if (d.date) lines.push(`Data: ${fmtDate(d.date)}`);
  lines.push("", d.scenario.intro || "");
  for (const [key, title] of SECTIONS) {
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
      body: { entry: { id: d.id, date: d.date, topic: d.topic, depth: d.depth, count: d.count, scenario: d.scenario, timing: d.timing } },
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
  const time = h("input", { type: "time", value: m?.time || "18:00" });
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
        body: { mode: "invite", topic: d.topic, date: d.date ? fmtDate(d.date) : "", time: time.value, place: place.value, note: note.value },
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
  host.slides = [{ label: "Įžanga", text: s.intro || d.topic, min: 0, intro: true }];
  for (const [key, title] of SECTIONS) {
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
  el.notice = h("div", { class: "host-notice", hidden: true, text: "Laikas pereiti prie kito klausimo" });
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
    h("div", { class: "host-body" }, el.q),
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
      h("p", { class: "hint", text: `${item.host ? `Veda ${item.host}. ` : ""}${item.topic ? "Klausimai" : "Tema ir klausimai"} atsivers po susitikimo.` })
    );
  }
  const upcoming = item.date >= today();
  const depth = (DEPTHS.find(([v]) => v === item.depth) || [])[1];
  const details = h("div", { class: "details", hidden: true },
    item.scenario.intro ? h("p", { class: "hint", style: "font-style:italic", text: item.scenario.intro }) : null,
    SECTIONS.map(([k, title]) => {
      const list = item.scenario[k] || [];
      return list.length ? [h("h3", { text: title }), h("ol", {}, list.map((q) => h("li", { class: "plain", text: q })))] : null;
    })
  );
  const toggle = h("button", { class: "secondary small", type: "button", text: "Klausimai" });
  toggle.onclick = () => {
    details.hidden = !details.hidden;
    toggle.textContent = details.hidden ? "Klausimai" : "Slėpti";
  };
  return h("article", { class: "card item" },
    h("p", { class: "date", text: fmtDate(item.date) }),
    h("h3", { text: item.topic }),
    h("p", { class: "hint", text: [depth, item.host && `išsaugojo ${item.host}`, upcoming && (item.revealed ? "📣 tema paskelbta narėms" : "🤫 kitoms dar paslaptis")].filter(Boolean).join(" · ") }),
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
    h("h1", { text: "Gentis" }),
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
      await api("/api/calendar", { method: "PUT", body: { dates: state.calendar.availability[state.me.id] || [] } });
      setCalStatus("Išsaugota ✓");
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
    drawCalendar();
  } catch (e) {
    alert(e.message);
  }
}

function meetingCard(cal) {
  const m = cal.meeting;
  if (!m) {
    return h("div", { class: "card meeting empty" },
      h("p", { text: "Kitas susitikimas dar nepaskirtas. Pasižymėk, kada gali, o žemiau pamatysi dienas, kurios tinka daugumai." })
    );
  }
  const time = h("input", { type: "time", value: m.time || "" });
  const place = h("input", { type: "text", value: m.place || "", placeholder: "pvz., pas Rūtą" });
  return h("div", { class: "card meeting" },
    h("p", { class: "label", text: "Kitas susitikimas" }),
    h("p", { class: "big", text: fmtDate(m.date) }),
    h("div", { class: "row" }, h("label", { class: "mini" }, "Laikas", time), h("label", { class: "mini" }, "Vieta", place)),
    h("div", { class: "actions" },
      h("button", { class: "secondary small", type: "button", text: "Išsaugoti", onclick: () => setMeeting({ ...m, time: time.value, place: place.value }) }),
      h("button", { class: "secondary small", type: "button", text: "Atšaukti susitikimą", onclick: () => confirm("Atšaukti paskirtą susitikimą?") && setMeeting(null) })
    ),
    m.setBy ? h("p", { class: "hint", text: `Paskyrė ${m.setBy}` }) : null
  );
}

function drawCalendar() {
  const cal = state.calendar;
  const meId = state.me.id;
  const t = today();
  const members = cal.members;
  const nameOf = (id) => (members.find((m) => m.id === id) || {}).name || id;
  const mine = new Set(cal.availability[meId] || []);

  const byDate = {};
  for (const [id, dates] of Object.entries(cal.availability)) {
    for (const d of dates) (byDate[d] = byDate[d] || []).push(id);
  }

  const start = new Date();
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const days = [];
  for (let i = 0; i < 56; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  const max = Math.max(0, ...days.map((d) => (byDate[isoDate(d)] || []).length));

  const toggle = (iso) => {
    if (mine.has(iso)) mine.delete(iso); else mine.add(iso);
    cal.availability[meId] = [...mine].sort();
    drawCalendar();
    scheduleSave();
  };

  const cells = days.map((d, i) => {
    const iso = isoDate(d);
    const count = (byDate[iso] || []).length;
    const past = iso < t;
    const showMonth = i === 0 || d.getDate() === 1;
    const cls = ["day", mine.has(iso) && "mine", !past && max > 0 && count === max && "best", cal.meeting?.date === iso && "meeting"]
      .filter(Boolean).join(" ");
    return h("button", {
      type: "button",
      class: cls,
      disabled: past,
      "aria-pressed": String(mine.has(iso)),
      "aria-label": `${fmtDate(iso)}: gali ${count}`,
      onclick: () => toggle(iso),
    },
      showMonth ? h("span", { class: "m", text: MONTHS_SHORT[d.getMonth()] }) : null,
      h("span", { class: "n", text: String(d.getDate()) }),
      count ? h("span", { class: "c", text: String(count) }) : null
    );
  });

  const ranked = Object.entries(byDate)
    .filter(([d]) => d >= t)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 5);

  const missing = members.filter((m) => !(cal.availability[m.id] || []).length).map((m) => m.name);

  $("#tab-kalendorius").replaceChildren(
    meetingCard(cal),
    h("div", { class: "card" },
      h("h2", { text: "Kada gali?" }),
      h("p", { class: "hint", style: "margin:0 0 12px", text: "Spustelk dienas, kai gali ateiti. Skaičius rodo, kiek narių tą dieną gali." }),
      h("div", { class: "cal" },
        ["Pr", "An", "Tr", "Kt", "Pn", "Še", "Sk"].map((w) => h("span", { class: "wd", text: w })),
        cells
      ),
      h("p", { class: "legend" },
        h("span", {}, h("i", { class: "l-mine" }), "tu gali"),
        h("span", {}, h("i", { class: "l-best" }), "tinka daugiausiai"),
        h("span", { text: "★ paskirtas susitikimas" })
      ),
      h("p", { class: "status", id: "cal-status", text: state.calStatus })
    ),
    h("div", { class: "card" },
      h("h2", { text: "Geriausios dienos" }),
      ranked.length
        ? h("ol", { class: "best-list" }, ranked.map(([d, ids]) =>
            h("li", {},
              h("div", {},
                h("strong", { text: fmtDate(d) }),
                h("p", { class: "hint", style: "margin:2px 0 0", text: `${ids.length} iš ${members.length}: ${ids.map(nameOf).join(", ")}` })
              ),
              cal.meeting?.date === d
                ? h("span", { class: "hint", text: "★ Paskirta" })
                : h("button", {
                    class: "secondary small",
                    type: "button",
                    text: "Paskirti",
                    onclick: () => setMeeting({ date: d, time: cal.meeting?.time || "18:00", place: cal.meeting?.place || "" }),
                  })
            )
          ))
        : h("p", { class: "hint", style: "margin:0", text: "Dar niekas nepasižymėjo." }),
      missing.length ? h("p", { class: "hint", style: "margin-top:14px", text: `Dar nepasižymėjo: ${missing.join(", ")}` }) : null
    )
  );
}

// ---------- Prisijungimas / programa ----------

function renderUserBar() {
  $("#userbar").replaceChildren(...[
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
