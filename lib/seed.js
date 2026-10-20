// Standard-Gerätebibliothek und Beispielvorlage
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const uid = () => crypto.randomBytes(6).toString('base64url');
const P = (name, dir, type) => ({ name, dir, type });
const R = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));

export const CATCOL = { Video: '#25598c', Audio: '#8a5220', Netzwerk: '#17695a', Licht: '#5d3f8f', Strom: '#8c2e29', Computer: '#3f5566', Eigene: '#4a5560' };

export const BUILTIN = [
  // Video
  { cat: 'Video', name: 'Studiokamera', el: ['12G-SDI, Tally, Return'], ports: [P('SDI Return', 'in', 'sdi'), P('Strom', 'in', 'power'), P('SDI Out', 'out', 'sdi'), P('HDMI Out', 'out', 'hdmi'), P('LAN / Tally', 'io', 'eth')] },
  { cat: 'Video', name: 'PTZ-Kamera', el: ['PoE, NDI, VISCA over IP'], ports: [P('SDI Out', 'out', 'sdi'), P('HDMI Out', 'out', 'hdmi'), P('LAN (PoE)', 'io', 'eth')] },
  { cat: 'Video', name: 'Camcorder', ports: [P('Strom', 'in', 'power'), P('SDI Out', 'out', 'sdi'), P('HDMI Out', 'out', 'hdmi'), P('Mic In', 'in', 'xlr')] },
  { cat: 'Video', name: 'Bildmischer 4×HDMI', ports: [...R(4, i => P('HDMI In ' + i, 'in', 'hdmi')), P('Mic 1', 'in', 'jack'), P('Mic 2', 'in', 'jack'), P('Strom', 'in', 'power'), P('HDMI Out', 'out', 'hdmi'), P('USB Webcam', 'io', 'usb'), P('LAN', 'io', 'eth')] },
  { cat: 'Video', name: 'Bildmischer 6×SDI', ports: [...R(6, i => P('SDI In ' + i, 'in', 'sdi')), P('Strom', 'in', 'power'), P('SDI PGM', 'out', 'sdi'), P('SDI AUX 1', 'out', 'sdi'), P('SDI AUX 2', 'out', 'sdi'), P('HDMI Multiview', 'out', 'hdmi'), P('LAN', 'io', 'eth')] },
  { cat: 'Video', name: 'Kreuzschiene 12×12 SDI', ports: [...R(12, i => P('In ' + i, 'in', 'sdi')), P('Strom', 'in', 'power'), ...R(12, i => P('Out ' + i, 'out', 'sdi')), P('LAN', 'io', 'eth')] },
  { cat: 'Video', name: 'Monitor', ports: [P('HDMI In', 'in', 'hdmi'), P('SDI In', 'in', 'sdi'), P('Strom', 'in', 'power'), P('SDI Loop', 'out', 'sdi')] },
  { cat: 'Video', name: 'Fernseher / Display', ports: [P('HDMI 1', 'in', 'hdmi'), P('HDMI 2', 'in', 'hdmi'), P('Strom', 'in', 'power'), P('LAN', 'io', 'eth')] },
  { cat: 'Video', name: 'LED-Wand Controller', ports: [P('HDMI In', 'in', 'hdmi'), P('DVI In', 'in', 'dvi'), P('Strom', 'in', 'power'), ...R(4, i => P('Port ' + i, 'out', 'eth'))] },
  { cat: 'Video', name: 'Beamer', ports: [P('HDMI In', 'in', 'hdmi'), P('Strom', 'in', 'power'), P('HDBaseT', 'in', 'hdbaset'), P('LAN', 'io', 'eth')] },
  { cat: 'Video', name: 'HDBaseT Sender', ports: [P('HDMI In', 'in', 'hdmi'), P('Strom', 'in', 'power'), P('HDBaseT Out', 'out', 'hdbaset')] },
  { cat: 'Video', name: 'HDBaseT Empfänger', ports: [P('HDBaseT In', 'in', 'hdbaset'), P('HDMI Out', 'out', 'hdmi')] },
  { cat: 'Video', name: 'Streaming-Encoder', ports: [P('SDI In', 'in', 'sdi'), P('HDMI In', 'in', 'hdmi'), P('Strom', 'in', 'power'), P('LAN', 'io', 'eth')] },
  { cat: 'Video', name: 'Recorder', ports: [P('SDI In', 'in', 'sdi'), P('HDMI In', 'in', 'hdmi'), P('Strom', 'in', 'power'), P('SDI Out', 'out', 'sdi'), P('LAN', 'io', 'eth')] },
  { cat: 'Video', name: 'Wandler HDMI → SDI', ports: [P('HDMI In', 'in', 'hdmi'), P('Strom', 'in', 'power'), P('SDI Out', 'out', 'sdi')] },
  { cat: 'Video', name: 'Wandler SDI → HDMI', ports: [P('SDI In', 'in', 'sdi'), P('Strom', 'in', 'power'), P('HDMI Out', 'out', 'hdmi')] },
  { cat: 'Video', name: 'SDI-Verteiler 1×4', ports: [P('SDI In', 'in', 'sdi'), P('Strom', 'in', 'power'), ...R(4, i => P('Out ' + i, 'out', 'sdi'))] },
  { cat: 'Video', name: 'HDMI-Verteiler 1×4', ports: [P('HDMI In', 'in', 'hdmi'), P('Strom', 'in', 'power'), ...R(4, i => P('Out ' + i, 'out', 'hdmi'))] },
  { cat: 'Video', name: 'SDI-Glasfaserwandler', ports: [P('SDI In', 'in', 'sdi'), P('Strom', 'in', 'power'), P('SDI Out', 'out', 'sdi'), P('LC Fiber', 'io', 'fiber')] },
  { cat: 'Video', name: 'Capture-Karte', ports: [P('SDI In', 'in', 'sdi'), P('HDMI In', 'in', 'hdmi'), P('USB / Thunderbolt', 'io', 'usb')] },
  { cat: 'Video', name: 'CCU (SMPTE)', ports: [P('Strom', 'in', 'power'), P('SDI Out', 'out', 'sdi'), P('SDI Return In', 'in', 'sdi'), P('SMPTE Hybrid', 'io', 'smpte'), P('LAN', 'io', 'eth')] },
  { cat: 'Video', name: 'Kamerakopf (SMPTE)', ports: [P('SMPTE Hybrid', 'io', 'smpte'), P('SDI Out', 'out', 'sdi')] },
  { cat: 'Video', name: 'Funkstrecke Sender', ports: [P('SDI In', 'in', 'sdi'), P('HDMI In', 'in', 'hdmi'), P('Strom', 'in', 'power'), P('Funk', 'out', 'wireless')] },
  { cat: 'Video', name: 'Funkstrecke Empfänger', ports: [P('Funk', 'in', 'wireless'), P('Strom', 'in', 'power'), P('SDI Out', 'out', 'sdi'), P('HDMI Out', 'out', 'hdmi')] },
  // Computer
  { cat: 'Computer', name: 'Präsentations-PC', ports: [P('Strom', 'in', 'power'), P('HDMI Out', 'out', 'hdmi'), P('DP Out', 'out', 'dp'), P('LAN', 'io', 'eth'), P('USB', 'io', 'usb')] },
  { cat: 'Computer', name: 'Laptop', ports: [P('Strom', 'in', 'power'), P('HDMI Out', 'out', 'hdmi'), P('USB-C', 'io', 'usb'), P('LAN', 'io', 'eth')] },
  { cat: 'Computer', name: 'Grafik-/Playout-Rechner', ports: [P('SDI Key In', 'in', 'sdi'), P('Strom', 'in', 'power'), P('SDI Fill', 'out', 'sdi'), P('SDI Key', 'out', 'sdi'), P('HDMI GUI', 'out', 'hdmi'), P('LAN', 'io', 'eth')] },
  { cat: 'Computer', name: 'Stream Deck / Controller', ports: [P('USB', 'io', 'usb')] },
  // Audio
  { cat: 'Audio', name: 'Digitalmischpult', ports: [...R(16, i => P('Mic ' + i, 'in', 'xlr')), P('Strom', 'in', 'power'), P('Main L', 'out', 'xlr'), P('Main R', 'out', 'xlr'), ...R(6, i => P('Aux ' + i, 'out', 'xlr')), P('Dante Pri', 'io', 'eth'), P('Dante Sec', 'io', 'eth'), P('Control', 'io', 'eth'), P('USB Audio', 'io', 'usb')] },
  { cat: 'Audio', name: 'Kleinmischer 8 Kanal', ports: [...R(8, i => P('In ' + i, 'in', 'xlr')), P('Strom', 'in', 'power'), P('Main L', 'out', 'xlr'), P('Main R', 'out', 'xlr'), P('Aux 1', 'out', 'jack'), P('Aux 2', 'out', 'jack'), P('USB', 'io', 'usb')] },
  { cat: 'Audio', name: 'Stagebox 16/8 Dante', ports: [...R(16, i => P('In ' + i, 'in', 'xlr')), P('Strom', 'in', 'power'), ...R(8, i => P('Out ' + i, 'out', 'xlr')), P('Dante Pri', 'io', 'eth'), P('Dante Sec', 'io', 'eth')] },
  { cat: 'Audio', name: 'Analog-Multicore 16/4', ports: [...R(16, i => P('In ' + i, 'in', 'xlr')), ...R(4, i => P('Return ' + i, 'out', 'xlr')), P('Multipin', 'io', 'multicore')] },
  { cat: 'Audio', name: 'Mikrofon', ports: [P('XLR Out', 'out', 'xlr')] },
  { cat: 'Audio', name: 'DI-Box', ports: [P('Klinke In', 'in', 'jack'), P('Thru', 'out', 'jack'), P('XLR Out', 'out', 'xlr')] },
  { cat: 'Audio', name: 'Funkempfänger 2-Kanal', ports: [P('Strom', 'in', 'power'), P('Antenne', 'in', 'wireless'), P('Out A', 'out', 'xlr'), P('Out B', 'out', 'xlr'), P('LAN', 'io', 'eth')] },
  { cat: 'Audio', name: 'Funksender (Handheld)', ports: [P('Funk', 'out', 'wireless')] },
  { cat: 'Audio', name: 'In-Ear Sender', ports: [P('In L', 'in', 'xlr'), P('In R', 'in', 'xlr'), P('Strom', 'in', 'power'), P('Funk', 'out', 'wireless')] },
  { cat: 'Audio', name: 'Aktivlautsprecher', ports: [P('XLR In', 'in', 'xlr'), P('Strom', 'in', 'power'), P('XLR Link', 'out', 'xlr'), P('Strom Thru', 'out', 'power')] },
  { cat: 'Audio', name: 'Aktiv-Subwoofer', ports: [P('XLR In L', 'in', 'xlr'), P('XLR In R', 'in', 'xlr'), P('Strom', 'in', 'power'), P('Out L', 'out', 'xlr'), P('Out R', 'out', 'xlr')] },
  { cat: 'Audio', name: 'Endstufe 4-Kanal', ports: [...R(4, i => P('In ' + i, 'in', 'xlr')), P('Strom', 'in', 'power'), ...R(4, i => P('Speakon ' + i, 'out', 'speakon')), P('LAN', 'io', 'eth')] },
  { cat: 'Audio', name: 'Passivlautsprecher', ports: [P('Speakon In', 'in', 'speakon'), P('Speakon Link', 'out', 'speakon')] },
  { cat: 'Audio', name: 'Audio-Interface 2×2', ports: [P('In 1', 'in', 'xlr'), P('In 2', 'in', 'xlr'), P('Out L', 'out', 'jack'), P('Out R', 'out', 'jack'), P('USB', 'io', 'usb')] },
  { cat: 'Audio', name: 'Intercom-Basis', ports: [P('Strom', 'in', 'power'), P('Partyline A', 'io', 'xlr'), P('Partyline B', 'io', 'xlr'), P('LAN', 'io', 'eth')] },
  { cat: 'Audio', name: 'Intercom-Beltpack', ports: [P('Partyline / LAN', 'io', 'xlr')] },
  // Netzwerk
  { cat: 'Netzwerk', name: 'Netzwerk-Switch 8 Port', ports: [P('Strom', 'in', 'power'), ...R(8, i => P('Port ' + i, 'io', 'eth'))] },
  { cat: 'Netzwerk', name: 'Switch 16 Port + 2 SFP', ports: [P('Strom', 'in', 'power'), ...R(16, i => P('Port ' + i, 'io', 'eth')), P('SFP 1', 'io', 'fiber'), P('SFP 2', 'io', 'fiber')] },
  { cat: 'Netzwerk', name: 'PoE-Switch 8 Port', el: ['PoE+ 120 W Budget'], ports: [P('Strom', 'in', 'power'), ...R(8, i => P('PoE ' + i, 'io', 'eth')), P('Uplink', 'io', 'eth')] },
  { cat: 'Netzwerk', name: 'WLAN Access Point', ports: [P('LAN (PoE)', 'io', 'eth')] },
  { cat: 'Netzwerk', name: 'Router / Firewall', ports: [P('Strom', 'in', 'power'), P('WAN', 'io', 'eth'), ...R(4, i => P('LAN ' + i, 'io', 'eth'))] },
  { cat: 'Netzwerk', name: 'LTE/5G-Bonding-Router', ports: [P('Strom', 'in', 'power'), P('WAN', 'io', 'eth'), P('LAN 1', 'io', 'eth'), P('LAN 2', 'io', 'eth'), P('USB Modem', 'io', 'usb')] },
  { cat: 'Netzwerk', name: 'Netzwerkdose (Haus)', ports: [P('Dose', 'io', 'eth')] },
  { cat: 'Netzwerk', name: 'Glasfaser-Spleißbox', ports: [...R(4, i => P('LC ' + i, 'io', 'fiber'))] },
  // Licht
  { cat: 'Licht', name: 'Lichtpult', ports: [P('Strom', 'in', 'power'), P('DMX A', 'out', 'dmx'), P('DMX B', 'out', 'dmx'), P('Art-Net / sACN', 'io', 'eth'), P('USB', 'io', 'usb')] },
  { cat: 'Licht', name: 'Art-Net Node 2 Univ.', ports: [P('Strom', 'in', 'power'), P('DMX 1', 'out', 'dmx'), P('DMX 2', 'out', 'dmx'), P('LAN', 'io', 'eth')] },
  { cat: 'Licht', name: 'DMX-Splitter 1×4', ports: [P('DMX In', 'in', 'dmx'), P('Strom', 'in', 'power'), ...R(4, i => P('Out ' + i, 'out', 'dmx')), P('Thru', 'out', 'dmx')] },
  { cat: 'Licht', name: 'Moving Head', ports: [P('DMX In', 'in', 'dmx'), P('Strom In', 'in', 'power'), P('DMX Thru', 'out', 'dmx'), P('Strom Thru', 'out', 'power')] },
  { cat: 'Licht', name: 'LED-PAR', ports: [P('DMX In', 'in', 'dmx'), P('Strom In', 'in', 'power'), P('DMX Thru', 'out', 'dmx'), P('Strom Thru', 'out', 'power')] },
  { cat: 'Licht', name: 'LED-Panel (Studio)', ports: [P('DMX In', 'in', 'dmx'), P('Strom', 'in', 'power'), P('DMX Thru', 'out', 'dmx')] },
  { cat: 'Licht', name: 'Dimmerpack 4-Kanal', ports: [P('DMX In', 'in', 'dmx'), P('Zuleitung', 'in', 'power'), P('DMX Thru', 'out', 'dmx'), ...R(4, i => P('Kanal ' + i, 'out', 'power'))] },
  // Strom
  { cat: 'Strom', name: 'Stromverteiler 6-fach', ports: [P('Zuleitung', 'in', 'power'), ...R(6, i => P('Abgang ' + i, 'out', 'power'))] },
  { cat: 'Strom', name: 'CEE-Verteiler 32 A', el: ['CEE 32 A → 3× CEE 16 A, 6× Schuko'], ports: [P('CEE 32 A In', 'in', 'cee'), P('CEE 32 A Thru', 'out', 'cee'), ...R(3, i => P('CEE 16 A ' + i, 'out', 'cee')), ...R(6, i => P('Schuko ' + i, 'out', 'power'))] },
  { cat: 'Strom', name: 'Wandsteckdose', ports: [P('Schuko', 'out', 'power')] },
  { cat: 'Strom', name: 'USV', ports: [P('Netz', 'in', 'power'), ...R(4, i => P('Out ' + i, 'out', 'power')), P('LAN', 'io', 'eth')] },
  { cat: 'Strom', name: 'Mehrfachsteckdose', ports: [P('Stecker', 'in', 'power'), ...R(5, i => P('Dose ' + i, 'out', 'power'))] },
];

export function seed(db, dataDir) {
  const now = Date.now();
  const has = db.prepare('SELECT COUNT(*) AS n FROM gear WHERE is_builtin = 1').get().n;
  if (!has) {
    const ins = db.prepare(`INSERT INTO gear (id, owner_id, name, category, color, ports, elements, is_public, is_builtin, created, updated)
      VALUES (?, NULL, ?, ?, ?, ?, ?, 1, 1, ?, ?)`);
    for (const g of BUILTIN) ins.run('b-' + uid(), g.name, g.cat, CATCOL[g.cat], JSON.stringify(g.ports), JSON.stringify(g.el || []), now, now);
  }
  const tpl = db.prepare('SELECT COUNT(*) AS n FROM plans WHERE owner_id IS NULL AND is_template = 1').get().n;
  if (!tpl) seedTemplates(db, dataDir, now);
}

function itemFrom(name, x, y, label) {
  const g = BUILTIN.find(b => b.name === name);
  return { id: uid(), gear: null, name: g.name, label, inv: '', notes: '', color: CATCOL[g.cat], elements: [], x, y, ports: g.ports.map(p => ({ id: uid(), ...p })) };
}

function seedTemplates(db, dataDir, now) {
  // 1) Gemeindezentrum mit Grundriss
  const planId = 't-' + uid();
  const assetId = uid();
  const file = 'tpl-' + assetId + '.svg';
  fs.writeFileSync(path.join(dataDir, 'uploads', file), sampleFloorSVG());
  const it = {};
  const add = (k, n, x, y, l) => { it[k] = itemFrom(n, x, y, l); };
  add('cam1', 'Studiokamera', 180, 800, 'CAM 1'); add('cam2', 'Studiokamera', 900, 430, 'CAM 2');
  add('foh', 'Kleinmischer 8 Kanal', 520, 780, 'FOH'); add('sb', 'Stagebox 16/8 Dante', 540, 30, 'Stagebox');
  add('bea', 'Beamer', 480, 560, 'Beamer'); add('mix', 'Bildmischer 6×SDI', 1150, 40, 'Bildmischer');
  add('mon', 'Monitor', 1380, 40, 'Multiview'); add('enc', 'Streaming-Encoder', 1380, 170, 'Stream');
  add('sw', 'Netzwerk-Switch 8 Port', 1250, 350, 'Switch'); add('pc', 'Präsentations-PC', 1150, 380, 'Folien-PC');
  const pid = (k, n) => it[k].ports.find(p => p.name === n).id;
  const cables = [];
  const link = (a, ap, b, bp, wps = [], type) => cables.push({ id: uid(), from: { item: it[a].id, port: pid(a, ap) }, to: { item: it[b].id, port: pid(b, bp) },
    type: type || it[a].ports.find(p => p.name === ap).type, label: '', wps, route: null, override: null, extra: 0, notes: '' });
  link('cam1', 'SDI Out', 'mix', 'SDI In 1', [{ x: 330, y: 820 }, { x: 330, y: 955 }, { x: 1085, y: 955 }, { x: 1085, y: 64 }]);
  link('cam2', 'SDI Out', 'mix', 'SDI In 2', [{ x: 1060, y: 450 }, { x: 1060, y: 74 }]);
  link('mix', 'SDI PGM', 'enc', 'SDI In');
  link('mix', 'HDMI Multiview', 'mon', 'HDMI In');
  link('mix', 'SDI AUX 1', 'bea', 'HDMI In', [{ x: 1290, y: 74 }, { x: 1290, y: 20 }, { x: 450, y: 20 }, { x: 450, y: 584 }]);
  link('pc', 'HDMI Out', 'mix', 'SDI In 3');
  link('sb', 'Dante Pri', 'sw', 'Port 1', [{ x: 700, y: 300 }, { x: 1070, y: 300 }, { x: 1070, y: 390 }]);
  link('enc', 'LAN', 'sw', 'Port 3');
  link('mix', 'LAN', 'sw', 'Port 4');
  const shapes = [
    { id: uid(), kind: 'zone', x: 1110, y: 30, w: 470, h: 280, color: 'blue', fill: 'tint', weight: 2, label: 'Regie', rot: 0 },
    { id: uid(), kind: 'sym', sym: 'camera', x: 205, y: 735, w: 55, h: 55, color: 'blue', fill: 'tint', weight: 2, label: '', rot: 0 },
    { id: uid(), kind: 'sym', sym: 'camera', x: 925, y: 365, w: 55, h: 55, color: 'blue', fill: 'tint', weight: 2, label: '', rot: 300 },
    { id: uid(), kind: 'sym', sym: 'projector', x: 615, y: 500, w: 55, h: 55, color: 'gray', fill: 'tint', weight: 2, label: '', rot: 0 },
    { id: uid(), kind: 'text', x: 30, y: 290, w: 0, h: 0, text: '# Hinweis\nKabel zur Regie laufen über die Deckentrasse.\n- Höhenzuschlag im Plan-Tab setzen\n- **Pins** ziehen, um den Weg anzupassen', size: 15, bold: false, color: 'orange', fill: 'tint', weight: 2, rot: 0 },
  ];
  const data = {
    v: 3, orient: 'ltr', ds: 0.55, grid: true, labels: true, legend: true, strict: false, hops: true,
    floors: [{ id: uid(), asset: assetId, name: 'Erdgeschoss (32 × 20 m)', x: 0, y: 0, w: 1600, h: 1000, w0: 1600, opacity: 0.95, visible: true, invert: true, calibrated: true, locked: true, pdf: null }],
    items: Object.values(it), cables, shapes,
    extras: [{ id: uid(), name: 'Gaffa-Tape schwarz', qty: 2 }, { id: uid(), name: 'Kabelbrücke 1 m', qty: 3 }],
    settings: { endSlack: 1, heightAdd: 0, reserve: 10, roundUp: true, route: 'auto' },
  };
  db.prepare(`INSERT INTO plans (id, owner_id, name, job_id, venue, is_template, data, created, updated)
    VALUES (?, NULL, ?, ?, ?, 1, ?, ?, ?)`).run(planId, 'Gemeindezentrum – Gottesdienst-Stream', 'VORLAGE', 'Gemeindezentrum', JSON.stringify(data), now, now);
  db.prepare(`INSERT INTO plan_assets (id, plan_id, kind, mime, filename, file, w, h, created) VALUES (?, ?, 'floor', 'image/svg+xml', 'beispiel-grundriss.svg', ?, 1600, 1000, ?)`)
    .run(assetId, planId, file, now);

  // 2) Kleines Streaming-Setup ohne Grundriss
  const it2 = {};
  const add2 = (k, n, x, y, l) => { it2[k] = itemFrom(n, x, y, l); };
  add2('c1', 'Camcorder', 40, 40, 'CAM 1'); add2('c2', 'PTZ-Kamera', 40, 260, 'CAM 2'); add2('m', 'Bildmischer 4×HDMI', 330, 90, 'Mischer');
  add2('l', 'Laptop', 640, 60, 'Stream-Laptop'); add2('r', 'LTE/5G-Bonding-Router', 640, 300, 'Internet'); add2('mic', 'Mikrofon', 40, 470, 'Moderation');
  const p2 = (k, n) => it2[k].ports.find(p => p.name === n).id;
  const cab2 = [];
  const l2 = (a, ap, b, bp, type) => cab2.push({ id: uid(), from: { item: it2[a].id, port: p2(a, ap) }, to: { item: it2[b].id, port: p2(b, bp) }, type: type || it2[a].ports.find(p => p.name === ap).type, label: '', wps: [], route: null, override: null, extra: 0, notes: '' });
  l2('c1', 'HDMI Out', 'm', 'HDMI In 1'); l2('c2', 'HDMI Out', 'm', 'HDMI In 2'); l2('m', 'USB Webcam', 'l', 'USB-C'); l2('l', 'LAN', 'r', 'LAN 1'); l2('mic', 'XLR Out', 'm', 'Mic 1', 'xlr');
  const data2 = { v: 3, orient: 'ltr', ds: 1, grid: true, labels: true, legend: true, strict: false, hops: true, floors: [], items: Object.values(it2), cables: cab2, shapes: [], extras: [],
    settings: { endSlack: 1, heightAdd: 0, reserve: 10, roundUp: true, route: 'auto' } };
  db.prepare(`INSERT INTO plans (id, owner_id, name, job_id, is_template, data, created, updated) VALUES (?, NULL, ?, ?, 1, ?, ?, ?)`)
    .run('t-' + uid(), 'Mobiles Streaming-Kit', 'VORLAGE', JSON.stringify(data2), now, now);
}

function sampleFloorSVG() {
  const s = (x, y, w, h, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${extra}/>`;
  let seats = '';
  for (let r = 0; r < 9; r++) for (let c = 0; c < 2; c++) { const x0 = c ? 600 : 160; seats += `<line x1="${x0}" y1="${380 + r * 42}" x2="${x0 + 340}" y2="${380 + r * 42}" stroke="#9aa2aa" stroke-width="3" stroke-dasharray="14 8"/>`; }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000" font-family="Arial,Helvetica,sans-serif">
  <rect width="1600" height="1000" fill="#fbfbfa"/>
  ${s(300, 10, 500, 250, 'fill="#eceef0"')}${seats}
  ${s(1100, 10, 490, 310, 'fill="#f1f3f5"')}${s(1100, 320, 490, 200, 'fill="#e9edf0"')}
  <g fill="none" stroke="#3b4249" stroke-width="10" stroke-linecap="square">
   <path d="M10 10 H1590 V990 H760 M640 990 H10 Z"/>
   <path d="M1100 10 V200 M1100 270 V690 M1100 760 V990"/>
   <path d="M1100 320 H1300 M1380 320 H1590"/><path d="M1100 520 H1440 M1520 520 H1590"/>
  </g>
  <g fill="none" stroke="#3b4249" stroke-width="2"><path d="M1100 200 A70 70 0 0 1 1170 270"/><path d="M1300 320 A80 80 0 0 0 1380 400"/><path d="M640 990 A60 60 0 0 1 700 930"/></g>
  <g stroke="#c7893a" stroke-width="4" stroke-dasharray="18 10" fill="none" opacity=".7"><path d="M40 40 H1080 V965 H40"/></g>
  <text x="56" y="62" font-size="15" fill="#a8722e">KABELTRASSE (DECKE, 4,5 m)</text>
  <g fill="#59626b" font-weight="700" letter-spacing="3">
   <text x="550" y="140" font-size="26" text-anchor="middle">BÜHNE</text><text x="550" y="168" font-size="15" text-anchor="middle" font-weight="400" letter-spacing="1">10,0 × 5,0 m · +0,6 m</text>
   <text x="560" y="830" font-size="30" text-anchor="middle" opacity=".55">SAAL</text>
   <text x="1345" y="295" font-size="24" text-anchor="middle">REGIE</text>
   <text x="1500" y="500" font-size="20" text-anchor="middle">TECHNIK</text>
   <text x="1345" y="800" font-size="24" text-anchor="middle">FOYER</text>
  </g>
  <g stroke="#59626b" stroke-width="2" fill="none"><path d="M10 978 v-14 M1590 978 v-14 M10 971 H1590"/></g>
  <text x="800" y="962" font-size="16" fill="#59626b" text-anchor="middle">32,0 m</text>
</svg>`;
}
