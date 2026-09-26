// Uruchamia scraper, a następnie commituje i wypycha zmiany w data/ do repo.
// Uruchamia scraper, a następnie commituje i wypycha zmiany w data/ do repo.
//
// Przeznaczenie:
//   - Wywołania ręczne / Harmonogram zadań Windows: node scraper/push.js
//   - Serwer Linux (systemd timer): używa automation/scrape-deploy.sh,
//     który wywołuje scraper/scrape.js bezpośrednio (bez tego pliku).
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

// 3. Commit.
const date = new Date().toISOString().slice(0, 10);
log("Wykryto zmiany, commit…");
run("git", ["add", "data/"]);

const commit = run("git", ["commit", "-m", `data: aktualizacja cen ${date}`]);
if (commit.status !== 0) {
  log("Commit nie powiódł się.");
  process.exit(commit.status || 1);
}

// 4. Push z odpornością na rozjazd z remote.
// Jeśli zdalne repo jest z przodu (np. commit z innego miejsca), robimy
// rebase na origin/main i ponawiamy push. Dane są regenerowane co przebieg,
// więc rebase jest bezpieczny.
function tryPush() {
  return run("git", ["push"]).status === 0;
}

if (!tryPush()) {
  log("Push odrzucony — synchronizuję z remote (pull --rebase) i ponawiam…");
  run("git", ["fetch", "origin"]);
  const rebase = run("git", ["rebase", "origin/main"]);
  if (rebase.status !== 0) {
    // Konflikt (np. równoległa edycja tych samych danych) — przerwij rebase,
    // żeby nie zostawić repo w połowie operacji.
    run("git", ["rebase", "--abort"]);
    log("Rebase nie powiódł się (konflikt). Push wymaga ręcznej interwencji.");
    process.exit(1);
  }
  if (!tryPush()) {
    log("Push nie powiódł się nawet po rebase. Sprawdź remote/uprawnienia.");
    process.exit(1);
  }
}

log("Gotowe — dane wypchnięte. GitHub Pages opublikuje aktualizację automatycznie.");
