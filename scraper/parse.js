// Parser HTML listingu wakacje.pl.
// Oferty renderowane są server-side z trwałymi atrybutami data-testid.
// Każda oferta w kolejności zawiera: geo -> name -> category -> duration-date
// -> duration-day -> transport -> services -> tour-operator -> ocena -> price.
//
// Dzielimy dokument na bloki ofert wg pozycji "offer-listing-geo"
// (geo jest pierwszym polem oferty), a każdy blok kończy się tam,
// gdzie zaczyna się kolejny (albo na końcu dokumentu).

/** Usuwa tagi HTML i dekoduje podstawowe encje. */
function stripHtml(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, "")).trim();
}

function decodeEntities(s) {
  return s
    .replace(/<!--.*?-->/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&oacute;/g, "ó")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Wyciąga tekstową zawartość elementu o danym data-testid z fragmentu HTML. */
function extractTestId(block, testid) {
  const re = new RegExp(
    `data-testid="${testid}"[^>]*>([\\s\\S]*?)</`,
    "i"
  );
  const m = block.match(re);
  return m ? stripHtml(m[1]) : "";
}

/** Cena: pierwsze wystąpienie liczby przed "zł" w bloku ceny. */
function extractPrice(block) {
  // Blok ceny zawiera np. "od </span>11 238<!-- --> <!-- -->zł"
  const priceBlockRe =
    /data-testid="offer-listing-section-price"[\s\S]*?<\/h4>/i;
  const pm = block.match(priceBlockRe);
  const scope = pm ? pm[0] : block;
  const cleaned = stripHtml(scope);
  // Szukamy liczby (z możliwymi spacjami/nbsp jako separatorem tysięcy) przed "zł"
  const m = cleaned.match(/([\d\s\u00a0]+)\s*zł/);
  if (!m) return null;
  const digits = m[1].replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : null;
}

/** Liczba gwiazdek z atrybutu title/aria-label kategorii. */
function extractStars(block) {
  // title może stać przed lub po data-testid, więc szukamy w całym tagu kategorii.
  const tagM = block.match(/<[^>]*data-testid="offer-listing-category"[^>]*>/i);
  const tag = tagM ? tagM[0] : "";
  const m = tag.match(/(?:title|aria-label)="([^"]*)"/i);
  const label = m ? m[1] : "";
  const map = {
    "jednogwiazdkowy": 1,
    "dwugwiazdkowy": 2,
    "trzygwiazdkowy": 3,
    "czterogwiazdkowy": 4,
    "pięciogwiazdkowy": 5,
  };
  for (const [k, v] of Object.entries(map)) {
    if (label.toLowerCase().includes(k)) return v;
  }
  return null;
}

/** Ocena liczbowa (np. 8.5). */
function extractRating(block) {
  const v = extractTestId(block, "RateBox-Paragraph");
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Liczba opinii. */
function extractOpinions(block) {
  const v = extractTestId(block, "OpinionsCount-Paragraph");
  const m = v.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** Link do szczegółów oferty (jeśli obecny w bloku). */
function extractDetailUrl(block) {
  const m = block.match(/href="(\/oferty\/[^"]+\.html[^"]*)"/i);
  if (!m) return null;
  return "https://www.wakacje.pl" + m[1];
}

/**
 * Buduje stabilny klucz oferty: hotel + termin + wylot.
 * Odporny na kolejność miast wylotu i drobne różnice w spacjach.
 */
export function makeOfferKey({ hotel, dateRange, departure }) {
  const norm = (s) =>
    (s || "")
      .toLowerCase()
      // polskie znaki, których NFD nie rozkłada (ł) i dla pewności pozostałe
      .replace(/ł/g, "l")
      .replace(/ą/g, "a")
      .replace(/ć/g, "c")
      .replace(/ę/g, "e")
      .replace(/ń/g, "n")
      .replace(/ó/g, "o")
      .replace(/ś/g, "s")
      .replace(/ż/g, "z")
      .replace(/ź/g, "z")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const dep = norm(departure).split("-").filter(Boolean).sort().join("-");
  return [norm(hotel), norm(dateRange), dep].join("__");
}

/**
 * Parsuje pełny HTML strony listingu i zwraca tablicę ofert.
 */
export function parseOffers(html) {
  // Pozycje początków bloków ofert (geo jest pierwszym polem).
  const geoRe = /data-testid="offer-listing-geo"/gi;
  const starts = [];
  let m;
  while ((m = geoRe.exec(html)) !== null) {
    starts.push(m.index);
  }
  if (starts.length === 0) return [];

  const offers = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : html.length;
    const block = html.slice(start, end);

    const geo = extractTestId(block, "offer-listing-geo");
    const hotel = extractTestId(block, "offer-listing-name");
    const dateRange = extractTestId(block, "offer-listing-duration-date");
    const duration = extractTestId(block, "offer-listing-duration-day");
    const departure = extractTestId(block, "offer-listing-transport-plane");
    const board = extractTestId(block, "offer-listing-services");
    const operator = extractTestId(block, "offer-listing-tour-operator");
    const price = extractPrice(block);
    const stars = extractStars(block);
    const rating = extractRating(block);
    const opinions = extractOpinions(block);
    const detailUrl = extractDetailUrl(block);

    // Pomijamy bloki bez nazwy lub ceny (śmieci / niepełne).
    if (!hotel || price == null) continue;

    const key = makeOfferKey({ hotel, dateRange, departure });

    offers.push({
      key,
      hotel,
      region: geo,
      dateRange,
      duration,
      departure,
      board,
      operator,
      stars,
      rating,
      opinions,
      price,
      currency: "PLN",
      detailUrl,
    });
  }

  return offers;
}

export default { parseOffers, makeOfferKey };
