# Tracker cen wycieczek do Egiptu 🏖️

Witryna śledząca ceny wycieczek all inclusive do Egiptu z [wakacje.pl](https://www.wakacje.pl) —
pokazuje aktualne ceny oraz **spadki i wzrosty** w czasie na wykresach.

Dane pobierane są automatycznie raz dziennie przez GitHub Actions i publikowane na GitHub Pages.

## Śledzony filtr

- Kierunek: **Egipt**, all inclusive, wylot samolotem
- Termin: **28.09 – 07.10.2026**
- 2 dorosłych + 2 dzieci, ocena od 8, z aquaparkiem, do 14 000 zł
- Wyloty: Katowice, Łódź, Poznań, Warszawa, Wrocław

Dokładny filtr znajduje się w `scraper/config.js` (`BASE_FILTER`). Aby zmienić kryteria,
skopiuj nowy fragment z adresu wakacje.pl po zastosowaniu filtrów i podmień tę zmienną.

## Jak to działa

```
wakacje.pl  ──►  scraper (Node)  ──►  data/history.json  ──►  frontend (Chart.js)
                                      data/latest.json
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
# pobranie danych (zapisze data/latest.json i data/history.json)
npm run scrape

# podgląd witryny lokalnie -> http://localhost:8080
npm run serve
```

## Publikacja na GitHub

1. Utwórz repozytorium i wypchnij projekt:
   ```bash
   git remote add origin https://github.com/<uzytkownik>/<repo>.git
   git push -u origin main
   ```
2. W ustawieniach repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Gotowe. Workflow `.github/workflows/scrape.yml`:
   - uruchamia się **codziennie o 06:12 UTC** (ok. 08:12 czasu PL),
   - można go też odpalić ręcznie w zakładce **Actions → Scrape ceny i publikacja → Run workflow**,
   - pobiera ceny, commituje zmiany w `data/` i publikuje witrynę na GitHub Pages.

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
│   └── serve.js          # lokalny serwer podglądu
└── .github/workflows/
    └── scrape.yml        # codzienne pobieranie + deploy Pages
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
