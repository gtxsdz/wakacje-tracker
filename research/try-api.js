// Test: czy endpoint getCalculatorOfferVariants da się wołać bez przeglądarki.
const url = "https://www.wakacje.pl/v2/api/getCalculatorOfferVariants/1166489";
const payload = {
  adults: 2,
  kids: 2,
  serviceId: 1,
  infants: 0,
  duration: 7,
  kidsAges: ["20091119", "20150707"],
  departureDate: "2026-09-28",
  transportId: 1,
  departureCityId: 2622,
  departureCityCode: "KTW",
  hotelId: 32171,
  tourOp: "JOIP",
  tourId: 11485,
  cruiseId: 0,
  roundTripId: 0,
  isAlternativeRoom: false,
  isOffer77: false,
};

const variants = [
  {
    name: "minimalny (tylko Content-Type + UA)",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  },
  {
    name: "pełne nagłówki przeglądarki",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "pl-PL,pl;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Origin: "https://www.wakacje.pl",
      Referer:
        "https://www.wakacje.pl/oferty/egipt/hurghada/hurghada/gravity-hotel-aquapark-hurghada-ex-samra-bay-resort-1166489.html",
      "X-Requested-With": "XMLHttpRequest",
    },
  },
];

for (const v of variants) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: v.headers,
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let n = "?";
    try {
      n = JSON.parse(text)?.data?.offers?.length ?? "brak offers";
    } catch {}
    console.log(
      `[${v.name}] status=${res.status} len=${text.length} offers=${n}`
    );
    if (res.status !== 200) console.log("  body:", text.slice(0, 200));
  } catch (e) {
    console.log(`[${v.name}] ERROR ${e.message}`);
  }
}
