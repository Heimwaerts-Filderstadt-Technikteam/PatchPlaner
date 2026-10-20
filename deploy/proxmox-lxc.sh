#!/usr/bin/env bash
# PatchPlaner auf Proxmox VE in einem schlanken LXC-Container installieren oder aktualisieren.
# Auf dem Proxmox-Host als root ausführen.
#
#   Neu installieren:   bash proxmox-lxc.sh install /root/PatchPlaner.zip
#   Aktualisieren:      bash proxmox-lxc.sh update 120 /root/PatchPlaner.zip
#
# Anpassbar über Umgebungsvariablen (Standardwerte in Klammern):
#   CTID (nächste freie ID)  HOSTNAME (patchplaner)  STORAGE (local-lvm)  TPL_STORAGE (local)
#   BRIDGE (vmbr0)  IP (dhcp oder z. B. 192.168.1.50/24,gw=192.168.1.1)
#   DISK in GB (3)  RAM in MB (384)  SWAP in MB (256)  CORES (1)  PORT (8080)
set -euo pipefail

MODE=${1:-}
if [ "$MODE" = "install" ]; then SRC=${2:-}; elif [ "$MODE" = "update" ]; then CTID=${2:-}; SRC=${3:-}; fi
if [ -z "$MODE" ] || [ -z "${SRC:-}" ] || { [ "$MODE" = "update" ] && [ -z "${CTID:-}" ]; }; then
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 1
fi
command -v pct >/dev/null || { echo "Das hier bitte auf dem Proxmox-Host ausführen."; exit 1; }
[ -e "$SRC" ] || { echo "Quelle nicht gefunden: $SRC"; exit 1; }

HOSTNAME=${HOSTNAME_CT:-patchplaner}
STORAGE=${STORAGE:-local-lvm}
TPL_STORAGE=${TPL_STORAGE:-local}
BRIDGE=${BRIDGE:-vmbr0}
IP=${IP:-dhcp}
DISK=${DISK:-3}
RAM=${RAM:-384}
SWAP=${SWAP:-256}
CORES=${CORES:-1}
PORT=${PORT:-8080}

# Quelle (ZIP oder Ordner) als tar vorbereiten
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
if [ -d "$SRC" ]; then SRCDIR="$SRC"
else
  command -v unzip >/dev/null || apt-get install -y unzip >/dev/null
  unzip -q "$SRC" -d "$WORK/src"
  SRCDIR=$(dirname "$(find "$WORK/src" -maxdepth 3 -name server.js | head -1)")
fi
[ -f "$SRCDIR/server.js" ] || { echo "In der Quelle fehlt server.js."; exit 1; }
tar -C "$SRCDIR" --exclude=./data --exclude=./.env --exclude=./.git -czf "$WORK/app.tgz" .

wait_net() {
  echo "→ Warte auf Netzwerk im Container …"
  for _ in $(seq 1 40); do pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1 && return 0; sleep 2; done
  echo "Der Container hat kein Netzwerk. Prüfe Bridge/IP (BRIDGE=$BRIDGE, IP=$IP)."; exit 1
}

if [ "$MODE" = "install" ]; then
  CTID=${CTID:-$(pvesh get /cluster/nextid)}
  echo "→ Lade Debian-12-Vorlage …"
  pveam update >/dev/null
  TPL=$(pveam available --section system | awk '/debian-12-standard/ {print $2}' | sort -V | tail -1)
  pveam list "$TPL_STORAGE" | grep -q "$TPL" || pveam download "$TPL_STORAGE" "$TPL"

  echo "→ Lege Container $CTID an ($CORES Kern, $RAM MB RAM, $DISK GB Disk) …"
  pct create "$CTID" "$TPL_STORAGE:vztmpl/$TPL" \
    --hostname "$HOSTNAME" --cores "$CORES" --memory "$RAM" --swap "$SWAP" \
    --rootfs "$STORAGE:$DISK" --net0 "name=eth0,bridge=$BRIDGE,ip=$IP" \
    --unprivileged 1 --features nesting=1 --onboot 1 --start 1 \
    --description "PatchPlaner – AV-Planung"
  wait_net

  echo "→ Entschlacke das System …"
  pct exec "$CTID" -- bash -c '
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get purge -y -qq postfix >/dev/null 2>&1 || true
    apt-get -y -qq upgrade
    # Journal klein halten
    mkdir -p /etc/systemd/journald.conf.d
    printf "[Journal]\nSystemMaxUse=30M\n" > /etc/systemd/journald.conf.d/size.conf
    # Keine Handbücher und Übersetzungen mehr installieren
    printf "path-exclude /usr/share/doc/*\npath-exclude /usr/share/man/*\npath-exclude /usr/share/locale/*\npath-include /usr/share/locale/de*\n" > /etc/dpkg/dpkg.cfg.d/01-slim
    rm -rf /usr/share/doc/* /usr/share/man/*
    systemctl restart systemd-journald'
else
  pct status "$CTID" | grep -q running || pct start "$CTID"
  wait_net
fi

echo "→ Kopiere PatchPlaner in den Container …"
pct push "$CTID" "$WORK/app.tgz" /root/patchplaner.tgz
pct exec "$CTID" -- bash -c "
  set -e
  rm -rf /root/patchplaner-src && mkdir -p /root/patchplaner-src
  tar -C /root/patchplaner-src -xzf /root/patchplaner.tgz
  bash /root/patchplaner-src/deploy/install.sh
  # Im Container von außen erreichbar machen (Reverse Proxy im LAN)
  sed -i 's/^HOST=.*/HOST=0.0.0.0/; s/^PORT=.*/PORT=$PORT/' /opt/patchplaner/.env
  systemctl restart patchplaner
  rm -rf /root/patchplaner-src /root/patchplaner.tgz
  apt-get -y -qq autoremove --purge >/dev/null; apt-get clean; rm -rf /var/lib/apt/lists/*
"

CTIP=$(pct exec "$CTID" -- hostname -I | awk '{print $1}')
echo
echo "Fertig. PatchPlaner läuft in Container $CTID: http://$CTIP:$PORT"
echo "Speicher belegt: $(pct exec "$CTID" -- df -h / | awk 'NR==2 {print $3 " von " $2}')"
echo "RAM in Benutzung: $(pct exec "$CTID" -- free -m | awk '/Mem:/ {print $3 " MB"}')"
[ "$MODE" = "install" ] && echo "Das erste Konto, das du anlegst, wird Admin."
