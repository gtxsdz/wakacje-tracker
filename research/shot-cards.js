// Zrzuty pojedynczych kart oferty na szerokości telefonu (OnePlus 12).
// Uruchomienie: node research/shot-cards.js  (wymaga serwera na :8080)
import { chromium } from "playwright";
import path from "node:path"; import fs from "node:fs"; import { fileURLToPath } from "node:url";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "screenshots");
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({
  viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 14; PJZ110) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
});
await p.goto(process.argv[2] || "http://localhost:8080", { waitUntil: "networkidle" });
await p.waitForSelector(".offer-card");
await p.waitForTimeout(500);
// pierwsze 4 karty osobno
const cards = p.locator(".offer-card");
const n = Math.min(4, await cards.count());
for (let i = 0; i < n; i++) {
  await cards.nth(i).scrollIntoViewIfNeeded();
  await cards.nth(i).screenshot({ path: path.join(OUT, `card-${i + 1}.png`) });
  console.log(`card-${i + 1}.png`);
}
await b.close();
for (const f of fs.readdirSync(OUT).filter(f => f.endsWith(".png"))) {
  console.log(`  ${f}: ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0)} KB`);
}
process.exit(0);
