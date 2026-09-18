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

// Ile stron maksymalnie odpytać (zabezpieczenie przed pętlą).
export const MAX_PAGES = 15;

// Odstęp między zapytaniami stron (ms), żeby nie obciążać serwisu.
export const REQUEST_DELAY_MS = 1500;

// Ścieżki plików danych.
export const DATA_DIR = "data";
export const HISTORY_FILE = "data/history.json";
export const LATEST_FILE = "data/latest.json";
