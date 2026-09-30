// Startseite: Karte, Sträuße, Bohnen, Öffnungszeiten, nächster Anlass, Anfrageformular
const DRINK_CATS = ["coffee", "flowerdrinks", "cold"];

function itemRow(p) {
  return `
    <li class="item item--tap" data-item="${p.id}" tabindex="0" aria-label="${esc(p.name)} – Details">
      <span class="item__icon ${p.tone ? "tone-" + p.tone : ""}"><svg><use href="#${ICON[p.cat]}"/></svg></span>
      <div class="item__text">
        <div class="item__name">${esc(p.name)}${p.popular ? '<span class="tag">Beliebt</span>' : ""}</div>
        <p class="item__desc">${esc(p.desc)}</p>
        ${p.options?.length ? `<p class="item__more">${p.options.map((g) => BB.C.options[g].label).join(" · ")} wählbar</p>` : ""}
      </div>
      <span class="item__price">${euro(p.price)}</span>
      ${control(p)}
    </li>`;
}

function bouquetCard(p) {
  return `
    <article class="b-card" data-item="${p.id}" tabindex="0" aria-label="${esc(p.name)} – Details">
      <div class="b-card__art ${p.tone ? "tone-" + p.tone : ""}">
        ${p.popular ? '<span class="tag">Beliebt</span>' : p.combo ? '<span class="tag">To-go-Kombi</span>' : ""}
        ${bouquetSVG(p)}
      </div>
      <div class="b-card__body">
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.desc)}</p>
        <div class="b-card__foot"><span class="b-card__price">${p.combo ? "" : "ab "}${euro(p.price)}</span>${control(p)}</div>
      </div>
    </article>`;
}

function renderHome() {
  const C = BB.C;
  $("#menuSections").innerHTML = C.categories.filter((c) => DRINK_CATS.includes(c.id)).map((c) => `
    <div class="menu-section" id="cat-${c.id}">
      <div class="menu-section__head"><h3>${c.label}</h3><span>${c.hint}</span></div>
      <ul class="menu-list">${C.products.filter((p) => p.cat === c.id).map(itemRow).join("")}</ul>
    </div>`).join("");

  $("#bouquetGrid").innerHTML = C.products.filter((p) => p.cat === "bouquets").map(bouquetCard).join("") + `
    <article class="b-card b-card--project">
      <div class="b-card__art"><svg viewBox="0 0 48 48"><use href="#i-flower"/></svg></div>
      <div class="b-card__body"><h3>Größere Projekte</h3><p>Hochzeit, Event, Firmen-Abo oder Trauerfloristik – individuell gestaltet, auf Anfrage.</p>
        <div class="b-card__foot"><a class="btn" href="#anfrage">Anfrage stellen</a></div></div>
    </article>`;

  $("#beanGrid").innerHTML = C.products.filter((p) => p.cat === "beans").map((p) => `
    <article class="bean" data-item="${p.id}" tabindex="0" aria-label="${esc(p.name)} – Details">
      <div class="bean__top"><svg><use href="#i-bean"/></svg>${p.popular ? '<span class="tag">Beliebt</span>' : ""}</div>
      <h3>${esc(p.name)}</h3><p>${esc(p.desc)}</p>
      <div class="bean__notes">${(p.notes || []).map((n) => `<span>${esc(n)}</span>`).join("")}</div>
      <div class="bean__foot"><span class="item__price">${euro(p.price)} <small>/ 250 g</small></span>${control(p)}</div>
    </article>`).join("");

  renderChips();
  renderOpenStatus();
  renderTeaser();
  $("#mapsLink").href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${C.shop.name}, ${C.shop.street}, ${C.shop.city}`)}`;
  $("#phoneLink").href = "tel:" + C.shop.phone.replace(/[^\d+]/g, "");
}

function renderChips() {
  const chips = [
    ...BB.C.categories.filter((c) => DRINK_CATS.includes(c.id)).map((c) => ({ href: `#cat-${c.id}`, label: c.label })),
    { href: "#straeusse", label: "Sträuße" }, { href: "#bohnen", label: "Bohnen" }, { href: "anlaesse.html", label: "Anlässe →" },
  ];
  $("#menuChips").innerHTML = chips.map((c, i) => `<a class="chip ${i === 0 ? "is-active" : ""}" href="${c.href}">${c.label}</a>`).join("");
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    $$(".chip").forEach((chip) => chip.classList.toggle("is-active", chip.getAttribute("href") === "#" + e.target.id));
    const active = $(`.chip[href="#${e.target.id}"]`);
    if (active) $("#menuChips").scrollTo({ left: active.offsetLeft - 16, behavior: "smooth" });
  }), { rootMargin: "-40% 0px -55% 0px" });
  chips.map((c) => c.href.startsWith("#") && $(c.href)).filter(Boolean).forEach((t) => io.observe(t));
}

function renderOpenStatus() {
  const el = $("#openStatus");
  const h = hoursOn(new Date());
  const n = nowMin();
  const open = h && n >= toMin(h[0]) && n < toMin(h[1]);
  el.classList.toggle("is-open", !!open);
  const next = nextOpening();
  $("span", el).textContent = open ? `Jetzt geöffnet · bis ${h[1]} Uhr` : next ? `Geschlossen · öffnet ${next.label} um ${next.time} Uhr` : "Geschlossen";
  const today = new Date().getDay();
  $("#hoursList").innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<li class="${d === today ? "is-today" : ""}"><span>${DAYS[d]}</span><span>${BB.C.hours[d] ? `${BB.C.hours[d][0]} – ${BB.C.hours[d][1]}` : "geschlossen"}</span></li>`).join("");
}

// Hinweis auf den nächsten Anlass (z. B. „Muttertag in 23 Tagen“)
function renderTeaser() {
  const next = BB.C.events.map((ev) => ({ ev, d: nextEventDate(ev) })).sort((a, b) => a.d - b.d)[0];
  if (!next) return;
  const days = daysUntil(next.d);
  const t = $("#eventTeaser");
  t.href = `anlaesse.html#${next.ev.id}`;
  t.className = `event-teaser tone-${next.ev.tone}`;
  t.innerHTML = `
    <span class="event-teaser__count"><b>${days === 0 ? "Heute" : days}</b>${days === 0 ? "" : days === 1 ? "Tag" : "Tage"}</span>
    <span class="event-teaser__text"><small>Nächster Anlass</small><b>${esc(next.ev.name)}</b> ${esc(next.ev.tagline)}</span>
    <span class="event-teaser__cta">Jetzt vorbestellen →</span>`;
  t.hidden = false;
}

async function sendInquiry(e) {
  e.preventDefault();
  const form = e.target;
  const note = $("#inquiryNote");
  const say = (msg, ok = false) => { note.innerHTML = msg; note.className = "form-note" + (ok ? " is-ok" : ""); note.hidden = false; };
  if (!form.checkValidity()) {
    const bad = $$("input:invalid, select:invalid, textarea:invalid", form)[0];
    say(bad?.type === "email" ? "Bitte gib eine gültige E-Mail-Adresse an." : "Bitte fülle alle Pflichtfelder (*) aus.");
    bad?.focus();
    return;
  }
  const f = Object.fromEntries(new FormData(form));
  $("#inquirySend").disabled = true;
  try {
    const res = await fetch("/api/inquiries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Senden fehlgeschlagen.");
    form.reset();
    say("Danke! Deine Anfrage ist bei uns – wir melden uns innerhalb eines Werktags. 🌿", true);
  } catch (err) {
    if (err instanceof TypeError) {
      const body = [`Anlass: ${f.occasion}`, `Datum: ${f.date || "offen"}`, `Budget: ${f.budget || "offen"}`, "", f.message, "", `${f.name} · ${f.email} · ${f.phone}`].join("\n");
      say(`Keine Verbindung zum Server. <a href="mailto:${BB.C.shop.email}?subject=${encodeURIComponent("Anfrage: " + f.occasion)}&body=${encodeURIComponent(body)}">Anfrage per E-Mail senden</a>`);
    } else say(err.message);
  } finally {
    $("#inquirySend").disabled = false;
  }
}

BB.ready.then(() => {
  renderHome();
  document.addEventListener("bag:change", refreshControls);
  $("#inquiryForm").addEventListener("submit", sendInquiry);
  setInterval(renderOpenStatus, 60_000);
  if (location.hash) setTimeout(() => $(location.hash)?.scrollIntoView(), 50);
});
