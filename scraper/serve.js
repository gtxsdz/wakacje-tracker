// Minimalny lokalny serwer statyczny do podglądu frontendu.
// Uruchomienie: node scraper/serve.js  (potem http://localhost:8080)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = process.env.PORT || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(ROOT, urlPath);

  // Ochrona przed path traversal. NIE używamy startsWith(ROOT), bo przepuszcza
  // katalog-sąsiada o wspólnym prefiksie (np. ../wakacje-tracker-2-x). Liczy się
  // ścieżka relatywna do ROOT — każda wychodząca poza ROOT zaczyna się od "..".
  const rel = path.relative(ROOT, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Nie znaleziono: " + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

// Domyślnie tylko lokalnie (127.0.0.1). Gdy potrzebujesz podglądu z telefonu
// w tej samej sieci, uruchom z HOST=0.0.0.0 — świadomie, bo to odsłania pliki
// projektu na LAN.
const HOST = process.env.HOST || "127.0.0.1";

server.listen(PORT, HOST, () => {
  console.log(`Podgląd: http://localhost:${PORT} (bind ${HOST})`);
});
