// Zrzut wykresu z tooltipem — test wizualny osi czasu i tooltipa.
// Uruchomienie: node research/shot-chart.js  (wymaga serwera na :8080)
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "screenshots");
const BASE = process.argv[2] || "http://localhost:8080";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 820, height: 900 }, deviceScaleFactor: 1.5 });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector(".offer-card");
fs.mkdirSync(OUT, { recursive: true });

// Otwórz modal hotelu z demo danymi (Gravity — powinien być na liście).
const card = page.locator(".offer-card", { hasText: "Gravity" }).first();
await (await card.count() ? card : page.locator(".offer-card").first()).click();
await page.waitForSelector(".modal:not([hidden])");
await page.waitForTimeout(900); // rysowanie wykresu

// Zrzut samego modala (wykres + statystyki + log zmian).
await page.locator(".modal-body").screenshot({ path: path.join(OUT, "chart-1.png") });
console.log("zapisano chart-1.png");

// Najedź na jeden z punktów wykresu, żeby pokazać tooltip.
const canvas = page.locator("#history-chart");
const box = await canvas.boundingBox();
if (box) {
  // punkt ~w 3/4 szerokości wykresu
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.5);
  await page.waitForTimeout(500);
  await page.locator(".modal-body").screenshot({ path: path.join(OUT, "chart-2-tooltip.png") });
  console.log("zapisano chart-2-tooltip.png");
}

await browser.close();
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith(".png"))) {
  console.log(`  ${f}: ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0)} KB`);
}
process.exit(0);
