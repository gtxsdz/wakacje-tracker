// Główny scraper: pobiera oferty Egiptu z wakacje.pl, parsuje,
// dopisuje snapshot cen do historii i wylicza zmiany (spadki/wzrosty).
//
// Uruchomienie: node scraper/scrape.js
// Wynik:
//   data/history.json - pełna historia (per oferta: lista {date, price})
//   data/latest.json  - aktualny stan + wyliczone zmiany dla frontendu

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseOffers } from "./parse.js";
import {
  pageUrl,
  USER_AGENT,
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

/** Data w formacie YYYY-MM-DD (UTC). */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Pełny znacznik czasu ISO. */
function nowIso() {
  return new Date().toISOString();
}

// Pełny zestaw nagłówków imitujący przeglądarkę Chrome. Niektóre zabezpieczenia
// anty-botowe (m.in. odpowiedź HTTP 449) odrzucają żądania bez tych nagłówków,
// zwłaszcza z adresów IP centrów danych (np. runnery GitHub Actions).
const BROWSER_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Ch-Ua": '"Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  Referer: "https://www.wakacje.pl/",
};

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url, attempt = 1) {
  const MAX_ATTEMPTS = 4;
  const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });
  if (res.ok) return res.text();

  // Blokady anty-botowe (429/449/503) — ponawiamy z rosnącym odstępem.
  const retryable = [429, 449, 503].includes(res.status);
  if (retryable && attempt < MAX_ATTEMPTS) {
    const wait = 2000 * attempt;
    console.warn(
      `HTTP ${res.status} — ponawiam za ${wait} ms (próba ${attempt + 1}/${MAX_ATTEMPTS})`
    );
    await sleepMs(wait);
    return fetchPage(url, attempt + 1);
  }
  throw new Error(`HTTP ${res.status} dla ${url}`);
}

/** Pobiera wszystkie strony listingu i zwraca zdeduplikowaną tablicę ofert. */
async function scrapeAll() {
  const seen = new Map();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = pageUrl(page);
    let html;
    try {
      html = await fetchPage(url);
    } catch (err) {
      console.error(`Błąd pobierania strony ${page}: ${err.message}`);
      break;
    }

    const offers = parseOffers(html);
    console.log(`Strona ${page}: znaleziono ${offers.length} ofert`);

    if (offers.length === 0) break;

    let added = 0;
    for (const o of offers) {
      if (!seen.has(o.key)) {
        seen.set(o.key, o);
        added++;
      }
    }

    // Mniej niż pełna strona lub brak nowych ofert => koniec paginacji.
    if (offers.length < 10 || added === 0) break;

    if (page < MAX_PAGES) await sleep(REQUEST_DELAY_MS);
  }
  return [...seen.values()];
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
 * Aktualizuje historię: dla każdej oferty dopisuje punkt {date, price},
 * jeśli cena się zmieniła lub to nowy dzień. Zwraca zaktualizowaną historię.
 */
function updateHistory(history, offers, date) {
  const offersByKey = history.offers || {};

  for (const o of offers) {
    const existing = offersByKey[o.key];
    if (!existing) {
      offersByKey[o.key] = {
        key: o.key,
        hotel: o.hotel,
        region: o.region,
        dateRange: o.dateRange,
        duration: o.duration,
        departure: o.departure,
        board: o.board,
        operator: o.operator,
        stars: o.stars,
        rating: o.rating,
        opinions: o.opinions,
        detailUrl: o.detailUrl,
        firstSeen: date,
        lastSeen: date,
        prices: [{ date, price: o.price }],
      };
      continue;
    }

    // Aktualizacja metadanych (mogą się zmienić: ocena, liczba opinii itp.).
    existing.hotel = o.hotel;
    existing.region = o.region;
    existing.duration = o.duration;
    existing.board = o.board;
    existing.operator = o.operator;
    existing.stars = o.stars ?? existing.stars;
    existing.rating = o.rating ?? existing.rating;
    existing.opinions = o.opinions ?? existing.opinions;
    existing.detailUrl = o.detailUrl ?? existing.detailUrl;
    existing.lastSeen = date;

    const prices = existing.prices;
    const last = prices[prices.length - 1];
    if (!last) {
      prices.push({ date, price: o.price });
    } else if (last.date === date) {
      // Ten sam dzień: nadpisz najnowszą ceną.
      last.price = o.price;
    } else if (last.price !== o.price) {
      // Inny dzień i inna cena: dopisz punkt.
      prices.push({ date, price: o.price });
    } else {
      // Inny dzień, ta sama cena: aktualizuj lastSeen tylko (już zrobione).
      // Dopisujemy też punkt, by wykres pokazywał ciągłość obserwacji.
      prices.push({ date, price: o.price });
    }
  }

  history.offers = offersByKey;
  history.lastUpdated = nowIso();
  history.sourceUrl = LISTING_URL;
  return history;
}

/**
 * Buduje snapshot latest.json z wyliczonymi zmianami cen.
 * Dla każdej aktualnie dostępnej oferty:
 *  - price (aktualna)
 *  - prevPrice (poprzedni punkt historii, jeśli istnieje)
 *  - change / changePct (względem poprzedniego punktu)
 *  - minPrice / maxPrice (z całej historii)
 */
function buildLatest(history, currentOffers, date) {
  const currentKeys = new Set(currentOffers.map((o) => o.key));
  const items = [];

  for (const o of currentOffers) {
    const h = history.offers[o.key];
    const prices = h ? h.prices : [{ date, price: o.price }];
    const current = o.price;

    // Poprzedni RÓŻNY od dzisiejszej obserwacji punkt (poprzednia znana cena).
    let prevPrice = null;
    for (let i = prices.length - 1; i >= 0; i--) {
      if (prices[i].date !== date) {
        prevPrice = prices[i].price;
        break;
      }
    }

    const values = prices.map((p) => p.price);
    const minPrice = Math.min(...values, current);
    const maxPrice = Math.max(...values, current);

    let change = null;
    let changePct = null;
    if (prevPrice != null) {
      change = current - prevPrice;
      changePct = prevPrice ? +((change / prevPrice) * 100).toFixed(2) : null;
    }

    items.push({
      key: o.key,
      hotel: o.hotel,
      region: o.region,
      dateRange: o.dateRange,
      duration: o.duration,
      departure: o.departure,
      board: o.board,
      operator: o.operator,
      stars: o.stars,
      rating: o.rating,
      opinions: o.opinions,
      detailUrl: o.detailUrl,
      price: current,
      prevPrice,
      change,
      changePct,
      minPrice,
      maxPrice,
      isLowest: current <= minPrice,
      pointCount: prices.length,
      firstSeen: h ? h.firstSeen : date,
    });
  }

  // Oferty z historii, których dziś nie ma (zniknęły z listingu).
  const disappeared = [];
  for (const key of Object.keys(history.offers)) {
    if (!currentKeys.has(key)) {
      const h = history.offers[key];
      const last = h.prices[h.prices.length - 1];
      disappeared.push({
        key,
        hotel: h.hotel,
        region: h.region,
        dateRange: h.dateRange,
        departure: h.departure,
        lastPrice: last ? last.price : null,
        lastSeen: h.lastSeen,
      });
    }
  }

  return {
    generatedAt: nowIso(),
    date,
    sourceUrl: LISTING_URL,
    count: items.length,
    offers: items,
    disappeared,
  };
}

async function main() {
  const date = today();
  console.log(`=== Scraper wakacje.pl (Egipt) — ${date} ===`);

  const offers = await scrapeAll();
  console.log(`Łącznie unikalnych ofert: ${offers.length}`);

  if (offers.length === 0) {
    console.error(
      "Nie znaleziono żadnych ofert. Struktura strony mogła się zmienić — historia nie została nadpisana."
    );
    process.exitCode = 1;
    return;
  }

  const historyPath = path.join(ROOT, HISTORY_FILE);
  const latestPath = path.join(ROOT, LATEST_FILE);

  const history = readJson(historyPath, { offers: {} });
  updateHistory(history, offers, date);
  const latest = buildLatest(history, offers, date);

  writeJson(historyPath, history);
  writeJson(latestPath, latest);

  // Krótkie podsumowanie zmian.
  const drops = latest.offers.filter((o) => o.change != null && o.change < 0);
  const rises = latest.offers.filter((o) => o.change != null && o.change > 0);
  console.log(`Zapisano dane do ${DATA_DIR}/`);
  console.log(`Spadki: ${drops.length}, Wzrosty: ${rises.length}`);
  if (drops.length) {
    const biggest = drops.sort((a, b) => a.change - b.change)[0];
    console.log(
      `Największy spadek: ${biggest.hotel} ${biggest.change} zł (${biggest.changePct}%)`
    );
  }
}

main().catch((err) => {
  console.error("Błąd krytyczny:", err);
  process.exitCode = 1;
});
