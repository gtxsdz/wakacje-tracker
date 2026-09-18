// Uruchamia scraper, a następnie commituje i wypycha zmiany w data/ do repo.
// Przeznaczony do uruchamiania lokalnie (z domowego IP), cyklicznie przez
// Harmonogram zadań Windows lub cron/systemd na Linuksie.
//
// Uruchomienie: node scraper/push.js   (albo: npm run push)
//
// Działa na Windows i Linux — używa git z PATH, bez zależności od powłoki.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    encoding: "utf8",
    shell: false,
    ...opts,
  });
  return res;
}

function runCapture(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", shell: false });
  return (res.stdout || "").trim();
}

function log(msg) {
  console.log(`[push] ${msg}`);
}

// 1. Pobierz ceny.
log("Uruchamiam scraper…");
const scrape = run(process.execPath, ["scraper/scrape.js"]);
if (scrape.status !== 0) {
  log("Scraper zakończył się błędem — nie commituję żadnych zmian.");
  process.exit(scrape.status || 1);
}

// 2. Sprawdź, czy dane się zmieniły.
const changed = runCapture("git", ["status", "--porcelain", "data/"]);
if (!changed) {
  log("Brak zmian w danych — nic do wypchnięcia.");
  process.exit(0);
}

// 3. Commit + push.
const date = new Date().toISOString().slice(0, 10);
log("Wykryto zmiany, commit i push…");
run("git", ["add", "data/"]);

const commit = run("git", ["commit", "-m", `data: aktualizacja cen ${date}`]);
if (commit.status !== 0) {
  log("Commit nie powiódł się.");
  process.exit(commit.status || 1);
}

const push = run("git", ["push"]);
if (push.status !== 0) {
  log("Push nie powiódł się. Sprawdź konfigurację remote/uprawnienia.");
  process.exit(push.status || 1);
}

log("Gotowe — dane wypchnięte. GitHub Pages opublikuje aktualizację automatycznie.");
