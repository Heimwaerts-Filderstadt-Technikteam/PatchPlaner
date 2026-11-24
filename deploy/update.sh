#!/usr/bin/env bash
# PatchPlaner per Git aktualisieren (im Container bzw. auf dem Server als root ausführen).
#   bash /opt/patchplaner/deploy/update.sh
# Beim ersten Aufruf wird /opt/patchplaner zu einem Git-Checkout gemacht.
# Daten (data/) und Einstellungen (.env) bleiben unberührt – sie stehen in .gitignore.
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/patchplaner}
REPO=${REPO:-https://github.com/Heimwaerts-Filderstadt-Technikteam/PatchPlaner.git}
BRANCH=${BRANCH:-main}

if [ "$(id -u)" -ne 0 ]; then echo "Bitte als root ausführen."; exit 1; fi
command -v git >/dev/null || { echo "→ Installiere git …"; apt-get update -y >/dev/null; apt-get install -y git >/dev/null; }
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
cd "$APP_DIR"

if [ ! -d .git ]; then
  echo "→ Mache $APP_DIR zum Git-Checkout …"
  git init -q
  git remote add origin "$REPO"
fi

OLD=$(git rev-parse --short HEAD 2>/dev/null || echo "-")
echo "→ Hole $BRANCH von GitHub …"
git fetch -q origin "$BRANCH"
# Lokale Änderungen am Programmcode werden verworfen, data/ und .env bleiben
git checkout -q -f -B "$BRANCH" "origin/$BRANCH"
NEW=$(git rev-parse --short HEAD)

chown -R patchplaner:patchplaner "$APP_DIR"
cp "$APP_DIR/deploy/patchplaner.service" /etc/systemd/system/patchplaner.service
systemctl daemon-reload
systemctl restart patchplaner
sleep 1
if systemctl is-active --quiet patchplaner; then
  echo "✓ Aktualisiert ($OLD → $NEW), Dienst läuft."
  git --no-pager log --oneline -5
else
  echo "✗ Dienst startet nicht. Log: journalctl -u patchplaner -n 50"; exit 1
fi
