#!/usr/bin/env bash
# PatchPlaner ohne Docker auf Debian/Ubuntu installieren oder aktualisieren.
# Aufruf aus dem entpackten Ordner:  sudo bash deploy/install.sh
set -euo pipefail

APP_DIR=/opt/patchplaner
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then echo "Bitte mit sudo ausführen."; exit 1; fi

need_node() {
  if ! command -v node >/dev/null 2>&1; then return 0; fi
  local v; v=$(node -p 'process.versions.node')
  local maj=${v%%.*}; local rest=${v#*.}; local min=${rest%%.*}
  if [ "$maj" -lt 22 ] || { [ "$maj" -eq 22 ] && [ "$min" -lt 13 ]; }; then return 0; fi
  return 1
}

if need_node; then
  echo "→ Installiere Node.js 22 (NodeSource) …"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "→ Node $(node -v)"

echo "→ Installiere poppler-utils für PDF-Grundrisse …"
apt-get install -y poppler-utils || echo "  (übersprungen – PDFs werden dann im Browser umgewandelt)"

id patchplaner >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin patchplaner

echo "→ Kopiere Dateien nach $APP_DIR …"
mkdir -p "$APP_DIR"
# Daten und .env bleiben bei Updates erhalten
tar -C "$SRC_DIR" --exclude=./data --exclude=./.env -cf - . | tar -C "$APP_DIR" -xf -
mkdir -p "$APP_DIR/data"
if [ ! -f "$APP_DIR/.env" ]; then cp "$APP_DIR/.env.example" "$APP_DIR/.env"; echo "  .env angelegt – bitte BASE_URL und ggf. SMTP eintragen."; fi
chown -R patchplaner:patchplaner "$APP_DIR"

echo "→ Richte systemd-Dienst ein …"
cp "$APP_DIR/deploy/patchplaner.service" /etc/systemd/system/patchplaner.service
systemctl daemon-reload
systemctl enable patchplaner >/dev/null
systemctl restart patchplaner
sleep 1
systemctl --no-pager --lines=5 status patchplaner || true

PORT=$(grep -E '^PORT=' "$APP_DIR/.env" | cut -d= -f2); PORT=${PORT:-8080}
echo
echo "Fertig. PatchPlaner läuft auf http://127.0.0.1:${PORT}"
echo "Das erste Konto, das du anlegst, wird Admin."
echo "Logs:   journalctl -u patchplaner -f"
echo "Backup: sudo -u patchplaner node $APP_DIR/server.js backup /pfad/zur/sicherung.db"
