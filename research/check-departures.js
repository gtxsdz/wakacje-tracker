// Diagnostyka: czy wyniki w data/ nie zawierają lotnisk spoza filtra `wyloty`.
//
// Sprawdza dwie rzeczy naraz (na żywo, przez to samo API co produkcyjny scraper):
//  1) LISTING  — czy wyszukiwarka zwraca oferty, które w ogóle nie mają wylotu
//     z dozwolonych miast (pole `departurePlaces` z API search.tripsSearch),
//  2) WARIANTY — co zwraca getCalculatorOfferVariants/{offerId} (bez
//     departureCityId = warianty ze WSZYSTKICH lotnisk) i które z nich
//     przechodzą filtr `wyloty` z config.js.
//
// Uruchomienie: node research/check-departures.js [liczba_ofert]
// Domyślnie sprawdza pierwsze 5 ofert z listingu.

import { postJson } from "../scraper/http.js";
import * as cfg from "../scraper/config.js";
import { SEARCH_API, SEARCH_QUERY, AIRPORTS, isAllowedDeparture } from "../scraper/config.js";

const API_HEADERS = {
  Accept: "application/json, text/plain, */*",
  Origin: "https://www.wakacje.pl",
  Referer: "https://www.wakacje.pl/wczasy/egipt/",
};

const MAX_OFFERS = Number(process.argv[2] || 5);

// Lista wylotów: WT2 trzyma ją w SEARCH.wyloty, WT1 w stałej WYLOTY.
const WYLOTY = cfg.WYLOTY ?? cfg.SEARCH.wyloty;

console.log(`Dozwolone wyloty: ${WYLOTY.join(", ")}`);
console.log(`Słowniki AIRPORTS: ${Object.keys(AIRPORTS).join(", ")}\n`);

// ---- 1) LISTING -----------------------------------------------------------
const body = [
  {
    method: "search.tripsSearch",
    params: {
      brand: "WAK",
      limit: 10,
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
      countryId: ["37"],
      regionId: [],
      cityId: [],
      hotelId: [],
      roundTripId: [],
      cruiseId: [],
      searchType: "wczasy",
      offersAttributes: [],
      alternative: { countryId: [], regionId: [], cityId: [] },
      qsVersion: "cx",
      query: { ...SEARCH_QUERY, pageNumber: 1 },
      durationMin: String(SEARCH_QUERY.duration.min),
    },
  },
];

const searchRes = await postJson(SEARCH_API, body, API_HEADERS);
if (searchRes.status !== 200) {
  console.error(`search API HTTP ${searchRes.status} — nie mogę sprawdzić listingu.`);
  process.exit(1);
}
const searchJson = JSON.parse(searchRes.body);
const offers = searchJson?.data?.offers || [];
console.log(`Listing: ${offers.length} ofert na 1. stronie (count=${searchJson?.data?.count})\n`);

const summarize = (list) =>
  !Array.isArray(list) || list.length === 0
    ? "(brak danych)"
    : list
        .map((p) => (typeof p === "string" ? p : p?.code || p?.iata || p?.name || JSON.stringify(p)))
        .join(", ");

for (const o of offers) {
  const places = o.departurePlaces ?? o.departurePlace ?? o.departureCities ?? null;
  console.log(`• ${String(o.name || "").slice(0, 45).padEnd(45)} offerId=${o.id} wyloty z API: ${summarize(places)}`);
}

// ---- 2) WARIANTY ----------------------------------------------------------
// Skład osób bierzemy z SEARCH_QUERY.rooms[0] — tę strukturę mają oba projekty
// (WT2 liczy ją z bloku SEARCH, WT1 ma ją zapisaną wprost).
const room = (SEARCH_QUERY.rooms || [])[0] || {};

console.log(`\n=== Warianty (getCalculatorOfferVariants) dla ${MAX_OFFERS} ofert ===`);
for (const o of offers.slice(0, MAX_OFFERS)) {
  const payload = {
    adults: room.adult ?? 2,
    kids: room.kid ?? (room.ages ? room.ages.length : 0),
    infants: 0,
    kidsAges: room.ages || [],
    serviceId: o.service ?? 1,
    duration: o.duration ?? o.durationNights ?? null,
    departureDate: o.departureDate ?? null,
    transportId: 1,
    hotelId: o.hotelId ?? null,
    tourOp: (o.offerHash || "").split(":")[0],
    tourId: o.tourOperator ?? null,
    cruiseId: 0,
    roundTripId: 0,
    isAlternativeRoom: false,
    isOffer77: false,
  };
  const res = await postJson(`https://www.wakacje.pl/v2/api/getCalculatorOfferVariants/${o.id}`, payload, API_HEADERS);
  if (res.status !== 200) {
    console.log(`\n• ${String(o.name).slice(0, 45)} → HTTP ${res.status}`);
    continue;
  }
  const list = JSON.parse(res.body)?.data?.offers || [];
  const map = new Map(); // kod -> najniższa cena
  for (const v of list) {
    const code = (v.departureCode || v.departStart?.airportCode || "?").toUpperCase();
    const price = v.totalPrice ?? v.basePrice ?? null;
    if (!map.has(code) || (price != null && price < map.get(code))) map.set(code, price);
  }
  const sorted = [...map.entries()].sort((a, b) => (a[1] ?? Infinity) - (b[1] ?? Infinity));
  const allowed = sorted.filter(([c]) => isAllowedDeparture(c));
  const banned = sorted.filter(([c]) => !isAllowedDeparture(c));
  console.log(`\n• ${String(o.name).slice(0, 45)} (${list.length} wariantów)`);
  console.log(`   ZDOZWOLONE: ${allowed.map(([c, p]) => `${c}=${p}`).join(", ") || "BRAK"}`);
  console.log(`   POZA FILTREM: ${banned.map(([c, p]) => `${c}=${p}`).join(", ") || "brak"}`);
  await new Promise((r) => setTimeout(r, 800));
}
