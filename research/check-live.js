// Podgląd + pomiary strony w prawdziwej przeglądarce (Playwright/Chromium).
//
// Sprawdza to, czego nie widać "po HTTP":
//  - czy karty się renderują i ile ich jest,
//  - błędy konsoli i wyjątki JS,
//  - POZIOMY OVERFLOW (które elementy wystają poza viewport — mobile!),
//  - modal z wykresem oraz regułę .modal-link[hidden] (czy link naprawdę znika),
//  - zapisuje zrzuty ekranu (mobile, modal, desktop) do ./screenshots.
//
// Uruchomienie: node research/check-live.js [URL]
// Domyślnie: https://gtxsdz.github.io/wakacje-tracker/  (wymaga: npm i -D playwright)

import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "screenshots");
fs.mkdirSync(OUT, { recursive: true });

const URL_ARG = process.argv[2] || "https://gtxsdz.github.io/wakacje-tracker/";

const browser = await chromium.launch({ headless: true });
let problems = 0;

async function visit(label, ctxOpts, shot) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", (m) => {
    if (m.type() === "error") errs.push(m.text().slice(0, 160));
  });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message.slice(0, 160)));

  await page.goto(URL_ARG, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector(".offer-card", { timeout: 20000 });

  const info = await page.evaluate(() => {
    const vw = window.innerWidth;
    const offenders = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1) {
        const cls =
          typeof el.className === "string" && el.className.trim()
            ? "." + el.className.trim().split(/\s+/).join(".")
            : "";
        offenders.push({ tag: el.tagName.toLowerCase() + cls, right: Math.round(r.right), w: Math.round(r.width) });
      }
    }
    return {
      vw,
      scrollWidth: document.documentElement.scrollWidth,
      cards: document.querySelectorAll(".offer-card").length,
      summaryCards: document.querySelectorAll(".summary-card").length,
      offenders: offenders.slice(0, 10),
    };
  });

  const overflow = info.scrollWidth > info.vw;
  if (overflow) problems++;

  console.log(`\n=== ${label} ===`);
  console.log(`viewport=${info.vw}px | scrollWidth=${info.scrollWidth} | kart ofert=${info.cards} | kafli=${info.summaryCards}`);
  console.log(`poziomy overflow: ${overflow ? "TAK (+" + (info.scrollWidth - info.vw) + "px)!" : "nie"}`);
  info.offenders.forEach((o) => console.log(`   wystaje: ${o.tag} (right=${o.right}, w=${o.w})`));
  console.log(`błędy konsoli: ${errs.length ? errs.join(" | ") : "brak"}`);
  if (errs.length) problems++;

  await page.screenshot({ path: path.join(OUT, shot) });
  await ctx.close();
}

await visit("MOBILE (iPhone 13)", { ...devices["iPhone 13"] }, "pw-mobile.png");
await visit("DESKTOP 1440x900", { viewport: { width: 1440, height: 900 } }, "pw-desktop.png");

// Modal + reguła .modal-link[hidden] — sprawdzane w prawdziwej przeglądarce.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL_ARG, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector(".offer-card");
  await page.locator(".offer-card").first().click();
  await page.waitForTimeout(700);
  const modal = await page.evaluate(() => ({
    open: document.querySelector("#modal").hidden === false,
    title: (document.querySelector("#modal-title").textContent || "").slice(0, 40),
    chartW: document.querySelector("#history-chart")?.width || 0,
    chartWidoczne: !!document.querySelector("#history-chart")?.offsetParent,
  }));
  console.log("\n=== MODAL (desktop) ===");
  console.log(JSON.stringify(modal));
  if (!modal.open || !modal.chartWidoczne) problems++;

  const linkCase = await page.evaluate(() => {
    const el = document.querySelector("#modal-link");
    const o = state.latest.offers.find((x) => x.detailUrl) || state.latest.offers[0];
    const saved = o.detailUrl;
    o.detailUrl = null;
    openModal(o.key);
    const bezDetailUrl = getComputedStyle(el).display;
    o.detailUrl = saved;
    openModal(o.key);
    const zDetailUrl = getComputedStyle(el).display;
    return { bezDetailUrl, zDetailUrl };
  });
  const hiddenOk = linkCase.bezDetailUrl === "none";
  const shownOk = linkCase.zDetailUrl !== "none";
  if (!hiddenOk || !shownOk) problems++;
  console.log("reguła .modal-link[hidden]:", JSON.stringify(linkCase));
  console.log(`   bez detailUrl -> display=${linkCase.bezDetailUrl} ${hiddenOk ? "OK" : "BŁĄD"}`);
  console.log(`   z detailUrl   -> display=${linkCase.zDetailUrl} ${shownOk ? "OK" : "BŁĄD"}`);

  await page.screenshot({ path: path.join(OUT, "pw-modal.png") });
  await ctx.close();
}

await browser.close();
console.log(`\nZrzuty ekranu: ${OUT}`);
console.log(problems ? `\nZNALEZIONO PROBLEMY: ${problems}` : "\nBrak problemów ✅");
process.exit(problems ? 1 : 0);
