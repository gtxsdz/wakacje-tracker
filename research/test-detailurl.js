// Test fallbacku buildDetailUrl — sprawdza URL dla ofert bez place/urlName.
// Uruchomienie: node research/test-detailurl.js
import assert from "node:assert";

// --- kopia logiki z scrape.js (izolowany test) ---
function urlSlug(s) {
  return (s || "").toString().toLowerCase()
    .replace(/ł/g, "l").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
const AIRPORT_SLUG = { KTW: "katowic", WAW: "warszawy", WRO: "wroclawia", POZ: "poznania", LCJ: "lodzi" };
const serviceSlug = (id) => (id === 1 ? "all-inclusive" : null);
const SEARCH_QUERY = { rooms: [{ adult: 2, kid: 2, ages: ["20091119", "20150707"] }] };

function buildDetailUrl(offer, chosen) {
  if (!offer.offerId) return null;
  const p = offer.place;
  let base = null;
  if (p && offer.urlName && p.country?.urlName && p.region?.urlName && p.city?.urlName) {
    base = `https://www.wakacje.pl/oferty/${p.country.urlName}/${p.region.urlName}/${p.city.urlName}/${offer.urlName}-${offer.offerId}.html`;
  } else {
    const regionName = (offer.region || "").split("/").pop().trim();
    const regionSlug = urlSlug(regionName);
    const nameSlug = urlSlug(offer.hotel);
    if (!regionSlug || !nameSlug) return null;
    base = `https://www.wakacje.pl/oferty/egipt/${regionSlug}/${nameSlug}-${offer.offerId}.html`;
  }
  const url = base;
  const parts = [];
  if (offer.departureDate) parts.push(`od-${offer.departureDate}`);
  if (offer.duration) parts.push(`${offer.duration}-dni`);
  const svc = serviceSlug(offer.service);
  if (svc) parts.push(svc);
  const airport = chosen?.departureCode || chosen?.outbound?.from?.airportCode;
  const slug = airport ? AIRPORT_SLUG[airport] : null;
  if (slug) parts.push(`z-${slug}`);
  const room = SEARCH_QUERY.rooms && SEARCH_QUERY.rooms[0];
  if (room) {
    const adults = room.adult || 0, kids = room.kid || 0;
    const ages = Array.isArray(room.ages) ? room.ages.join("-") : "";
    let comp = `${adults}doros${adults === 1 ? "ly" : "le"}`;
    if (kids > 0) comp += `-${kids}dzie${kids === 1 ? "cko" : "ci"}`;
    if (ages) comp += `-${ages}`;
    parts.push(comp);
  }
  return parts.length ? `${url}?${parts.join(",")}` : url;
}

let passed = 0;
const ok = (n) => { console.log(`  ✓ ${n}`); passed++; };

// 1) Fallback: Charmillion (bez place/urlName) — powinien zbudować URL z regionu+nazwy.
{
  const offer = { offerId: 1166531, hotel: "Charmillion Club Aqua Park", region: "Egipt / Sharm el Sheikh", departureDate: "2026-09-29", duration: 7, service: 1, place: null, urlName: null };
  const url = buildDetailUrl(offer, { departureCode: "KTW" });
  assert.ok(url, "URL nie może być null");
  assert.ok(url.includes("/oferty/egipt/sharm-el-sheikh/charmillion-club-aqua-park-1166531.html"), "poprawna ścieżka fallback");
  assert.ok(url.includes("od-2026-09-29") && url.includes("z-katowic"), "parametry filtra dołączone");
  console.log("    " + url);
  ok("Fallback bez place => URL z regionu i nazwy + parametry");
}

// 2) Pełna ścieżka: gdy API dało place/urlName — używamy jej (nie fallbacku).
{
  const offer = { offerId: 1166489, hotel: "Gravity Hotel", region: "Egipt / Hurghada", departureDate: "2026-09-28", duration: 7, service: 1,
    urlName: "gravity-hotel-aquapark-hurghada-ex-samra-bay-resort",
    place: { country: { urlName: "egipt" }, region: { urlName: "hurghada" }, city: { urlName: "hurghada" } } };
  const url = buildDetailUrl(offer, { departureCode: "KTW" });
  assert.ok(url.includes("/oferty/egipt/hurghada/hurghada/gravity-hotel-aquapark-hurghada-ex-samra-bay-resort-1166489.html"), "pełna ścieżka z API");
  ok("Pełna ścieżka gdy API dało place/urlName");
}

// 3) Fantazia Resort (Hurghada, bez place) — inny region.
{
  const offer = { offerId: 254865, hotel: "Fantazia Resort", region: "Egipt / Hurghada", departureDate: "2026-09-29", duration: 7, service: 1, place: null, urlName: null };
  const url = buildDetailUrl(offer, { departureCode: "WAW" });
  assert.ok(url.includes("/oferty/egipt/hurghada/fantazia-resort-254865.html"), "fallback dla Hurghady");
  console.log("    " + url);
  ok("Fallback Fantazia Resort (Hurghada)");
}

// 4) Brak offerId => null (nie da się zbudować).
{
  assert.strictEqual(buildDetailUrl({ offerId: null, hotel: "X", region: "Egipt / Hurghada" }, {}), null);
  ok("Brak offerId => null");
}

console.log(`\nWszystkie ${passed} testy przeszły ✅`);
