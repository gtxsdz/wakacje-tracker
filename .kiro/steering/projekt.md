# Kontekst projektu wakacje-tracker

Ten plik jest wczytywany przez Kiro w każdej sesji (dom i praca), żeby zachowanie
było spójne niezależnie od maszyny.

## Co to za projekt
Tracker cen wycieczek all inclusive do Egiptu z wakacje.pl. Scraper pobiera dane
lokalnie (z domowego IP, bo wakacje.pl blokuje IP centrów danych — HTTP 449),
wypycha JSON-y do repo, a GitHub Pages serwuje statyczny frontend.
Strona: https://gtxsdz.github.io/wakacje-tracker/

## Praca z wielu maszyn — WAŻNE
Repo edytowane jest z kilku miejsc: komputer domowy, komputer w pracy oraz
automatyczne pushe ze scrapera na Linuksie (co godzinę 8:30–22:30). Dlatego:
- ZAWSZE `git pull` na starcie pracy, zanim cokolwiek zmienisz.
- Commituj i pushuj przed odejściem od maszyny (nie zostawiaj niezacommitowanych zmian).
- Przed własnymi zmianami rób `git fetch` i sprawdzaj, czy origin się nie ruszył
  (hook SessionStart o tym przypomina).
- Przy rozjeździe z origin: rebase własnych zmian na origin/main (dane regenerują
  się co przebieg, więc rebase jest bezpieczny). Nie force-push.

## Scraper produkcyjny (Linux przez Tailscale)
- Host: gtx@100.117.63.42 (nazwa `deb` w Tailscale). Klucz SSH już autoryzowany.
- Repo na serwerze: /home/gtx/wakacje-tracker
- Node: pełna ścieżka ~/.local/node/bin/node (NIE ma w domyślnym PATH sesji SSH).
- Timer systemd użytkownika: co godzinę 8:30–22:30 (strefa Europe/Warsaw).
- UWAGA: 100.80.242.7 to Raspberry Pi (`rpi`), NIE serwer scrapera.

## Pułapki techniczne (Windows/PowerShell)
- Komendy SSH przez PowerShell: unikać nawiasów `()` i spacji w komunikatach
  commita — cudzysłowy gubią się w podwójnym przejściu PowerShell→bash. Używać
  krótkich, prostych komunikatów (myślniki zamiast spacji).
- `node -e "..."` przez SSH przez PowerShell zwykle się rozjeżdża na cudzysłowach —
  lepiej grep/sed albo osobny skrypt.
- Zrzuty Playwright: DPR 2 (nie 3.5) i pojedyncze elementy, bo full-page bywa >5 MB.

## Model danych (kluczowe decyzje)
- Tożsamość śledzonej oferty = BIURO (operator), nie lot/pokój/data. Liczy się
  tylko najniższa cena hotelu. Zmiana lotniska/godziny/pokoju w tym samym biurze
  NIE jest "zmianą wariantu".
- Historia zapisuje punkt tylko przy zmianie ceny LUB biura (baza nie puchnie).
  Każdy punkt ma znacznik czasu `at` (punkty śróddzienne).
- `detailUrl`: gdy API nie zwróci place/urlName, budujemy URL z regionu + slugu
  nazwy hotelu + offerId (fallback w buildDetailUrl).

## Weryfikacja przed pushem
- `node --check` na zmienianych plikach JS.
- `node research/test-logic.js` (logika historii) i `node research/test-detailurl.js`.
- Nie commitować: node_modules/, screenshots/, danych testowych (research/_*).
