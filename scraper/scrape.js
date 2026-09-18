// Główny scraper: pobiera listing Egiptu z wakacje.pl, a dla każdej oferty
// pobiera warianty wylotów (lotnisko/pokój/godziny/cena) przez API i śledzi
// NAJTAŃSZY dostępny wariant. Zapisuje historię cen i aktualny snapshot.
//
// Uruchomienie: node scraper/scrape.js
// Wynik:
//   data/history.json - historia (per oferta: śledzony wariant + punkty cenowe)
//   data/latest.json  - aktualny stan z pełnymi danymi lotu i zmianami

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseOffers } from "./parse.js";
import { pickCheapestAvailable, BlockedError } from "./variants.js";
import { getText } from "./http.js";
import {
  pageUrl,
  MAX_PAGES,
  REQUEST_DELAY_MS,
  HISTORY_FILE,
  LATEST_FILE,
  DATA_DIR,
  LISTING_URL,
} from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();

async function fetchPage(url) {
  const { status, body } = await getText(url, {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  });
  if (status !== 200) throw new Error(`HTTP ${status} dla ${url}`);
  return body;
}

/** Pobiera wszystkie strony listingu, zwraca zdeduplikowane oferty. */
async function scrapeListing() {
  const seen = new Map();
  for (let page = 1; page <= MAX_PAGES; page++) {
    let html;
    try {
      html = await fetchPage(pageUrl(page));
    } catch (err) {
      console.error(`Błąd pobierania strony ${page}: ${err.message}`);
      break;
    }
    const offers = parseOffers(html);
    console.log(`Strona ${page}: ${offers.length} ofert`);
    if (offers.length === 0) break;

    let added = 0;
    for (const o of offers) {
      if (!seen.has(o.key)) {
        seen.set(o.key, o);
        added++;
      }
    }
    if (offers.length < 10 || added === 0) break;
    if (page < MAX_PAGES) await sleep(REQUEST_DELAY_MS);
  }
  return [...seen.values()];
}

/** Krótki, czytelny opis wariantu (do notek i porównań). */
function variantLabel(v) {
  if (!v) return "";
  const dep = v.outbound?.from;
  const ret = v.inbound?.from;
  return [
    v.room,
    dep ? `${dep.airportCode} ${dep.customDate} ${dep.time}` : "",
    ret ? `powrót ${ret.customDate} ${ret.time}` : "",
  ]
    .filter(Boolean)
    .join(" • ");
}

/**
 * Stabilna sygnatura wariantu (offerHash z API rotuje między zapytaniami,
 * więc tożsamość budujemy z realnych atrybutów: pokój + lotnisko + daty/godziny).
 */
function variantSignature(v) {
  if (!v) return "";
  const d = v.outbound?.from;
  const r = v.inbound?.from;
  return [
    (v.room || "").toLowerCase().trim(),
    v.departureCode || d?.airportCode || "",
    d?.date || "",
    d?.time || "",
    r?.date || "",
    r?.time || "",
  ].join("|");
}

/** Spłaszcza wybrany wariant do postaci zapisywanej w historii/snapshotcie. */
function flattenVariant(v) {
  if (!v) return null;
  return {
    variantId: variantSignature(v),
    apiHash: v.id, // token z API (rotuje) — tylko poglądowo
    price: v.price,
    currency: v.currency,
    room: v.room,
    departureCode: v.departureCode || v.outbound?.from?.airportCode || "",
    luggageIncluded: v.luggageIncluded,
    carrier: v.carrier,
    outbound: v.outbound,
    inbound: v.inbound,
    label: variantLabel(v),
  };
}

function readJson(absPath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(absPath, data) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/**
 * Aktualizuje historię o dzisiejszy najtańszy wariant danej oferty.
 * Wykrywa zmianę śledzonego wariantu (np. poprzedni się wyprzedał).
 */
function updateOfferHistory(entry, offer, chosen, soldOutCheaper, date) {
  const flat = flattenVariant(chosen);

  // Metadane oferty (mogą się zmieniać: ocena, liczba opinii).
  entry.offerId = offer.offerId;
  entry.hotel = offer.hotel;
  entry.region = offer.region;
  entry.stars = offer.stars ?? entry.stars;
  entry.rating = offer.rating ?? entry.rating;
  entry.opinions = offer.opinions ?? entry.opinions;
  entry.operator = offer.operator;
  entry.duration = offer.duration;
  entry.departureDate = offer.departureDate;
  entry.returnDate = offer.returnDate;
  entry.lastSeen = date;
  if (!entry.firstSeen) entry.firstSeen = date;

  entry.prices = entry.prices || [];
  entry.variantChanges = entry.variantChanges || [];

  const prev = entry.prices[entry.prices.length - 1];

  // Zmiana śledzonego wariantu (inny variantId niż ostatnio zapisany).
  if (prev && flat && prev.variantId !== flat.variantId) {
    entry.variantChanges.push({
      date,
      from: { variantId: prev.variantId, label: prev.label, price: prev.price },
      to: { variantId: flat.variantId, label: flat.label, price: flat.price },
      // Jeśli poprzedni był wśród niedostępnych/tańszych — prawdopodobnie wyprzedany.
      reason:
        soldOutCheaper.some((v) => variantSignature(v) === prev.variantId)
          ? "poprzedni wariant wyprzedany"
          : "zmiana najtańszego wariantu",
    });
  }

  if (!flat) return; // brak dostępnego wariantu — nie dopisujemy punktu

  const point = { date, ...flat };
  if (!prev) {
    entry.prices.push(point);
  } else if (prev.date === date) {
    entry.prices[entry.prices.length - 1] = point; // nadpisz ten sam dzień
  } else {
    entry.prices.push(point);
  }
}

/** Buduje snapshot latest.json ze zmianami cen. */
function buildLatest(history, currentResults, date) {
  const offers = [];

  for (const r of currentResults) {
    const entry = history.offers[r.offer.key];
    const prices = entry ? entry.prices : [];
    const flat = flattenVariant(r.chosen);
    const current = flat ? flat.price : null;

    // Poprzednia znana cena (punkt z innego dnia).
    let prevPrice = null;
    for (let i = prices.length - 1; i >= 0; i--) {
      if (prices[i].date !== date) {
        prevPrice = prices[i].price;
        break;
      }
    }

    const values = prices.map((p) => p.price).filter((n) => n != null);
    if (current != null) values.push(current);
    const minPrice = values.length ? Math.min(...values) : null;
    const maxPrice = values.length ? Math.max(...values) : null;

    let change = null;
    let changePct = null;
    if (prevPrice != null && current != null) {
      change = current - prevPrice;
      changePct = prevPrice ? +((change / prevPrice) * 100).toFixed(2) : null;
    }

    const lastChange =
      entry && entry.variantChanges && entry.variantChanges.length
        ? entry.variantChanges[entry.variantChanges.length - 1]
        : null;
    const variantChangedToday = lastChange && lastChange.date === date;

    offers.push({
      key: r.offer.key,
      offerId: r.offer.offerId,
      hotel: r.offer.hotel,
      region: r.offer.region,
      stars: r.offer.stars,
      rating: r.offer.rating,
      opinions: r.offer.opinions,
      operator: r.offer.operator,
      duration: r.offer.duration,
      departureDate: r.offer.departureDate,
      returnDate: r.offer.returnDate,
      detailUrl: buildDetailUrl(r.offer),
      variantCount: r.variants.length,
      cheapest: flat,
      price: current,
      prevPrice,
      change,
      changePct,
      minPrice,
      maxPrice,
      isLowest: current != null && minPrice != null && current <= minPrice,
      pointCount: prices.length,
      firstSeen: entry ? entry.firstSeen : date,
      soldOutNote: variantChangedToday
        ? lastChange.reason
        : null,
      soldOutCheaperCount: r.soldOutCheaper.length,
    });
  }

  offers.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

  // Oferty z historii nieobecne dziś.
  const currentKeys = new Set(currentResults.map((r) => r.offer.key));
  const disappeared = [];
  for (const key of Object.keys(history.offers)) {
    if (!currentKeys.has(key)) {
      const e = history.offers[key];
      const last = e.prices && e.prices.length ? e.prices[e.prices.length - 1] : null;
      disappeared.push({
        key,
        hotel: e.hotel,
        region: e.region,
        lastPrice: last ? last.price : null,
        lastSeen: e.lastSeen,
      });
    }
  }

  return {
    generatedAt: nowIso(),
    date,
    sourceUrl: LISTING_URL,
    count: offers.length,
    offers,
    disappeared,
  };
}

/** Odtwarza URL szczegółów oferty (informacyjnie, dla frontendu). */
function buildDetailUrl(offer) {
  const p = offer.place;
  if (!p || !offer.urlName) return null;
  const country = p.country?.urlName;
  const region = p.region?.urlName;
  const city = p.city?.urlName;
  if (!country || !region || !city) return null;
  return `https://www.wakacje.pl/oferty/${country}/${region}/${city}/${offer.urlName}-${offer.offerId}.html`;
}

async function main() {
  const date = today();
  console.log(`=== Scraper wakacje.pl (Egipt, warianty) — ${date} ===`);

  const offers = await scrapeListing();
  console.log(`Ofert z listingu: ${offers.length}`);
  if (offers.length === 0) {
    console.error("Brak ofert — struktura strony mogła się zmienić. Nie nadpisuję historii.");
    process.exitCode = 1;
    return;
  }

  // Dla każdej oferty pobierz warianty i wybierz najtańszy.
  // UWAGA: weryfikacja dostępności (checkOfferAvailability) okazała się
  // niewiarygodna — endpoint wymaga offerHash z tej samej sesji, a hashe z
  // getCalculatorOfferVariants rotują, więc zwraca fałszywe "niedostępne" nawet
  // dla realnie dostępnych, najtańszych wariantów. Włączenie jej zawyżałoby cenę.
  // Dlatego ufamy liście z getCalculatorOfferVariants (to samo źródło, z którego
  // serwis liczy ceny). Bezpieczniki (BlockedError, limity) zostają na przyszłość.
  const results = [];
  let blocked = false;
  for (const offer of offers) {
    try {
      const picked = await pickCheapestAvailable(offer, { verifyAvailability: false });
      results.push({ offer, ...picked });
      const c = picked.chosen;
      console.log(
        `  ${offer.hotel.slice(0, 30).padEnd(30)} → ${
          c ? `${c.price} zł | ${variantLabel(c)}` : "brak wariantów"
        } (${picked.variants.length} wariantów${
          picked.soldOutCheaper.length ? `, ${picked.soldOutCheaper.length} tańszych niedostępnych` : ""
        })`
      );
    } catch (err) {
      if (err instanceof BlockedError) {
        // Serwis zaczął blokować/throttlować — przerywamy, by nie eskalować.
        console.error(`\n⛔ ${err.message}\nPrzerywam pobieranie. Historia NIE zostanie nadpisana.`);
        blocked = true;
        break;
      }
      console.error(`  ${offer.hotel}: błąd wariantów — ${err.message}`);
      results.push({ offer, chosen: null, variants: [], soldOutCheaper: [] });
    }
    await sleep(700); // odstęp między ofertami
  }

  if (blocked) {
    process.exitCode = 1;
    return;
  }

  const withVariants = results.filter((r) => r.chosen);
  if (withVariants.length === 0) {
    console.error("Żadna oferta nie zwróciła wariantów — nie nadpisuję historii.");
    process.exitCode = 1;
    return;
  }

  const historyPath = path.join(ROOT, HISTORY_FILE);
  const latestPath = path.join(ROOT, LATEST_FILE);
  const history = readJson(historyPath, { offers: {} });
  history.offers = history.offers || {};

  for (const r of results) {
    const entry = history.offers[r.offer.key] || {};
    updateOfferHistory(entry, r.offer, r.chosen, r.soldOutCheaper, date);
    history.offers[r.offer.key] = entry;
  }
  history.lastUpdated = nowIso();
  history.sourceUrl = LISTING_URL;

  const latest = buildLatest(history, results, date);

  writeJson(historyPath, history);
  writeJson(latestPath, latest);

  const drops = latest.offers.filter((o) => o.change != null && o.change < 0);
  const rises = latest.offers.filter((o) => o.change != null && o.change > 0);
  const changes = latest.offers.filter((o) => o.soldOutNote);
  console.log(`Zapisano do ${DATA_DIR}/  | spadki: ${drops.length}, wzrosty: ${rises.length}, zmiany wariantu: ${changes.length}`);
}

main().catch((err) => {
  console.error("Błąd krytyczny:", err);
  process.exitCode = 1;
});
