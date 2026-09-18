// Frontend trackera cen (model wariantów wylotów).
// Czyta data/latest.json (najtańszy wariant per oferta + zmiany) oraz
// data/history.json (szeregi cen do wykresów).

const state = { latest: null, history: null, chart: null };
const $ = (s) => document.querySelector(s);

const fmtPrice = (n) =>
  n == null ? "—" : new Intl.NumberFormat("pl-PL").format(n) + " zł";

const fmtDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("pl-PL", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

async function loadData() {
  const [lr, hr] = await Promise.all([
    fetch("./data/latest.json", { cache: "no-store" }),
    fetch("./data/history.json", { cache: "no-store" }).catch(() => null),
  ]);
  if (!lr.ok) throw new Error("Brak pliku latest.json");
  state.latest = await lr.json();
  state.history = hr && hr.ok ? await hr.json() : { offers: {} };
}

function renderMeta() {
  const { generatedAt, count, sourceUrl } = state.latest;
  $("#updated").textContent = "Aktualizacja: " + fmtDateTime(generatedAt);
  $("#count").textContent = count + " ofert";
  if (sourceUrl) $("#source-link").href = sourceUrl;
}

function renderSummary() {
  const offers = state.latest.offers;
  const changed = offers.filter((o) => o.change != null && o.change !== 0);
  const drops = changed.filter((o) => o.change < 0);
  const rises = changed.filter((o) => o.change > 0);
  const soldOut = offers.filter((o) => o.soldOutNote);
  const lowest = offers.length
    ? offers.reduce((a, b) => ((a.price ?? Infinity) <= (b.price ?? Infinity) ? a : b))
    : null;
  const biggestDrop = drops.length
    ? drops.reduce((a, b) => (a.change <= b.change ? a : b))
    : null;

  const cards = [
    { label: "Najtańsza teraz", value: lowest ? fmtPrice(lowest.price) : "—", cls: "" },
    { label: "Spadki", value: String(drops.length), cls: drops.length ? "down" : "" },
    { label: "Wzrosty", value: String(rises.length), cls: rises.length ? "up" : "" },
    { label: "Największy spadek", value: biggestDrop ? fmtPrice(biggestDrop.change) : "—", cls: biggestDrop ? "down" : "" },
    { label: "Zmiany wariantu", value: String(soldOut.length), cls: soldOut.length ? "up" : "" },
  ];

  $("#summary").innerHTML = cards
    .map((c) => `
      <div class="summary-card">
        <div class="label">${c.label}</div>
        <div class="value ${c.cls}">${c.value}</div>
      </div>`)
    .join("");
}

function changeMarkup(o) {
  if (o.change == null) return `<span class="change flat">nowa oferta</span>`;
  if (o.change === 0) return `<span class="change flat">→ bez zmian</span>`;
  const down = o.change < 0;
  const arrow = down ? "▼" : "▲";
  const sign = down ? "" : "+";
  const pct = o.changePct != null ? ` (${sign}${o.changePct}%)` : "";
  return `<span class="change ${down ? "down" : "up"}">${arrow} ${sign}${fmtPrice(o.change)}${pct}</span>`;
}

/** Blok z rozkładem lotu wariantu. */
function flightMarkup(v) {
  if (!v) return "";
  const seg = (node, arrowFrom, arrowTo) => {
    if (!node?.from || !node?.to) return "";
    return `
      <div class="flight-row">
        <span class="airport">${node.from.airportCode || "?"}</span>
        <span class="flight-detail">${node.from.customDate} ${node.from.time}</span>
        <span class="flight-arrow">→</span>
        <span class="airport">${node.to.airportCode || "?"}</span>
        <span class="flight-detail">${node.to.time}</span>
      </div>`;
  };
  return `
    <div class="flights">
      <div class="flight-line"><span class="flight-label">Tam</span>${seg(v.outbound)}</div>
      <div class="flight-line"><span class="flight-label">Powrót</span>${seg(v.inbound)}</div>
    </div>`;
}

function offerCard(o) {
  const v = o.cheapest;
  const tags = [];
  if (o.stars) tags.push(`<span class="tag stars">${"★".repeat(o.stars)}</span>`);
  if (o.rating != null) tags.push(`<span class="tag rating">${o.rating}/10</span>`);
  if (v?.room) tags.push(`<span class="tag">${v.room}</span>`);
  if (o.operator) tags.push(`<span class="tag">${o.operator}</span>`);
  if (v?.luggageIncluded) tags.push(`<span class="tag">🧳 bagaż w cenie</span>`);
  if (o.variantCount > 1) tags.push(`<span class="tag muted">${o.variantCount} wariantów</span>`);

  const dep = v?.outbound?.from;
  const airportLine = dep
    ? `<p class="airport-line">✈ Najtańszy wylot z <strong>${dep.airportName || dep.airportCode}</strong> (${dep.airportCode})</p>`
    : "";

  const soldOut = o.soldOutNote
    ? `<div class="sold-note">⚠ ${o.soldOutNote} — pokazujemy kolejny najtańszy wariant</div>`
    : "";

  const lowestBadge =
    o.isLowest && o.pointCount > 1 ? `<span class="badge-lowest">najniższa dotąd</span>` : "";

  const range =
    o.minPrice != null && o.maxPrice != null && o.minPrice !== o.maxPrice
      ? `<div class="price-range">min ${fmtPrice(o.minPrice)} • max ${fmtPrice(o.maxPrice)}</div>`
      : "";

  return `
    <article class="offer-card ${o.isLowest && o.pointCount > 1 ? "lowest" : ""}" data-key="${o.key}" tabindex="0" role="button" aria-label="Historia cen: ${o.hotel}">
      <div class="offer-main">
        <h3 class="hotel">${o.hotel}</h3>
        <p class="region">${o.region || ""}</p>
        ${airportLine}
        ${flightMarkup(v)}
        <div class="tags">${tags.join("")}</div>
        ${soldOut}
      </div>
      <div class="offer-price">
        <span class="price-now">${fmtPrice(o.price)}</span>
        <span class="price-unit">za wszystkich</span>
        ${changeMarkup(o)}
        ${range}
        ${lowestBadge}
      </div>
    </article>`;
}

function getFilteredSorted() {
  let offers = [...state.latest.offers];
  if ($("#only-changed").checked)
    offers = offers.filter((o) => o.change != null && o.change !== 0);
  if ($("#only-drops").checked)
    offers = offers.filter((o) => o.change != null && o.change < 0);

  const cmp = {
    "price-asc": (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    "price-desc": (a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity),
    "change-asc": (a, b) => (a.change ?? 0) - (b.change ?? 0),
    "change-desc": (a, b) => (b.change ?? 0) - (a.change ?? 0),
    "rating-desc": (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
  }[$("#sort").value];
  offers.sort(cmp);
  return offers;
}

function renderOffers() {
  const offers = getFilteredSorted();
  const c = $("#offers");
  c.innerHTML = offers.length
    ? offers.map(offerCard).join("")
    : `<div class="state">Brak ofert spełniających filtry.</div>`;
}

function renderDisappeared() {
  const dis = state.latest.disappeared || [];
  const section = $("#disappeared-section");
  if (!dis.length) { section.hidden = true; return; }
  section.hidden = false;
  $("#disappeared-list").innerHTML = dis
    .map((d) => `<li>${d.hotel} — ${d.region || ""}, ostatnia cena ${fmtPrice(d.lastPrice)}, widziana ${d.lastSeen}</li>`)
    .join("");
}

// ---- Modal z wykresem ----
function openModal(key) {
  const offer = state.latest.offers.find((o) => o.key === key);
  const hist = state.history.offers ? state.history.offers[key] : null;
  if (!offer) return;
  const v = offer.cheapest;

  $("#modal-title").textContent = offer.hotel;
  $("#modal-sub").textContent = v
    ? `${offer.region || ""} • ${v.room} • ✈ ${v.departureCode} ${v.outbound?.from?.customDate || ""} ${v.outbound?.from?.time || ""}`
    : offer.region || "";

  const points = hist && hist.prices ? hist.prices : (v ? [{ date: state.latest.date, price: v.price }] : []);
  drawChart(points);

  const values = points.map((p) => p.price);
  const changes = hist && hist.variantChanges ? hist.variantChanges : [];
  const stats = [
    { l: "Aktualna", v: fmtPrice(offer.price) },
    { l: "Poprzednia", v: fmtPrice(offer.prevPrice) },
    { l: "Min", v: values.length ? fmtPrice(Math.min(...values)) : "—" },
    { l: "Max", v: values.length ? fmtPrice(Math.max(...values)) : "—" },
    { l: "Pomiarów", v: String(points.length) },
    { l: "Wariantów teraz", v: String(offer.variantCount ?? "—") },
  ];
  $("#modal-stats").innerHTML = stats
    .map((s) => `<div class="stat"><div class="l">${s.l}</div><div class="v">${s.v}</div></div>`)
    .join("");

  // Historia zmian wariantu (jeśli była).
  const holder = $("#modal-changes");
  if (changes.length) {
    holder.hidden = false;
    holder.innerHTML =
      `<h3>Zmiany śledzonego wariantu</h3>` +
      changes
        .slice()
        .reverse()
        .map(
          (c) => `<div class="change-item">
            <span class="cdate">${c.date}</span>
            <span>${c.from?.label || "?"} (${fmtPrice(c.from?.price)}) → ${c.to?.label || "?"} (${fmtPrice(c.to?.price)})</span>
            <span class="creason">${c.reason || ""}</span>
          </div>`
        )
        .join("");
  } else {
    holder.hidden = true;
    holder.innerHTML = "";
  }

  const link = $("#modal-link");
  if (offer.detailUrl) { link.hidden = false; link.href = offer.detailUrl; }
  else link.hidden = true;

  $("#modal").hidden = false;
}

function closeModal() {
  $("#modal").hidden = true;
  if (state.chart) { state.chart.destroy(); state.chart = null; }
}

function drawChart(points) {
  const ctx = $("#history-chart").getContext("2d");
  if (state.chart) state.chart.destroy();
  const labels = points.map((p) =>
    new Date(p.date).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" })
  );
  state.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Cena (zł)",
        data: points.map((p) => p.price),
        borderColor: "#ffb020",
        backgroundColor: "rgba(255,176,32,0.15)",
        fill: true, tension: 0.25, pointRadius: 4, pointBackgroundColor: "#ffb020",
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => new Intl.NumberFormat("pl-PL").format(c.parsed.y) + " zł" } },
      },
      scales: {
        y: { ticks: { color: "#9fb0c3", callback: (v) => new Intl.NumberFormat("pl-PL").format(v) }, grid: { color: "rgba(255,255,255,0.06)" } },
        x: { ticks: { color: "#9fb0c3" }, grid: { color: "rgba(255,255,255,0.06)" } },
      },
    },
  });
}

function wireEvents() {
  $("#sort").addEventListener("change", renderOffers);
  $("#only-changed").addEventListener("change", renderOffers);
  $("#only-drops").addEventListener("change", renderOffers);
  $("#offers").addEventListener("click", (e) => {
    const card = e.target.closest(".offer-card");
    if (card) openModal(card.dataset.key);
  });
  $("#offers").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      const card = e.target.closest(".offer-card");
      if (card) { e.preventDefault(); openModal(card.dataset.key); }
    }
  });
  document.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeModal));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
}

async function init() {
  try {
    await loadData();
    renderMeta();
    renderSummary();
    renderOffers();
    renderDisappeared();
    wireEvents();
  } catch (err) {
    console.error(err);
    $("#offers").innerHTML = `<div class="state error">Nie udało się wczytać danych.<br>${err.message}<br><br>Uruchom scraper (npm run scrape).</div>`;
    $("#updated").textContent = "Błąd ładowania";
  }
}

init();
