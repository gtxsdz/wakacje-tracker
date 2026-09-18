// Narzędzie badawcze: otwiera stronę oferty w Chromium (Playwright),
// przechwytuje wszystkie odpowiedzi XHR/fetch i zapisuje te w formacie JSON.
// Cel: znaleźć endpoint zwracający warianty wylotów (lotnisko/data/godziny/cena).
//
// Uruchomienie: node research/sniff.js "<URL_OFERTY>"

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "captures");
fs.mkdirSync(OUT_DIR, { recursive: true });

const url =
  process.argv[2] ||
  "https://www.wakacje.pl/oferty/egipt/hurghada/hurghada/gravity-hotel-aquapark-hurghada-ex-samra-bay-resort-1166489.html?od-2026-09-28,7-dni,all-inclusive,z-katowic,2dorosle-2dzieci-20091119-20150707";

function safeName(u, i) {
  const clean = u.replace(/[^a-z0-9]+/gi, "_").slice(0, 80);
  return `${String(i).padStart(3, "0")}_${clean}.json`;
}

const log = [];

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "pl-PL",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  // Blokuj ciężkie zasoby, żeby przyspieszyć i uniknąć zawieszania nawigacji.
  await context.route("**/*", (route) => {
    const t = route.request().resourceType();
    if (["image", "font", "media", "stylesheet"].includes(t)) {
      return route.abort();
    }
    return route.continue();
  });

  const page = await context.newPage();

  let i = 0;
  page.on("response", async (res) => {
    try {
      const req = res.request();
      const rurl = res.url();
      const type = res.headers()["content-type"] || "";
      const method = req.method();

      // Interesują nas odpowiedzi JSON z API (pomijamy statyki/obrazy/fonty).
      const isJson = type.includes("application/json") || type.includes("+json");
      if (!isJson) return;
      if (/_next\/static|\.woff|\.png|\.jpg|\.css|\.js($|\?)/i.test(rurl)) return;

      let body = "";
      try {
        body = await res.text();
      } catch {
        return;
      }

      i++;
      const entry = {
        idx: i,
        method,
        url: rurl,
        status: res.status(),
        contentType: type,
        postData: req.postData() || null,
        bodyLength: body.length,
      };
      log.push(entry);

      // Zapisz treść, jeśli może zawierać dane o lotach/wariantach.
      const looksRelevant =
        /wylot|powr|lotnisk|flight|transport|depart|variant|term|offer|godzin|hour|date/i.test(
          body
        );
      const fname = safeName(rurl, i);
      fs.writeFileSync(
        path.join(OUT_DIR, fname),
        JSON.stringify({ meta: entry, body: safeParse(body) }, null, 2)
      );
      console.log(
        `[${i}] ${method} ${res.status()} ${rurl.slice(0, 100)} (${body.length}b)${
          looksRelevant ? "  <-- RELEVANT" : ""
        }`
      );
    } catch (e) {
      // ignoruj
    }
  });

  console.log("Otwieram:", url);
  try {
    // "commit" = jak tylko zacznie przychodzić odpowiedź; nie czekamy na pełny load.
    await page.goto(url, { waitUntil: "commit", timeout: 45000 });
  } catch (e) {
    console.log("goto ostrzeżenie:", e.message);
  }

  // Poczekaj na doładowanie treści dynamicznej (XHR z lotami).
  await page.waitForTimeout(12000);

  // Spróbuj zaakceptować cookies (jeśli jest baner) i przewinąć.
  try {
    const btn = page.locator(
      'button:has-text("Akceptuj"), button:has-text("Zgadzam"), button:has-text("Zaakceptuj"), #onetrust-accept-btn-handler'
    );
    if (await btn.first().isVisible({ timeout: 2000 })) {
      await btn.first().click();
      await page.waitForTimeout(3000);
    }
  } catch {}

  try {
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(4000);
  } catch {}

  try {
    console.log("Tytuł strony:", await page.title());
    console.log("URL końcowy:", page.url());
  } catch {}

  fs.writeFileSync(
    path.join(OUT_DIR, "_index.json"),
    JSON.stringify(log, null, 2)
  );
  console.log(`\nPrzechwycono ${log.length} odpowiedzi JSON. Zapisano w research/captures/`);

  await browser.close();
};

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s.slice(0, 20000);
  }
}

run().catch((e) => {
  console.error("Błąd:", e);
  process.exit(1);
});
