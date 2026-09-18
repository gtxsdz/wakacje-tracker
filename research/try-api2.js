// Test 2: rekonstrukcja wywołania API wyłącznie z danych listingu +
// sprawdzenie różnych miast wylotu i mapowania kodu miasta.
// Dane z listingu dla oferty Gravity: hotelId 32171, offerId 1166489,
// tourOperator 11485, offerHash "JOIP:...", departureDate 2026-09-28, duration 7.

const offerId = 1166489;
const url = `https://www.wakacje.pl/v2/api/getCalculatorOfferVariants/${offerId}`;

const base = {
  adults: 2,
  kids: 2,
  serviceId: 1,
  infants: 0,
  duration: 7,
  kidsAges: ["20091119", "20150707"],
  departureDate: "2026-09-28",
  transportId: 1,
  hotelId: 32171,
  tourOp: "JOIP",
  tourId: 11485,
  cruiseId: 0,
  roundTripId: 0,
  isAlternativeRoom: false,
  isOffer77: false,
};

const headers = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

async function call(label, extra) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...base, ...extra }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let offers = [];
    try {
      offers = JSON.parse(text)?.data?.offers ?? [];
    } catch {}
    console.log(`\n[${label}] status=${res.status} offers=${offers.length}`);
    for (const o of offers.slice(0, 3)) {
      console.log(
        `   ${o.totalPrice} ${o.priceCurrency} | ${o.roomDesc} | ${o.departStart?.airportCode}->${o.departEnd?.airportCode} ${o.departStart?.customDate} ${o.departStart?.time}`
      );
    }
  } catch (e) {
    console.log(`[${label}] ERROR ${e.message}`);
  }
}

// A. Bez podania miasta (czy zwróci coś domyślnie?)
await call("bez miasta", {});
// B. Katowice (code+id znane z przechwyconego payloadu)
await call("KTW id2622", { departureCityCode: "KTW", departureCityId: 2622 });
// C. Tylko kod, bez id
await call("KTW bez id", { departureCityCode: "KTW" });
// D. Inne miasto - Warszawa (nie znamy id; test samego kodu WAW)
await call("WAW bez id", { departureCityCode: "WAW" });
