// Pobieranie listy ofert przez API wyszukiwarki (search.tripsSearch).
//
// Zastępuje parsowanie HTML (które widziało tylko 1. stronę = 10 ofert).
// Endpoint zwraca "count" (łączna liczba) i "offers" (10 na stronę);
// paginujemy przez query.pageNumber aż zbierzemy wszystkie.

import { postJson } from "./http.js";
import { normalizeOffer } from "./parse.js";
import { SEARCH_API, SEARCH_QUERY, MAX_PAGES } from "./config.js";

const PAGE_SIZE = 10;

function buildBody(pageNumber) {
  return [
    {
      method: "search.tripsSearch",
      params: {
        brand: "WAK",
        limit: PAGE_SIZE,
        priceHistory: 1,
        imageSizes: ["570,428"],
        flatArray: true,
        multiSearch: true,
        withHotelRate: 1,
        withPromoOffer: 0,
        recommendationVersion: "noTUI",
        imageLimit: 10,
        withPromotionsInfo: false,
        type: "tours",
        firstMinuteTui: false,
        countryId: ["37"], // Egipt
        regionId: [],
        cityId: [],
        hotelId: [],
        roundTripId: [],
        cruiseId: [],
        searchType: "wczasy",
        offersAttributes: [],
        alternative: { countryId: [], regionId: [], cityId: [] },
        qsVersion: "cx",
        query: { ...SEARCH_QUERY, pageNumber },
        durationMin: String(SEARCH_QUERY.duration.min),
      },
    },
  ];
}

const API_HEADERS = {
  Accept: "application/json, text/plain, */*",
  Origin: "https://www.wakacje.pl",
  Referer: "https://www.wakacje.pl/wczasy/egipt/",
};

/** Pobiera jedną stronę wyników. Zwraca { offers, count }. */
async function fetchSearchPage(pageNumber) {
  const { status, body } = await postJson(SEARCH_API, buildBody(pageNumber), API_HEADERS);
  if (status !== 200) throw new Error(`search API HTTP ${status} (strona ${pageNumber})`);
  const json = JSON.parse(body);
  const data = json?.data;
  if (!data || !Array.isArray(data.offers)) {
    throw new Error(`search API: nieoczekiwana odpowiedź (strona ${pageNumber})`);
  }
  return { offers: data.offers, count: data.count ?? null };
}

/**
 * Pobiera WSZYSTKIE strony i zwraca znormalizowane, zdeduplikowane oferty.
 * Obiekty z API mają to samo pole `id` co osadzony JSON — mapujemy je na
 * `offerId`, którego oczekuje normalizeOffer.
 */
export async function fetchAllOffers({ delayMs = 500 } = {}) {
  const seen = new Map();
  let total = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { offers, count } = await fetchSearchPage(page);
    if (total == null) total = count;
    console.log(`Search API strona ${page}: ${offers.length} ofert (łącznie do pobrania: ${total ?? "?"})`);

    if (offers.length === 0) break;

    for (const raw of offers) {
      // API używa `id`; normalizeOffer oczekuje `offerId`.
      const withOfferId = { ...raw, offerId: raw.offerId ?? raw.id };
      const norm = normalizeOffer(withOfferId);
      if (!norm.offerId && !norm.hotelId) continue;
      // Klucz deduplikacji: offerId, a gdy API go nie zwróci — stabilny klucz
      // oferty (hotel-{hotelId} + data). Bez fallbacku wszystkie oferty bez `id`
      // wpadały do wspólnego gniazda `null` i zostawała tylko pierwsza.
      const dedupKey = norm.offerId ?? norm.key;
      if (!seen.has(dedupKey)) seen.set(dedupKey, norm);
    }

    // Koniec, gdy zebraliśmy wszystko albo strona niepełna.
    if (total != null && seen.size >= total) break;
    if (offers.length < PAGE_SIZE) break;

    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }

  return { offers: [...seen.values()], total };
}

export default { fetchAllOffers };
