// Transport HTTP oparty na curl.
//
// DLACZEGO curl, a nie wbudowany fetch: wakacje.pl (Akamai WAF) rozpoznaje i
// blokuje (HTTP 449) połączenia po odcisku TLS/HTTP klienta. Node `fetch`
// (undici) ma charakterystyczny fingerprint, który bywa flagowany — zwłaszcza
// na Linuksie. curl przechodzi jak normalny klient (zwraca 200). curl jest
// dostępny standardowo na Linuksie/macOS, a na Windows od dawna w systemie.
//
// Moduł udostępnia getText (GET) i postJson (POST JSON) zwracające
// { status, body }. Kod wywołujący sam interpretuje status.

import { spawn } from "node:child_process";
import { USER_AGENT } from "./config.js";

const DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "pl-PL,pl;q=0.9",
};

const CURL_TIMEOUT_S = 30;

/** Uruchamia curl i zwraca { status, body }. */
function runCurl(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", args, { windowsHide: true });
    let out = Buffer.alloc(0);
    let err = "";
    child.stdout.on("data", (d) => (out = Buffer.concat([out, d])));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => reject(new Error(`curl niedostępny: ${e.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`curl zakończył się kodem ${code}${err ? `: ${err.trim()}` : ""}`));
      }
      const text = out.toString("utf8");
      // Ostatnia linia to kod HTTP (dopisany przez -w "%{http_code}").
      const nl = text.lastIndexOf("\n");
      const status = parseInt(text.slice(nl + 1).trim(), 10);
      const body = nl >= 0 ? text.slice(0, nl) : text;
      resolve({ status: Number.isFinite(status) ? status : 0, body });
    });
  });
}

function headerArgs(headers) {
  const merged = { ...DEFAULT_HEADERS, ...headers };
  const args = [];
  for (const [k, v] of Object.entries(merged)) {
    if (v == null) continue;
    args.push("-H", `${k}: ${v}`);
  }
  return args;
}

const baseArgs = () => [
  "-sS", // cicho, ale pokazuj błędy
  "--compressed", // obsłuż gzip/br
  "-L", // podążaj za przekierowaniami
  "--max-time", String(CURL_TIMEOUT_S),
  "-w", "\n%{http_code}", // dopisz kod HTTP w nowej linii na końcu
];

/** GET zwracający { status, body } (tekst). */
export async function getText(url, headers = {}) {
  const args = [...baseArgs(), ...headerArgs(headers), url];
  return runCurl(args);
}

/** POST JSON zwracający { status, body } (tekst). */
export async function postJson(url, payload, headers = {}) {
  const args = [
    ...baseArgs(),
    "-X", "POST",
    ...headerArgs({ "Content-Type": "application/json", Accept: "application/json, text/plain, */*", ...headers }),
    "--data-binary", JSON.stringify(payload),
    url,
  ];
  return runCurl(args);
}

export default { getText, postJson };
