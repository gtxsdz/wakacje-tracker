// Test logiki śledzenia (model "tożsamość = biuro", punkty śróddzienne).
// Odtwarza logikę z scraper/scrape.js i sprawdza scenariusze zmian ceny/biura.
// Uruchomienie: node research/test-logic.js

import assert from "node:assert";

// --- kopia logiki ze scrape.js (do izolowanego testu) ---
const variantSignature = (operator) => (operator || "").toLowerCase().trim();

// Odpowiednik updateOfferHistory: punkt dopisywany TYLKO przy zmianie ceny/biura.
function updateHistory(entry, { operator, price }, date, at) {
  entry.prices = entry.prices || [];
  entry.variantChanges = entry.variantChanges || [];
  const flat = { variantId: variantSignature(operator), operator, price };
  const prev = entry.prices[entry.prices.length - 1];

  const priceChanged = !prev || prev.price !== flat.price;
  const operatorChanged = !prev || prev.variantId !== flat.variantId;

  if (prev && operatorChanged) {
    const cheaper = flat.price != null && prev.price != null && flat.price < prev.price;
    entry.variantChanges.push({
      date, at,
      from: { operator: prev.operator, price: prev.price },
      to: { operator: flat.operator, price: flat.price },
      reason: cheaper ? "najtańsze teraz w innym biurze (taniej)" : "najtańsze teraz w innym biurze",
    });
  }

  if (prev && !priceChanged && !operatorChanged) return; // nic się nie zmieniło
  entry.prices.push({ date, at, ...flat });
}

// Odpowiednik buildLatest: prevPrice = ostatni punkt o INNEJ cenie niż current.
function computeChange(entry, current) {
  const prices = entry.prices;
  let prevPrice = null;
  for (let i = prices.length - 1; i >= 0; i--) {
    if (prices[i].price !== current) { prevPrice = prices[i].price; break; }
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

// --- Scenariusz 1: pierwszy pomiar = "nowa oferta" (change null) ---
{
  const e = {};
  updateHistory(e, { operator: "Join UP", price: 11238 }, "2026-09-18", "2026-09-18T06:30:00Z");
  const c = computeChange(e, 11238);
  assert.strictEqual(c.change, null);
  assert.strictEqual(e.prices.length, 1);
  assert.strictEqual(e.variantChanges.length, 0);
  ok("Scenariusz 1: pierwszy pomiar => nowa oferta (change=null), 1 punkt");
}

// --- Scenariusz 2: ten sam dzień, cena bez zmian => BRAK nowego punktu ---
{
  const e = {};
  updateHistory(e, { operator: "Join UP", price: 11238 }, "2026-09-18", "2026-09-18T06:30:00Z");
  updateHistory(e, { operator: "Join UP", price: 11238 }, "2026-09-18", "2026-09-18T08:30:00Z"); // 2h później, ta sama cena
  assert.strictEqual(e.prices.length, 1, "bez zmiany => brak nowego punktu");
  ok("Scenariusz 2: ten sam dzień, cena bez zmian => nadal 1 punkt (baza nie puchnie)");
}

// --- Scenariusz 3: ŚRÓDDZIENNY spadek => nowy punkt, change względem poprzedniego ---
{
  const e = {};
  updateHistory(e, { operator: "Join UP", price: 11238 }, "2026-09-18", "2026-09-18T06:30:00Z");
  updateHistory(e, { operator: "Join UP", price: 10990 }, "2026-09-18", "2026-09-18T08:30:00Z"); // ten sam dzień, taniej
  assert.strictEqual(e.prices.length, 2, "śróddzienna zmiana => nowy punkt");
  const c = computeChange(e, 10990);
  assert.strictEqual(c.change, -248, "spadek -248 w ciągu dnia");
  assert.strictEqual(e.variantChanges.length, 0, "to samo biuro => brak zmiany biura");
  ok("Scenariusz 3: śróddzienny spadek (co 2h) => nowy punkt, change=-248, 0 zmian biura");
}

// --- Scenariusz 4: śróddzienna zmiana biura na tańsze => nowy punkt + zmiana biura ---
{
  const e = {};
  updateHistory(e, { operator: "Join UP", price: 11238 }, "2026-09-18", "2026-09-18T06:30:00Z");
  updateHistory(e, { operator: "Coral Travel", price: 10800 }, "2026-09-18", "2026-09-18T08:30:00Z");
  assert.strictEqual(e.prices.length, 2);
  const c = computeChange(e, 10800);
  assert.strictEqual(c.change, -438);
  assert.strictEqual(e.variantChanges.length, 1);
  assert.strictEqual(e.variantChanges[0].reason, "najtańsze teraz w innym biurze (taniej)");
  assert.strictEqual(e.variantChanges[0].at, "2026-09-18T08:30:00Z", "zmiana biura ma znacznik czasu");
  ok("Scenariusz 4: śróddzienna zmiana biura taniej => spadek -438 + zmiana biura z 'at'");
}

// --- Scenariusz 5: wzrost przy zmianie biura => odnotowany ---
{
  const e = {};
  updateHistory(e, { operator: "Join UP", price: 11238 }, "2026-09-18", "2026-09-18T06:30:00Z");
  updateHistory(e, { operator: "TUI", price: 11900 }, "2026-09-18", "2026-09-18T10:30:00Z");
  const c = computeChange(e, 11900);
  assert.strictEqual(c.change, 662, "wzrost +662");
  assert.strictEqual(e.variantChanges[0].reason, "najtańsze teraz w innym biurze");
  ok("Scenariusz 5: zmiana biura drożej => wzrost +662 + zmiana biura (bez 'taniej')");
}

// --- Scenariusz 6: sekwencja dnia — buduje wykres tylko z realnych zmian ---
{
  const e = {};
  updateHistory(e, { operator: "Join UP", price: 11238 }, "2026-09-18", "2026-09-18T06:30:00Z");
  updateHistory(e, { operator: "Join UP", price: 11238 }, "2026-09-18", "2026-09-18T08:30:00Z"); // bez zmian
  updateHistory(e, { operator: "Join UP", price: 11000 }, "2026-09-18", "2026-09-18T10:30:00Z"); // spadek
  updateHistory(e, { operator: "Join UP", price: 11000 }, "2026-09-18", "2026-09-18T12:30:00Z"); // bez zmian
  updateHistory(e, { operator: "Join UP", price: 11400 }, "2026-09-18", "2026-09-18T14:30:00Z"); // wzrost
  assert.strictEqual(e.prices.length, 3, "3 realne punkty z 5 przebiegów (schodki)");
  assert.deepStrictEqual(e.prices.map((p) => p.price), [11238, 11000, 11400]);
  ok("Scenariusz 6: 5 przebiegów dziennie => 3 punkty (tylko realne zmiany)");
}

console.log(`\nWszystkie ${passed} scenariuszy przeszło ✅`);
