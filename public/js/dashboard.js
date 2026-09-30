// Inhaber-Dashboard: Kennzahlen, Diagramme, Live-Board, Vorbestellungen & Anfragen
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const euro = (n) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const euro0 = (n) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const num = (n, d = 0) => n.toLocaleString("de-DE", { maximumFractionDigits: d, minimumFractionDigits: d });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
function load(k, f) { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } }
function store(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// Bereiche für „Umsatz nach Bereich“ – feste Reihenfolge = feste Farbe
const AREAS = [
  { id: "drinks", label: "Kaffee & Getränke", cats: ["coffee", "flowerdrinks", "cold"], color: "var(--series-1)" },
  { id: "flowers", label: "Sträuße", cats: ["bouquets"], color: "var(--series-2)" },
  { id: "beans", label: "Bohnen", cats: ["beans"], color: "var(--series-3)" },
  { id: "events", label: "Anlässe", cats: ["event"], color: "var(--series-4)" },
];
const OPEN = ["neu", "zubereitung", "abholbereit"];
const NEXT = { neu: ["zubereitung", "Zubereiten"], zubereitung: ["abholbereit", "Abholbereit ✓"], abholbereit: ["abgeholt", "Abgeholt"] };

const S = {
  pin: load("bb-dash-pin", null), data: null, range: 1, tab: "overview",
  seen: new Set(), first: true, flash: new Set(), sound: load("bb-dash-sound", true), offset: 0,
};
let audio = null;

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", "X-Dashboard-Pin": S.pin } });
  if (res.status === 401) { logout("PIN ungültig."); throw new Error("401"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Fehler");
  return data;
}

async function login(pin) {
  S.pin = pin;
  try {
    const res = await fetch("/api/dashboard/data", { headers: { "X-Dashboard-Pin": pin } });
    if (res.status === 401) throw new Error("Falsche PIN.");
    const data = await res.json();
    store("bb-dash-pin", pin);
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    $("#login").hidden = true;
    $("#app").hidden = false;
    apply(data);
    setInterval(poll, 5000);
  } catch (e) {
    $("#loginError").textContent = e instanceof TypeError ? "Server nicht erreichbar – läuft start_server.bat?" : e.message;
    $("#loginError").hidden = false;
  }
}
function logout(msg) {
  store("bb-dash-pin", null);
  if (msg) alert(msg);
  location.reload();
}

async function poll() {
  try { apply(await api("/api/dashboard/data")); $("#live").classList.remove("is-off"); $("#live em").textContent = "Live"; }
  catch (e) { if (e.message !== "401") { $("#live").classList.add("is-off"); $("#live em").textContent = "Keine Verbindung"; } }
}

function now() { return new Date(Date.now() + S.offset); }

function apply(data) {
  S.offset = Date.parse(data.serverTime) - Date.now();
  // Neue Bestellungen erkennen → Ton + Hinweis
  const fresh = data.orders.filter((o) => o.status === "neu" && !S.seen.has(o.number));
  data.orders.forEach((o) => S.seen.add(o.number));
  if (!S.first && fresh.length) {
    fresh.forEach((o) => { S.flash.add(o.number); setTimeout(() => S.flash.delete(o.number), 8000); });
    ding();
    toast(fresh.length === 1 ? `🌷 Neue Bestellung #${fresh[0].number} von ${fresh[0].customer.name}` : `🌷 ${fresh.length} neue Bestellungen`);
  }
  S.first = false;
  S.data = data;
  $("#live em").textContent = "Live";
  $("#demoBar").hidden = !data.hasDemo;
  render();
}

function ding() {
  if (!S.sound || !audio) return;
  audio.resume();
  [784, 1047].forEach((f, i) => {
    const t = audio.currentTime + i * 0.18, o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.26);
  });
}

// ---------- Auswertung ----------
const valid = (o) => o.status !== "storniert";
function inRange(o, days, endOffset = 0) {
  const end = now(); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + 1 - endOffset);
  const start = new Date(end); start.setDate(start.getDate() - days);
  const d = new Date(o.createdAt);
  return d >= start && d < end;
}
function stats(list) {
  const orders = list.filter(valid);
  const revenue = orders.reduce((s, o) => s + o.total, 0);
  const withDrinks = orders.filter((o) => o.lines.some((l) => l.drinks));
  return {
    count: orders.length, revenue, avg: orders.length ? revenue / orders.length : 0,
    reuse: withDrinks.length ? withDrinks.filter((o) => o.reusable).length / withDrinks.length : 0,
  };
}
function delta(cur, prev, fmt) {
  if (!prev) return `<span>–</span>`;
  const d = (cur - prev) / prev;
  const cls = d >= 0 ? "up" : "down";
  return `<b class="${cls}">${d >= 0 ? "▲" : "▼"} ${num(Math.abs(d) * 100)} %</b> ${fmt}`;
}

// ---------- Rendern ----------
function render() {
  const orders = S.data.orders;
  const today = isoDay(now());
  const open = orders.filter((o) => OPEN.includes(o.status) && o.pickupDate <= today);
  const pre = orders.filter((o) => o.pickupDate > today && valid(o));
  const newInq = S.data.inquiries.filter((i) => i.status === "neu");
  setBadge("#badgeOrders", open.filter((o) => o.status === "neu").length);
  setBadge("#badgePre", pre.length);
  setBadge("#badgeInq", newInq.length);
  document.title = open.some((o) => o.status === "neu") ? `(${open.filter((o) => o.status === "neu").length}) Neu · Dashboard` : "Dashboard · Blüte & Bohne";

  renderOverview();
  renderBoard(open, orders.filter((o) => o.pickupDate === today && !OPEN.includes(o.status)));
  renderPre(pre);
  renderInquiries();
}
function setBadge(sel, n) { $(sel).hidden = !n; $(sel).textContent = n; }

function renderOverview() {
  const days = S.range;
  const cur = S.data.orders.filter((o) => inRange(o, days));
  const s = stats(cur);
  const n = now();
  $("#overviewTitle").textContent = days === 1 ? "Heute" : "Letzte 7 Tage";
  $("#overviewSub").textContent = days === 1
    ? n.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }) + ` · Stand ${pad(n.getHours())}:${pad(n.getMinutes())} Uhr`
    : "inkl. heute";

  // Vergleich: heute ↔ gleicher Wochentag letzte Woche (bis zur gleichen Uhrzeit)
  let cmp = null;
  if (days === 1) {
    const cutoff = n.getHours() * 60 + n.getMinutes();
    cmp = stats(S.data.orders.filter((o) => inRange(o, 1, 7) && (new Date(o.createdAt).getHours() * 60 + new Date(o.createdAt).getMinutes()) <= cutoff));
  }
  const vs = "vs. letzte Woche";
  $("#kpis").innerHTML = [
    ["Bestellungen", num(s.count), cmp ? delta(s.count, cmp.count, vs) : `Ø ${num(s.count / 7, 1)} pro Tag`],
    ["Umsatz", euro0(s.revenue), cmp ? delta(s.revenue, cmp.revenue, vs) : `Ø ${euro0(s.revenue / 7)} pro Tag`],
    ["Ø Bon", euro(s.avg), cmp ? delta(s.avg, cmp.avg, vs) : "pro Bestellung"],
    ["Mehrweg-Quote", num(s.reuse * 100) + " %", "der Bestellungen mit Getränk"],
  ].map(([l, v, d]) => `<div class="kpi"><div class="kpi__label">${l}</div><div class="kpi__value">${v}</div><div class="kpi__delta">${d}</div></div>`).join("");

  // Zeitverlauf
  let rows;
  if (days === 1) {
    const hours = Array.from({ length: 12 }, (_, i) => i + 7);
    rows = hours.map((h) => {
      const list = cur.filter((o) => valid(o) && new Date(o.createdAt).getHours() === h);
      return { label: `${h}`, full: `${h}:00–${h + 1}:00 Uhr`, value: list.length, revenue: list.reduce((a, o) => a + o.total, 0) };
    });
    $("#chartTimeTitle").textContent = "Bestellungen pro Stunde";
    $("#chartTimeSub").textContent = "Wann ist am meisten los?";
  } else {
    rows = Array.from({ length: 7 }, (_, i) => {
      const d = now(); d.setDate(d.getDate() - 6 + i);
      const list = S.data.orders.filter((o) => valid(o) && o.createdAt.startsWith(isoDay(d)));
      return { label: i === 6 ? "Heute" : WD[d.getDay()], full: d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "numeric" }), value: list.length, revenue: list.reduce((a, o) => a + o.total, 0) };
    });
    $("#chartTimeTitle").textContent = "Bestellungen pro Tag";
    $("#chartTimeSub").textContent = "Umsatz je Tag im Tooltip & in der Tabelle";
  }
  barChart($("#chartTime"), rows, (r) => `<b>${r.full}</b><br>${r.value} Bestellungen · ${euro(r.revenue)}`);
  $("#tableTime").innerHTML = table(["Zeitraum", "Bestellungen", "Umsatz"], rows.map((r) => [r.full, num(r.value), euro(r.revenue)]));

  // Umsatz nach Bereich
  const byArea = AREAS.map((a) => ({ ...a, value: cur.filter(valid).flatMap((o) => o.lines).filter((l) => a.cats.includes(l.cat)).reduce((s2, l) => s2 + l.unit * l.qty, 0) }));
  const total = byArea.reduce((a, b) => a + b.value, 0);
  $("#mixSub").textContent = total ? `${euro0(total)} Warenwert` : "";
  $("#chartMix").innerHTML = total
    ? `<div class="mix-bar" role="img" aria-label="Umsatzanteile nach Bereich">${byArea.filter((a) => a.value).map((a) => `<span style="width:${(a.value / total) * 100}%;background:${a.color}" data-tip="<b>${a.label}</b><br>${euro(a.value)} · ${num((a.value / total) * 100)} %"></span>`).join("")}</div>
       <ul class="legend">${byArea.map((a) => `<li><i style="background:${a.color}"></i><span>${a.label}</span><b>${euro0(a.value)}</b><small>${num(total ? (a.value / total) * 100 : 0)} %</small></li>`).join("")}</ul>`
    : `<p class="empty">Noch keine Umsätze in diesem Zeitraum.</p>`;
  $("#tableMix").innerHTML = table(["Bereich", "Umsatz", "Anteil"], byArea.map((a) => [a.label, euro(a.value), num(total ? (a.value / total) * 100 : 0) + " %"]));

  // Top-Produkte
  const qty = {};
  cur.filter(valid).flatMap((o) => o.lines).forEach((l) => { qty[l.name] = (qty[l.name] || 0) + l.qty; });
  const top = Object.entries(qty).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ label: name, value }));
  hBarChart($("#chartTop"), top);
  $("#tableTop").innerHTML = table(["Produkt", "Menge"], top.map((r) => [r.label, num(r.value)]));

  // Gerade offen
  const today = isoDay(now());
  const open = S.data.orders.filter((o) => OPEN.includes(o.status) && o.pickupDate <= today).sort(byPickup);
  $("#openMini").innerHTML = open.length
    ? open.slice(0, 6).map((o) => `<li><span class="no">#${o.number}</span><span class="st st--${o.status}">${statusLabel(o.status)}</span><span class="what">${esc(o.customer.name)} · ${o.lines.map((l) => `${l.qty}× ${l.name}`).join(", ")}</span><span>${when(o)}</span></li>`).join("")
    : `<li class="empty">Alles erledigt – keine offenen Bestellungen. ☕</li>`;
}

function table(head, rows) {
  return `<table><thead><tr>${head.map((h, i) => `<th class="${i ? "num" : ""}">${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? "num" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

// Säulendiagramm (eine Reihe): dünne Balken, 4px abgerundete Enden an der Basislinie, dezentes Raster
function barChart(el, rows, tip) {
  // In echter Pixelbreite zeichnen, damit Schrift & Linien nicht mitskalieren
  const W = Math.max(280, el.clientWidth || 720), H = W < 500 ? 200 : 240, L = 30, B = 24, T = 18;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const bw = (W - L) / rows.length;
  const barW = Math.min(34, bw * 0.56);
  const peak = rows.reduce((m, r, i) => (r.value > rows[m].value ? i : m), 0);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Säulendiagramm">`;
  for (let v = 0; v <= top; v += step) svg += `<line class="${v ? "gridline" : "baseline"}" x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  rows.forEach((r, i) => {
    const x = L + i * bw + (bw - barW) / 2;
    const h = y(0) - y(r.value);
    const r4 = Math.min(4, h / 2, barW / 2);
    // oben abgerundet, unten gerade auf der Basislinie
    const path = h > 0 ? `M${x},${y(0)} V${y(r.value) + r4} Q${x},${y(r.value)} ${x + r4},${y(r.value)} H${x + barW - r4} Q${x + barW},${y(r.value)} ${x + barW},${y(r.value) + r4} V${y(0)} Z` : "";
    svg += `<rect class="hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" data-i="${i}"/>`;
    if (path) svg += `<path class="bar" d="${path}" data-i="${i}"/>`;
    if (i === peak && r.value) svg += `<text class="value" x="${x + barW / 2}" y="${y(r.value) - 6}" text-anchor="middle">${r.value}</text>`;
    svg += `<text class="tick" x="${x + barW / 2}" y="${H - 6}" text-anchor="middle">${esc(r.label)}</text>`;
  });
  el.innerHTML = svg + "</svg>";
  bindTips(el, (i) => tip(rows[i]));
}

// Balkendiagramm (horizontal) mit Werten direkt am Balken
function hBarChart(el, rows) {
  if (!rows.length) { el.innerHTML = `<p class="empty">Noch keine Verkäufe in diesem Zeitraum.</p>`; return; }
  const W = Math.max(280, el.clientWidth || 520), rowH = 34, L = Math.min(170, W * 0.42), R = 40, H = rows.length * rowH;
  const max = Math.max(...rows.map((r) => r.value));
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Top-Produkte">`;
  rows.forEach((r, i) => {
    const y0 = i * rowH + 8, h = rowH - 16, w = Math.max(2, ((W - L - R) * r.value) / max);
    const r4 = Math.min(4, h / 2);
    svg += `<rect class="hit" x="0" y="${i * rowH}" width="${W}" height="${rowH}" data-i="${i}"/>`;
    const maxChars = Math.floor((L - 10) / 6.6);
    svg += `<text class="label" x="${L - 10}" y="${y0 + h / 2 + 4}" text-anchor="end">${esc(r.label.length > maxChars ? r.label.slice(0, maxChars - 1) + "…" : r.label)}</text>`;
    svg += `<path class="bar" data-i="${i}" d="M${L},${y0} H${L + w - r4} Q${L + w},${y0} ${L + w},${y0 + r4} V${y0 + h - r4} Q${L + w},${y0 + h} ${L + w - r4},${y0 + h} H${L} Z"/>`;
    svg += `<text class="value" x="${L + w + 6}" y="${y0 + h / 2 + 4}">${r.value}</text>`;
  });
  el.innerHTML = svg + "</svg>";
  bindTips(el, (i) => `<b>${esc(rows[i].label)}</b><br>${rows[i].value}× verkauft`);
}
function niceStep(max) {
  const raw = max / 4, mag = 10 ** Math.floor(Math.log10(raw)), n = raw / mag;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag);
}

// Tooltips: Maus & Touch (Tippen zeigt, Tippen daneben blendet aus)
function bindTips(el, content) {
  const tip = $("#tooltip");
  const show = (e) => {
    const t = e.target.closest("[data-i]");
    if (!t) return hide();
    $$(".bar", el).forEach((b) => b.classList.toggle("is-hover", b.dataset.i === t.dataset.i));
    tip.innerHTML = content(+t.dataset.i);
    const bar = $(`.bar[data-i="${t.dataset.i}"]`, el) || t;
    const r = bar.getBoundingClientRect();
    tip.style.left = Math.min(innerWidth - 90, Math.max(90, r.left + r.width / 2)) + "px";
    tip.style.top = r.top + "px";
    tip.hidden = false;
  };
  const hide = () => { tip.hidden = true; $$(".bar", el).forEach((b) => b.classList.remove("is-hover")); };
  el.onpointermove = show;
  el.onpointerdown = show;
  el.onpointerleave = hide;
}
document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".chart, .mix-bar")) $("#tooltip").hidden = true; });
document.addEventListener("pointermove", (e) => {
  const seg = e.target.closest(".mix-bar span");
  const tip = $("#tooltip");
  if (seg) { tip.innerHTML = seg.dataset.tip; const r = seg.getBoundingClientRect(); tip.style.left = r.left + r.width / 2 + "px"; tip.style.top = r.top + "px"; tip.hidden = false; }
  else if (e.target.closest("#chartMix")) tip.hidden = true;
});

// ---------- Bestellungen ----------
const statusLabel = (s) => ({ neu: "Neu", zubereitung: "In Zubereitung", abholbereit: "Abholbereit", abgeholt: "Abgeholt", storniert: "Storniert" }[s]);
function when(o) {
  if (o.pickupTime === "asap") return "sofort";
  const today = isoDay(now());
  if (o.pickupDate === today) return o.pickupTime;
  const d = new Date(o.pickupDate + "T12:00:00");
  return `${WD[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}. ${o.pickupTime}`;
}
function byPickup(a, b) {
  const k = (o) => o.pickupDate + (o.pickupTime === "asap" ? o.createdAt.slice(11, 16) : o.pickupTime);
  return k(a).localeCompare(k(b));
}
function orderCard(o, actions = true) {
  const soon = o.pickupTime === "asap";
  return `
    <article class="order ${S.flash.has(o.number) ? "is-new" : ""}" data-no="${o.number}">
      <div class="order__head"><span class="order__no">#${o.number}</span><span class="order__who">${esc(o.customer.name)}</span>
        <span class="order__when ${soon ? "is-now" : ""}">${soon ? "⚡ sofort" : "🕒 " + when(o)}</span></div>
      <ul>${o.lines.map((l) => `<li><b>${l.qty}×</b>${esc(l.name)}${l.opts.length ? ` <small>· ${esc(l.opts.join(" · "))}</small>` : ""}${l.cardText ? `<span class="card-text">Karte: „${esc(l.cardText)}“</span>` : ""}</li>`).join("")}</ul>
      ${o.notes ? `<p class="order__note">📝 ${esc(o.notes)}</p>` : ""}
      <div class="order__foot"><span>${o.reusable ? '<span class="pill">Mehrweg</span> ' : ""}${o.customer.phone ? `<a href="tel:${esc(o.customer.phone.replace(/[^\d+]/g, ""))}">📞</a>` : ""} bei Abholung</span><b>${euro(o.total)}</b></div>
      ${actions && NEXT[o.status] ? `<div class="order__actions"><button class="btn ${o.status === "zubereitung" ? "btn--ok" : "btn--primary"}" data-set="${NEXT[o.status][0]}">${NEXT[o.status][1]}</button>
        ${o.status === "neu" ? `<button class="btn btn--danger btn--small" data-set="storniert" title="Stornieren">✕</button>` : ""}</div>` : ""}
      ${!actions ? `<span class="st st--${o.status}">${statusLabel(o.status)}</span>` : ""}
    </article>`;
}
function renderBoard(open, done) {
  const lanes = { neu: "#laneNeu", zubereitung: "#lanePrep", abholbereit: "#laneReady" };
  const counts = { neu: "#cntNeu", zubereitung: "#cntPrep", abholbereit: "#cntReady" };
  Object.entries(lanes).forEach(([st, sel]) => {
    const list = open.filter((o) => o.status === st).sort(byPickup);
    $(sel).innerHTML = list.map((o) => orderCard(o)).join("") || `<p class="empty">–</p>`;
    $(counts[st]).textContent = list.length;
  });
  $("#cntDone").textContent = done.length;
  $("#doneList").innerHTML = done.length ? `<div class="pre-orders">${done.sort(byPickup).reverse().map((o) => orderCard(o, false)).join("")}</div>` : `<p class="empty">Noch nichts.</p>`;
}

async function setStatus(no, status) {
  if (status === "storniert" && !confirm(`Bestellung #${no} wirklich stornieren? Der Gast sieht den Status sofort.`)) return;
  const o = S.data.orders.find((x) => x.number === no);
  const prev = o.status;
  o.status = status;
  render();
  try { await api(`/api/dashboard/orders/${no}/status`, { method: "POST", body: JSON.stringify({ status }) }); }
  catch { o.status = prev; render(); toast("⚠ Status konnte nicht gespeichert werden"); }
}

// ---------- Vorbestellungen ----------
function renderPre(pre) {
  const days = {};
  pre.forEach((o) => (days[o.pickupDate] ||= []).push(o));
  const keys = Object.keys(days).sort();
  $("#preList").innerHTML = keys.length ? keys.map((k) => {
    const list = days[k].sort(byPickup);
    const d = new Date(k + "T12:00:00");
    const need = {};
    list.flatMap((o) => o.lines).forEach((l) => { const key = l.name + (l.opts.length ? ` (${l.opts.join(", ")})` : ""); need[key] = (need[key] || 0) + l.qty; });
    return `<section class="pre-day">
      <div class="pre-day__head"><h2>${d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}</h2>
        <span>${list.length} ${list.length === 1 ? "Bestellung" : "Bestellungen"} · ${euro(list.reduce((s, o) => s + o.total, 0))}</span></div>
      <div class="prep-list">${Object.entries(need).sort((a, b) => b[1] - a[1]).map(([n, q]) => `<span>${q}× ${esc(n)}</span>`).join("")}</div>
      <div class="pre-orders">${list.map((o) => orderCard(o, false)).join("")}</div>
    </section>`;
  }).join("") : `<p class="empty">Keine Vorbestellungen für die kommenden Tage.</p>`;
}

// ---------- Anfragen ----------
function renderInquiries() {
  const list = [...S.data.inquiries].sort((a, b) => (a.status === "erledigt") - (b.status === "erledigt") || b.createdAt.localeCompare(a.createdAt));
  $("#inqList").innerHTML = list.length ? list.map((i) => {
    const created = new Date(i.createdAt);
    const date = i.date ? new Date(i.date + "T12:00:00").toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" }) : "Datum offen";
    const reply = `mailto:${encodeURIComponent(i.email)}?subject=${encodeURIComponent("Ihre Anfrage: " + i.occasion)}&body=${encodeURIComponent(`Hallo ${i.name},\n\nvielen Dank für Ihre Anfrage!\n\n`)}`;
    return `<article class="inq ${i.status === "erledigt" ? "is-done" : ""}" data-inq="${i.id}">
      <div class="inq__head"><h2>${esc(i.occasion)} · ${esc(i.name)}</h2><span class="st st--${i.status === "neu" ? "neu" : i.status === "beantwortet" ? "zubereitung" : "abgeholt"}">${i.status === "neu" ? "Neu" : i.status === "beantwortet" ? "Beantwortet" : "Erledigt"}</span></div>
      <div class="inq__meta"><span>📅 ${date}</span>${i.budget ? `<span>💶 ${esc(i.budget)}</span>` : ""}<span>eingegangen ${created.toLocaleDateString("de-DE")} ${pad(created.getHours())}:${pad(created.getMinutes())}</span></div>
      <p>${esc(i.message)}</p>
      <div class="inq__contact">✉ ${esc(i.email)}${i.phone ? ` · 📞 ${esc(i.phone)}` : ""}</div>
      <div class="inq__actions"><a class="btn btn--primary btn--small" href="${reply}">Antworten</a>
        ${i.status !== "beantwortet" ? `<button class="btn btn--small" data-inq-set="beantwortet">Beantwortet</button>` : ""}
        ${i.status !== "erledigt" ? `<button class="btn btn--small" data-inq-set="erledigt">Erledigt</button>` : `<button class="btn btn--small" data-inq-set="neu">Wieder öffnen</button>`}</div>
    </article>`;
  }).join("") : `<p class="empty">Noch keine Anfragen.</p>`;
}
async function setInquiry(id, status) {
  const i = S.data.inquiries.find((x) => x.id === id);
  const prev = i.status;
  i.status = status;
  render();
  try { await api(`/api/dashboard/inquiries/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }); }
  catch { i.status = prev; render(); }
}

// ---------- Oberfläche ----------
let toastTimer;
function toast(msg) {
  $("#toast").textContent = msg;
  $("#toast").classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("is-visible"), 3500);
}
function showTab(tab) {
  S.tab = tab;
  $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === tab));
  $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + tab));
  $("#tooltip").hidden = true;
  scrollTo(0, 0);
  if (tab === "overview" && S.data) renderOverview();
}

$("#loginForm").addEventListener("submit", (e) => { e.preventDefault(); login($("#pin").value.trim()); });
$("#tabs").addEventListener("click", (e) => { const t = e.target.closest(".tab"); if (t) showTab(t.dataset.tab); });
$("#range").addEventListener("click", (e) => {
  const b = e.target.closest("[data-range]");
  if (!b) return;
  S.range = +b.dataset.range;
  $$("#range button").forEach((x) => { x.classList.toggle("is-active", x === b); x.setAttribute("aria-checked", x === b); });
  renderOverview();
});
document.addEventListener("click", (e) => {
  const set = e.target.closest("[data-set]");
  if (set) return setStatus(+set.closest("[data-no]").dataset.no, set.dataset.set);
  const inq = e.target.closest("[data-inq-set]");
  if (inq) return setInquiry(+inq.closest("[data-inq]").dataset.inq, inq.dataset.inqSet);
  const tbl = e.target.closest("[data-table]");
  if (tbl) { const t = $("#" + tbl.dataset.table); t.hidden = !t.hidden; tbl.textContent = t.hidden ? "Tabelle" : "Diagramm"; return; }
  const go = e.target.closest("[data-goto]");
  if (go) showTab(go.dataset.goto);
});
$("#soundBtn").addEventListener("click", () => {
  S.sound = !S.sound;
  store("bb-dash-sound", S.sound);
  $("#soundBtn").classList.toggle("is-off", !S.sound);
  $("#soundBtn").textContent = S.sound ? "🔔" : "🔕";
  if (S.sound) { audio?.resume(); ding(); }
});
$("#logout").addEventListener("click", () => logout());
$("#demoDelete").addEventListener("click", async () => {
  if (!confirm("Alle Demo-Bestellungen und -Anfragen löschen? Echte Bestellungen bleiben erhalten.")) return;
  await api("/api/dashboard/demo/delete", { method: "POST", body: "{}" });
  S.seen.clear(); S.first = true;
  poll();
  toast("Demo-Daten gelöscht – ab jetzt siehst du nur echte Bestellungen.");
});
document.addEventListener("visibilitychange", () => !document.hidden && S.data && poll());
let resizeTimer;
addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => S.data && renderOverview(), 150); });

$("#soundBtn").classList.toggle("is-off", !S.sound);
$("#soundBtn").textContent = S.sound ? "🔔" : "🔕";
if (S.pin) $("#pin").value = S.pin;
$("#pin").focus();
