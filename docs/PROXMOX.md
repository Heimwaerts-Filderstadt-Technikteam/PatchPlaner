# PatchPlaner auf Proxmox hosten

PatchPlaner braucht nur Node.js und eine SQLite-Datei. Auf Proxmox ist deshalb ein **unprivilegierter LXC-Container mit Debian 12 ohne Docker** die sparsamste Lösung: kein zweiter Kernel wie bei einer VM, keine Docker-Schicht, kein Datenbankserver.

| | Empfehlung | Warum |
|---|---|---|
| Typ | LXC, unprivilegiert | teilt sich den Kernel mit dem Host, startet in Sekunden |
| System | Debian 12 Standard-Vorlage | Node 22 von NodeSource läuft dort zuverlässig |
| CPU | 1 Kern | PatchPlaner rechnet fast alles im Browser |
| RAM | 384 MB, 256 MB Swap | Leerlauf rund 60–90 MB, unter Last selten über 150 MB |
| Disk | 3 GB | System + Node ≈ 0,8 GB; der Rest für Datenbank und Grundrisse |
| Docker | nein | spart RAM und Plattenplatz, vermeidet Nesting-Probleme |

Auf LVM-Thin oder ZFS ist die Disk dünn bereitgestellt: Belegt wird nur, was wirklich geschrieben ist. Die 3 GB sind also eine Obergrenze, kein toter Platz.

## Variante A: automatisch mit dem Skript (empfohlen)

Auf dem Proxmox-Host als root:

```bash
# PatchPlaner.zip auf den Host kopieren, z. B. per scp nach /root/
unzip -p /root/PatchPlaner.zip patchplaner/deploy/proxmox-lxc.sh > /root/proxmox-lxc.sh
bash /root/proxmox-lxc.sh install /root/PatchPlaner.zip
```

Mit fester IP oder anderem Speicher:

```bash
IP=192.168.1.50/24,gw=192.168.1.1 STORAGE=local-zfs bash /root/proxmox-lxc.sh install /root/PatchPlaner.zip
```

Alle Optionen: `CTID`, `STORAGE` (Standard `local-lvm`), `TPL_STORAGE` (`local`), `BRIDGE` (`vmbr0`), `IP` (`dhcp`), `DISK` in GB (`3`), `RAM` in MB (`384`), `SWAP` (`256`), `CORES` (`1`), `PORT` (`8080`).

Das Skript
1. lädt die neueste Debian-12-Vorlage, falls sie fehlt,
2. legt einen unprivilegierten Container an, der beim Booten des Hosts mitstartet,
3. entschlackt ihn: Postfix raus, Handbücher und fremde Sprachpakete raus, Journal auf 30 MB begrenzt,
4. installiert Node.js 22, poppler-utils (für PDF-Grundrisse) und PatchPlaner als systemd-Dienst,
5. räumt den apt-Cache weg und zeigt am Ende IP, belegten Speicher und RAM an.

Danach `http://IP-DES-CONTAINERS:8080` öffnen und das erste Konto anlegen – es wird Admin.

### Aktualisieren

```bash
bash /root/proxmox-lxc.sh update 120 /root/PatchPlaner-neu.zip
```

`120` ist die Container-ID. Daten und `.env` bleiben erhalten.

## Variante B: von Hand über die Proxmox-Oberfläche

1. **Vorlage laden:** Speicher `local` → *CT-Vorlagen* → *Vorlagen* → `debian-12-standard` herunterladen.
2. **CT erstellen:** Hostname `patchplaner`, *Unprivilegierter Container* an, Vorlage Debian 12, Disk 3 GB, 1 Kern, 384 MB RAM, 256 MB Swap, Netzwerk per DHCP oder feste IP. Unter *Optionen* „Beim Booten starten“ aktivieren.
3. In der Konsole des Containers:

   ```bash
   apt-get update && apt-get purge -y postfix && apt-get -y upgrade
   apt-get install -y unzip
   # PatchPlaner.zip in den Container kopieren (z. B. auf dem Host: pct push 120 PatchPlaner.zip /root/PatchPlaner.zip)
   cd /root && unzip PatchPlaner.zip && cd patchplaner
   bash deploy/install.sh
   sed -i 's/^HOST=.*/HOST=0.0.0.0/' /opt/patchplaner/.env
   systemctl restart patchplaner
   apt-get clean
   ```

## Erreichbar machen (Nginx Proxy Manager)

Proxy Host anlegen:
- Domain: z. B. `patchplaner.example.de`
- Forward Hostname/IP: IP des Containers, Port `8080`
- *Websockets Support* an, SSL-Zertifikat anfordern, *Force SSL* an
- Unter **Advanced**:

  ```nginx
  proxy_buffering off;
  proxy_read_timeout 1h;
  client_max_body_size 50m;
  ```

Im Container `/opt/patchplaner/.env` anpassen und den Dienst neu starten:

```bash
BASE_URL=https://patchplaner.example.de
TRUST_PROXY=true
```

```bash
systemctl restart patchplaner
```

Wenn PatchPlaner nur über den Proxy erreichbar sein soll, in der Proxmox-Firewall des Containers eingehend Port 8080 nur von der IP des Proxys erlauben.

## Backup

- **Ganzer Container:** Proxmox-Backup (vzdump) des CT einplanen. Der Container ist klein, ein Backup im zstd-Format liegt meist unter 400 MB.
- **Nur die Daten:** im Container

  ```bash
  sudo -u patchplaner node /opt/patchplaner/server.js backup /root/patchplaner-$(date +%F).db
  tar czf /root/grundrisse-$(date +%F).tgz -C /opt/patchplaner/data uploads
  ```

## Nützliche Befehle im Container

```bash
systemctl status patchplaner        # läuft der Dienst?
journalctl -u patchplaner -f        # Live-Log
sudo -u patchplaner node /opt/patchplaner/server.js list-users
sudo -u patchplaner node /opt/patchplaner/server.js reset-password mail@example.de NeuesPasswort
du -sh /opt/patchplaner/data        # Platz für Datenbank und Grundrisse
```

## Wenn der Dienst nicht startet

- **`Failed to set up mount namespacing`** im Log: Beim Container unter *Optionen → Features* „Nesting“ aktivieren (das Skript macht das automatisch) oder in `/etc/systemd/system/patchplaner.service` die Zeilen `PrivateTmp`, `ProtectSystem` und `ProtectHome` entfernen, dann `systemctl daemon-reload && systemctl restart patchplaner`.
- **„braucht Node.js 22.13 oder neuer“:** `bash /opt/patchplaner/deploy/install.sh` erneut ausführen – es installiert die passende Node-Version.
- **Seite lädt, aber Live-Updates hängen:** `proxy_buffering off;` im Nginx Proxy Manager fehlt.
