// Pobieranie i wybór wariantów wylotu dla oferty.
//
// Endpoint (bez autoryzacji): POST /v2/api/getCalculatorOfferVariants/{offerId}
// Bez departureCityId zwraca warianty ze WSZYSTKICH lotnisk (każdy pokój/wylot
// z osobną ceną, lotniskiem i godzinami tam/powrót).
//
// Strategia: śledzimy najtańszy DOSTĘPNY wariant. Dostępność potwierdzamy
// (opcjonalnie) przez checkOfferAvailability. Jeśli najtańszy jest niedostępny,
// bierzemy kolejny najtańszy.

import { USER_AGENT } from "./config.js";

const VARIANTS_URL = (offerId) =>
  `https://www.wakacje.pl/v2/api/getCalculatorOfferVariants/${offerId}`;

const AVAIL_URL = "https://www.wakacje.pl/v2/api/checkOfferAvailability";

const API_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "pl-PL,pl;q=0.9",
  "User-Agent": USER_AGENT,
  Origin: "https://www.wakacje.pl",
};

const TIMEOUT_MS = 20000;

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
  const res = await fetch(url, {
    method: "POST",
    headers: API_HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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
    const res = await fetch(`${AVAIL_URL}?${params.toString()}`, {
      headers: { ...API_HEADERS, "Content-Type": undefined },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.availability === true;
  } catch {
    return null;
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
  for (const v of variants) {
    const avail = await checkAvailability(offer, v);
    if (avail === false) {
      soldOutCheaper.push(v);
      continue;
    }
    // true lub null (nie potwierdzono) => bierzemy jako wybrany.
    return { chosen: v, variants, soldOutCheaper };
  }
  // Wszystkie potwierdzone jako niedostępne — zwróć najtańszy mimo to.
  return { chosen: variants[0], variants, soldOutCheaper };
}

export default { fetchVariants, checkAvailability, pickCheapestAvailable };
