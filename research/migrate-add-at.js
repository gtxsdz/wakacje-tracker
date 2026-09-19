// Jednorazowa, idempotentna migracja: nadaje polu 'at' (znacznik czasu) tym
// punktom historii, które go nie mają — czyli tym sprzed modelu śróddziennego.
//
// Wykres używa 'at' do osi czasu (data + godzina). Stare punkty miały tylko
// 'date' (sam dzień). Ustawiamy 'at' na południe danego dnia (UTC), żeby uniknąć
// przeskoku daty przy strefach czasowych. Nowe punkty już mają 'at' — pomijamy je.
//
// Bezpieczne do wielokrotnego uruchomienia: nie rusza punktów, które mają 'at',
// i nie dotyka variantChanges ani cen.
//
// Uruchomienie: node research/migrate-add-at.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "data", "history.json");

const h = JSON.parse(fs.readFileSync(FILE, "utf8"));
let added = 0;
let skipped = 0;

for (const key of Object.keys(h.offers || {})) {
  const entry = h.offers[key];
  for (const p of entry.prices || []) {
    if (p.at) { skipped++; continue; }
    // Południe danego dnia w UTC — stabilne względem stref czasowych.
    p.at = `${p.date}T12:00:00.000Z`;
    added++;
  }
  // variantChanges też mogą nie mieć 'at' — nadajemy na bazie ich 'date'.
  for (const c of entry.variantChanges || []) {
    if (!c.at && c.date) c.at = `${c.date}T12:00:00.000Z`;
  }
}

fs.writeFileSync(FILE, JSON.stringify(h, null, 2) + "\n", "utf8");
console.log(`Dodano 'at' do ${added} punktów; pominięto ${skipped} (już miały 'at').`);
