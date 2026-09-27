// Jednorazowa diagnostyka: gdzie w danych są jeszcze lotniska spoza filtra.
// Uruchomienie: node research/check-data-airports.js
// (nie zapisuje nic — tylko raport)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cfg from "../scraper/config.js";
import { isAllowedDeparture } from "../scraper/config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WYLOTY = cfg.WYLOTY ?? cfg.SEARCH.wyloty;
console.log(`Dozwolone wyloty: ${WYLOTY.join(", ")}\n`);

const dirs = [];
try {
  const cur = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "current.json"), "utf8"));
  if (cur?.dir) dirs.push(path.join(ROOT, "data", cur.dir));
} catch {
  /* brak wskaźnika */
}
dirs.push(path.join(ROOT, "data"));

for (const d of dirs) {
  const latest = path.join(d, "latest.json");
  if (fs.existsSync(latest)) {
    const l = JSON.parse(fs.readFileSync(latest, "utf8"));
    console.log(`latest.json (${path.relative(ROOT, latest)}): ofert ${l.offers.length}`);
    const obce = l.offers.filter((o) => !isAllowedDeparture(o.cheapest?.departureCode));
    console.log(`  oferty z wylotem spoza filtra: ${obce.length}${obce.length ? " -> " + obce.map((o) => `${o.hotel} (${o.cheapest?.departureCode})`).join("; ") : ""}`);
    const rozklad = {};
    for (const o of l.offers) rozklad[o.cheapest?.departureCode || "?"] = (rozklad[o.cheapest?.departureCode || "?"] || 0) + 1;
    console.log(`  rozkład wylotów: ${Object.entries(rozklad).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    console.log(`  zniknęły (disappeared): ${(l.disappeared || []).map((x) => `${x.hotel} [${x.key}]`).join("; ") || "brak"}`);
  }

  const hist = path.join(d, "history.json");
  if (fs.existsSync(hist)) {
    const h = JSON.parse(fs.readFileSync(hist, "utf8"));
    console.log(`\nhistory.json (${path.relative(ROOT, hist)}): wpisów ${Object.keys(h.offers || {}).length}`);
    for (const [key, e] of Object.entries(h.offers || {})) {
      const punkty = (e.prices || []).filter((p) => !isAllowedDeparture(p.departureCode));
      if (punkty.length) {
        console.log(
          `  ${key} | ${e.hotel} | punktów spoza filtra: ${punkty.length}/${(e.prices || []).length} -> ` +
            punkty.map((p) => `${p.date} ${p.departureCode} ${p.price}zł`).join(", ")
        );
      }
    }
  }
}
