#!/usr/bin/env bash
# Uruchamia scraper i wypycha dane. Do użycia w cron lub systemd na Linuksie.
# Skrypt sam ustala katalog projektu, więc można go wołać z dowolnego miejsca.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# Upewnij się, że node jest w PATH (cron ma minimalny PATH).
if ! command -v node >/dev/null 2>&1; then
  echo "Nie znaleziono node w PATH. Ustaw PATH w crontab albo użyj pełnej ścieżki." >&2
  exit 1
fi

node scraper/push.js
