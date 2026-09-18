// Zrzut ekranu wersji mobilnej (emulacja OnePlus 12) — narzędzie badawcze.
// Uruchomienie: node research/shot-mobile.js [baseUrl]
// Domyślnie celuje w lokalny serwer podglądu (http://localhost:8080).
//
// OnePlus 12: CSS viewport ~412 px szerokości. Layout zależy od szerokości CSS,
// nie od DPR — dlatego DPR ustawiamy na 2 (a nie 3.5), żeby zrzuty nie były
// gigantyczne (limit podglądu ~5 MB). Layout/breakpointy pozostają identyczne.

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "screenshots");
const BASE = process.argv[2] || "http://localhost:8080";

const DEVICE = {
  viewport: { width: 412, height: 915 }, // CSS px (OnePlus 12 w Chrome mobile)
  deviceScaleFactor: 2, // nie 3.5 — mniejsze pliki, ten sam layout
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; PJZ110) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext(DEVICE);
  const page = await context.newPage();

  console.log(`Otwieram ${BASE} …`);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".offer-card", { timeout: 15000 });
  await page.waitForTimeout(500);

  // 1) Pierwszy ekran.
  await page.screenshot({ path: path.join(OUT, "1-viewport.png") });
  console.log("zapisano 1-viewport.png");

  // 2) Nagłówek + podsumowanie + kontrolki (górna część, bez całej listy).
  await page.screenshot({
    path: path.join(OUT, "2-top.png"),
    clip: { x: 0, y: 0, width: 412, height: 760 },
  });
  console.log("zapisano 2-top.png");

  // 3) Konkretne karty: najdłuższa nazwa i najwięcej wariantów (element-shot).
  const cards = page.locator(".offer-card");
  const n = await cards.count();
  let longest = { i: 0, len: 0 };
  let mostVariants = { i: 0, n: 0 };
  for (let i = 0; i < n; i++) {
    const hotel = (await cards.nth(i).locator(".hotel").textContent()) || "";
    if (hotel.length > longest.len) longest = { i, len: hotel.length };
    const tag = await cards.nth(i).locator(".tag.muted").first().textContent().catch(() => "");
    const m = /(\d+)\s*wariant/.exec(tag || "");
    const v = m ? parseInt(m[1], 10) : 0;
    if (v > mostVariants.n) mostVariants = { i, n: v };
  }
  await cards.nth(longest.i).screenshot({ path: path.join(OUT, "3-card-longest.png") });
  console.log(`zapisano 3-card-longest.png (karta #${longest.i}, nazwa ${longest.len} znaków)`);
  await cards.nth(mostVariants.i).screenshot({ path: path.join(OUT, "4-card-variants.png") });
  console.log(`zapisano 4-card-variants.png (karta #${mostVariants.i}, ${mostVariants.n} wariantów)`);

  // 4) Otwarty modal z wykresem.
  await cards.first().click();
  await page.waitForSelector(".modal:not([hidden])", { timeout: 5000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, "5-modal.png") });
  console.log("zapisano 5-modal.png");

  await browser.close();

  // Raport rozmiarów — pilnujemy limitu podglądu.
  for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith(".png")).sort()) {
    const kb = (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0);
    console.log(`  ${f}: ${kb} KB`);
  }
  console.log(`Gotowe — zrzuty w ${OUT}`);
}

main().catch((e) => {
  console.error("Błąd zrzutu:", e);
  process.exit(1);
});
