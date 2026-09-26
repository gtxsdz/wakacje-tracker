// Parser listingu wakacje.pl.
//
// Parser i normalizator obiektów ofert wakacje.pl.
//
// Uwaga: dawniej oferty były parsowane bezpośrednio z HTML (metodami extractRawOffers / scanBalanced).
// Obecnie listing.js pobiera oferty bezpośrednio z JSON Search API wakacje.pl,
// a parse.js odpowiada za ich normalizację (normalizeOffer) i generowanie kluczy (makeOfferKey).

/** Kod dostawcy z offerHash, np. "JOIP:188808" -> "JOIP". */
function providerFromHash(offerHash) {
  if (!offerHash || typeof offerHash !== "string") return null;
  const i = offerHash.indexOf(":");
  return i > 0 ? offerHash.slice(0, i) : offerHash;
}

/**
 * Buduje stabilny klucz oferty na podstawie identyfikatorów serwisu.
 * Preferujemy offerId (stabilny), z fallbackiem na hotelId+termin.
 *
 * KLUCZE (Fix 12):
 * - normalizeOffer generuje klucz początkowy `offer-{offerId}` (per wariant/operator).
 * - scrape.js (funkcja collapseByHotel) konsoliduje oferty per hotel i zamienia klucz
 *   na `hotel-{hotelId}` — dzięki temu historia cen hotelu jest ciągła, nawet gdy
 *   najtańszy operator zmienia się w czasie (np. Coral -> Itaka).
 * - Klucz `hotel-{hotelId}` jest zapisywany w history.json.
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

export default { normalizeOffer, makeOfferKey };
