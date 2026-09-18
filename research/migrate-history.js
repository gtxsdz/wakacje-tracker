// Jednorazowa migracja data/history.json do modelu "tożsamość = biuro".
//
// Przed zmianą: variantId punktu = pokój|lotnisko|daty|godziny.
// Po zmianie:   variantId punktu = sygnatura operatora (biura).
//
// Migracja:
//  - dla każdego punktu ustawia operator (z entry.operator, jeśli brak w punkcie)
//    i przelicza variantId na sygnaturę operatora,
//  - czyści stare variantChanges (były oparte na starym, drobiazgowym modelu).
//
// Dzięki temu pierwszy przebieg po zmianie nie wygeneruje fałszywej „zmiany biura".
//
// Uruchomienie: node research/migrate-history.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "data", "history.json");

const sig = (operator) => (operator || "").toLowerCase().trim();

const h = JSON.parse(fs.readFileSync(FILE, "utf8"));
let points = 0;
let cleared = 0;

for (const key of Object.keys(h.offers || {})) {
  const entry = h.offers[key];
  const entryOp = entry.operator || "";
  for (const p of entry.prices || []) {
    // Punkt nie miał zapisanego operatora — bierzemy z metadanych oferty.
    if (!p.operator) p.operator = entryOp;
    p.variantId = sig(p.operator);
    points++;
  }
  if (Array.isArray(entry.variantChanges) && entry.variantChanges.length) {
    cleared += entry.variantChanges.length;
  }
  entry.variantChanges = []; // stare wpisy to szum ze starego modelu
}

fs.writeFileSync(FILE, JSON.stringify(h, null, 2) + "\n", "utf8");
console.log(`Zmigrowano ${points} punktów w ${Object.keys(h.offers || {}).length} hotelach; wyczyszczono ${cleared} starych variantChanges.`);
