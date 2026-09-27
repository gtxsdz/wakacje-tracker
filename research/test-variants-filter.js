// Test filtra LOTNISK WYLOTU — regresja błędu "w wyniku są miasta spoza filtra".
//
// Co sprawdza (bez żadnych zapytań HTTP):
//  1) isAllowedDeparture — dozwolone kody z konfiguracji (w tym alias Modlin->Warszawa),
//  2) spójność konfiguracji: każdy kod z listy wylotów ma odpowiednik `z-<slug>`
//     w filtrze listingu (BASE_FILTER) i istnieje w słowniku AIRPORTS,
//  3) splitByAllowedDepartures — warianty z obcego lotniska (wylot LUB powrót)
//     są odrzucane, a z dozwolonego (także gdy API nie podało departureCode,
//     a tylko lotnisko w segmencie lotu) — zostają,
//  4) dane na dysku: KAŻDA oferta w najnowszym latest.json ma lotnisko z filtra
//     (dokładnie ten błąd: KRK przy konfiguracji KTW/LCJ/POZ/WAW/WRO).
//
// Uruchomienie: node research/test-variants-filter.js
//
// UWAGA: historii (history.json) NIE sprawdzamy twardo — punkty sprzed zmiany
// filtra to zapis faktów z danego dnia, a nie błąd. Test tylko je zlicza.

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cfg from "../scraper/config.js";
import { AIRPORTS, BASE_FILTER, SEARCH_QUERY, isAllowedDeparture } from "../scraper/config.js";
import { splitByAllowedDepartures, departureCodes, variantDepartureCode } from "../scraper/variants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Kod listy wylotów jest różny w obu projektach: WT2 trzyma ją w SEARCH.wyloty,
// WT1 w osobnej stałej WYLOTY. `??` nie ewaluuje prawej strony, gdy lewa istnieje,
// więc ten sam plik działa w obu repozytoriach.
const WYLOTY = cfg.WYLOTY ?? cfg.SEARCH.wyloty;

let passed = 0;
const ok = (name) => {
  console.log(`  ✓ ${name}`);
  passed++;
};

// Minimalny wariant w kształcie z API (to, czego używa splitByAllowedDepartures).
const variant = (dep, ret) => ({
  id: `h-${dep}-${ret}`,
  price: 5000,
  departureCode: dep,
  outbound: { from: dep ? { airportCode: dep } : null, to: { airportCode: "HRG" } },
  inbound: { from: { airportCode: "HRG" }, to: ret ? { airportCode: ret } : null },
});

console.log("== dozwolone lotniska (isAllowedDeparture) ==");
{
  assert.ok(isAllowedDeparture("KTW"), "KTW z listy wylotów musi być dozwolone");
  assert.deepStrictEqual(
    WYLOTY.map((c) => isAllowedDeparture(c)),
    WYLOTY.map(() => true),
    "każdy kod z listy wylotów jest dozwolony"
  );
  assert.ok(isAllowedDeparture("ktw"), "kod bez rozróżniania wielkości liter");
  assert.ok(isAllowedDeparture(" wro "), "spacje dookoła kodu są ignorowane");
  assert.ok(isAllowedDeparture("WMI"), "Modlin (WMI) liczy się jako Warszawa");
  assert.ok(!isAllowedDeparture("KRK"), "KRK (spoza filtra) NIE jest dozwolone");
  assert.ok(!isAllowedDeparture("GDN"), "GDN (spoza filtra) NIE jest dozwolone");
  assert.ok(!isAllowedDeparture("HRG"), "lotnisko docelowe (Egipt) NIE jest wylotem");
  assert.ok(!isAllowedDeparture(""), "pusty kod NIE jest dozwolony");
  assert.ok(!isAllowedDeparture(null), "brak kodu NIE jest dozwolony");
  ok("dozwolone tylko kody z listy wylotów (+ alias WMI), wielkość liter i spacje bez znaczenia");
}

console.log("\n== spójność konfiguracji ==");
{
  for (const kod of WYLOTY) {
    assert.ok(AIRPORTS[kod], `kod ${kod} musi istnieć w słowniku AIRPORTS`);
    assert.ok(
      BASE_FILTER.includes(`z-${AIRPORTS[kod].slug}`),
      `filtr listingu (BASE_FILTER) musi zawierać z-${AIRPORTS[kod].slug} dla ${kod}`
    );
  }
  // Bez tej spójności filtr listingu zawężałby oferty do innych miast niż te,
  // które dopuszczamy w wariantach (albo odwrotnie).
  assert.strictEqual(
    SEARCH_QUERY.departure.length,
    WYLOTY.filter((k) => AIRPORTS[k].id != null).length,
    "departure w zapytaniu API odpowiada liście wylotów (pomijając kody bez ID w API)"
  );
  ok(`wyloty = BASE_FILTER = SEARCH_QUERY.departure (${WYLOTY.join(", ")})`);
}


console.log("\n== podział wariantów (splitByAllowedDepartures) ==");
{
  const { allowed, skipped } = splitByAllowedDepartures([
    variant("KTW", "KTW"), // wylot i powrót z Katowic
    variant("WRO", null), // API nie podało powrotu — nie odrzucamy
    variant("ktw", "ktw"), // małe litery
    variant("", null), // brak departureCode i brak segmentu lotu -> odpada
    variant("KRK", "KRK"), // obce lotnisko
    variant("GDN", null), // obce lotnisko (tylko wylot)
    variant("KTW", "KRK"), // open-jaw: powrót z obcego lotniska -> odpada
  ]);
  assert.strictEqual(allowed.length, 3, "zostają 3 warianty z dozwolonych lotnisk");
  assert.strictEqual(skipped.length, 4, "odpadają 4 warianty");
  // Kody w komunikacie podajemy po lotnisku WYLOTU — odrzucony open-jaw
  // z wylotem KTW i powrotem KRK też wnosi tu KTW.
  assert.deepStrictEqual(
    departureCodes(skipped),
    ["GDN", "KRK", "KTW"],
    "kody odrzuconych wariantów w komunikatach"
  );
  ok("dozwolone: KTW / WRO (brak powrotu) / ktw — odrzucone: KRK, GDN, open-jaw, brak danych");

  // Kształt danych, gdy API poda lotnisko tylko w segmencie lotu.
  assert.strictEqual(variantDepartureCode({ outbound: { from: { airportCode: "poz" } } }), "POZ");
  assert.strictEqual(
    variantDepartureCode({ departureCode: "KRK", outbound: { from: { airportCode: "KTW" } } }),
    "KRK"
  );
  assert.strictEqual(variantDepartureCode({}), "");
  ok('variantDepartureCode: departureCode ma priorytet, fallback na segment lotu, brak danych = ""');
}

console.log("\n== dane na dysku (najnowszy latest.json) ==");
{
  const dataDir = path.join(ROOT, "data");

  // Ścieżki danych: WT2 trzyma je w data/<dir>/latest.json (wskaźnik
  // data/current.json), WT1 wprost w data/latest.json. Sprawdzamy wszystkie,
  // które istnieją.
  const pliki = (() => {
    const out = [];
    try {
      const cur = JSON.parse(fs.readFileSync(path.join(dataDir, "current.json"), "utf8"));
      if (cur?.dir) out.push(path.join(dataDir, cur.dir, "latest.json"));
    } catch {
      /* brak wskaźnika — sprawdzimy data/latest.json */
    }
    out.push(path.join(dataDir, "latest.json"));
    return out.filter((p, i, a) => a.indexOf(p) === i);
  })();

  const istniejace = pliki.filter((p) => fs.existsSync(p));
  if (istniejace.length === 0) {
    console.log("  (brak latest.json — pomijam; uruchom scraper, żeby wytworzyć dane)");
  }

  for (const plik of istniejace) {
    const rel = path.relative(ROOT, plik);
    const latest = JSON.parse(fs.readFileSync(plik, "utf8"));
    const oferty = latest.offers || [];

    const obceWyloty = oferty.filter((o) => !isAllowedDeparture(o.cheapest?.departureCode));
    assert.strictEqual(
      obceWyloty.length,
      0,
      `${rel}: oferty z wylotem spoza filtra -> ` +
        obceWyloty.map((o) => `${o.hotel} (${o.cheapest?.departureCode || "?"})`).join(", ")
    );

    const obcePowroty = oferty.filter(
      (o) => o.cheapest?.inbound?.to?.airportCode && !isAllowedDeparture(o.cheapest.inbound.to.airportCode)
    );
    assert.strictEqual(obcePowroty.length, 0, `${rel}: powroty na lotniska spoza filtra`);

    ok(`${rel}: ${oferty.length} ofert, wyloty i powroty wyłącznie z filtra (${WYLOTY.join(", ")})`);
  }

  // Informacyjnie: punkty historii sprzed zmiany filtra (nie są błędem — to zapis
  // tego, co faktycznie było najtańsze w dniu pomiaru).
  const plikiHistorii = [...new Set(pliki.map((p) => path.join(path.dirname(p), "history.json")))];
  for (const h of plikiHistorii.filter((p) => fs.existsSync(p))) {
    const history = JSON.parse(fs.readFileSync(h, "utf8"));
    let obce = 0;
    for (const e of Object.values(history.offers || {})) {
      for (const p of e.prices || []) if (!isAllowedDeparture(p.departureCode)) obce++;
    }
    console.log(`  i ${path.relative(ROOT, h)}: punktów historii spoza filtra: ${obce} (dane historyczne)`);
  }
}

console.log(`\nWszystkie ${passed} testów przeszło ✅`);
