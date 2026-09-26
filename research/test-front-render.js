// Smoke-test frontendu: uruchamia PRAWDZIWY app.js na minimalnej atrapie DOM
// (bez przeglądarki i bez zależności npm) i sprawdza render kart, escapowanie
// danych z wakacje.pl, stany cen, modal z wykresem oraz eksport CSV.
//
// Nie zastępuje oględzin w przeglądarce — nie testuje CSS ani wyglądu. Łapie
// natomiast błędy runtime i regresje w logice renderowania/escapowania.
//
// Uruchomienie: node research/test-front-render.js
// (wymaga wygenerowanych data/latest.json + data/history.json — układ v1)

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? "  -> " + extra : ""}`);
  }
};

// ---- dane wejściowe (te same, które czyta front) ----
// Ten projekt (v1) trzyma dane płasko: data/latest.json + data/history.json
// (bez wskaźnika current.json i katalogów per-parametry jak w wersji 2).
const L = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "latest.json"), "utf8"));
const H = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "history.json"), "utf8"));

// ---- minimalna atrapa DOM ----
const store = new Map();
const mk = (sel, extra = {}) => {
  const o = {
    sel,
    textContent: "",
    innerHTML: "",
    hidden: false,
    href: "",
    value: "",
    checked: false,
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    getContext: () => ({}),
    ...extra,
  };
  store.set(sel, o);
  return o;
};

const document = {
  querySelector(sel) {
    if (!store.has(sel)) mk(sel, sel === "#sort" ? { value: "price-asc" } : {});
    return store.get(sel);
  },
  querySelectorAll() {
    return { forEach() {} };
  },
  addEventListener() {},
  createElement() {
    return { href: "", download: "", style: {}, click() {} };
  },
  body: { appendChild() {}, removeChild() {} },
};

const sandbox = {
  document,
  console,
  navigator: { clipboard: { writeText: async (t) => (sandbox.__clip = t) } },
  // fetch czyta pliki z repo (ścieżki jak w app.js: ./data/...)
  fetch: async (url) => {
    const p = path.join(ROOT, String(url).replace(/^\.\//, ""));
    if (!fs.existsSync(p)) return { ok: false, json: async () => null };
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) };
  },
  setInterval: () => 0, // bez auto-odświeżania w tle (proces ma się zakończyć)
  Chart: class {
    constructor(ctx, cfg) {
      this.cfg = cfg;
      sandbox.__chart = cfg;
    }
    destroy() {}
  },
  Blob: class {
    constructor(parts) {
      sandbox.__blob = parts.join("");
    }
  },
  URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
  Intl,
  Date,
  Math,
  JSON,
  Number,
  Array,
  Object,
  String,
  Boolean,
  Set,
  Map,
  isNaN,
  parseInt,
  parseFloat,
  setTimeout,
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;

const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"), ctx, { filename: "app.js" });
const run = (src) => vm.runInContext(src, ctx);

await new Promise((r) => setTimeout(r, 400)); // init() jest asynchroniczne

// Oferta z historią cen — do testu modala i CSV.
const withHist = L.offers.find((o) => ((H.offers[o.key] || {}).prices || []).length > 0) || L.offers[0];

console.log("\n== render po init() ==");
const offers = store.get("#offers");
const cardCount = (offers.innerHTML.match(/class="offer-card/g) || []).length;
check(`kart = liczba ofert (${L.offers.length})`, cardCount === L.offers.length, `kart=${cardCount}`);
check("brak komunikatu o błędzie ładowania", !offers.innerHTML.includes("state error"));
check("licznik ofert w nagłówku", store.get("#count").textContent === `${L.count} ofert`, store.get("#count").textContent);
check(
  "meta bez 'Invalid Date'",
  store.get("#updated").textContent.includes("Aktualizacja") && !store.get("#updated").textContent.includes("Invalid")
);
// (v1 nie ma dynamicznego podtytułu z metadanych filtra — jest statyczny w index.html)
check("5 kafli podsumowania", (store.get("#summary").innerHTML.match(/summary-card/g) || []).length === 5);
check("link źródłowy ustawiony", store.get("#source-link").href.includes("wakacje.pl"));
const disCount = (L.disappeared || []).length;
check("sekcja 'zniknięte' spójna z danymi", disCount === 0 ? store.get("#disappeared-section").hidden === true : store.get("#disappeared-section").hidden === false);
if (disCount > 0) {
  check(
    `licznik „znikniętych” w nagłówku zwijanej komórki (${disCount})`,
    store.get("#disappeared-count").textContent === `(${disCount})`,
    store.get("#disappeared-count").textContent
  );
}

console.log("\n== escapowanie danych z zewnątrz ==");
const html = offers.innerHTML;
const withAmp = L.offers.filter((o) => /&/.test(o.hotel || "")).length;
check("nazwy hoteli z '&' są escapowane", withAmp === 0 || html.includes("&amp;"), `hoteli z & w danych: ${withAmp}`);
check("brak surowego '& ' (nieescapowany ampersand)", !/[^a-z;]& [A-Z]/.test(html));
check("brak wstrzykniętego znacznika w treści kart", !html.includes("<script"));

console.log("\n== priceState / ramka karty ==");
check("spadek do nowego minimum => 'down'", run("priceState({price:500,minPrice:500,maxPrice:900,change:-400,pointCount:5,stable:false})") === "down");
check("wzrost do nowego maksimum => 'up'", run("priceState({price:900,minPrice:500,maxPrice:900,change:400,pointCount:5,stable:false})") === "up");
check("cena stabilna => 'stable'", run("priceState({price:700,minPrice:500,maxPrice:900,change:0,pointCount:5,stable:true})") === "stable");
check("brak porównania => 'none'", run("priceState({price:700,minPrice:null,maxPrice:null,change:null,pointCount:1,stable:false})") === "none");
const lowCard = run('offerCard({key:"hotel-x",hotel:"Test & Co",region:"Egipt",stars:5,rating:9,operator:"Biuro",price:500,minPrice:500,maxPrice:900,change:-400,pointCount:5,stable:false,cheapest:null})');
check("karta nowego rekordu: state-down + extreme-low", lowCard.includes("state-down") && lowCard.includes("extreme-low"));
check("badge 'najniższa dotąd' + escapowany '&' w nazwie", lowCard.includes("najniższa dotąd") && lowCard.includes("Test &amp; Co"), lowCard.slice(0, 200));

console.log("\n== modal + wykres ==");
run(`openModal(${JSON.stringify(withHist.key)})`);
check("modal otwarty", store.get("#modal").hidden === false);
check("tytuł modala = nazwa hotelu", store.get("#modal-title").textContent === withHist.hotel, store.get("#modal-title").textContent);
check("wykres dostał punkty", Array.isArray(sandbox.__chart?.data?.labels) && sandbox.__chart.data.labels.length >= 1);
check("statystyki bez 'undefined'", !store.get("#modal-stats").innerHTML.includes("undefined"));
check("link widoczny gdy jest detailUrl", store.get("#modal-link").hidden === !withHist.detailUrl);
run(`(function(){ const o = state.latest.offers.find((x) => x.key === ${JSON.stringify(withHist.key)}); const d = o.detailUrl; o.detailUrl = null; openModal(o.key); o.detailUrl = d; })()`);
check("link ukryty (hidden=true) gdy brak detailUrl", store.get("#modal-link").hidden === true);
run("closeModal()");
check("modal zamknięty / wykres zwolniony", store.get("#modal").hidden === true);

console.log("\n== eksport CSV ==");
run(`openModal(${JSON.stringify(withHist.key)})`);
const ptsArr = ((H.offers[withHist.key] || {}).prices || []);
const pts = ptsArr.length || 1;
run("downloadModalCsv()");
const rows = (sandbox.__blob || "").split("\r\n");
const expHeader = "\uFEFFData,Godzina,Cena_PLN,Biuro,Pokój,Lotnisko";
check("nagłówek z BOM UTF-8 (Excel) i polskimi znakami", rows[0] === expHeader, JSON.stringify(rows[0]));
check(`wierszy danych = liczba punktów (${pts})`, rows.length - 1 === pts, `wierszy=${rows.length - 1}`);

// CSV jest w kolejności CHRONOLOGICZNEJ (jak w data/history.json): pierwszy wiersz
// danych = najstarszy punkt, ostatni = najnowszy. Poprzednia wersja porównywała
// wiersz #1 z OSTATNIM punktem — przechodziło tylko dla ofert z 1 punktem historii.
const firstPt = ptsArr[0] || { at: L.generatedAt, price: withHist.price };
const lastPt = ptsArr.slice(-1)[0] || { at: L.generatedAt, price: withHist.price };
const atFirst = firstPt.at || L.generatedAt;
const atLast = lastPt.at || L.generatedAt;

check("pierwszy wiersz: data = UTC pierwszego punktu", rows[1].startsWith(`"${atFirst.slice(0, 10)}"`), rows[1]);
check(
  "pierwszy wiersz: godzina = UTC punktu (nie czas lokalny)",
  rows[1].includes(`"${atFirst.slice(11, 16)}"`),
  `${rows[1]} | oczekiwano ${atFirst.slice(11, 16)}`
);
check("pierwszy wiersz: cena = pierwszy punkt", rows[1].includes(`,${firstPt.price},`), rows[1]);

if (pts > 1) {
  const lastRow = rows[pts];
  check("ostatni wiersz: data = UTC ostatniego punktu", lastRow.startsWith(`"${atLast.slice(0, 10)}"`), lastRow);
  check("ostatni wiersz: cena = ostatni punkt", lastRow.includes(`,${lastPt.price},`), lastRow);
}

run("copyModalHistory()");
await new Promise((r) => setTimeout(r, 50));
check(
  "schowek: CSV bez BOM (BOM tylko w pliku)",
  String(sandbox.__clip || "").length > 0 && !String(sandbox.__clip || "").startsWith("\uFEFF")
);

console.log(`\n${passed} OK, ${failed} FAIL`);
process.exit(failed ? 1 : 0);

