# PatchPlaner

Selbst gehostetes AV-Planungstool nach dem Vorbild von H2R Gear – mit Gebäude-Grundrissen, kombinierten I/O-Ports und Kabellängen, die aus dem Grundriss berechnet und richtig in die Packliste übernommen werden.

Läuft ohne Docker und ohne npm-Pakete: nur Node.js 22.13 oder neuer (SQLite ist in Node eingebaut).

## Funktionen

**Planen**
- Geräte aus der eigenen Bibliothek, der Team-Bibliothek oder der Community auf den Plan ziehen
- Kabel von Port zu Port ziehen; 22 Kabeltypen (SDI, HDMI, DisplayPort, DVI, VGA, HDBaseT, Ethernet, Glasfaser, USB, Thunderbolt, XLR, Klinke, Cinch, Speakon, Multicore, DMX, Schuko, powerCON, CEE, SMPTE-Hybrid, GPIO/Tally, Funk)
- **I/O-Ports**: Ein- und Ausgang in einem, mit Anschluss auf beiden Seiten des Geräts; verbinden sich mit Eingängen, Ausgängen und anderen I/O-Ports
- Ethernet, Glasfaser, USB, Thunderbolt, Multicore und SMPTE sowie I/O-zu-I/O-Verbindungen gelten als bidirektional (kein Richtungspfeil)
- Automatisches Routing um Geräte herum, alternativ Winkel oder direkt; Pins per Doppelklick setzen und ziehen – dann bleibt die Führung manuell
- Sprünge an Kabelkreuzungen, Kabel-Legende mit Hervorhebung, Kabel-IDs und Längen am Kabel
- Adapter werden erkannt, wenn ein Kabel zwei verschiedene Anschlusstypen verbindet, und landen in der Packliste
- Ausrichtung Oben → Unten oder Links → Rechts
- Zonen (verschieben ihren Inhalt mit), Rich-Text-Labels (`# Überschrift`, `- Liste`, `**fett**`)
- Zeichenwerkzeuge (Shift D): Rechteck, Kreis, Dreieck, Halbkreis, Trapez, Linie, Pfeil sowie Symbole für Person, Stuhl, Mikrofon, Lautsprecher, Scheinwerfer, Beamer, Kamera, Traverse, Treppe, Tür, Stromanschluss, Tisch, Leinwand, Rack – mit 8 Farben, 3 Füllungen, 3 Linienstärken, Beschriftung und Drehung
- Rückgängig/Wiederholen, Raster, Mehrfachauswahl, Kopieren/Einfügen, Tastenkürzel (`?`), Kontextmenü, Touch mit Pinch-Zoom und langem Drücken

**Grundrisse und Kabellängen**
- Beliebig viele Grundrisse pro Plan (PNG, JPG, WebP, GIF, SVG oder PDF), z. B. eine pro Etage
- Maßstab mit zwei Punkten setzen oder bei PDFs den Zeichnungsmaßstab (1:100 …) eingeben
- Grundrisse verschieben, ein-/ausblenden, Deckkraft, im Dark Mode invertieren
- Messwerkzeug
- Kabellänge = Weg auf dem Plan (inkl. Pins) + 2 × Endzuschlag + Höhenzuschlag + Zusatzlänge je Kabel (z. B. Steigleitung zwischen Etagen) + Reserve in %, danach auf die nächste lieferbare Länge des Kabeltyps aufgerundet; feste Länge pro Kabel möglich
- Meter oder Fuß

**Listen und Export**
- Packliste mit Geräten, Kabeln (nach Typ und Länge), Adaptern und Extras; abhaken mit Fortschritt, „gepackt von …“, live für alle; optional nach Zonen gruppiert
- Patchliste mit Quelle, Ziel, Zonen, Weg- und Packlänge
- Export als PNG, JPG oder PDF (Plan plus Pack- und Patchliste, A4–A2), CSV, Text, Plan als JSON

**Zusammenarbeit**
- Konten mit Anmeldung, Passwort-Reset per E-Mail (optional)
- Projekte, Plandaten (Job-ID, Ort, Aufbau- und Veranstaltungsdatum) mit Filter Bevorstehend/Vergangen/Archiv, Vorlagen
- Teams mit Admins und Mitgliedern, Einladung per Link oder E-Mail; Team-Pläne, Team-Projekte und Team-Geräte
- Live-Abgleich: Wer gerade im Plan ist, Änderungen erscheinen sofort; Konflikte werden erkannt statt überschrieben
- Freigabe-Link zum Ansehen ohne Konto
- Geräte-Builder mit Beschreibungszeilen, Bild, Geräte-ID, Live-Vorschau; Geräte in der Community veröffentlichen
- Eigene Kabelfarben, Hell/Dunkel/System
- Admin-Bereich: Benutzer, Registrierung an/aus, Passwort zurücksetzen, Test-E-Mail

## Installation ohne Docker (Debian/Ubuntu)

```bash
unzip patchplaner.zip && cd patchplaner
sudo bash deploy/install.sh
sudo nano /opt/patchplaner/.env      # BASE_URL, ggf. SMTP
sudo systemctl restart patchplaner
```

Das Skript installiert bei Bedarf Node.js 22 und poppler-utils (für PDF-Grundrisse), legt den Benutzer `patchplaner` an, kopiert alles nach `/opt/patchplaner` und richtet den systemd-Dienst ein. Updates: neue Version entpacken und das Skript erneut ausführen – Daten und `.env` bleiben erhalten.

Danach `http://SERVER:8080` öffnen. Das erste Konto wird Admin.

### Lokal testen

```bash
cd patchplaner
node --disable-warning=ExperimentalWarning server.js
# → http://localhost:8080
```

### Mit Docker (optional)

```bash
cp .env.example .env
docker compose -f deploy/docker-compose.yml up -d
```

## Hinter dem Nginx Proxy Manager

Proxy Host anlegen: Forward Hostname = Server-IP, Port 8080, „Websockets Support“ an, SSL-Zertifikat anfordern und „Force SSL“ aktivieren. Unter **Advanced** eintragen, damit die Live-Updates sofort ankommen und große Grundrisse durchgehen:

```nginx
proxy_buffering off;
proxy_read_timeout 1h;
client_max_body_size 50m;
```

In der `.env`: `TRUST_PROXY=true` und `BASE_URL=https://deine-domain`.

## Befehle

```bash
node server.js backup /pfad/sicherung.db        # Datenbank sichern (Grundrisse liegen in data/uploads)
node server.js list-users
node server.js reset-password mail@example.de NeuesPasswort
node server.js make-admin mail@example.de
```

Als Dienst: `sudo -u patchplaner node /opt/patchplaner/server.js …`

## Datenablage

- `data/patchplaner.db` – SQLite-Datenbank (Konten, Pläne, Geräte, Teams)
- `data/uploads/` – Grundrisse

Für ein vollständiges Backup beides sichern.

## PDF-Grundrisse ohne poppler

Ohne `poppler-utils` wandelt der Browser PDFs mit pdf.js um. Das lädt pdf.js von cdnjs. Für Server ohne Internetzugang die Dateien `pdf.min.js` und `pdf.worker.min.js` (pdf.js 3.11.174) nach `public/vendor/` legen.
