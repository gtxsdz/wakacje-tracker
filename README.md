# Tracker cen wycieczek do Egiptu 🏖️

Witryna śledząca ceny wycieczek all inclusive do Egiptu z [wakacje.pl](https://www.wakacje.pl) —
pokazuje aktualne ceny oraz **spadki i wzrosty** w czasie na wykresach.

Dla każdej z 10 ofert śledzimy **najtańszy dostępny wariant wylotu** — konkretne
lotnisko, pokój oraz godziny lotu tam i z powrotem. Gdy śledzony wariant znika
(np. się wyprzeda), tracker przechodzi na kolejny najtańszy i odnotowuje zmianę.

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

1. **`scraper/listing.js`** pobiera pełną listę ofert przez API wyszukiwarki
   (`POST /v2/api/offers`, metoda `search.tripsSearch`) — z **paginacją** przez
   `query.pageNumber` (10 na stronę), aż zbierze wszystkie wyniki (`count`).
   To ważne: strona WWW pokazuje tylko pierwsze 10, a ofert jest zwykle kilkadziesiąt.
   `scraper/parse.js` normalizuje każdą ofertę (`offerId`, `hotelId`, operator itd.).
2. **`scraper/variants.js`** dla każdej oferty woła publiczne API
   `POST /v2/api/getCalculatorOfferVariants/{offerId}` (bez autoryzacji). Zwraca ono
   wszystkie warianty (każde lotnisko × pokój) z ceną, lotniskami i godzinami lotów.
   Wybieramy **najtańszy dostępny**.
3. **`scraper/scrape.js`** łączy powyższe i aktualizuje dane.
4. **`data/history.json`** — historia: per oferta śledzony wariant + punkty
   `{date, price, room, departureCode, godziny lotów}` oraz `variantChanges[]`
   (kiedy i z czego na co zmienił się śledzony wariant).
5. **`data/latest.json`** — aktualny snapshot: najtańszy wariant każdej oferty z pełnym
   rozkładem lotu, zmianą ceny (`change`, `changePct`, `minPrice`, `maxPrice`, `isLowest`),
   notką o zmianie wariantu i listą ofert, które zniknęły.
6. **Frontend** (`index.html`, `app.js`, `styles.css`) pokazuje listę z lotniskiem
   i godzinami, strzałkami ▲/▼, a po kliknięciu — wykres historii ceny i log zmian wariantu.

Jeden wpis na hotel: ten sam hotel bywa w kilku ofertach (różni operatorzy) —
scalamy je po `hotelId` i pokazujemy najtańszy wariant ze wszystkich, a pozostałe
oferty hotelu trafiają do pola `altOffers`. Klucz historii = `hotel-{hotelId}`
(stabilny). Tożsamość wariantu budujemy z jego atrybutów (pokój + lotnisko +
daty/godziny), bo token `offerHash` z API zmienia się przy każdym zapytaniu.

> **API zamiast HTML.** Konkretny wylot (lotnisko, dzień, godzina) nie jest w HTML strony
> oferty — doładowuje go przeglądarka z powyższego API. Namierzyliśmy je narzędziem
> badawczym (Playwright, folder `research/`), ale **produkcyjny scraper używa zwykłego
> `fetch`** — Playwright nie jest potrzebny do działania.

## Uruchomienie lokalne

Wymagany Node.js 18+ (używa wbudowanego `fetch`). Produkcja nie ma zależności npm;
`playwright` jest tylko `devDependency` do narzędzi badawczych w `research/`.

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
4. Workflow publikuje **tylko pliki witryny** (`index.html`, `app.js`, `styles.css`,
   `.nojekyll`, `data/`). Buduje je do katalogu `_site/` i dopiero ten katalog trafia
   jako artefakt Pages — dzięki temu narzędzia i notatki z repo (`.kiro/`, `research/`,
   `automation/`, `package.json`) **nie są** dostępne publicznie pod adresem strony.

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

Tak wygląda faktyczne wdrożenie na Debianie (bez roota, timer użytkownika):

```bash
# 1. Node (jeśli brak) — binarka do katalogu domowego, bez sudo:
curl -fsSL -o /tmp/node.tar.xz https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-x64.tar.xz
mkdir -p ~/.local && tar -xf /tmp/node.tar.xz -C ~/.local
mv ~/.local/node-v20.18.1-linux-x64 ~/.local/node
echo 'export PATH="$HOME/.local/node/bin:$PATH"' >> ~/.bashrc

# 2. Repo + push przez deploy key (klucz SSH z prawem zapisu w ustawieniach repo):
git clone git@github.com:<uzytkownik>/<repo>.git ~/wakacje-tracker

# 3. Timer użytkownika (co godzinę w oknie 08:30–22:30):
mkdir -p ~/.config/systemd/user
cp ~/wakacje-tracker/automation/systemd/user/wakacje-tracker.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now wakacje-tracker.timer
sudo loginctl enable-linger $USER          # by działało bez aktywnej sesji SSH

systemctl --user list-timers                 # podgląd harmonogramu
journalctl --user -u wakacje-tracker.service # logi
```

Alternatywnie **cron**: patrz `automation/crontab.example`. Warianty systemowe (z sudo)
są w `automation/systemd/` (bez podkatalogu `user/`).

> **HTTP przez curl.** Scraper używa `curl` jako transportu (`scraper/http.js`), bo
> wakacje.pl blokuje wbudowany `fetch` Node po odcisku TLS (HTTP 449), szczególnie na
> Linuksie. `curl` jest standardowo dostępny; nic nie trzeba dodatkowo instalować.

Historia cen buduje się z czasem — pierwszego dnia wszystkie oferty mają jeden pomiar,
a strzałki spadków/wzrostów pojawią się po kolejnych uruchomieniach.

## Weryfikacja zmian

Zestaw testów uruchamiany przed pushem (bez zależności zewnętrznych; tylko
`check-live.js` potrzebuje Playwrighta):

```bash
node research/test-logic.js          # logika historii cen (6 scenariuszy)
node research/test-detailurl.js      # budowa URL oferty (4 testy)
node research/test-scrape-logic.js   # min/max, limity, dedup po hotelu, „zniknięte" (10 testów)
node research/test-front-render.js   # render kart, escapowanie, modal, eksport CSV (31 kontroli)
node research/check-live.js          # prawdziwa przeglądarka: overflow, błędy konsoli, modal, zrzuty
```

`check-live.js` przyjmuje opcjonalny URL (domyślnie strona na GitHub Pages), więc ten sam
test działa też na podglądzie lokalnym: `node research/check-live.js http://127.0.0.1:8080/`.

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
│   ├── config.js         # filtr, adresy, parametry wyszukiwarki
│   ├── listing.js        # pobieranie pełnej listy ofert (API + paginacja)
│   ├── parse.js          # normalizacja pojedynczej oferty
│   ├── http.js           # transport HTTP przez curl
│   ├── variants.js       # pobieranie wariantów wylotu z API
│   ├── scrape.js         # główny scraper (listing + warianty + historia)
│   ├── push.js           # scrape + commit + push (do automatyzacji)
│   └── serve.js          # lokalny serwer podglądu
├── research/             # narzędzia badawcze (namierzanie API; Playwright)
│   ├── sniff.js          # przechwytywanie XHR na stronie oferty
│   └── try-api.js        # test wołania API bez przeglądarki
├── automation/
│   ├── windows-setup-task.ps1   # rejestracja zadania w Harmonogramie Windows
│   ├── scrape.sh                # skrypt uruchomieniowy dla Linuksa
│   ├── crontab.example          # przykładowy wpis cron
│   └── systemd/                 # jednostka + timer systemd
└── .github/workflows/
    └── scrape.yml        # deploy witryny na GitHub Pages
```

## Uwagi

- Projekt niekomercyjny, do użytku prywatnego. Scraper pobiera dane z rozsądnym odstępem
  i standardowym nagłówkiem User-Agent.
- Parser i API mogą wymagać aktualizacji, jeśli wakacje.pl zmieni strukturę. Scraper w razie
  braku danych nie nadpisuje historii pustką (kończy się błędem, gdy nie znajdzie ofert).
- Ceny to wartości za wszystkich uczestników dla wybranego wariantu.
- Nie weryfikujemy osobno dostępności wariantu (`verifyAvailability=false`). Sprawdziliśmy
  endpoint `checkOfferAvailability`, ale okazał się niewiarygodny: wymaga `offerHash` z tej
  samej sesji, a hashe z `getCalculatorOfferVariants` rotują, więc zwraca fałszywe
  „niedostępne” nawet dla realnie dostępnych, najtańszych wariantów — co zawyżałoby cenę.
  Dlatego ufamy liście z `getCalculatorOfferVariants` (to samo źródło, z którego serwis
  liczy ceny). Kod weryfikacji i bezpieczniki (limit sprawdzeń, `BlockedError`, backoff na
  429/449) zostają w `variants.js` na wypadek, gdyby dało się to później naprawić.

## Licencja

MIT
