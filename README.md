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

**Ebenen (UG, EG, Empore …)**
- Ebenen selbst anlegen, benennen (Doppelklick auf den Reiter über der Planfläche) und mit Fußbodenhöhe versehen; Wechsel per Reiter oder Bild ↑/↓
- Jede Ebene bekommt ihren eigenen Grundriss: PDF (beliebige Seite), SVG oder Bild. Ein mehrseitiges PDF wird einmal hochgeladen, weitere Seiten weist du anderen Ebenen direkt zu
- **Nur Wände und Fenster übernehmen** (PDF aus dem CAD und SVG): Text, Bemaßung, Möbel, Türen, Treppen, Legende, Plankopf und Blattrahmen fliegen raus. Wände werden an Füllung bzw. Strichstärke erkannt, Fenster daran, dass sie zwischen zwei Wandstücken liegen. Vorschau mit Korrektur je Linienart (Wand / Prüfen / Weg); SVGs mit Layern („Wände“, „Fenster“ …) werden nach Layern gefiltert. Ergebnis ist ein scharfer Vektor-Grundriss
- Alternativ ganze Zeichnung ohne weißen Hintergrund oder ganze Seite als Bild; Zuschneiden, um Reste loszuwerden
- **Maßstab je Ebene** (1:100, 1:50 …): Größe des Grundrisses ergibt sich direkt daraus; Seiten aus demselben Plansatz liegen nach Blattkoordinaten deckungsgleich übereinander
- **Geräte in echter Größe** („Maßstäblich“): Grundfläche aus den Maßen (B × T × H, im Geräte-Bauer und je Gerät einstellbar, sinnvolle Vorgaben nach Gerätename), drehen mit R, Verbinden über den ＋-Griff mit Port-Auswahl; schaltet beim ersten maßstäblichen Grundriss automatisch ein
- Andere Ebenen blass einblenden zum Ausrichten; Kabel zwischen Ebenen bekommen den Höhenunterschied automatisch zur Länge dazu (Steigleitung als ↕-Punkt)
- Packliste nach Ebenen gruppiert, Patchliste mit Spalte „Ort“, PDF-Export mit einer Planseite je Ebene
- **Höhen für die 3D-Planung:** Fußbodenhöhe und Raumhöhe je Ebene, Podest und Raumhöhe je Bereich (Zone), Montagehöhe je Gerät (Vorgaben nach Gerätename, z. B. Lautsprecher 2,2 m, Beamer 2,8 m), Kabelweg am Boden, an der Decke oder in fester Höhe (Plan-Standard und je Kabel)
- Kabellänge mit allen senkrechten Stücken: Gerät ↔ Kabelweg an beiden Enden und Steigleitung zwischen Ebenen, einzeln aufgeschlüsselt
- **3D-Ansicht:** Ebenen in echter Höhe, Wände aus Vektor-Grundrissen hochgezogen (Fenster als Glas), Podeste, Geräte in Montagehöhe, Kabel mit senkrechten Wegen und hervorgehobenen Steigleitungen. Zwei Geräte nacheinander anklicken verbindet sie – auch über Ebenen hinweg; Montagehöhe direkt in 3D einstellen; Kabel anklicken zeigt die Länge. Ebenen ein-/ausblenden, auseinanderziehen, als PNG speichern

**Grundrisse und Kabellängen**
- Beliebig viele Grundrisse pro Plan (PNG, JPG, WebP, GIF, SVG oder PDF)
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

## Proxmox

Am sparsamsten läuft PatchPlaner in einem kleinen LXC-Container (1 Kern, 384 MB RAM, 3 GB Disk). Ein Skript legt ihn mit einem Befehl an: siehe [docs/PROXMOX.md](docs/PROXMOX.md).

## Installation ohne Docker (Debian/Ubuntu)

```bash
unzip patchplaner.zip && cd patchplaner
sudo bash deploy/install.sh
sudo nano /opt/patchplaner/.env      # BASE_URL, ggf. SMTP
sudo systemctl restart patchplaner
```

Das Skript installiert bei Bedarf Node.js 22 und poppler-utils (für PDF-Grundrisse; `pdftocairo` daraus für „Nur Wände und Fenster“), legt den Benutzer `patchplaner` an, kopiert alles nach `/opt/patchplaner` und richtet den systemd-Dienst ein. Updates: `sudo bash /opt/patchplaner/deploy/update.sh` (holt den neuen Stand per Git und startet neu) – oder neue Version entpacken und das Skript erneut ausführen. Daten und `.env` bleiben erhalten.

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

## Fremdbibliotheken

Die 3D-Ansicht nutzt [three.js](https://threejs.org) r147 (MIT-Lizenz), lokal unter `public/vendor/three/` – sie funktioniert also auch ohne Internet.
