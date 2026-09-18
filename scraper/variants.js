// Pobieranie i wybór wariantów wylotu dla oferty.
//
// Endpoint (bez autoryzacji): POST /v2/api/getCalculatorOfferVariants/{offerId}
// Bez departureCityId zwraca warianty ze WSZYSTKICH lotnisk (każdy pokój/wylot
// z osobną ceną, lotniskiem i godzinami tam/powrót).
//
// Strategia: śledzimy najtańszy DOSTĘPNY wariant. Dostępność potwierdzamy
// (opcjonalnie) przez checkOfferAvailability. Jeśli najtańszy jest niedostępny,
// bierzemy kolejny najtańszy.

import { getText, postJson as curlPostJson } from "./http.js";

const VARIANTS_URL = (offerId) =>
  `https://www.wakacje.pl/v2/api/getCalculatorOfferVariants/${offerId}`;

const AVAIL_URL = "https://www.wakacje.pl/v2/api/checkOfferAvailability";

const API_HEADERS = {
  Origin: "https://www.wakacje.pl",
  Referer: "https://www.wakacje.pl/",
};

// Bezpieczniki chroniące przed blokadą / nadmiernym ruchem.
const MAX_AVAILABILITY_CHECKS = 3; // ile wariantów sprawdzamy per oferta
const AVAIL_DELAY_MS = 600; // odstęp między zapytaniami o dostępność
const BLOCK_STATUSES = [429, 449, 503]; // sygnały throttlingu/blokady

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Błąd sygnalizujący blokadę serwisu — scraper powinien się wycofać. */
export class BlockedError extends Error {
  constructor(status) {
    super(`Serwis odpowiada blokadą/throttlingiem (HTTP ${status}).`);
    this.name = "BlockedError";
    this.status = status;
  }
}

/** Skraca węzeł lotu do prostej postaci. */
function flightNode(n) {
  if (!n) return null;
  return {
    airportCode: n.airportCode || n.airportIATACode || "",
    airportName: n.airportName || n.name || "",
    city: n.name || "",
    date: n.date || "",
    customDate: n.customDate || "",
    time: n.time || "",
  };
}

/** Normalizuje pojedynczy wariant z odpowiedzi API. */
function normalizeVariant(v) {
  return {
    id: v.id || null, // offerHash danego wariantu
    uid: v.uid || null,
    price: v.totalPrice ?? v.basePrice ?? null,
    currency: v.priceCurrency || "PLN",
    room: v.roomDesc || "",
    roomExtra: Array.isArray(v.roomDescAdditional) ? v.roomDescAdditional : [],
    service: v.serviceDesc || "",
    departureCode: v.departureCode || "",
    luggageIncluded: !!v.isLuggageIncluded,
    carrier: v.departStart?.carrierCode || "",
    outbound: {
      from: flightNode(v.departStart),
      to: flightNode(v.departEnd),
    },
    inbound: {
      from: flightNode(v.returnStart),
      to: flightNode(v.returnEnd),
    },
  };
}

async function postJson(url, body) {
  const { status, body: text } = await curlPostJson(url, body, API_HEADERS);
  if (BLOCK_STATUSES.includes(status)) throw new BlockedError(status);
  if (status !== 200) throw new Error(`HTTP ${status}`);
  return JSON.parse(text);
}

/**
 * Pobiera wszystkie warianty oferty i zwraca je znormalizowane,
 * posortowane rosnąco po cenie.
 */
export async function fetchVariants(offer) {
  const json = await postJson(VARIANTS_URL(offer.offerId), offer.variantParams);
  const list = json?.data?.offers;
  if (!Array.isArray(list)) return [];
  return list
    .map(normalizeVariant)
    .filter((v) => v.price != null)
    .sort((a, b) => a.price - b.price);
}

/**
 * Sprawdza dostępność wariantu (po jego offerHash / id).
 * Zwraca true/false/null (null = nie udało się sprawdzić).
 */
export async function checkAvailability(offer, variant) {
  if (!variant?.id || !offer?.providerCode) return null;
  const place = offer.place || {};
  const params = new URLSearchParams({
    providerCode: offer.providerCode,
    offerHash: variant.id,
    offerType: "tour",
    includeTfgService: "true",
    isAlternativeRoom: "false",
    cityId: String(place?.city?.id ?? ""),
    countryId: String(place?.country?.id ?? ""),
    regionId: String(place?.region?.id ?? ""),
  });
  // Uczestnicy: 2 dorosłych + 2 dzieci (zgodnie z filtrem).
  const participants = [
    ["1", "1988-01-01", "adult"],
    ["2", "1988-01-01", "adult"],
    ["3", "2009-11-19", "child"],
    ["4", "2015-07-07", "child"],
  ];
  participants.forEach((p, i) => {
    params.append(`participantsObject[participants][${i}][userAllocateId]`, p[0]);
    params.append(`participantsObject[participants][${i}][birthDate]`, p[1]);
    params.append(`participantsObject[participants][${i}][type]`, p[2]);
  });

  try {
    const { status, body } = await getText(
      `${AVAIL_URL}?${params.toString()}`,
      { Accept: "application/json, text/plain, */*", Referer: "https://www.wakacje.pl/" }
    );
    // Blokada/throttling — przerywamy, żeby nie eskalować ruchu.
    if (BLOCK_STATUSES.includes(status)) throw new BlockedError(status);
    if (status !== 200) return null;
    const json = JSON.parse(body);
    return json?.data?.availability === true;
  } catch (e) {
    if (e instanceof BlockedError) throw e; // propaguj blokadę wyżej
    return null; // inne błędy (timeout itp.) traktujemy jako "nie wiadomo"
  }
}

/**
 * Zwraca najtańszy DOSTĘPNY wariant oraz informację o wariantach niedostępnych,
 * które były tańsze (żeby móc odnotować "wyprzedane").
 *
 * verifyAvailability=false => ufamy, że warianty z listy są dostępne
 * (getCalculatorOfferVariants zwraca aktualnie sprzedawane).
 */
export async function pickCheapestAvailable(offer, { verifyAvailability = false } = {}) {
  const variants = await fetchVariants(offer);
  if (variants.length === 0) {
    return { chosen: null, variants: [], soldOutCheaper: [] };
  }

  if (!verifyAvailability) {
    return { chosen: variants[0], variants, soldOutCheaper: [] };
  }

  const soldOutCheaper = [];
  // Sprawdzamy dostępność od najtańszego, ale najwyżej MAX_AVAILABILITY_CHECKS
  // razy per oferta (bezpiecznik przed lawiną zapytań przy wielu wariantach).
  const limit = Math.min(variants.length, MAX_AVAILABILITY_CHECKS);
  for (let i = 0; i < limit; i++) {
    const v = variants[i];
    if (i > 0) await sleep(AVAIL_DELAY_MS); // odstęp między zapytaniami
    const avail = await checkAvailability(offer, v); // może rzucić BlockedError
    if (avail === false) {
      soldOutCheaper.push(v);
      continue;
    }
    // true lub null (nie potwierdzono) => bierzemy jako wybrany.
    return { chosen: v, variants, soldOutCheaper, verified: true };
  }
  // W ramach limitu nie znaleziono dostępnego — bierzemy najtańszy mimo to.
  return { chosen: variants[0], variants, soldOutCheaper, verified: true };
}

export default { fetchVariants, checkAvailability, pickCheapestAvailable, BlockedError };
