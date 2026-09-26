// Test logiki scrapera na PRAWDZIWYCH funkcjach z scraper/scrape.js (nie na
// kopii). Import nie uruchamia main() (guard `isDirectRun` na końcu scrape.js),
// więc test nie zapisuje nic do data/ i nie wykonuje żadnych zapytań HTTP.
//
// Sprawdza zachowania dodane/wzmocnione przy przeglądzie kodu:
//  - kumulatywne min/max (minSeenPrice/maxSeenPrice) odporne na przycinanie punktów,
//  - limit wpisów o zmianie biura (MAX_VARIANT_CHANGES),
//  - dedup po hotelu (collapseByHotel) i brak „alt” z ceną null,
//  - sortowanie listy „znikniętych” od najświeższej.
//
// Uruchomienie: node research/test-scrape-logic.js

import assert from "node:assert";
import { updateOfferHistory, buildLatest, collapseByHotel } from "../scraper/scrape.js";

let passed = 0;
const ok = (name) => {
  console.log(`  ✓ ${name}`);
  passed++;
};

const D = "2026-09-26";
const T1 = "2026-09-26T08:00:00.000Z";
const T2 = "2026-09-26T12:00:00.000Z";
const T3 = "2026-09-26T16:00:00.000Z";

// Minimalny wariant zgodny z kształtem z API (to, czego używa flattenVariant).
const variant = (price, operator = "Join UP") => ({
  id: `hash-${price}-${operator}`,
  uid: "uid",
  price,
  currency: "PLN",
  room: "Standard double",
  roomExtra: [],
  service: "All inclusive",
  departureCode: "KTW",
  luggageIncluded: true,
  carrier: "XX",
  outbound: { from: { airportCode: "KTW", customDate: "21.06", time: "06:30" }, to: { airportCode: "HRG", time: "11:45" } },
  inbound: { from: { airportCode: "HRG", customDate: "28.06", time: "12:30" }, to: { airportCode: "KTW", time: "15:50" } },
});

const offer = (extra = {}) => ({
  key: "hotel-111",
  offerId: 999,
  hotelId: 111,
  hotel: "Hotel Test & Spa",
  region: "Egipt / Hurghada",
  stars: 5,
  rating: 8.5,
  opinions: 100,
  operator: "Join UP",
  service: 1,
  duration: 7,
  departureDate: "2027-06-21",
  returnDate: "2027-06-28",
  place: null,
  urlName: null,
  ...extra,
});

const result = (hotelId, price, operator) => ({
  offer: offer({ key: `offer-${hotelId}-${price ?? "x"}`, hotelId, operator }),
  chosen: price == null ? null : variant(price, operator),
  variants: price == null ? [] : [variant(price, operator)],
  soldOutCheaper: [],
});

console.log("== min/max kumulatywne, licznik serii ==");

// 1) Pierwszy pomiar — jeden punkt, min = max.
{
  const e = {};
  updateOfferHistory(e, offer(), variant(5000), [], D, T1);
  assert.strictEqual(e.prices.length, 1);
  assert.strictEqual(e.minSeenPrice, 5000);
  assert.strictEqual(e.maxSeenPrice, 5000);
  ok("Pierwszy pomiar: 1 punkt, min = max = 5000");
}

// 2) Spadek obniża tylko minimum.
{
  const e = {};
  updateOfferHistory(e, offer(), variant(5000), [], D, T1);
  updateOfferHistory(e, offer(), variant(4200), [], D, T2);
  assert.strictEqual(e.prices.length, 2);
  assert.strictEqual(e.minSeenPrice, 4200);
  assert.strictEqual(e.maxSeenPrice, 5000);
  ok("Spadek: min → 4200, max pozostaje 5000");
}

// 3) Trzy identyczne odczyty → streak 3 i stable=true w latest.json.
{
  const e = {};
  updateOfferHistory(e, offer(), variant(5000), [], D, T1);
  updateOfferHistory(e, offer(), variant(5000), [], D, T2);
  updateOfferHistory(e, offer(), variant(5000), [], D, T3);
  assert.strictEqual(e.prices.length, 1, "bez zmiany nie dopisujemy punktu");
  assert.strictEqual(e.sameRunStreak, 3);
  const latest = buildLatest(
    { offers: { "hotel-111": e } },
    [{ offer: offer(), chosen: variant(5000), variants: [variant(5000)], soldOutCheaper: [] }],
    D
  );
  assert.strictEqual(latest.offers[0].stable, true);
  ok("3 identyczne odczyty → sameRunStreak = 3, stable = true");
}

// 4) Przycięcie punktów NIE gubi min/max z całej historii (sedno poprawki).
{
  const e = {
    prices: [
      { price: 500, date: "2026-01-01" },
      ...Array.from({ length: 499 }, () => ({ price: 2000, date: "2026-02-01" })),
    ],
  };
  updateOfferHistory(e, offer(), variant(3000), [], D, T1);
  assert.strictEqual(e.prices.length, 500, "limit punktów");
  assert.ok(!e.prices.some((p) => p.price === 500), "najstarszy/najtańszy punkt wypadł z listy");
  assert.strictEqual(e.minSeenPrice, 500, "min nadal pamięta 500");
  assert.strictEqual(e.maxSeenPrice, 3000);
  const latest = buildLatest(
    { offers: { "hotel-111": e } },
    [{ offer: offer(), chosen: variant(3000), variants: [variant(3000)], soldOutCheaper: [] }],
    D
  );
  assert.strictEqual(latest.offers[0].minPrice, 500);
  assert.strictEqual(latest.offers[0].maxPrice, 3000);
  assert.strictEqual(latest.offers[0].pointCount, 500);
  ok("Po przycięciu do 500 punktów min/max = 500/3000 (cała historia zachowana)");
}

// 5) Limit wpisów o zmianie biura.
{
  const e = {};
  for (let i = 0; i < 205; i++) {
    const op = i % 2 ? "Coral Travel" : "Join UP";
    updateOfferHistory(e, offer({ operator: op }), variant(5000 + i * 10, op), [], D, T1);
  }
  assert.strictEqual(e.variantChanges.length, 200, "limit MAX_VARIANT_CHANGES");
  ok("variantChanges przycięte do 200 wpisów");
}

console.log("\n== dedup po hotelu (collapseByHotel) ==");

// 6) Błąd wariantów PRZED realną ceną.
{
  const out = collapseByHotel([result(111, null, "Join UP"), result(111, 5000, "Coral Travel")]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].offer.key, "hotel-111");
  assert.strictEqual(out[0].chosen.price, 5000);
  assert.deepStrictEqual(out[0].altOffers, [], "nieudany wariant nie jest alternatywą");
  ok("chosen=null przed realną ceną → brak „alt” z ceną null, klucz hotel-111");
}

// 7) Błąd wariantów PO realnej cenie.
{
  const out = collapseByHotel([result(111, 5000, "Coral Travel"), result(111, null, "Join UP")]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].chosen.price, 5000);
  assert.deepStrictEqual(out[0].altOffers, []);
  ok("chosen=null po realnej cenie → pominięty (bez „alt” z ceną null)");
}

// 8) Dwie realne ceny — tańsza wygrywa, droższa idzie do altOffers.
{
  const out = collapseByHotel([result(111, 5000, "Coral Travel"), result(111, 4500, "Join UP")]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].chosen.price, 4500);
  assert.deepStrictEqual(out[0].altOffers, [
    { offerId: 999, operator: "Coral Travel", price: 5000 },
  ]);
  ok("Tańsza oferta wygrywa, droższa trafia do altOffers z realną ceną");
}

// 9) Brak alternatyw → altOffers undefined (front nie rysuje pustej linii).
{
  const e = {};
  updateOfferHistory(e, offer(), variant(5000), [], D, T1);
  const latest = buildLatest(
    { offers: { "hotel-111": e } },
    [{ offer: offer(), chosen: variant(5000), variants: [variant(5000)], soldOutCheaper: [] }],
    D
  );
  assert.strictEqual(latest.offers[0].altOffers, undefined);
  ok("Brak alternatyw → altOffers = undefined");
}

console.log("\n== lista „znikniętych” ==");

// 10) Sortowanie od najświeżej widzianej.
{
  const history = {
    offers: {
      "hotel-A": { hotel: "A", region: "Egipt", lastSeen: "2026-09-20", prices: [{ price: 1, date: "2026-09-20" }] },
      "hotel-B": { hotel: "B", region: "Egipt", lastSeen: "2026-09-25", prices: [{ price: 2, date: "2026-09-25" }] },
    },
  };
  const latest = buildLatest(history, [], D);
  assert.deepStrictEqual(latest.disappeared.map((d) => d.hotel), ["B", "A"]);
  assert.strictEqual(latest.count, 0);
  ok("disappeared posortowane od najświeżej widzianej");
}

console.log(`\nWszystkie ${passed} testów przeszło ✅`);
