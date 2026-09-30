// Gemeinsamer Code für Startseite & Anlässe: Katalog, Produktdetails, Tüte, Bestellung, Status
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const euro = (n) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const pad = (n) => String(n).padStart(2, "0");
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function store(key, value) { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch {} }

const BB = { C: null, byId: {}, events: {} };
const state = {
  bag: load("bb-bag-v2", []), // [{ key, id, qty, opts: {group: choice}, cardText }]
  reusable: load("bb-reusable", false),
  active: load("bb-active-order", null), // { token, number }
  sending: false,
};

// ---------- Datum & Öffnungszeiten ----------
const hoursOn = (d) => BB.C.hours[d.getDay()];
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

function nextOpening() {
  const d = new Date();
  for (let i = 0; i < 8; i++) {
    const day = new Date(d); day.setDate(d.getDate() + i);
    const h = hoursOn(day);
    if (!h || (i === 0 && nowMin() >= toMin(h[0]))) continue;
    return { label: i === 0 ? "heute" : i === 1 ? "morgen" : DAYS[day.getDay()], time: h[0] };
  }
  return null;
}

function dayLabel(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today) / 864e5);
  const date = d.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
  return diff === 0 ? "Heute" : diff === 1 ? `Morgen, ${date}` : `${DAYS[d.getDay()].slice(0, 2)}, ${date}`;
}

// Anlässe: nächstes Datum berechnen (fest, Ostern, n-ter Wochentag)
function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
function eventDateIn(ev, y) {
  const r = ev.rule;
  if (r.type === "fixed") return new Date(y, r.month - 1, r.day);
  if (r.type === "easter") return easterSunday(y);
  if (r.type === "nthWeekday") {
    const first = new Date(y, r.month - 1, 1);
    return new Date(y, r.month - 1, 1 + ((7 + r.weekday - first.getDay()) % 7) + 7 * (r.n - 1));
  }
}
function nextEventDate(ev) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = eventDateIn(ev, today.getFullYear());
  return d >= today ? d : eventDateIn(ev, today.getFullYear() + 1);
}
function daysUntil(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 864e5);
}
// Empfohlener Abholtag für einen Anlass (ggf. Vortag, wenn am Tag selbst geschlossen)
function eventPickupDay(ev) {
  let d = nextEventDate(ev);
  if (ev.pickupDayBefore || !hoursOn(d)) { d = new Date(d); d.setDate(d.getDate() - 1); }
  while (!hoursOn(d)) d.setDate(d.getDate() - 1);
  return d;
}

// ---------- Illustrationen ----------
const ICON = { coffee: "i-cup", flowerdrinks: "i-flower", cold: "i-glass", beans: "i-bean", bouquets: "i-bouquet", event: "i-bouquet" };
const PALETTES = {
  rose: ["#e9b8b0", "#f3d5c4", "#c9b6d9"], sage: ["#fff5e6", "#e9b8b0", "#b7c4ae"],
  lavender: ["#c9b6d9", "#efe6f7", "#e9b8b0"], peach: ["#f6c9a8", "#e9b8b0", "#fff5e6"],
};
function flower(x, y, r, fill) {
  return [0, 72, 144, 216, 288].map((a) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return `<circle cx="${(x + Math.cos(rad) * r).toFixed(1)}" cy="${(y + Math.sin(rad) * r).toFixed(1)}" r="${r}" fill="${fill}"/>`;
  }).join("") + `<circle cx="${x}" cy="${y}" r="${(r * 0.55).toFixed(1)}" fill="#f6d9a8"/>`;
}
function bouquetSVG(p) {
  const [a, b, c] = PALETTES[p.tone] || PALETTES.rose;
  const big = /bouquet-l|bouquet-m|val-roses|fem-team|mom-bouquet/.test(p.id);
  const roses = p.id === "val-roses";
  const fl = roses
    ? [[44, 44, 5.5, "#c24d5a"], [56, 36, 5.5, "#d45a66"], [68, 36, 5.5, "#c24d5a"], [78, 46, 5.5, "#d45a66"], [50, 56, 5.5, "#d45a66"], [62, 50, 5.5, "#b8404d"], [72, 58, 5.5, "#c24d5a"], [40, 58, 5, "#b8404d"], [82, 60, 5, "#b8404d"]]
    : [[45, 44, 6.5, a], [60, 33, 7, b], [75, 44, 6.5, c], [52, 57, 6, c], [68, 57, 6, a], ...(big ? [[36, 58, 5.5, b], [84, 58, 5.5, b], [60, 49, 5.5, a]] : [])];
  const wreath = /wreath/.test(p.id);
  if (wreath) {
    return `<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="62" r="34" fill="none" stroke="#6f8468" stroke-width="16"/>
      <circle cx="60" cy="62" r="34" fill="none" stroke="#3b2a22" stroke-width="1.4" stroke-dasharray="3 5"/>
      <g stroke="#3b2a22" stroke-width="1.2">${[[30, 50, a], [88, 56, b], [52, 94, c], [76, 30, a]].map(([x, y, f]) => flower(x, y, 5, f)).join("")}</g>
      ${p.id === "xmas-wreath" ? [44, 56, 68, 80].map((x) => `<rect x="${x - 3}" y="18" width="6" height="18" rx="2" fill="#fffdf9" stroke="#3b2a22" stroke-width="1.3"/><path d="M${x} 12 q3 3 0 6 q-3 -3 0 -6z" fill="#f0b43c"/>`).join("") : ""}</svg>`;
  }
  const cup = p.combo && p.drinks
    ? `<g transform="translate(78 58)" stroke="#3b2a22" stroke-width="1.6" stroke-linejoin="round"><rect x="0" y="0" width="30" height="6" rx="2.5" fill="#3b2a22"/><path d="M2 6 L6 50 a2 2 0 0 0 2 2 H22 a2 2 0 0 0 2-2 L28 6 Z" fill="#fffdf9"/><path d="M3.5 20 H26.5 L25.2 34 H4.8 Z" fill="#f4e4e0"/></g>`
    : p.combo ? `<g transform="translate(82 78)" stroke="#3b2a22" stroke-width="1.5"><rect x="0" y="0" width="26" height="30" rx="3" fill="#c9a98f"/><rect x="0" y="8" width="26" height="10" fill="#fffdf9"/></g>` : "";
  return `<svg viewBox="0 0 120 120" aria-hidden="true"><g transform="translate(${p.combo ? -12 : 0} 0)">
    <g stroke="#3b2a22" stroke-width="1.5" stroke-linecap="round" fill="none"><path d="M60 100 L45 48 M60 100 L60 36 M60 100 L75 48 M60 100 L52 60 M60 100 L68 60"/></g>
    <g stroke="#3b2a22" stroke-width="1.2"><ellipse cx="40" cy="70" rx="9" ry="4.5" fill="#9fb096" transform="rotate(-35 40 70)"/><ellipse cx="80" cy="70" rx="9" ry="4.5" fill="#9fb096" transform="rotate(35 80 70)"/>${fl.map(([x, y, r, f]) => flower(x, y, r, f)).join("")}</g>
    <path d="M36 72 L84 72 L68 112 L52 112 Z" fill="#efe4d6" stroke="#3b2a22" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M36 72 L60 86 L84 72" fill="none" stroke="#3b2a22" stroke-width="1.6" stroke-linejoin="round"/></g>${cup}</svg>`;
}
function isFloral(p) { return p.cat === "bouquets" || (p.cat === "event" && !p.drinks) || (p.cat === "event" && p.combo); }
function productArt(p) {
  if (isFloral(p)) return bouquetSVG(p);
  return `<svg viewBox="0 0 48 48" class="art-icon"><use href="#${ICON[p.cat] === "i-bouquet" ? "i-cup" : ICON[p.cat]}"/></svg>`;
}

// ---------- Tüte: Zeilen & Preise ----------
function defaultOpts(p) {
  return Object.fromEntries((p.options || []).map((g) => [g, BB.C.options[g].choices[0].id]));
}
function lineKey(id, opts, cardText) { return id + "|" + JSON.stringify(opts) + "|" + (cardText || ""); }
function unitPrice(p, opts) {
  return (p.options || []).reduce((s, g) => s + (BB.C.options[g].choices.find((c) => c.id === opts[g])?.price || 0), p.price);
}
function optLabels(p, opts) {
  return (p.options || []).flatMap((g) => {
    const group = BB.C.options[g];
    const c = group.choices.find((x) => x.id === opts[g]);
    if (!c || (c === group.choices[0] && g !== "combodrink")) return [];
    return g === "card" ? ["Grußkarte"] : [c.label];
  });
}
function bagLines() {
  return state.bag.filter((l) => BB.byId[l.id]).map((l) => {
    const p = BB.byId[l.id];
    return { ...l, p, unit: unitPrice(p, l.opts) };
  });
}
function totals() {
  const lines = bagLines();
  const subtotal = lines.reduce((s, l) => s + l.unit * l.qty, 0);
  const drinks = lines.reduce((n, l) => n + (l.p.drinks || 0) * l.qty, 0);
  const discount = state.reusable ? drinks * BB.C.shop.reusableDiscount : 0;
  return { subtotal, drinks, discount, total: Math.max(0, subtotal - discount), count: lines.reduce((n, l) => n + l.qty, 0) };
}
function qtyOf(id) { return state.bag.filter((l) => l.id === id).reduce((n, l) => n + l.qty, 0); }

function addLine(id, opts, qty = 1, cardText = "", fromEl = null) {
  const key = lineKey(id, opts, cardText);
  const line = state.bag.find((l) => l.key === key);
  if (line) line.qty = Math.min(20, line.qty + qty);
  else state.bag.push({ key, id, qty, opts, cardText });
  saveBag();
  flyToBag(fromEl);
  navigator.vibrate?.(12);
}
function changeLine(key, delta) {
  const line = state.bag.find((l) => l.key === key);
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) state.bag = state.bag.filter((l) => l !== line);
  saveBag();
}
// Schnell-Buttons in der Karte: + legt Standard-Variante dazu, − nimmt die zuletzt hinzugefügte weg
function quickChange(id, delta, fromEl) {
  const p = BB.byId[id];
  if (delta > 0) addLine(id, defaultOpts(p), 1, "", fromEl);
  else {
    const last = [...state.bag].reverse().find((l) => l.id === id);
    if (last) changeLine(last.key, -1);
  }
}
function saveBag() {
  store("bb-bag-v2", state.bag);
  document.dispatchEvent(new CustomEvent("bag:change"));
  renderBag();
}

function control(p) {
  const qty = qtyOf(p.id);
  return qty
    ? `<div class="stepper" data-id="${p.id}"><button data-act="dec" aria-label="${esc(p.name)}: eins weniger">−</button><span>${qty}</span><button data-act="inc" aria-label="${esc(p.name)}: eins mehr">+</button></div>`
    : `<button class="add" data-id="${p.id}" data-act="inc" aria-label="${esc(p.name)} in die Tüte">+</button>`;
}
function refreshControls() {
  $$("[data-item]").forEach((el) => {
    const old = $(".add, .stepper", el);
    if (old && !el.closest(".bag")) old.outerHTML = control(BB.byId[el.dataset.item]);
  });
}

// Kleiner Punkt fliegt vom Button zur Tüte
function flyToBag(fromEl) {
  const target = matchMedia("(max-width: 960px)").matches && !$("#floatBar").classList.contains("is-away") ? $("#floatBar .float-bar__icon") : $("#bagOpen");
  if (!fromEl || !target || matchMedia("(prefers-reduced-motion: reduce)").matches) return bump();
  const a = fromEl.getBoundingClientRect(), b = target.getBoundingClientRect();
  const dot = document.createElement("span");
  dot.className = "fly-dot";
  dot.style.left = a.left + a.width / 2 - 9 + "px";
  dot.style.top = a.top + a.height / 2 - 9 + "px";
  document.body.append(dot);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  dot.animate(
    [{ transform: "translate(0,0) scale(1)" }, { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) scale(1.1)`, offset: 0.5 }, { transform: `translate(${dx}px, ${dy}px) scale(.4)`, opacity: 0.6 }],
    { duration: 600, easing: "cubic-bezier(.5,0,.5,1)" }
  ).onfinish = () => { dot.remove(); bump(); };
}
function bump() {
  [$("#bagOpen"), $("#floatBar .float-bar__icon")].forEach((b) => { if (!b) return; b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); });
}

// ---------- Produktdetails (Bottom-Sheet) ----------
let sheetState = null;
function openProduct(id) {
  const p = BB.byId[id];
  if (!p) return;
  const ev = p.event && BB.events[p.event];
  let later = null; // Anlass noch zu weit weg → nur ansehen
  if (ev && daysUntil(eventPickupDay(ev)) > BB.C.shop.maxDaysAhead) {
    later = new Date(eventPickupDay(ev)); later.setDate(later.getDate() - BB.C.shop.maxDaysAhead);
  }
  sheetState = { id, opts: defaultOpts(p), qty: 1, cardText: "", later };
  $("#sheetBody").innerHTML = `
    <div class="sheet__art ${p.tone ? "tone-" + p.tone : isFloral(p) ? "tone-rose" : "tone-sage"}">${productArt(p)}</div>
    <div class="sheet__info">
      ${ev ? `<span class="eyebrow">${esc(ev.name)} · ${nextEventDate(ev).toLocaleDateString("de-DE", { day: "numeric", month: "long" })}</span>` : ""}
      <h3 id="sheetTitle">${esc(p.name)}</h3>
      <p>${esc(p.desc)}</p>
      ${(p.options || []).map((g) => {
        const group = BB.C.options[g];
        return `<fieldset class="opt"><legend>${group.label}</legend><div class="opt__choices">${group.choices.map((c) => `
          <label class="opt__choice"><input type="radio" name="opt-${g}" value="${c.id}" ${c.id === sheetState.opts[g] ? "checked" : ""}>
          <span>${esc(c.label)}${c.price ? ` <small>+${euro(c.price)}</small>` : ""}</span></label>`).join("")}</div>
          ${group.text ? `<textarea class="opt__text" id="cardText" rows="2" maxlength="200" placeholder="Dein Kartentext, z. B. „Alles Liebe, Anna“" hidden></textarea>` : ""}
        </fieldset>`;
      }).join("")}
    </div>`;
  updateSheet();
  const sheet = $("#sheet");
  sheet.classList.add("is-open");
  sheet.setAttribute("aria-hidden", "false");
  $("#sheetOverlay").hidden = false;
  document.documentElement.classList.add("no-scroll");
  $("#sheetBody").scrollTop = 0;
}
function updateSheet() {
  const p = BB.byId[sheetState.id];
  const card = $("#cardText");
  if (card) card.hidden = sheetState.opts.card !== "yes";
  $("#sheetQty").textContent = sheetState.qty;
  $("#sheetAdd").disabled = !!sheetState.later;
  $("#sheetAdd").innerHTML = sheetState.later
    ? `Vorbestellbar ab ${sheetState.later.toLocaleDateString("de-DE", { day: "numeric", month: "long" })}`
    : `In die Tüte <span>${euro(unitPrice(p, sheetState.opts) * sheetState.qty)}</span>`;
}
function closeSheet() {
  const sheet = $("#sheet");
  sheet.classList.remove("is-open");
  sheet.style.transform = "";
  sheet.setAttribute("aria-hidden", "true");
  $("#sheetOverlay").hidden = true;
  if (!$("#bag").classList.contains("is-open")) document.documentElement.classList.remove("no-scroll");
}

// ---------- Tüte (Drawer) ----------
function openBag() {
  closeSheet();
  $("#bag").classList.add("is-open");
  $("#bag").setAttribute("aria-hidden", "false");
  $("#bagOverlay").hidden = false;
  $("#floatBar").classList.add("is-hidden");
  document.documentElement.classList.add("no-scroll");
  const saved = load("bb-customer", null);
  const f = $("#bagForm");
  if (saved) { f.name.value ||= saved.name || ""; f.phone.value ||= saved.phone || ""; }
  renderBag();
}
function closeBag() {
  const bag = $("#bag");
  if (!bag.classList.contains("is-open")) return;
  bag.classList.remove("is-open");
  bag.style.transform = "";
  bag.setAttribute("aria-hidden", "true");
  $("#bagOverlay").hidden = true;
  $("#floatBar").classList.remove("is-hidden");
  document.documentElement.classList.remove("no-scroll");
  if (!$("#bagDone").hidden && !state.bag.length) showBagView("list");
}
function showBagView(view) {
  $("#bagMain").hidden = view !== "list";
  $("#bagFoot").hidden = view !== "list" || !state.bag.length;
  $("#bagDone").hidden = view !== "done";
  $("#bagTitle").textContent = view === "done" ? "Bestellt!" : "Deine To-go-Tüte";
}

function renderBag() {
  if (!BB.C) return;
  const lines = bagLines();
  const t = totals();
  $("#bagCount").textContent = t.count;
  $("#bagCount").classList.toggle("is-visible", t.count > 0);
  const float = $("#floatBar");
  float.classList.toggle("has-items", t.count > 0);
  $("#floatText").textContent = t.count ? `Tüte ansehen · ${t.count}` : "To go vorbestellen";
  $("#floatTotal").textContent = t.count ? euro(t.total) : "";

  $("#bagEmpty").hidden = lines.length > 0;
  $("#bagForm").hidden = lines.length === 0;
  if ($("#bagDone").hidden) $("#bagFoot").hidden = lines.length === 0;
  $("#bagList").innerHTML = lines.map((l) => {
    const labels = optLabels(l.p, l.opts);
    return `<li class="item" data-line="${esc(l.key)}">
      <span class="item__icon ${l.p.tone ? "tone-" + l.p.tone : ""}">${isFloral(l.p) ? bouquetSVG(l.p) : `<svg class="mini"><use href="#${ICON[l.p.cat] === "i-bouquet" ? "i-cup" : ICON[l.p.cat]}"/></svg>`}</span>
      <div class="item__text"><div class="item__name">${esc(l.p.name)}</div>
        <p class="item__desc">${labels.length ? esc(labels.join(" · ")) + " · " : ""}${euro(l.unit * l.qty)}</p>
        ${l.cardText ? `<p class="item__card">„${esc(l.cardText)}“</p>` : ""}</div>
      <div class="stepper stepper--line"><button data-line-act="dec" aria-label="weniger">−</button><span>${l.qty}</span><button data-line-act="inc" aria-label="mehr">+</button></div>
    </li>`;
  }).join("");

  $("#reusableCheck").closest(".check").hidden = t.drinks === 0;
  $("#reusableCheck").checked = state.reusable;
  $("#reusableSave").textContent = t.drinks ? `(−${euro(t.drinks * BB.C.shop.reusableDiscount)})` : "";
  $("#bagTotal").textContent = euro(t.total);
  fillPickupDays();
  refreshControls();
}

// Abholtag: heute + kommende Öffnungstage (bei Anlass-Artikeln bis zum Anlass)
function fillPickupDays() {
  const sel = $("#pickupDay");
  const prev = sel.value;
  const lines = bagLines();
  const eventDays = lines.filter((l) => l.p.event).map((l) => eventPickupDay(BB.events[l.p.event]));
  const lastEvent = eventDays.length ? Math.max(...eventDays.map((d) => daysUntil(d))) : 0;
  const range = Math.min(BB.C.shop.maxDaysAhead, Math.max(13, lastEvent));
  const opts = [];
  for (let i = 0; i <= range; i++) {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + i);
    if (!hoursOn(d) || (i === 0 && slotsFor(d).length === 0)) continue;
    const isEvent = eventDays.some((e) => isoDay(e) === isoDay(d));
    opts.push(`<option value="${isoDay(d)}">${dayLabel(d)}${isEvent ? " 🌷" : ""}</option>`);
  }
  sel.innerHTML = opts.join("");
  const suggested = eventDays.length ? isoDay(eventDays.sort((a, b) => a - b)[0]) : null;
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  else if (suggested && [...sel.options].some((o) => o.value === suggested)) sel.value = suggested;
  fillPickupTimes();
}
function slotsFor(day) {
  const h = hoursOn(day);
  if (!h) return [];
  const isToday = isoDay(day) === isoDay(new Date());
  const prep = Math.max(3, ...bagLines().map((l) => l.p.prep || 5));
  const slot = BB.C.shop.slotMinutes;
  const out = [];
  if (isToday) {
    const n = nowMin();
    if (n >= toMin(h[0]) && n + prep <= toMin(h[1])) out.push({ value: "asap", label: `So schnell wie möglich (ca. ${prep} Min.)` });
    for (let t = Math.ceil(Math.max(n + prep + 1, toMin(h[0]) + prep) / slot) * slot; t <= toMin(h[1]) - 5; t += slot) out.push({ value: fromMin(t), label: `${fromMin(t)} Uhr` });
  } else {
    for (let t = toMin(h[0]) + 30; t <= toMin(h[1]) - 5; t += 30) out.push({ value: fromMin(t), label: `${fromMin(t)} Uhr` });
  }
  return out;
}
function fillPickupTimes() {
  const sel = $("#pickupTime");
  const prev = sel.value;
  const dayVal = $("#pickupDay").value;
  const slots = dayVal ? slotsFor(new Date(dayVal + "T12:00:00")) : [];
  sel.innerHTML = slots.map((s) => `<option value="${s.value}">${s.label}</option>`).join("") || `<option value="">–</option>`;
  if (slots.some((s) => s.value === prev)) sel.value = prev;
  const none = slots.length === 0;
  $("#sendOrder").disabled = none || state.sending;
  const note = $("#bagNote");
  if (none && state.bag.length) {
    const next = nextOpening();
    note.textContent = `Gerade ist keine Abholung möglich${next ? ` – wieder ${next.label} ab ${next.time} Uhr` : ""}.`;
    note.className = "form-note";
    note.hidden = false;
  } else if (note.dataset.kind !== "error") note.hidden = true;
}

// ---------- Bestellen ----------
async function sendOrder() {
  const f = $("#bagForm");
  const note = $("#bagNote");
  const showError = (msg) => { note.textContent = msg; note.className = "form-note"; note.dataset.kind = "error"; note.hidden = false; };
  delete note.dataset.kind;
  if (!f.name.value.trim()) { showError("Bitte gib deinen Namen an, damit wir die Bestellung zuordnen können."); f.name.focus(); return; }
  store("bb-customer", { name: f.name.value.trim(), phone: f.phone.value.trim() });

  const payload = {
    lines: state.bag.map(({ id, qty, opts, cardText }) => ({ id, qty, opts, cardText })),
    pickupDate: $("#pickupDay").value, pickupTime: $("#pickupTime").value,
    name: f.name.value.trim(), phone: f.phone.value.trim(), notes: f.notes.value.trim(), reusable: state.reusable,
  };
  state.sending = true;
  $("#sendOrder").disabled = true;
  $("#sendOrder").textContent = "Wird gesendet …";
  try {
    const res = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Bestellung fehlgeschlagen.");
    state.active = { token: data.token, number: data.number };
    store("bb-active-order", state.active);
    state.bag = [];
    f.notes.value = "";
    saveBag();
    renderDone(data);
    showBagView("done");
    startTracking();
  } catch (e) {
    if (e instanceof TypeError) showFallback(payload);
    else showError(e.message);
  } finally {
    state.sending = false;
    $("#sendOrder").textContent = "Verbindlich vorbestellen";
    fillPickupTimes();
  }
}

// Ohne Server (z. B. Datei direkt geöffnet): Bestellung per WhatsApp/E-Mail schicken
function showFallback(payload) {
  const t = totals();
  const text = [
    `Hallo ${BB.C.shop.name}! Ich möchte zum Mitnehmen vorbestellen:`, "",
    ...bagLines().map((l) => `• ${l.qty}× ${l.p.name}${optLabels(l.p, l.opts).length ? ` (${optLabels(l.p, l.opts).join(", ")})` : ""} – ${euro(l.unit * l.qty)}${l.cardText ? `\n   Karte: „${l.cardText}“` : ""}`),
    t.discount ? `• Mehrwegbecher – −${euro(t.discount)}` : null, "",
    `Gesamt: ${euro(t.total)} (Zahlung bei Abholung)`,
    `Abholung: ${$("#pickupDay").selectedOptions[0]?.text || ""}, ${$("#pickupTime").selectedOptions[0]?.text || ""}`,
    `Name: ${payload.name}`, payload.phone ? `Telefon: ${payload.phone}` : null, payload.notes ? `Wünsche: ${payload.notes}` : null,
  ].filter((l) => l !== null).join("\n");
  const note = $("#bagNote");
  note.className = "form-note";
  note.dataset.kind = "error";
  note.innerHTML = `Keine Verbindung zum Café-Server. Schick uns die Bestellung einfach direkt:
    <span class="fallback"><a class="btn btn--whatsapp" target="_blank" rel="noopener" href="https://wa.me/${BB.C.shop.whatsapp}?text=${encodeURIComponent(text)}">WhatsApp</a>
    <a class="btn btn--ghost" href="mailto:${BB.C.shop.email}?subject=${encodeURIComponent("Vorbestellung – " + payload.name)}&body=${encodeURIComponent(text)}">E-Mail</a></span>`;
  note.hidden = false;
}

// ---------- Live-Status ----------
const STEPS = ["neu", "zubereitung", "abholbereit", "abgeholt"];
let trackTimer = null;
function statusText(s) {
  return { neu: "Bestellung eingegangen", zubereitung: "Wird zubereitet …", abholbereit: "Abholbereit – bis gleich!", abgeholt: "Abgeholt – danke!", storniert: "Storniert – bitte ruf uns an" }[s] || s;
}
function pickupText(o) {
  const d = new Date(o.pickupDate + "T12:00:00");
  return o.pickupTime === "asap" ? "so schnell wie möglich" : `${dayLabel(d)}, ${o.pickupTime} Uhr`;
}
function renderDone(o) {
  $("#doneNumber").textContent = "#" + o.number;
  $("#donePickup").textContent = pickupText(o);
  $("#doneStatus").textContent = statusText(o.status);
  const idx = STEPS.indexOf(o.status);
  $$("#doneTracker li").forEach((li, i) => { li.classList.toggle("is-done", i < idx || idx === 3); li.classList.toggle("is-current", i === idx); });
  $("#doneLines").innerHTML = o.lines.map((l) => `<li>${l.qty}× ${esc(l.name)}${l.opts.length ? ` <small>${esc(l.opts.join(" · "))}</small>` : ""}</li>`).join("");
  $("#doneTotal").textContent = euro(o.total);
  const banner = $("#orderBanner");
  banner.dataset.status = o.status;
  $("#orderBannerText").textContent = `#${o.number} · ${statusText(o.status)}`;
}
async function pollStatus() {
  if (!state.active) return stopTracking();
  try {
    const res = await fetch(`/api/status/${encodeURIComponent(state.active.token)}`);
    if (res.status === 404) return clearActive();
    if (!res.ok) return;
    const o = await res.json();
    if (state.active.status && state.active.status !== o.status) {
      toast(o.status === "abholbereit" ? "🌷 Deine Bestellung ist abholbereit!" : statusText(o.status));
      navigator.vibrate?.(o.status === "abholbereit" ? [80, 60, 80, 60, 160] : 30);
    }
    state.active.status = o.status;
    store("bb-active-order", state.active);
    renderDone(o);
    $("#orderBanner").hidden = false;
    if (o.status === "abgeholt" || o.status === "storniert") { stopTracking(); setTimeout(clearActive, 5 * 60_000); }
  } catch { /* offline */ }
}
function startTracking() {
  stopTracking();
  if (!state.active) return;
  pollStatus();
  trackTimer = setInterval(pollStatus, 6000);
}
function stopTracking() { clearInterval(trackTimer); }
function clearActive() { state.active = null; store("bb-active-order", null); $("#orderBanner").hidden = true; stopTracking(); }

// ---------- Kleinkram ----------
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("is-visible"), 2200);
}
function closeNav() { $("#nav")?.classList.remove("is-open"); $("#burger")?.setAttribute("aria-expanded", "false"); }

function swipeToClose(panel, onClose) {
  let y0 = null, dy = 0;
  $$(".panel__handle, .panel__head", panel).forEach((el) => el.addEventListener("touchstart", (e) => {
    if (!matchMedia("(max-width: 760px)").matches) return;
    y0 = e.touches[0].clientY; dy = 0; panel.style.transition = "none";
  }, { passive: true }));
  panel.addEventListener("touchmove", (e) => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  panel.addEventListener("touchend", () => {
    if (y0 === null) return;
    panel.style.transition = ""; y0 = null;
    if (dy > 110) onClose(); else panel.style.transform = "";
  });
}

// ---------- Gemeinsames Markup (Icons, Tüte, Detail-Sheet, Button, Toast) ----------
function mountShared() {
  document.body.insertAdjacentHTML("afterbegin", `
  <svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <symbol id="i-cup" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="11" y="8" width="26" height="5" rx="2"/><path d="M13.5 13l3 27a2 2 0 0 0 2 1.8h11a2 2 0 0 0 2-1.8l3-27"/><path d="M15 21h18M16 30h16"/></g></symbol>
    <symbol id="i-glass" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 12h22l-3 29a2 2 0 0 1-2 1.8H18a2 2 0 0 1-2-1.8z"/><path d="M27 12l5-7"/><rect x="18" y="20" width="6" height="6" rx="1"/><rect x="24.5" y="25" width="6" height="6" rx="1"/></g></symbol>
    <symbol id="i-flower" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="17" r="3.5"/><path d="M24 13.5c-2-5 4-7 3.5-1.5M27.3 15.8c4.5-2.6 6.5 3.4 1.4 3.3M26.6 20.1c3 4.4-2.6 7.2-3 2.1M21.2 19.8c-4.8 2-5.7-4.2-.9-3.7M21.2 14.4c-3.8-3.4 1.4-7.4 2.5-2.3"/><path d="M24 20.5V43M24 34c-6 0-9-4-9-8 5 0 9 3 9 8zM24 38c5 0 8-3 8-7-4.5 0-8 2.5-8 7z"/></g></symbol>
    <symbol id="i-bean" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="24" cy="24" rx="11" ry="15" transform="rotate(30 24 24)"/><path d="M19 12c6 6 2 17 9 24"/></g></symbol>
    <symbol id="i-bouquet" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="17" cy="14" r="5"/><circle cx="31" cy="13" r="5"/><circle cx="24" cy="9" r="4.5"/><path d="M14 22h20l-8.5 20h-3z"/><path d="M19 19l3 3M29 18l-3 4M24 14v8"/></g></symbol>
    <symbol id="i-bag" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></g></symbol>
    <symbol id="i-clock" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></g></symbol>
    <symbol id="i-pin" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></g></symbol>
    <symbol id="i-leaf" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19c0-9 5-14 15-14 0 10-5 15-14 15"/><path d="M5 19l8-8"/></g></symbol>
    <symbol id="i-cal" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></g></symbol>
  </defs></svg>`);

  document.body.insertAdjacentHTML("beforeend", `
  <button class="order-banner" id="orderBanner" hidden><span class="order-banner__dot"></span><span id="orderBannerText">Deine Bestellung</span><span class="order-banner__more">Status ›</span></button>

  <button class="float-bar is-away" id="floatBar">
    <span class="float-bar__icon"><svg><use href="#i-bag"/></svg></span>
    <span class="float-bar__text" id="floatText">To go vorbestellen</span>
    <span class="float-bar__total" id="floatTotal"></span>
  </button>

  <div class="overlay" id="sheetOverlay" hidden></div>
  <aside class="panel sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle" aria-hidden="true">
    <div class="panel__handle" aria-hidden="true"></div>
    <div class="panel__head panel__head--float"><button class="icon-btn" id="sheetClose" aria-label="Schließen">✕</button></div>
    <div class="panel__body" id="sheetBody"></div>
    <div class="panel__foot sheet__foot">
      <div class="stepper stepper--big"><button id="sheetMinus" aria-label="weniger">−</button><span id="sheetQty">1</span><button id="sheetPlus" aria-label="mehr">+</button></div>
      <button class="btn btn--primary" id="sheetAdd">In die Tüte</button>
    </div>
  </aside>

  <div class="overlay" id="bagOverlay" hidden></div>
  <aside class="panel bag" id="bag" role="dialog" aria-modal="true" aria-labelledby="bagTitle" aria-hidden="true">
    <div class="panel__handle" aria-hidden="true"></div>
    <div class="panel__head"><h3 id="bagTitle">Deine To-go-Tüte</h3><button class="icon-btn" id="bagClose" aria-label="Schließen">✕</button></div>
    <div class="panel__body">
      <div id="bagMain">
        <ul class="bag-list" id="bagList"></ul>
        <div class="bag-empty" id="bagEmpty"><svg><use href="#i-bag"/></svg><p>Noch leer – such dir was Schönes aus.</p><a class="btn btn--ghost" href="index.html#karte" data-close-bag>Zur Karte</a></div>
        <form id="bagForm" novalidate>
          <label class="check"><input type="checkbox" id="reusableCheck"><span>Ich bringe einen Mehrwegbecher mit <b id="reusableSave"></b></span></label>
          <div class="field-row field-row--keep">
            <label class="field"><span>Abholtag</span><select id="pickupDay"></select></label>
            <label class="field"><span>Uhrzeit</span><select id="pickupTime"></select></label>
          </div>
          <div class="field-row">
            <label class="field"><span>Name *</span><input name="name" required autocomplete="given-name" enterkeyhint="next"></label>
            <label class="field"><span>Telefon</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" enterkeyhint="next"></label>
          </div>
          <label class="field"><span>Wünsche</span><input name="notes" maxlength="300" placeholder="z. B. extra heiß, ohne Deckel …" enterkeyhint="done"></label>
        </form>
      </div>
      <div class="done" id="bagDone" hidden>
        <div class="done__icon">✓</div>
        <p class="done__lead">Danke! Deine Bestellung <b id="doneNumber"></b> ist bei uns.</p>
        <p class="done__pickup">Abholung: <b id="donePickup"></b></p>
        <ol class="tracker" id="doneTracker"><li><span></span>Eingegangen</li><li><span></span>In Zubereitung</li><li><span></span>Abholbereit</li></ol>
        <p class="done__status" id="doneStatus"></p>
        <ul class="done__lines" id="doneLines"></ul>
        <p class="done__total">Zu zahlen bei Abholung: <b id="doneTotal"></b></p>
        <button class="btn btn--ghost btn--block" id="doneNew">Weiter stöbern</button>
      </div>
    </div>
    <div class="panel__foot" id="bagFoot">
      <div class="sum"><span>Gesamt <small>– bezahlt wird bei Abholung</small></span><strong id="bagTotal">0,00 €</strong></div>
      <p class="form-note" id="bagNote" hidden></p>
      <button class="btn btn--primary btn--block" id="sendOrder">Verbindlich vorbestellen</button>
    </div>
  </aside>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>`);
}

function bindShared() {
  document.addEventListener("click", (e) => {
    // Schnell-Buttons (+/−) in Karten & Listen
    const act = e.target.closest("[data-act]");
    if (act) {
      const id = act.dataset.id || act.closest("[data-id]").dataset.id;
      return quickChange(id, act.dataset.act === "inc" ? 1 : -1, act);
    }
    // Zeilen in der Tüte
    const lineAct = e.target.closest("[data-line-act]");
    if (lineAct) return changeLine(lineAct.closest("[data-line]").dataset.line, lineAct.dataset.lineAct === "inc" ? 1 : -1);
    // Tippen auf ein Produkt öffnet die Details
    const item = e.target.closest("[data-item]");
    if (item && !item.closest(".bag") && !e.target.closest("a, button, input, select, textarea")) openProduct(item.dataset.item);
  });
  // Tastatur: Produktkarten sind fokussierbar
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeSheet(); closeBag(); closeNav(); }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-item]")) { e.preventDefault(); openProduct(e.target.dataset.item); }
  });

  $("#sheetBody").addEventListener("change", (e) => {
    if (e.target.name?.startsWith("opt-")) { sheetState.opts[e.target.name.slice(4)] = e.target.value; updateSheet(); }
  });
  $("#sheetBody").addEventListener("input", (e) => { if (e.target.id === "cardText") sheetState.cardText = e.target.value; });
  $("#sheetMinus").addEventListener("click", () => { sheetState.qty = Math.max(1, sheetState.qty - 1); updateSheet(); });
  $("#sheetPlus").addEventListener("click", () => { sheetState.qty = Math.min(20, sheetState.qty + 1); updateSheet(); });
  $("#sheetAdd").addEventListener("click", (e) => {
    const s = sheetState;
    addLine(s.id, { ...s.opts }, s.qty, s.opts.card === "yes" ? s.cardText.trim() : "", e.currentTarget);
    toast(`${BB.byId[s.id].name} ist in der Tüte`);
    setTimeout(closeSheet, 150);
  });
  $("#sheetClose").addEventListener("click", closeSheet);
  $("#sheetOverlay").addEventListener("click", closeSheet);

  $("#bagOpen").addEventListener("click", openBag);
  $("#bagClose").addEventListener("click", closeBag);
  $("#bagOverlay").addEventListener("click", closeBag);
  $("#orderBanner").addEventListener("click", () => { openBag(); showBagView("done"); pollStatus(); });
  $("#doneNew").addEventListener("click", () => { showBagView("list"); closeBag(); });
  $$("[data-close-bag]").forEach((a) => a.addEventListener("click", closeBag));
  $("#floatBar").addEventListener("click", () => {
    if (state.bag.length) openBag();
    else if ($("#karte")) $("#karte").scrollIntoView({ behavior: "smooth" });
    else location.href = "index.html#karte";
  });
  $("#reusableCheck").addEventListener("change", (e) => { state.reusable = e.target.checked; store("bb-reusable", state.reusable); renderBag(); });
  $("#pickupDay").addEventListener("change", fillPickupTimes);
  $("#sendOrder").addEventListener("click", sendOrder);
  $("#bagForm").addEventListener("submit", (e) => { e.preventDefault(); sendOrder(); });
  swipeToClose($("#bag"), closeBag);
  swipeToClose($("#sheet"), closeSheet);

  $("#burger")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = $("#nav").classList.toggle("is-open");
    $("#burger").setAttribute("aria-expanded", open);
  });
  $$("#nav a").forEach((a) => a.addEventListener("click", closeNav));
  document.addEventListener("click", (e) => !e.target.closest("#nav, #burger") && closeNav());
  addEventListener("scroll", () => $(".header").classList.toggle("is-scrolled", scrollY > 8), { passive: true });
  document.addEventListener("visibilitychange", () => !document.hidden && state.active && pollStatus());

  // Schwebender Button erst, wenn der Haupt-Button der Seite aus dem Bild ist
  const cta = $("[data-float-anchor]");
  if (cta) new IntersectionObserver(([e]) => $("#floatBar").classList.toggle("is-away", e.isIntersecting)).observe(cta);
  else $("#floatBar").classList.remove("is-away");
}

function fillShopInfo() {
  const s = BB.C.shop;
  const values = { name: s.name, street: s.street, area: s.area, city: s.city, seats: s.seats, reusable: "−" + euro(s.reusableDiscount), reusableAmount: euro(s.reusableDiscount) };
  $$("[data-shop]").forEach((el) => { if (values[el.dataset.shop] !== undefined) el.textContent = values[el.dataset.shop]; });
  $$("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));
}

// ---------- Start ----------
BB.ready = (async () => {
  mountShared();
  bindShared();
  try {
    BB.C = await (await fetch("catalog.json", { cache: "no-store" })).json();
  } catch {
    document.body.insertAdjacentHTML("afterbegin", `<div class="offline-note">Die Seite muss über den Café-Server geöffnet werden: <b>start_server.bat</b> doppelklicken.</div>`);
    throw new Error("Katalog nicht geladen");
  }
  BB.byId = Object.fromEntries(BB.C.products.map((p) => [p.id, p]));
  BB.events = Object.fromEntries(BB.C.events.map((e) => [e.id, e]));
  fillShopInfo();
  renderBag();
  if (state.active) { $("#orderBanner").hidden = false; startTracking(); }
  setInterval(fillPickupTimes, 60_000);
  return BB;
})();
