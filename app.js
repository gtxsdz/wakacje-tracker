// Frontend trackera cen. Czyta data/latest.json (aktualny stan + zmiany)
// oraz data/history.json (pełne szeregi cen do wykresów).

const state = {
  latest: null,
  history: null,
  chart: null,
};

const $ = (sel) => document.querySelector(sel);

const fmtPrice = (n) =>
  n == null ? "—" : new Intl.NumberFormat("pl-PL").format(n) + " zł";

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

async function loadData() {
  const [latestRes, historyRes] = await Promise.all([
    fetch("./data/latest.json", { cache: "no-store" }),
    fetch("./data/history.json", { cache: "no-store" }).catch(() => null),
  ]);

  if (!latestRes.ok) throw new Error("Brak pliku danych latest.json");
  state.latest = await latestRes.json();

  if (historyRes && historyRes.ok) {
    state.history = await historyRes.json();
  } else {
    state.history = { offers: {} };
  }
}

function renderMeta() {
  const { generatedAt, count, sourceUrl } = state.latest;
  $("#updated").textContent = "Aktualizacja: " + fmtDate(generatedAt);
  $("#count").textContent = count + " ofert";
  const link = $("#source-link");
  if (sourceUrl) link.href = sourceUrl;
}

function renderSummary() {
  const offers = state.latest.offers;
  const changed = offers.filter((o) => o.change != null && o.change !== 0);
  const drops = changed.filter((o) => o.change < 0);
  const rises = changed.filter((o) => o.change > 0);
  const lowest = offers.length
    ? offers.reduce((a, b) => (a.price <= b.price ? a : b))
    : null;

  const biggestDrop = drops.length
    ? drops.reduce((a, b) => (a.change <= b.change ? a : b))
    : null;

  const cards = [
    {
      label: "Najtańsza teraz",
      value: lowest ? fmtPrice(lowest.price) : "—",
      cls: "",
    },
    {
      label: "Spadki",
      value: String(drops.length),
      cls: drops.length ? "down" : "",
    },
    {
      label: "Wzrosty",
      value: String(rises.length),
      cls: rises.length ? "up" : "",
    },
    {
      label: "Największy spadek",
      value: biggestDrop ? fmtPrice(biggestDrop.change) : "—",
      cls: biggestDrop ? "down" : "",
    },
  ];

  $("#summary").innerHTML = cards
    .map(
      (c) => `
      <div class="summary-card">
        <div class="label">${c.label}</div>
        <div class="value ${c.cls}">${c.value}</div>
      </div>`
    )
    .join("");
}

function changeMarkup(o) {
  if (o.change == null) {
    return `<span class="change flat">nowa oferta</span>`;
  }
  if (o.change === 0) {
    return `<span class="change flat">→ bez zmian</span>`;
  }
  const isDown = o.change < 0;
  const arrow = isDown ? "▼" : "▲";
  const cls = isDown ? "down" : "up";
  const sign = isDown ? "" : "+";
  const pct = o.changePct != null ? ` (${sign}${o.changePct}%)` : "";
  return `<span class="change ${cls}">${arrow} ${sign}${fmtPrice(o.change)}${pct}</span>`;
}

function offerCard(o) {
  const tags = [];
  if (o.stars) tags.push(`<span class="tag stars">${"★".repeat(o.stars)}</span>`);
  if (o.rating != null) tags.push(`<span class="tag rating">${o.rating}/10</span>`);
  if (o.board) tags.push(`<span class="tag">${o.board}</span>`);
  if (o.operator) tags.push(`<span class="tag">${o.operator}</span>`);
  if (o.departure) tags.push(`<span class="tag">✈ ${o.departure}</span>`);
  if (o.dateRange) tags.push(`<span class="tag">${o.dateRange.replace(/\s+/g, " ")}</span>`);

  const lowestBadge = o.isLowest && o.pointCount > 1
    ? `<span class="badge-lowest">najniższa dotąd</span>`
    : "";

  const range =
    o.minPrice != null && o.maxPrice != null && o.minPrice !== o.maxPrice
      ? `<div class="price-range">min ${fmtPrice(o.minPrice)} • max ${fmtPrice(o.maxPrice)}</div>`
      : "";

  return `
    <article class="offer-card ${o.isLowest && o.pointCount > 1 ? "lowest" : ""}" data-key="${o.key}" tabindex="0" role="button" aria-label="Pokaż historię cen: ${o.hotel}">
      <div class="offer-main">
        <h3 class="hotel">${o.hotel}</h3>
        <p class="region">${o.region || ""}</p>
        <div class="tags">${tags.join("")}</div>
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

  if ($("#only-changed").checked) {
    offers = offers.filter((o) => o.change != null && o.change !== 0);
  }
  if ($("#only-drops").checked) {
    offers = offers.filter((o) => o.change != null && o.change < 0);
  }

  const sort = $("#sort").value;
  const cmp = {
    "price-asc": (a, b) => a.price - b.price,
    "price-desc": (a, b) => b.price - a.price,
    "change-asc": (a, b) => (a.change ?? 0) - (b.change ?? 0),
    "change-desc": (a, b) => (b.change ?? 0) - (a.change ?? 0),
    "rating-desc": (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
  }[sort];
  offers.sort(cmp);
  return offers;
}

function renderOffers() {
  const offers = getFilteredSorted();
  const container = $("#offers");
  if (offers.length === 0) {
    container.innerHTML = `<div class="state">Brak ofert spełniających filtry.</div>`;
    return;
  }
  container.innerHTML = offers.map(offerCard).join("");
}

function renderDisappeared() {
  const dis = state.latest.disappeared || [];
  const section = $("#disappeared-section");
  if (dis.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  $("#disappeared-list").innerHTML = dis
    .map(
      (d) =>
        `<li>${d.hotel} — ${d.region || ""} (${d.dateRange || ""}), ostatnia cena ${fmtPrice(
          d.lastPrice
        )}, widziana ${d.lastSeen}</li>`
    )
    .join("");
}

// ---- Modal z wykresem historii ----

function openModal(key) {
  const offer = state.latest.offers.find((o) => o.key === key);
  const hist = state.history.offers ? state.history.offers[key] : null;
  if (!offer) return;

  $("#modal-title").textContent = offer.hotel;
  $("#modal-sub").textContent = `${offer.region || ""} • ${offer.dateRange || ""} • ✈ ${offer.departure || ""}`;

  const points = hist && hist.prices ? hist.prices : [{ date: state.latest.date, price: offer.price }];
  drawChart(points);

  const values = points.map((p) => p.price);
  const stats = [
    { l: "Aktualna", v: fmtPrice(offer.price) },
    { l: "Poprzednia", v: fmtPrice(offer.prevPrice) },
    { l: "Min", v: fmtPrice(Math.min(...values)) },
    { l: "Max", v: fmtPrice(Math.max(...values)) },
    { l: "Pomiarów", v: String(points.length) },
  ];
  $("#modal-stats").innerHTML = stats
    .map((s) => `<div class="stat"><div class="l">${s.l}</div><div class="v">${s.v}</div></div>`)
    .join("");

  $("#modal").hidden = false;
}

function closeModal() {
  $("#modal").hidden = true;
  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }
}

function drawChart(points) {
  const ctx = $("#history-chart").getContext("2d");
  if (state.chart) state.chart.destroy();

  const labels = points.map((p) =>
    new Date(p.date).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" })
  );
  const data = points.map((p) => p.price);

  state.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Cena (zł)",
          data,
          borderColor: "#ffb020",
          backgroundColor: "rgba(255,176,32,0.15)",
          fill: true,
          tension: 0.25,
          pointRadius: 4,
          pointBackgroundColor: "#ffb020",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => new Intl.NumberFormat("pl-PL").format(c.parsed.y) + " zł",
          },
        },
      },
      scales: {
        y: {
          ticks: {
            color: "#9fb0c3",
            callback: (v) => new Intl.NumberFormat("pl-PL").format(v),
          },
          grid: { color: "rgba(255,255,255,0.06)" },
        },
        x: {
          ticks: { color: "#9fb0c3" },
          grid: { color: "rgba(255,255,255,0.06)" },
        },
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
      if (card) {
        e.preventDefault();
        openModal(card.dataset.key);
      }
    }
  });

  document.querySelectorAll("[data-close]").forEach((el) =>
    el.addEventListener("click", closeModal)
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
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
    $("#offers").innerHTML = `<div class="state error">Nie udało się wczytać danych.<br>${err.message}<br><br>Uruchom scraper (npm run scrape), aby wygenerować dane.</div>`;
    $("#updated").textContent = "Błąd ładowania";
  }
}

init();
