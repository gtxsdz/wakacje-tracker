// Test logiki śledzenia (model "tożsamość = biuro").
// Odtwarza logikę z scraper/scrape.js i sprawdza scenariusze zmian ceny/biura.
// Uruchomienie: node research/test-logic.js

import assert from "node:assert";

// --- kopia logiki ze scrape.js (do izolowanego testu) ---
const variantSignature = (operator) => (operator || "").toLowerCase().trim();

function updateHistory(entry, { operator, price }, date) {
  entry.prices = entry.prices || [];
  entry.variantChanges = entry.variantChanges || [];
  const flat = { variantId: variantSignature(operator), operator, price };
  const prev = entry.prices[entry.prices.length - 1];

  if (prev && flat && prev.variantId !== flat.variantId) {
    const cheaper = flat.price != null && prev.price != null && flat.price < prev.price;
    entry.variantChanges.push({
      date,
      from: { operator: prev.operator, price: prev.price },
      to: { operator: flat.operator, price: flat.price },
      reason: cheaper ? "najtańsze teraz w innym biurze (taniej)" : "najtańsze teraz w innym biurze",
    });
  }

  const point = { date, ...flat };
  if (!prev) entry.prices.push(point);
  else if (prev.date === date) entry.prices[entry.prices.length - 1] = point;
  else entry.prices.push(point);
}

// change liczony jak w buildLatest: current vs ostatni punkt z INNEGO dnia.
function computeChange(entry, date, current) {
  const prices = entry.prices;
  let prevPrice = null;
  for (let i = prices.length - 1; i >= 0; i--) {
    if (prices[i].date !== date) { prevPrice = prices[i].price; break; }
  }
  let change = null, changePct = null;
  if (prevPrice != null && current != null) {
    change = current - prevPrice;
    changePct = prevPrice ? +((change / prevPrice) * 100).toFixed(2) : null;
  }
  return { prevPrice, change, changePct };
}

let passed = 0;
const ok = (name) => { console.log(`  ✓ ${name}`); passed++; };

// --- Scenariusz 1: pierwszy pomiar hotelu = "nowa oferta" (change null) ---
{
  const e = {};
  updateHistory(e, { operator: "Join UP", price: 11238 }, "2026-09-18");
  const c = computeChange(e, "2026-09-18", 11238);
  assert.strictEqual(c.change, null, "pierwszy pomiar nie ma zmiany");
  assert.strictEqual(e.variantChanges.length, 0, "brak zmiany biura na starcie");
  ok("Scenariusz 1: pierwszy pomiar => nowa oferta (change=null), 0 zmian biura");
}

// --- Scenariusz 2: to samo biuro, inny lot/pokój, taniej => SPADEK, bez zmiany biura ---
{
  const e = {};
  updateHistory(e, { operator: "Join UP", price: 11238 }, "2026-09-18");
  // kolejny dzień: to samo biuro, ale niższa cena (inny lot — nieistotne)
  updateHistory(e, { operator: "Join UP", price: 10500 }, "2026-09-19");
  const c = computeChange(e, "2026-09-19", 10500);
  assert.strictEqual(c.change, -738, "spadek o 738");
  assert.strictEqual(e.variantChanges.length, 0, "ta sama firma => brak zmiany biura");
  ok("Scenariusz 2: to samo biuro, taniej => spadek -738, 0 zmian biura (brak szumu)");
}

// --- Scenariusz 3: inne biuro, taniej => SPADEK + zmiana biura (taniej) ---
{
  const e = {};
  updateHistory(e, { operator: "Join UP", price: 11238 }, "2026-09-18");
  updateHistory(e, { operator: "Coral Travel", price: 10800 }, "2026-09-19");
  const c = computeChange(e, "2026-09-19", 10800);
  assert.strictEqual(c.change, -438, "spadek o 438 mimo zmiany biura");
  assert.strictEqual(e.variantChanges.length, 1, "jedna zmiana biura");
  assert.strictEqual(e.variantChanges[0].reason, "najtańsze teraz w innym biurze (taniej)");
  assert.strictEqual(e.variantChanges[0].from.operator, "Join UP");
  assert.strictEqual(e.variantChanges[0].to.operator, "Coral Travel");
  ok("Scenariusz 3: inne biuro taniej => spadek -438 + zmiana biura (taniej)");
}

// --- Scenariusz 4: inne biuro, drożej => WZROST + zmiana biura (bez 'taniej') ---
{
  const e = {};
  updateHistory(e, { operator: "Join UP", price: 11238 }, "2026-09-18");
  updateHistory(e, { operator: "TUI", price: 11900 }, "2026-09-19");
  const c = computeChange(e, "2026-09-19", 11900);
  assert.strictEqual(c.change, 662, "wzrost o 662");
  assert.strictEqual(e.variantChanges.length, 1);
  assert.strictEqual(e.variantChanges[0].reason, "najtańsze teraz w innym biurze");
  ok("Scenariusz 4: inne biuro drożej => wzrost +662 + zmiana biura (bez 'taniej')");
}

// --- Scenariusz 5: ten sam dzień, ponowny przebieg => nadpisanie, nie duplikat ---
{
  const e = {};
  updateHistory(e, { operator: "Join UP", price: 11238 }, "2026-09-18");
  updateHistory(e, { operator: "Join UP", price: 11000 }, "2026-09-18"); // ten sam dzień
  assert.strictEqual(e.prices.length, 1, "jeden punkt na dzień (nadpisanie)");
  assert.strictEqual(e.prices[0].price, 11000, "punkt nadpisany nowszą ceną");
  const c = computeChange(e, "2026-09-18", 11000);
  assert.strictEqual(c.change, null, "brak wcześniejszego dnia => brak zmiany");
  ok("Scenariusz 5: dwa przebiegi tego samego dnia => 1 punkt (nadpisany), change=null");
}

console.log(`\nWszystkie ${passed} scenariuszy przeszło ✅`);
