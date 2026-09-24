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

// Zwięzły czas względny, np. "przed chwilą", "2 godz. temu", "wczoraj", "3 dni temu".
const fmtAgo = (iso) => {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return fmtDateTime(iso);
  const min = Math.floor(diffMs / 60000);
  if (min < 5) return "przed chwilą";
  if (min < 60) return `${min} min temu`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} godz. temu`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "wczoraj";
  if (days < 7) return `${days} dni temu`;
  return fmtDateTime(iso);
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

// Ile minut temu wygenerowano dane (na podstawie generatedAt).
function dataAgeMinutes() {
  const iso = state.latest?.generatedAt;
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return ms >= 0 ? Math.round(ms / 60000) : null;
}

// Czytelny opis wieku danych ("12 min", "3 godz.", "2 dni").
function humanAge(min) {
  if (min == null) return "";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} godz.`;
  return `${Math.round(h / 24)} dni`;
}

// Heartbeat: dane powinny odświeżać się co godzinę (timer 8:30–22:30).
// Jeśli są starsze niż STALE_AFTER_MIN, scraper prawdopodobnie nie działa
// (blokada anty-bot, serwer offline, padnięty timer) — pokazujemy ostrzeżenie.
const STALE_AFTER_MIN = 90; // ~1,5 cyklu godzinowego tolerancji

function renderMeta() {
  const { generatedAt, count, sourceUrl } = state.latest;
  const age = dataAgeMinutes();
  const stale = age != null && age > STALE_AFTER_MIN;

  const updated = $("#updated");
  updated.textContent = "Aktualizacja: " + fmtDateTime(generatedAt);
  updated.classList.toggle("stale", stale);

  $("#count").textContent = count + " ofert";
  if (sourceUrl) $("#source-link").href = sourceUrl;

  // Baner ostrzegawczy o nieaktualnych danych (heartbeat).
  const banner = $("#stale-banner");
  if (banner) {
    if (stale) {
      banner.hidden = false;
      banner.textContent = `⚠ Dane mogą być nieaktualne — ostatnia aktualizacja ${humanAge(age)} temu. Scraper mógł się zatrzymać (blokada serwisu, offline lub przerwany harmonogram).`;
    } else {
      banner.hidden = true;
    }
  }
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
    { label: "Zmiany biura", value: String(soldOut.length), cls: soldOut.length ? "up" : "" },
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
  // Notka o ostatnim sprawdzeniu (kiedy pobraliśmy dane po raz ostatni).
  const checked = o.lastCheckedAt
    ? `<span class="snap-checked" title="Ostatnie sprawdzenie ceny">🕒 sprawdzono ${fmtAgo(o.lastCheckedAt)}</span>`
    : "";

  // Nowa oferta — brak poprzedniego pomiaru.
  if (o.change == null) {
    return `<span class="change flat">nowa oferta</span>${checked}`;
  }

  // Cena identyczna jak przy ostatniej zmianie — podkreślamy "bez zmian"
  // i pokazujemy, od kiedy cena się trzyma.
  if (o.change === 0) {
    const since = o.lastChangeAt || o.lastChangeDate;
    const sinceTxt = since ? ` od ${fmtAgo(o.lastChangeAt) || o.lastChangeDate}` : "";
    return `<span class="change flat">→ bez zmian${sinceTxt}</span>${checked}`;
  }

  const down = o.change < 0;
  const arrow = down ? "▼" : "▲";
  const sign = down ? "" : "+";
  const pct = o.changePct != null ? ` (${sign}${o.changePct}%)` : "";
  const prev =
    o.prevPrice != null
      ? `<span class="snap-prev">poprzednio ${fmtPrice(o.prevPrice)}</span>`
      : "";
  return `<span class="change ${down ? "down" : "up"}">${arrow} ${sign}${fmtPrice(o.change)}${pct}</span>${prev}${checked}`;
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
    ? `<div class="sold-note">⚠ ${o.soldOutNote}</div>`
    : "";

  const alt =
    o.altOffers && o.altOffers.length
      ? `<div class="alt-offers">Ten hotel też u: ${o.altOffers
          .map((a) => `${a.operator || "inny operator"} (${fmtPrice(a.price)})`)
          .join(", ")}</div>`
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
        ${alt}
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

  const points = hist && hist.prices && hist.prices.length
    ? hist.prices
    : (v ? [{ date: state.latest.date, at: state.latest.generatedAt, price: v.price, operator: v.operator, room: v.room, outbound: v.outbound, inbound: v.inbound }] : []);
  drawChart(points);

  const values = points.map((p) => p.price);
  const changes = hist && hist.variantChanges ? hist.variantChanges : [];
  const stats = [
    { l: "Aktualna", v: fmtPrice(offer.price) },
    { l: "Poprzednia", v: fmtPrice(offer.prevPrice) },
    { l: "Min", v: values.length ? fmtPrice(Math.min(...values)) : "—" },
    { l: "Max", v: values.length ? fmtPrice(Math.max(...values)) : "—" },
    { l: "Zanotowanych cen", v: String(points.length) },
    { l: "Wariantów teraz", v: String(offer.variantCount ?? "—") },
  ];
  $("#modal-stats").innerHTML = stats
    .map((s) => `<div class="stat"><div class="l">${s.l}</div><div class="v">${s.v}</div></div>`)
    .join("");

  // Historia zmian biura, przez które hotel był najtańszy (jeśli była).
  // Fallback na .label dla starszych wpisów sprzed zmiany modelu.
  const holder = $("#modal-changes");
  if (changes.length) {
    const who = (side) => side?.operator || side?.label || "?";
    holder.hidden = false;
    const whenChange = (c) => c.at
      ? new Date(c.at).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      : c.date;
    holder.innerHTML =
      `<h3>Zmiany biura z najtańszą ofertą</h3>` +
      changes
        .slice()
        .reverse()
        .map(
          (c) => `<div class="change-item">
            <span class="cdate">${whenChange(c)}</span>
            <span>${who(c.from)} (${fmtPrice(c.from?.price)}) → ${who(c.to)} (${fmtPrice(c.to?.price)})</span>
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

// Etykieta osi X: data + godzina jeśli punkt ma znacznik czasu (at),
// w przeciwnym razie sama data (stare punkty sprzed modelu śróddziennego).
function pointLabel(p) {
  const iso = p.at || p.date;
  const d = new Date(iso);
  if (p.at) {
    return d.toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
}

// Krótki opis lotu punktu (tam + powrót) do tooltipa.
function flightSummary(p) {
  const out = p.outbound?.from;
  const inb = p.inbound?.from;
  const parts = [];
  if (out) parts.push(`✈ ${out.airportCode || "?"} ${out.customDate || out.date || ""} ${out.time || ""}`.trim());
  if (inb) parts.push(`↩ powrót ${inb.customDate || inb.date || ""} ${inb.time || ""}`.trim());
  return parts;
}

function drawChart(points) {
  const ctx = $("#history-chart").getContext("2d");
  if (state.chart) state.chart.destroy();
  const labels = points.map(pointLabel);
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
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          padding: 10,
          callbacks: {
            // Nagłówek: pełna data i godzina punktu.
            title: (items) => {
              const p = points[items[0].dataIndex];
              const iso = p?.at || p?.date;
              return iso
                ? new Date(iso).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                : "";
            },
            // Treść: cena, różnica względem poprzedniego punktu, biuro, pokój, lot.
            label: (c) => {
              const i = c.dataIndex;
              const p = points[i];
              const lines = [`Cena: ${new Intl.NumberFormat("pl-PL").format(p.price)} zł`];
              const prev = i > 0 ? points[i - 1] : null;
              if (prev && prev.price != null && p.price != null) {
                const diff = p.price - prev.price;
                const sign = diff > 0 ? "▲ +" : diff < 0 ? "▼ " : "→ ";
                const pct = prev.price ? ` (${diff > 0 ? "+" : ""}${((diff / prev.price) * 100).toFixed(1)}%)` : "";
                lines.push(`Poprzednia: ${new Intl.NumberFormat("pl-PL").format(prev.price)} zł`);
                lines.push(`Zmiana: ${sign}${new Intl.NumberFormat("pl-PL").format(diff)} zł${pct}`);
              } else {
                lines.push("Pierwszy pomiar");
              }
              if (p.operator) lines.push(`Biuro: ${p.operator}`);
              if (p.room) lines.push(`Pokój: ${p.room}`);
              for (const f of flightSummary(p)) lines.push(f);
              return lines;
            },
          },
        },
      },
      scales: {
        y: { ticks: { color: "#9fb0c3", callback: (v) => new Intl.NumberFormat("pl-PL").format(v) }, grid: { color: "rgba(255,255,255,0.06)" } },
        x: { ticks: { color: "#9fb0c3", maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { color: "rgba(255,255,255,0.06)" } },
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
