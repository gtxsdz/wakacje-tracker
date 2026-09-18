# Tracker cen wycieczek do Egiptu 🏖️

Witryna śledząca ceny wycieczek all inclusive do Egiptu z [wakacje.pl](https://www.wakacje.pl) —
pokazuje aktualne ceny oraz **spadki i wzrosty** w czasie na wykresach.

Dane pobiera lokalny skrypt (z domowego IP) i wypycha je do repo, a witryna jest
publikowana na GitHub Pages.

> **Dlaczego nie w całości w chmurze?** wakacje.pl blokuje żądania z adresów IP
> centrów danych (odpowiada wtedy HTTP 449 — blokada anty-bot). Dotyczy to GitHub
> Actions, Firebase/Google Cloud itp. Dlatego **scraper musi działać z „normalnego"
> IP** (dom, własna maszyna), a chmura służy tylko do hostowania gotowej witryny.

## Śledzony filtr

- Kierunek: **Egipt**, all inclusive, wylot samolotem
- Termin: **28.09 – 07.10.2026**
- 2 dorosłych + 2 dzieci, ocena od 8, z aquaparkiem, do 14 000 zł
- Wyloty: Katowice, Łódź, Poznań, Warszawa, Wrocław

Dokładny filtr znajduje się w `scraper/config.js` (`BASE_FILTER`). Aby zmienić kryteria,
skopiuj nowy fragment z adresu wakacje.pl po zastosowaniu filtrów i podmień tę zmienną.

## Jak to działa

```
maszyna lokalna (domowe IP)                    chmura
───────────────────────────                    ──────
wakacje.pl ─► scraper ─► data/*.json ─► git push ─► GitHub Pages (frontend)
              (npm run push, cyklicznie)                serwuje data/*.json
```

1. **`scraper/scrape.js`** pobiera strony listingu, parsuje oferty (po trwałych atrybutach
   `data-testid`) i aktualizuje dane.
2. **`data/history.json`** — pełna historia: dla każdej oferty lista punktów `{date, price}`.
3. **`data/latest.json`** — aktualny snapshot z wyliczonymi zmianami (`change`, `changePct`,
   `minPrice`, `maxPrice`, `isLowest`) oraz listą ofert, które zniknęły z listingu.
4. **Frontend** (`index.html`, `app.js`, `styles.css`) czyta oba pliki i pokazuje listę ofert
   ze strzałkami ▲/▼, a po kliknięciu — wykres historii ceny.

Identyfikacja oferty (klucz historii) = `hotel + termin + wyloty`, odporna na kolejność miast.

## Uruchomienie lokalne

Wymagany Node.js 18+ (używa wbudowanego `fetch`). Brak zależności npm.

```bash
# samo pobranie danych (zapisze data/latest.json i data/history.json)
npm run scrape

# pobranie danych + commit + push do repo (używane w automatyzacji)
npm run push

# podgląd witryny lokalnie -> http://localhost:8080
npm run serve
```

## Publikacja na GitHub

1. Repozytorium i push:
   ```bash
   git remote add origin https://github.com/<uzytkownik>/<repo>.git
   git push -u origin main
   ```
2. W ustawieniach repo: **Settings → Pages → Source: GitHub Actions**.
3. Workflow `.github/workflows/scrape.yml` publikuje witrynę na GitHub Pages przy
   każdym pushu danych (`data/**`) lub zmianie frontendu. Można go też odpalić ręcznie
   w zakładce **Actions**.

## Automatyczne pobieranie cen (cyklicznie)

Scraper uruchamiamy lokalnie, cyklicznie. `npm run push` pobiera ceny, a następnie
sam commituje i wypycha `data/` — po pushu GitHub Pages odświeża witrynę.

### Windows (Harmonogram zadań)

Jednorazowo, z katalogu projektu:

```powershell
powershell -ExecutionPolicy Bypass -File automation\windows-setup-task.ps1
```

Rejestruje zadanie `WakacjeTracker-Scrape` uruchamiane **codziennie o 08:15**
(godzinę zmienisz parametrem `-Time`). `StartWhenAvailable` sprawia, że jeśli komputer
był wyłączony, zadanie odpali się przy najbliższej okazji.

- Test od razu: `Start-ScheduledTask -TaskName WakacjeTracker-Scrape`
- Usunięcie: `Unregister-ScheduledTask -TaskName WakacjeTracker-Scrape -Confirm:$false`

### Linux (docelowa maszyna działająca 24/7)

Wariant A — **systemd timer** (zalecany dla maszyny non-stop):

```bash
# dostosuj User i ścieżki w plikach jednostek
sudo cp automation/systemd/wakacje-tracker.service /etc/systemd/system/
sudo cp automation/systemd/wakacje-tracker.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wakacje-tracker.timer

systemctl list-timers | grep wakacje        # podgląd harmonogramu
journalctl -u wakacje-tracker.service -f     # logi
```

Wariant B — **cron**: patrz `automation/crontab.example` (gotowa linia do `crontab -e`).

W obu wariantach maszyna musi mieć dostęp do gita z uprawnieniem do push
(klucz SSH lub token w credential helperze). Pierwsze `git push` wykonaj ręcznie,
żeby zapisać poświadczenia.

Historia cen buduje się z czasem — pierwszego dnia wszystkie oferty mają jeden pomiar,
a strzałki spadków/wzrostów pojawią się po kolejnych uruchomieniach.

## Struktura projektu

```
.
├── index.html            # strona główna
├── app.js                # logika frontendu + wykresy (Chart.js z CDN)
├── styles.css            # style (ciemny motyw, responsywny)
├── data/
│   ├── history.json      # pełna historia cen (generowana)
│   └── latest.json       # aktualny snapshot ze zmianami (generowany)
├── scraper/
│   ├── config.js         # filtr, adresy, ustawienia
│   ├── parse.js          # parser HTML listingu
│   ├── scrape.js         # główny scraper
│   ├── push.js           # scrape + commit + push (do automatyzacji)
│   └── serve.js          # lokalny serwer podglądu
├── automation/
│   ├── windows-setup-task.ps1   # rejestracja zadania w Harmonogramie Windows
│   ├── scrape.sh                # skrypt uruchomieniowy dla Linuksa
│   ├── crontab.example          # przykładowy wpis cron
│   └── systemd/                 # jednostka + timer systemd
└── .github/workflows/
    └── scrape.yml        # deploy witryny na GitHub Pages
```

## Uwagi

- Projekt niekomercyjny, do użytku prywatnego. Scraper pobiera strony z rozsądnym odstępem
  i standardowym nagłówkiem User-Agent.
- Parser opiera się na atrybutach `data-testid` z wakacje.pl. Jeśli serwis zmieni strukturę
  strony, może wymagać aktualizacji `scraper/parse.js` — scraper w takim wypadku nie nadpisze
  historii pustymi danymi (kończy się błędem, gdy nie znajdzie ofert).
- Ceny to wartości „od” za wszystkich uczestników.

## Licencja

MIT
