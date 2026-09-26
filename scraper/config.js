// Konfiguracja scrapera.
// URL pochodzi z przefiltrowanych ofert Egiptu na wakacje.pl.
// Zmienną {PAGE} scraper podmienia na numer strony przy paginacji.

export const BASE_FILTER =
  "od-2026-09-28,do-2026-10-07,do-14000zl,samolotem,all-inclusive,ocena-8,z-aquaparkiem,z-katowic,z-lodzi,z-poznania,z-warszawy,z-wroclawia,2dorosle-2dzieci-20091119-20150707,tanio";

// Bazowy adres listingu (bez numeru strony).
export const LISTING_URL = `https://www.wakacje.pl/wczasy/egipt/?${BASE_FILTER}&src=fromFilters`;

// Adres z numerem strony (paginacja).
export function pageUrl(page) {
  if (page <= 1) return LISTING_URL;
  return `https://www.wakacje.pl/wczasy/egipt/?${BASE_FILTER},strona-${page}&src=fromFilters`;
}

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Endpoint wyszukiwarki ofert (paginacja przez query.pageNumber, 10 na stronę).
export const SEARCH_API = "https://www.wakacje.pl/v2/api/offers";

// Parametry zapytania odpowiadające filtrowi (patrz BASE_FILTER powyżej).
// departure = ID miast wylotu: Katowice 2622, Łódź 2654, Poznań 2632,
// Warszawa 278, Wrocław 256. attribute ["21"] = z aquaparkiem. service [1] = AI.
export const SEARCH_QUERY = {
  departureDate: "2026-09-28",
  arrivalDate: "2026-10-07",
  departure: [2622, 2654, 2632, 278, 256],
  type: [1], // samolot
  duration: { min: 7, max: 28 },
  minPrice: null,
  maxPrice: "14000",
  service: [1], // all inclusive
  attribute: ["21"], // z aquaparkiem
  maxCategory: 50,
  sort: 1,
  order: 0,
  totalPrice: true,
  pricePerPerson: false,
  rank: 80, // ocena od 8.0
  rooms: [{ adult: 2, kid: 2, ages: ["20091119", "20150707"] }],
};

// Ile stron maksymalnie odpytać (zabezpieczenie przed pętlą).
export const MAX_PAGES = 15;

// Odstęp między zapytaniami stron (ms), żeby nie obciążać serwisu.
export const REQUEST_DELAY_MS = 1500;

// Ścieżki plików danych.
export const DATA_DIR = "data";
export const HISTORY_FILE = "data/history.json";
export const LATEST_FILE = "data/latest.json";

// Kod lotniska (IATA) -> { id: ID w API wyszukiwarki, slug: część URL wakacje.pl }.
// id: null = lotnisko pominięte w filtrze API (np. Modlin jako alias Warszawy).
// Jedno źródło prawdy — zastępuje lokalny AIRPORT_SLUG w scrape.js.
export const AIRPORTS = {
  KTW: { id: 2622, slug: "katowic" },
  LCJ: { id: 2654, slug: "lodzi" },
  POZ: { id: 2632, slug: "poznania" },
  WAW: { id: 278,  slug: "warszawy" },
  WMI: { id: null, slug: "warszawy" }, // Modlin — alias Warszawy, bez osobnego ID w API
  WRO: { id: 256,  slug: "wroclawia" },
  GDN: { id: 2620, slug: "gdanska" },
  KRK: { id: 2624, slug: "krakowa" },
  RZE: { id: 2638, slug: "rzeszowa" },
  SZZ: { id: 2640, slug: "szczecina" },
  BZG: { id: 2618, slug: "bydgoszczy" },
  LUZ: { id: null, slug: "lublina" },  // Lublin — bez ID w API wakacje.pl
};
