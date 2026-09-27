// Jednorazowa migracja: usuwa z historii punkty z lotnisk spoza filtra (WYLOTY).
//
// PO CO: do 27.09.2026 scraper brał najtańszy wariant ze WSZYSTKICH lotnisk
// (endpoint getCalculatorOfferVariants nie filtruje po mieście wylotu), więc do
// historii trafiały punkty np. z Krakowa, choć w konfiguracji były tylko
// KTW/LCJ/POZ/WAW/WRO. Takie punkty nie odpowiadają żadnej ofercie z filtra —
// po poprawce (scraper/variants.js) są usuwane, żeby wykres/CSV w UI nie
// pokazywał lotnisk, których nie ma w wyszukiwaniu.
//
// Uruchomienie:
//   node research/migrate-drop-banned-departures.js          → tylko raport (nic nie zapisuje)
//   node research/migrate-drop-banned-departures.js --apply  → zapisuje zmiany
//
// Zakres: wyłącznie `data/<dir>/history.json` (lub data/history.json).
// Po usunięciu punktów przelicza kumulatywne minSeenPrice/maxSeenPrice; wpis bez
// żadnego punktu jest usuwany. Oferty w latest.json regeneruje scraper — tu ich
// nie ruszamy.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowedDeparture } from "../scraper/config.js";
import * as cfg from "../scraper/config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WYLOTY = cfg.WYLOTY ?? cfg.SEARCH.wyloty;
const APPLY = process.argv.includes("--apply");

// Ścieżka danych: najpierw katalog ze wskaźnika data/current.json, potem data/.
const kandydaci = [];
try {
  const cur = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "current.json"), "utf8"));
  if (cur?.dir) kandydaci.push(path.join(ROOT, "data", cur.dir, "history.json"));
} catch {
  /* brak wskaźnika */
}
kandydaci.push(path.join(ROOT, "data", "history.json"));

const pliki = kandydaci.filter((p) => fs.existsSync(p));
if (pliki.length === 0) {
  console.error("Nie znalazłem history.json — nic do zrobienia.");
  process.exit(1);
}

console.log(`Dozwolone wyloty: ${WYLOTY.join(", ")}`);
console.log(APPLY ? "TRYB: ZAPIS (--apply)\n" : "TRYB: raport (bez --apply nic nie zapiszę)\n");

let zmienionePliki = 0;

for (const plik of pliki) {
  const rel = path.relative(ROOT, plik);
  const history = JSON.parse(fs.readFileSync(plik, "utf8"));
  const wpisy = history.offers || {};
  let usunietePunkty = 0;
  let usunieteWpisy = 0;

  for (const [key, entry] of Object.entries(wpisy)) {
    const punkty = entry.prices || [];
    const dobre = punkty.filter((p) => isAllowedDeparture(p.departureCode));
    const zle = punkty.length - dobre.length;
    if (zle === 0) continue;

    usunietePunkty += zle;
    console.log(
      `  ${key} | ${entry.hotel} | usuwam ${zle}/${punkty.length} pkt: ` +
        punkty
          .filter((p) => !isAllowedDeparture(p.departureCode))
          .map((p) => `${p.date} ${p.departureCode} ${p.price}zł`)
          .join(", ")
    );

    if (dobre.length === 0) {
      delete wpisy[key];
      usunieteWpisy++;
      continue;
    }

    entry.prices = dobre;
    // Kumulatywne min/max przeliczamy z tego, co zostało — inaczej ekstrema
    // pamiętałyby cenę z lotniska, które wypadło z filtra.
    const ceny = dobre.map((p) => p.price).filter((n) => n != null);
    entry.minSeenPrice = ceny.length ? Math.min(...ceny) : null;
    entry.maxSeenPrice = ceny.length ? Math.max(...ceny) : null;
    // Punkt "ostatnio widziany" z odrzuconego lotniska nie jest już podstawą
    // porównania "czy cena drgnęła" — czyścimy, żeby nie robić fałszywego spadku.
    if (entry.lastSeenPrice != null && !ceny.includes(entry.lastSeenPrice)) {
      entry.lastSeenPrice = null;
      entry.changedSincePrevRun = false;
    }
  }

  if (usunietePunkty === 0) {
    console.log(`  ${rel}: bez zmian (brak punktów spoza filtra)`);
    continue;
  }

  console.log(`  ${rel}: usunięte punkty ${usunietePunkty}, usunięte wpisy ${usunieteWpisy}`);
  if (APPLY) {
    fs.writeFileSync(plik, JSON.stringify(history, null, 2) + "\n", "utf8");
    zmienionePliki++;
    console.log(`  ${rel}: ZAPISANE`);
  }
}

console.log(
  APPLY
    ? `\nGotowe. Zmienionych plików: ${zmienionePliki}. Uruchom test: node research/test-variants-filter.js`
    : "\nTo był tylko raport. Powtórz z --apply, żeby zapisać."
);
