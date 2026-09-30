// Unterseite „Anlässe“: Valentinstag, Muttertag & Co. – nach Datum sortiert, mit Countdown & Vorbestellung
function eventCard(p) {
  return `
    <article class="b-card ev-card" data-item="${p.id}" tabindex="0" aria-label="${esc(p.name)} – Details">
      <div class="b-card__art tone-${p.tone || "rose"}">
        ${p.popular ? '<span class="tag">Beliebt</span>' : p.combo ? '<span class="tag">Set</span>' : ""}
        ${productArt(p)}
      </div>
      <div class="b-card__body">
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.desc)}</p>
        <div class="b-card__foot"><span class="b-card__price">${euro(p.price)}</span>${control(p)}</div>
      </div>
    </article>`;
}

function dateText(d) {
  return d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
}
function countdownText(days) {
  return days === 0 ? "Heute!" : days === 1 ? "Morgen" : `in ${days} Tagen`;
}

function renderEvents() {
  const list = BB.C.events.map((ev) => ({ ev, d: nextEventDate(ev) })).sort((a, b) => a.d - b.d);
  const maxAhead = BB.C.shop.maxDaysAhead;

  // Nächster Anlass groß oben
  const first = list[0];
  const days = daysUntil(first.d);
  $("#evNext").innerHTML = `
    <div class="ev-next__ring tone-${first.ev.tone}"><b>${days}</b><span>${days === 1 ? "Tag" : "Tage"}</span></div>
    <div class="ev-next__text"><small>Als Nächstes</small><b>${esc(first.ev.name)}</b><span>${dateText(first.d)}</span></div>
    <a class="btn btn--primary" href="#${first.ev.id}">Ansehen</a>`;

  $("#evChips").innerHTML = list.map(({ ev, d }, i) => `<a class="chip ${i === 0 ? "is-active" : ""}" href="#${ev.id}">${esc(ev.name)} <small>${d.toLocaleDateString("de-DE", { day: "numeric", month: "numeric" })}</small></a>`).join("");

  $("#evSections").innerHTML = list.map(({ ev, d }) => {
    const n = daysUntil(d);
    const pickup = eventPickupDay(ev);
    const bookable = daysUntil(pickup) <= maxAhead;
    const products = BB.C.products.filter((p) => p.event === ev.id);
    return `
      <section class="ev-section tone-${ev.tone}" id="${ev.id}">
        <div class="container">
          <div class="ev-section__head">
            <div>
              <span class="ev-date"><svg><use href="#i-cal"/></svg>${dateText(d)} · <b>${countdownText(n)}</b></span>
              <h2>${esc(ev.name)}</h2>
              <p class="ev-tagline">${esc(ev.tagline)}</p>
              <p>${esc(ev.desc)}</p>
            </div>
            <div class="ev-pickup">
              <small>${bookable ? "Abholung empfohlen" : "Vorbestellung ab"}</small>
              <b>${bookable ? pickup.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" }) : (() => { const s = new Date(pickup); s.setDate(s.getDate() - maxAhead); return s.toLocaleDateString("de-DE", { day: "numeric", month: "long" }); })()}</b>
              <span>${bookable ? "Wähle in der Tüte deinen Abholtag – der Anlasstag ist vorgemerkt." : `Bis dahin kannst du dich hier schon inspirieren lassen.`}</span>
            </div>
          </div>
          <div class="ev-row" role="list">${products.map(eventCard).join("")}</div>
        </div>
      </section>`;
  }).join("");

  // Nicht vorbestellbare Anlässe: + ausblenden, Details bleiben ansehbar
  list.forEach(({ ev }) => {
    if (daysUntil(eventPickupDay(ev)) > maxAhead) $(`#${ev.id}`).classList.add("is-later");
  });

  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    $$("#evChips .chip").forEach((c) => c.classList.toggle("is-active", c.getAttribute("href") === "#" + e.target.id));
    const chip = $(`#evChips .chip[href="#${e.target.id}"]`);
    if (chip) $("#evChips").scrollTo({ left: chip.offsetLeft - 16, behavior: "smooth" });
  }), { rootMargin: "-45% 0px -50% 0px" });
  $$(".ev-section").forEach((s) => io.observe(s));
}

BB.ready.then(() => {
  renderEvents();
  document.addEventListener("bag:change", refreshControls);
  if (location.hash) setTimeout(() => $(location.hash)?.scrollIntoView(), 60);
});
