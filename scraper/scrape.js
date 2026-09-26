// Główny scraper: pobiera listing Egiptu z wakacje.pl, a dla każdej oferty
// pobiera warianty wylotów (lotnisko/pokój/godziny/cena) przez API i śledzi
// NAJTAŃSZY dostępny wariant. Zapisuje historię cen i aktualny snapshot.
//
// Uruchomienie: node scraper/scrape.js
// Wynik:
//   data/history.json - historia (per oferta: śledzony wariant + punkty cenowe)
//   data/latest.json  - aktualny stan z pełnymi danymi lotu i zmianami

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickCheapestAvailable, BlockedError } from "./variants.js";
import { fetchAllOffers } from "./listing.js";
import {
  HISTORY_FILE,
  LATEST_FILE,
  DATA_DIR,
  LISTING_URL,
  SEARCH_QUERY,
  AIRPORTS,
} from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();

/** Krótki, czytelny opis wariantu (do notek i porównań). */
function variantLabel(v) {
  if (!v) return "";
  const dep = v.outbound?.from;
  const ret = v.inbound?.from;
  return [
    v.room,
    dep ? `${dep.airportCode} ${dep.customDate} ${dep.time}` : "",
    ret ? `powrót ${ret.customDate} ${ret.time}` : "",
  ]
    .filter(Boolean)
    .join(" • ");
}

/**
 * Tożsamość ŚLEDZONEJ oferty hotelu = biuro podróży (operator).
 *
 * Świadomie NIE uwzględniamy tu lotniska, godzin, daty ani pokoju: te kryteria
 * są już zawężone filtrem wyszukiwania (interesujące miasta wylotu i termin),
 * a nas interesuje wyłącznie NAJNIŻSZA cena danego hotelu. Dzięki temu zmiana
 * lotniska/godziny/pokoju w obrębie tego samego biura nie generuje sztucznej
 * „zmiany wariantu" — liczy się tylko cena (spadek/wzrost) i ewentualna zmiana
 * biura, przez które hotel jest teraz najtańszy.
 */
function variantSignature(operator) {
  return (operator || "").toLowerCase().trim();
}

/**
 * Spłaszcza wybrany wariant do postaci zapisywanej w historii/snapshotcie.
 * `operator` (biuro podróży) pochodzi z oferty, nie z samego wariantu, i służy
 * jako tożsamość śledzonej oferty hotelu.
 */
function flattenVariant(v, operator) {
  if (!v) return null;
  return {
    variantId: variantSignature(operator),
    operator: operator || "",
    apiHash: v.id, // token z API (rotuje) — tylko poglądowo
    price: v.price,
    currency: v.currency,
    room: v.room,
    departureCode: v.departureCode || v.outbound?.from?.airportCode || "",
    luggageIncluded: v.luggageIncluded,
    carrier: v.carrier,
    outbound: v.outbound,
    inbound: v.inbound,
    label: variantLabel(v),
  };
}

function readJson(absPath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(absPath, data) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/**
 * Aktualizuje historię o dzisiejszą najniższą cenę danego hotelu.
 * Wykrywa zmianę biura, przez które hotel jest teraz najtańszy.
 */
function updateOfferHistory(entry, offer, chosen, soldOutCheaper, date, at) {
  const flat = flattenVariant(chosen, offer.operator);

  // Metadane oferty (mogą się zmieniać: ocena, liczba opinii).
  entry.offerId = offer.offerId;
  entry.hotel = offer.hotel;
  entry.region = offer.region;
  entry.stars = offer.stars ?? entry.stars;
  entry.rating = offer.rating ?? entry.rating;
  entry.opinions = offer.opinions ?? entry.opinions;
  entry.operator = offer.operator;
  entry.duration = offer.duration;
  entry.departureDate = offer.departureDate;
  entry.returnDate = offer.returnDate;
  if (!entry.firstSeen) entry.firstSeen = date;

  entry.prices = entry.prices || [];
  entry.variantChanges = entry.variantChanges || [];

  const prev = entry.prices[entry.prices.length - 1];

  if (!flat) return; // brak dostępnego wariantu — nie dopisujemy punktu

  // Porównanie ze SPRAWDZENIEM (zrzutem) sprzed tego uruchomienia.
  // entry.lastSeenPrice/lastSeenAt trzymamy z każdego przebiegu (nie tylko przy
  // zmianie), więc pozwala odpowiedzieć: "czy cena drgnęła od ostatniego razu".
  const prevSeenPrice = entry.lastSeenPrice ?? null;
  const prevSeenAt = entry.lastSeenAt ?? null;
  const sameAsPrevRun = prevSeenPrice != null && prevSeenPrice === flat.price;
  entry.changedSincePrevRun = prevSeenPrice != null && prevSeenPrice !== flat.price;
  entry.prevSeenPrice = prevSeenPrice;
  entry.prevSeenAt = prevSeenAt;

  // Seria kolejnych sprawdzeń z TĄ SAMĄ ceną. 1 = pierwszy odczyt tej ceny,
  // 2 = drugi z rzędu identyczny, 3+ = cena "zastygła" (traktujemy jako stabilną).
  entry.sameRunStreak = sameAsPrevRun ? (entry.sameRunStreak || 1) + 1 : 1;

  // Aktualizacja znaczników "ostatnio widziane" — KAŻDY przebieg.
  entry.lastSeen = date;
  entry.lastSeenAt = at;
  entry.lastSeenPrice = flat.price;

  // Czy coś realnego się zmieniło od ostatniego punktu? Zapisujemy punkt tylko
  // przy zmianie CENY lub BIURA — inaczej baza puchłaby przy częstych przebiegach.
  const priceChanged = !prev || prev.price !== flat.price;
  const operatorChanged = !prev || prev.variantId !== flat.variantId;

  // Zmiana BIURA, przez które hotel jest teraz najtańszy (inny operator niż
  // ostatnio). Nie notujemy zmian lotniska/godziny/pokoju w obrębie tego samego
  // biura — dla śledzenia liczy się wyłącznie najniższa cena hotelu.
  if (prev && operatorChanged) {
    const cheaper = flat.price != null && prev.price != null && flat.price < prev.price;
    entry.variantChanges.push({
      date,
      at,
      from: { variantId: prev.variantId, operator: prev.operator || prev.variantId, price: prev.price },
      to: { variantId: flat.variantId, operator: flat.operator || flat.variantId, price: flat.price },
      reason: cheaper
        ? "najtańsze teraz w innym biurze (taniej)"
        : "najtańsze teraz w innym biurze",
    });
  }

  // Nic się nie zmieniło (ta sama cena i to samo biuro) — nie dopisujemy punktu.
  if (prev && !priceChanged && !operatorChanged) return;

  entry.prices.push({ date, at, ...flat });

  // Zabezpieczenie przed niekontrolowanym rozrastaniem się history.json.
  // Zbieramy co godzinę — 500 punktów to ~3 tygodnie częstych zmian.
  const MAX_HISTORY_POINTS = 500;
  if (entry.prices.length > MAX_HISTORY_POINTS) {
    entry.prices = entry.prices.slice(-MAX_HISTORY_POINTS);
  }
}

/** Buduje snapshot latest.json ze zmianami cen. */
function buildLatest(history, currentResults, date) {
  const offers = [];

  for (const r of currentResults) {
    // Pomijamy hotele bez dostępnego wariantu (brak ceny do śledzenia).
    if (!r.chosen) continue;

    const entry = history.offers[r.offer.key];
    const prices = entry ? entry.prices : [];
    const flat = flattenVariant(r.chosen, r.offer.operator);
    const current = flat ? flat.price : null;

    // Poprzednia cena = ostatni zanotowany punkt o INNEJ cenie niż aktualna.
    // Punkty zapisujemy tylko przy zmianie, więc to naturalnie „cena sprzed
    // ostatniej zmiany" — niezależnie od tego, czy była dziś, czy wcześniej.
    let prevPrice = null;
    for (let i = prices.length - 1; i >= 0; i--) {
      if (prices[i].price !== current) {
        prevPrice = prices[i].price;
        break;
      }
    }

    const values = prices.map((p) => p.price).filter((n) => n != null);
    if (current != null) values.push(current);
    const minPrice = values.length ? Math.min(...values) : null;
    const maxPrice = values.length ? Math.max(...values) : null;

    let change = null;
    let changePct = null;
    if (prevPrice != null && current != null) {
      change = current - prevPrice;
      changePct = prevPrice ? +((change / prevPrice) * 100).toFixed(2) : null;
    }

    const lastChange =
      entry && entry.variantChanges && entry.variantChanges.length
        ? entry.variantChanges[entry.variantChanges.length - 1]
        : null;
    const variantChangedToday = lastChange && lastChange.date === date;

    // Kiedy cena ostatnio FAKTYCZNIE się zmieniła (ostatni zapisany punkt).
    // Punkty zapisujemy tylko przy zmianie, więc `at` ostatniego punktu = moment
    // ostatniej zmiany ceny. Gdy jest tylko 1 punkt, to pierwszy pomiar.
    const lastPoint = prices.length ? prices[prices.length - 1] : null;
    const lastChangeAt = lastPoint ? lastPoint.at || null : null;
    const lastChangeDate = lastPoint ? lastPoint.date || null : null;
    // Kiedy oferta była ostatnio sprawdzona (niezależnie od zmiany ceny).
    const lastCheckedAt = entry ? entry.lastSeenAt || null : null;
    // Porównanie z POPRZEDNIM ZRZUTEM: czy cena drgnęła od ostatniego sprawdzenia.
    const sameSincePrevRun = entry ? entry.changedSincePrevRun === false && entry.prevSeenPrice != null : false;
    const prevRunAt = entry ? entry.prevSeenAt || null : null;
    // Seria identycznych odczytów; od 3. z rzędu uznajemy cenę za STABILNĄ.
    const sameRunStreak = entry ? entry.sameRunStreak || 1 : 1;
    const stable = sameRunStreak >= 3;

    offers.push({
      key: r.offer.key,
      offerId: r.offer.offerId,
      hotelId: r.offer.hotelId,
      hotel: r.offer.hotel,
      region: r.offer.region,
      stars: r.offer.stars,
      rating: r.offer.rating,
      opinions: r.offer.opinions,
      operator: r.offer.operator,
      duration: r.offer.duration,
      departureDate: r.offer.departureDate,
      returnDate: r.offer.returnDate,
      detailUrl: buildDetailUrl(r.offer, r.chosen),
      variantCount: r.variants.length,
      altOffers: r.altOffers && r.altOffers.length ? r.altOffers : undefined,
      cheapest: flat,
      price: current,
      prevPrice,
      change,
      changePct,
      minPrice,
      maxPrice,
      isLowest: current != null && minPrice != null && current <= minPrice,
      pointCount: prices.length,
      firstSeen: entry ? entry.firstSeen : date,
      lastChangeAt,
      lastChangeDate,
      lastCheckedAt,
      sameSincePrevRun,
      prevRunAt,
      sameRunStreak,
      stable,
      soldOutNote: variantChangedToday
        ? lastChange.reason
        : null,
      soldOutCheaperCount: r.soldOutCheaper.length,
    });
  }

  offers.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

  // Oferty z historii nieobecne dziś.
  const currentKeys = new Set(currentResults.map((r) => r.offer.key));
  const disappeared = [];
  for (const key of Object.keys(history.offers)) {
    if (!currentKeys.has(key)) {
      const e = history.offers[key];
      const last = e.prices && e.prices.length ? e.prices[e.prices.length - 1] : null;
      disappeared.push({
        key,
        hotel: e.hotel,
        region: e.region,
        lastPrice: last ? last.price : null,
        lastSeen: e.lastSeen,
      });
    }
  }

  return {
    generatedAt: nowIso(),
    date,
    sourceUrl: LISTING_URL,
    count: offers.length,
    offers,
    disappeared,
  };
}

/**
 * Scala wyniki per hotel: ten sam hotel (hotelId) może pochodzić z kilku ofert
 * (różni operatorzy). Zostawiamy jeden wynik na hotel — ten z najtańszym
 * wybranym wariantem. Klucz historii ustawiamy na hotel-{hotelId}, żeby historia
 * była spójna niezależnie od tego, przez którego operatora hotel akurat jest tani.
 *
 * KLUCZE (Fix 12): parse.js generuje klucz wejściowy offer-{offerId} (per oferta/operator).
 * Ta funkcja konsoliduje oferty per hotel i zamienia klucz na hotel-{hotelId} —
 * dzięki temu historia cen hotelu jest ciągła, nawet gdy najtańszy operator
 * zmienia się w czasie (np. Coral -> Itaka). Klucz hotel-{hotelId} jest
 * zapisywany w history.json.
 */
function collapseByHotel(results) {
  const byHotel = new Map();
  for (const r of results) {
    const hotelId = r.offer.hotelId;
    // Klucz na poziomie hotelu (fallback na dotychczasowy, gdy brak hotelId).
    const hotelKey = hotelId ? `hotel-${hotelId}` : r.offer.key;
    const prev = byHotel.get(hotelKey);

    const price = r.chosen ? r.chosen.price : Infinity;
    const prevPrice = prev && prev.chosen ? prev.chosen.price : Infinity;

    if (!prev || price < prevPrice) {
      // Ta oferta daje tańszy (lub pierwszy) wariant dla tego hotelu.
      const merged = {
        ...r,
        offer: { ...r.offer, key: hotelKey, hotelId },
        // zachowaj informację o alternatywnych ofertach tego hotelu
        altOffers: prev ? [...(prev.altOffers || []), altInfo(prev)] : [],
      };
      byHotel.set(hotelKey, merged);
    } else {
      // Ten wariant nie jest tańszy — dopisz jako alternatywę.
      prev.altOffers = prev.altOffers || [];
      prev.altOffers.push(altInfo(r));
    }
  }
  // Sort po cenie wybranego wariantu.
  return [...byHotel.values()].sort(
    (a, b) => (a.chosen?.price ?? Infinity) - (b.chosen?.price ?? Infinity)
  );
}

/** Skrótowa informacja o alternatywnej ofercie hotelu (inny operator). */
function altInfo(r) {
  return {
    offerId: r.offer.offerId,
    operator: r.offer.operator,
    price: r.chosen ? r.chosen.price : null,
  };
}

/** Slug wyżywienia w URL (serwis 1 = all inclusive). */
function serviceSlug(serviceId) {
  return serviceId === 1 ? "all-inclusive" : null;
}

/**
 * Slug do URL wakacje.pl: małe litery, bez ogonków, spacje/znaki -> myślniki.
 * Np. "Sharm el Sheikh" -> "sharm-el-sheikh", "Charmillion Club" -> "charmillion-club".
 */
function urlSlug(s) {
  return (s || "")
    .toString()
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Buduje URL szczegółów oferty z parametrami (data, długość, wyżywienie,
 * miasto wylotu, skład osób), tak by strona otworzyła konkretny wariant.
 * Przykład query: od-2026-09-28,7-dni,all-inclusive,z-katowic,2dorosle-2dzieci-20091119-20150707
 *
 * Gdy API nie zwróci pełnego `place`/`urlName` (zdarza się przy części
 * operatorów), budujemy URL z regionu i nazwy hotelu — wakacje.pl przyjmuje
 * `/oferty/egipt/{region}/{slug-nazwy}-{offerId}.html` i tak samo otwiera ofertę.
 */
function buildDetailUrl(offer, chosen) {
  if (!offer.offerId) return null;

  const p = offer.place;
  let base = null;

  if (p && offer.urlName && p.country?.urlName && p.region?.urlName && p.city?.urlName) {
    // Ścieżka pełna (z danych API): kraj/region/miasto/nazwa.
    base = `https://www.wakacje.pl/oferty/${p.country.urlName}/${p.region.urlName}/${p.city.urlName}/${offer.urlName}-${offer.offerId}.html`;
  } else {
    // Fallback: region z pola `region` ("Egipt / Sharm el Sheikh") + slug nazwy.
    // Wystarcza wakacje.pl do otwarcia właściwej oferty po offerId.
    const regionName = (offer.region || "").split("/").pop().trim();
    const regionSlug = urlSlug(regionName);
    const nameSlug = urlSlug(offer.hotel);
    if (!regionSlug || !nameSlug) return null;
    base = `https://www.wakacje.pl/oferty/egipt/${regionSlug}/${nameSlug}-${offer.offerId}.html`;
  }

  const url = base;

  // Parametry filtra dla konkretnego wariantu.
  const parts = [];
  if (offer.departureDate) parts.push(`od-${offer.departureDate}`);
  if (offer.duration) parts.push(`${offer.duration}-dni`);
  const svc = serviceSlug(offer.service);
  if (svc) parts.push(svc);

  const airport = chosen?.departureCode || chosen?.outbound?.from?.airportCode;
  const slug = airport ? AIRPORTS[airport]?.slug : null;
  if (slug) parts.push(`z-${slug}`);

  // Skład osób: 2 dorosłych + 2 dzieci z datami urodzenia (zgodnie z filtrem).
  const room = SEARCH_QUERY.rooms && SEARCH_QUERY.rooms[0];
  if (room) {
    const adults = room.adult || 0;
    const kids = room.kid || 0;
    const ages = Array.isArray(room.ages) ? room.ages.join("-") : "";
    let comp = `${adults}doros${adults === 1 ? "ly" : "le"}`;
    if (kids > 0) comp += `-${kids}dzie${kids === 1 ? "cko" : "ci"}`;
    if (ages) comp += `-${ages}`;
    parts.push(comp);
  }

  return parts.length ? `${url}?${parts.join(",")}` : url;
}

async function main() {
  const date = today();
  const at = nowIso(); // znacznik czasu przebiegu (punkty śróddzienne)
  console.log(`=== Scraper wakacje.pl (Egipt, warianty) — ${date} ${at} ===`);

  let offers, total;
  try {
    ({ offers, total } = await fetchAllOffers({ delayMs: 500 }));
  } catch (err) {
    console.error(`Błąd pobierania listy ofert: ${err.message}. Nie nadpisuję historii.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Ofert z listingu: ${offers.length}${total != null ? ` / ${total}` : ""}`);
  if (offers.length === 0) {
    console.error("Brak ofert — API mogło się zmienić. Nie nadpisuję historii.");
    process.exitCode = 1;
    return;
  }

  // Dla każdej oferty pobierz warianty i wybierz najtańszy.
  // UWAGA: weryfikacja dostępności (checkOfferAvailability) okazała się
  // niewiarygodna — endpoint wymaga offerHash z tej samej sesji, a hashe z
  // getCalculatorOfferVariants rotują, więc zwraca fałszywe "niedostępne" nawet
  // dla realnie dostępnych, najtańszych wariantów. Włączenie jej zawyżałoby cenę.
  // Dlatego ufamy liście z getCalculatorOfferVariants (to samo źródło, z którego
  // serwis liczy ceny). Bezpieczniki (BlockedError, limity) zostają na przyszłość.
  const results = [];
  let blocked = false;
  for (const offer of offers) {
    try {
      const picked = await pickCheapestAvailable(offer, { verifyAvailability: false });
      results.push({ offer, ...picked });
      const c = picked.chosen;
      console.log(
        `  ${offer.hotel.slice(0, 30).padEnd(30)} → ${
          c ? `${c.price} zł | ${variantLabel(c)}` : "brak wariantów"
        } (${picked.variants.length} wariantów${
          picked.soldOutCheaper.length ? `, ${picked.soldOutCheaper.length} tańszych niedostępnych` : ""
        })`
      );
    } catch (err) {
      if (err instanceof BlockedError) {
        // Serwis zaczął blokować/throttlować — przerywamy, by nie eskalować.
        console.error(`\n⛔ ${err.message}\nPrzerywam pobieranie. Historia NIE zostanie nadpisana.`);
        blocked = true;
        break;
      }
      console.error(`  ${offer.hotel}: błąd wariantów — ${err.message}`);
      results.push({ offer, chosen: null, variants: [], soldOutCheaper: [] });
    }
    await sleep(700); // odstęp między ofertami
  }

  if (blocked) {
    process.exitCode = 1;
    return;
  }

  const withVariants = results.filter((r) => r.chosen);
  if (withVariants.length === 0) {
    console.error("Żadna oferta nie zwróciła wariantów — nie nadpisuję historii.");
    process.exitCode = 1;
    return;
  }

  // Deduplikacja po hotelu: ten sam hotel bywa w kilku ofertach (różni
  // operatorzy). Dla każdego hotelu bierzemy ofertę z najtańszym wariantem.
  const hotelResults = collapseByHotel(results);
  const collapsed = offers.length - hotelResults.length;
  if (collapsed > 0) {
    console.log(`Scalono duplikaty hoteli: ${offers.length} ofert → ${hotelResults.length} hoteli`);
  }

  const historyPath = path.join(ROOT, HISTORY_FILE);
  const latestPath = path.join(ROOT, LATEST_FILE);
  const history = readJson(historyPath, { offers: {} });
  history.offers = history.offers || {};

  for (const r of hotelResults) {
    if (!r.chosen) continue; // brak wariantu — nie zakładamy wpisu historii
    const entry = history.offers[r.offer.key] || {};
    updateOfferHistory(entry, r.offer, r.chosen, r.soldOutCheaper, date, at);
    history.offers[r.offer.key] = entry;
  }
  history.lastUpdated = at;
  history.sourceUrl = LISTING_URL;

  const latest = buildLatest(history, hotelResults, date);

  writeJson(historyPath, history);
  writeJson(latestPath, latest);

  const drops = latest.offers.filter((o) => o.change != null && o.change < 0);
  const rises = latest.offers.filter((o) => o.change != null && o.change > 0);
  const changes = latest.offers.filter((o) => o.soldOutNote);
  console.log(`Zapisano do ${DATA_DIR}/  | spadki: ${drops.length}, wzrosty: ${rises.length}, zmiany biura: ${changes.length}`);
}

main().catch((err) => {
  console.error("Błąd krytyczny:", err);
  process.exitCode = 1;
});
