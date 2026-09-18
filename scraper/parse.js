// Parser listingu wakacje.pl.
//
// Strona osadza w HTML czysty JSON z ofertami (React Query cache):
//   "offers":{"data":[ { ...oferta... }, ... ]}
// Parsujemy tę tablicę zamiast kruchego HTML-a (klasy CSS są hashowane).
// Z każdej oferty wyciągamy pola potrzebne do wywołania API wariantów wylotów.

/**
 * Znajduje i parsuje tablicę ofert osadzoną w HTML.
 * Zwraca surowe obiekty ofert (jak w JSON serwisu) albo [] gdy nie znaleziono.
 */
export function extractRawOffers(html) {
  const marker = '"offers":{"data":[';
  const at = html.indexOf(marker);
  if (at === -1) return [];

  // Początek tablicy = pozycja '[' po markerze.
  const arrStart = at + marker.length - 1; // wskazuje na '['
  const jsonArray = scanBalanced(html, arrStart, "[", "]");
  if (!jsonArray) return [];

  try {
    return JSON.parse(jsonArray);
  } catch {
    return [];
  }
}

/**
 * Skanuje zbalansowany fragment (nawiasy), respektując stringi JSON.
 * Zwraca podłańcuch od openIdx do pasującego domknięcia (włącznie) lub null.
 */
function scanBalanced(str, openIdx, openCh, closeCh) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = openIdx; i < str.length; i++) {
    const ch = str[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return str.slice(openIdx, i + 1);
    }
  }
  return null;
}

/** Kod dostawcy z offerHash, np. "JOIP:188808" -> "JOIP". */
function providerFromHash(offerHash) {
  if (!offerHash || typeof offerHash !== "string") return null;
  const i = offerHash.indexOf(":");
  return i > 0 ? offerHash.slice(0, i) : offerHash;
}

/**
 * Buduje stabilny klucz oferty na podstawie identyfikatorów serwisu.
 * Preferujemy offerId (stabilny), z fallbackiem na hotelId+termin.
 */
export function makeOfferKey(o) {
  if (o.offerId) return `offer-${o.offerId}`;
  const norm = (s) =>
    (s || "")
      .toString()
      .toLowerCase()
      .replace(/ł/g, "l")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return `h${o.hotelId || norm(o.hotel)}-${norm(o.departureDate)}`;
}

/**
 * Normalizuje surową ofertę z listingu do postaci używanej w projekcie.
 * Zwraca też parametry potrzebne do API wariantów (params).
 */
export function normalizeOffer(raw) {
  const offerId = raw.offerId ?? null;
  const hotelId = raw.hotelId ?? null;
  const tourId = raw.tourOperator ?? null; // w listingu tourOperator = tourId
  const providerCode = providerFromHash(raw.offerHash);
  const service = raw.service ?? 1;
  const duration = raw.duration ?? raw.durationNights ?? null;
  const departureDate = raw.departureDate ?? null;

  const offer = {
    offerId,
    hotelId,
    hotel: raw.name ?? "",
    region: raw.placeName ?? "",
    stars: raw.category ?? null,
    rating: raw.ratingValue ?? null,
    opinions: raw.ratingRecommends ?? raw.ratingReservationCount ?? null,
    operator: raw.tourOperatorName ?? "",
    tourId,
    providerCode,
    service,
    serviceDesc: raw.serviceDesc ?? "",
    duration,
    durationNights: raw.durationNights ?? null,
    departureDate,
    returnDate: raw.returnDate ?? null,
    departurePlaces: raw.departurePlaces ?? [],
    cheapestDeparturePlace: raw.departurePlace ?? null,
    listingPrice: raw.price ?? null,
    roomType: raw.roomType ?? "",
    offerHash: raw.offerHash ?? null,
    place: raw.place ?? null,
    urlName: raw.urlName ?? null,
  };
  offer.key = makeOfferKey(offer);

  // Parametry do POST getCalculatorOfferVariants (bez departureCityId ->
  // API zwraca warianty ze wszystkich lotnisk).
  offer.variantParams = {
    adults: 2,
    kids: 2,
    infants: 0,
    kidsAges: ["20091119", "20150707"],
    serviceId: service,
    duration,
    departureDate,
    transportId: 1,
    hotelId,
    tourOp: providerCode,
    tourId,
    cruiseId: 0,
    roundTripId: 0,
    isAlternativeRoom: false,
    isOffer77: false,
  };

  return offer;
}

/** Parsuje listing i zwraca znormalizowane oferty. */
export function parseOffers(html) {
  const raw = extractRawOffers(html);
  return raw
    .filter((o) => o && (o.offerId || o.hotelId))
    .map(normalizeOffer);
}

export default { parseOffers, extractRawOffers, normalizeOffer, makeOfferKey };
