// Gemeinsame Konstanten: Kabeltypen, Farben, Symbole, Einheiten
export const U = 50; // Welt-Einheiten pro Meter

const L_VIDEO = [0.5, 1, 2, 3, 5, 10, 15, 20, 25, 30, 50, 75, 100];
const L_SHORT = [0.5, 1, 2, 3, 5, 10, 15];
export const TYPES = {
  sdi:       { name: 'SDI (BNC)',      short: 'SDI',  color: '#2f7fe8', bi: false, lens: L_VIDEO },
  hdmi:      { name: 'HDMI',           short: 'HDMI', color: '#8a4fd0', bi: false, lens: [0.5, 1, 2, 3, 5, 7.5, 10, 15, 20, 30, 50] },
  dp:        { name: 'DisplayPort',    short: 'DP',   color: '#b25bc4', bi: false, lens: [1, 2, 3, 5, 10] },
  dvi:       { name: 'DVI',            short: 'DVI',  color: '#9a6fb0', bi: false, lens: [1, 2, 3, 5, 10] },
  vga:       { name: 'VGA',            short: 'VGA',  color: '#6f7fb0', bi: false, lens: [1, 2, 3, 5, 10, 15, 20] },
  hdbaset:   { name: 'HDBaseT (CAT)',  short: 'HDBT', color: '#0f8f9e', bi: false, lens: [1, 2, 5, 10, 20, 30, 50, 70, 100] },
  eth:       { name: 'Ethernet',       short: 'ETH',  color: '#169c86', bi: true,  lens: [0.5, 1, 2, 3, 5, 10, 15, 20, 30, 50, 75, 100] },
  fiber:     { name: 'Glasfaser',      short: 'LWL',  color: '#e07a1f', bi: true,  lens: [1, 3, 5, 10, 25, 50, 100, 150, 200, 300] },
  usb:       { name: 'USB',            short: 'USB',  color: '#6b8aa3', bi: true,  lens: L_SHORT },
  thunderbolt:{ name: 'Thunderbolt',   short: 'TB',   color: '#4f6d8a', bi: true,  lens: [0.5, 1, 2, 3, 5] },
  xlr:       { name: 'XLR',            short: 'XLR',  color: '#c9a227', bi: false, lens: [0.5, 1, 2, 3, 5, 7.5, 10, 15, 20, 30, 50] },
  jack:      { name: 'Klinke',         short: 'KL',   color: '#d98d3b', bi: false, lens: [0.5, 1, 2, 3, 5, 10] },
  rca:       { name: 'Cinch (RCA)',    short: 'RCA',  color: '#c46b52', bi: false, lens: [0.5, 1, 2, 3, 5, 10] },
  speakon:   { name: 'Speakon',        short: 'SPK',  color: '#b8457a', bi: false, lens: [1, 2, 5, 10, 15, 20, 30, 50] },
  multicore: { name: 'Multicore',      short: 'MC',   color: '#8c7a3a', bi: true,  lens: [5, 10, 15, 20, 30, 50] },
  dmx:       { name: 'DMX',            short: 'DMX',  color: '#5867c9', bi: false, lens: [0.5, 1, 2, 3, 5, 10, 15, 20, 30, 50] },
  power:     { name: 'Strom (Schuko)', short: 'PWR',  color: '#cf3d34', bi: false, lens: [0.5, 1, 1.5, 2, 3, 5, 10, 15, 25, 50] },
  powercon:  { name: 'powerCON',       short: 'PCON', color: '#a8322c', bi: false, lens: [0.5, 1, 1.5, 2, 3, 5, 10] },
  cee:       { name: 'CEE',            short: 'CEE',  color: '#d65a1e', bi: false, lens: [1.5, 3, 5, 10, 15, 25, 50] },
  smpte:     { name: 'SMPTE-Hybrid',   short: 'SMPTE',color: '#d26a16', bi: true,  lens: [10, 25, 50, 100, 150, 250] },
  gpio:      { name: 'GPIO / Tally',   short: 'GPIO', color: '#7a8a52', bi: false, lens: [1, 2, 5, 10, 20, 50] },
  wireless:  { name: 'Funk',           short: 'FUNK', color: '#8d96a0', bi: false, lens: [0], nocable: true },
};
export const FT_LENS = [1, 3, 6, 10, 15, 25, 35, 50, 75, 100, 150, 200, 250, 300, 500, 1000];
export const DEFAULT_COLORS = Object.fromEntries(Object.entries(TYPES).map(([k, t]) => [k, t.color]));
export function applyCableColors(map) {
  for (const k in TYPES) TYPES[k].color = (map && map[k]) || DEFAULT_COLORS[k];
}
export const typeOf = (k) => TYPES[k] || { name: k || '?', short: (k || '?').toUpperCase().slice(0, 5), color: '#8d96a0', bi: false, lens: L_VIDEO };

export const DIRS = { in: 'Eingang', out: 'Ausgang', io: 'I/O' };
export const CATS = ['Eigene', 'Video', 'Audio', 'Netzwerk', 'Licht', 'Strom', 'Computer'];
export const CATCOL = { Video: '#25598c', Audio: '#8a5220', Netzwerk: '#17695a', Licht: '#5d3f8f', Strom: '#8c2e29', Computer: '#3f5566', Eigene: '#4a5560' };
export const COLORS = { gray: '#7c8690', red: '#d24a42', orange: '#e07a2a', yellow: '#d4ab17', green: '#3b9a56', blue: '#3577d4', purple: '#8457c9', pink: '#cf5596' };
export const COLNAMES = { gray: 'Grau', red: 'Rot', orange: 'Orange', yellow: 'Gelb', green: 'Grün', blue: 'Blau', purple: 'Lila', pink: 'Pink' };

// Symbole (Draufsicht, 100×100, Vorderseite oben)
export const SYMS = {
  person: { n: 'Person', d: '<ellipse cx="50" cy="56" rx="36" ry="15" class="sf"/><circle cx="50" cy="52" r="14" class="sf"/>' },
  chair: { n: 'Stuhl', d: '<rect x="24" y="22" width="52" height="50" rx="6" class="sf"/><rect x="22" y="74" width="56" height="10" rx="3" class="sf"/>' },
  mic: { n: 'Mikrofon', d: '<circle cx="50" cy="28" r="13" class="sf"/><path d="M50 41 V80 M36 86 H64"/>' },
  speaker: { n: 'Lautsprecher', d: '<rect x="22" y="44" width="56" height="34" rx="3" class="sf"/><path d="M32 44 L22 16 H78 L68 44" class="sf"/>' },
  light: { n: 'Scheinwerfer', d: '<path d="M38 56 L20 12 H80 L62 56Z" class="sf beam"/><circle cx="50" cy="66" r="16" class="sf"/>' },
  projector: { n: 'Beamer', d: '<path d="M42 38 L26 8 H74 L58 38Z" class="sf beam"/><rect x="22" y="38" width="56" height="40" rx="4" class="sf"/><circle cx="50" cy="44" r="7"/>' },
  camera: { n: 'Kamera', d: '<path d="M38 44 L32 14 H68 L62 44Z" class="sf"/><rect x="28" y="44" width="44" height="40" rx="4" class="sf"/><path d="M50 84 V96 M34 96 H66"/>' },
  truss: { n: 'Traverse', d: '<rect x="2" y="38" width="96" height="24" class="sf"/><path d="M2 62 L14 38 L26 62 L38 38 L50 62 L62 38 L74 62 L86 38 L98 62"/>' },
  stairs: { n: 'Treppe', d: '<rect x="20" y="8" width="60" height="84" class="sf"/><path d="M20 24 H80 M20 40 H80 M20 56 H80 M20 72 H80"/>' },
  door: { n: 'Tür', d: '<path d="M10 90 V10 M10 10 A80 80 0 0 1 90 90 M4 90 H96"/>' },
  power: { n: 'Stromanschluss', d: '<circle cx="50" cy="50" r="34" class="sf"/><path d="M56 22 L38 54 H52 L44 78 L64 44 H50Z" class="solid"/>' },
  table: { n: 'Tisch', d: '<rect x="8" y="26" width="84" height="48" rx="3" class="sf"/>' },
  screen: { n: 'Leinwand', d: '<rect x="4" y="40" width="92" height="10" class="sf"/><path d="M4 56 H96" stroke-dasharray="6 5"/>' },
  rack: { n: 'Rack', d: '<rect x="18" y="12" width="64" height="76" rx="3" class="sf"/><path d="M26 24 H74 M26 36 H74 M26 48 H74 M26 60 H74 M26 72 H74"/>' },
};
export const SHAPES = { rect: 'Rechteck', circle: 'Kreis', tri: 'Dreieck', half: 'Halbkreis', trap: 'Trapez', line: 'Linie', arrow: 'Pfeil', zone: 'Zone', text: 'Text' };

/* Einheiten */
export const units = { mode: 'm' };
export const M_PER_FT = 0.3048;
export const toUser = (m) => (units.mode === 'ft' ? m / M_PER_FT : m);
export const fromUser = (v) => (units.mode === 'ft' ? v * M_PER_FT : v);
export const uName = () => (units.mode === 'ft' ? 'ft' : 'm');
export function fmtNum(n, d = 1) { return Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }); }
export function fmtLen(m, d) {
  const v = toUser(m);
  if (d == null) return Number(v).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' ' + uName();
  return fmtNum(v, d) + ' ' + uName();
}
