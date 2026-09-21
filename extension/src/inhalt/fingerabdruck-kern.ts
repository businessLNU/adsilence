/**
 * Der rechnende Teil von „Fingerabdruck verwischen": Hashes, Mischer, die
 * beiden Rauschfunktionen fuer Pixel und Audioproben, und seit dem
 * 05.09.2026 die Kernzahl und das erfundene Plugin je Site.
 *
 * KEIN DOM, KEINE BROWSER-API, KEIN ZUSTAND. Alles hier ist eine reine
 * Funktion ueber Zahlen und Puffern, damit es in Node laeuft und
 * `tests/inhalt/fingerabdruck.test.ts` es ohne Browser beweisen kann: dass
 * das Rauschen deterministisch ist, dass es idempotent ist, dass es Alpha nie
 * anfasst, dass es nie weiter als 1 vom Original abweicht. Die Huellen um
 * Canvas und AudioBuffer stehen in `fingerabdruck.ts` und rufen nur hierher.
 *
 * Wer eine Zahl in dieser Datei aendert, aendert, was jede Seite sieht. Jede
 * Grenze steht deshalb als benannte Konstante mit ihrer Begruendung daneben;
 * die Messung, die sie rechtfertigt, liefert `npm run probe:fingerabdruck`
 * und steht mit Datum in `katalog/35-fingerabdruck.md`.
 */

// ── Grenzen ────────────────────────────────────────────────────────────────

/**
 * So viele Pixel bekommen je Aufruf hoechstens Rauschen; darueber wird nur
 * jede k-te Zeile bearbeitet.
 *
 * 512 x 512. Ein Fingerabdruck-Canvas ist 300 x 150 oder kleiner
 * (FingerprintJS: 240 x 60; Cover Your Tracks: 300 x 150) und liegt damit
 * VOLLSTAENDIG unter der Grenze; es verliert nichts. Ein Videofilter, der
 * je Frame ein 1280 x 720-Bild liest (921 600 Pixel), bekommt bei 30 fps
 * ein Budget von 33 ms je Frame; ein Mischwert je Pixel kostet dort ein
 * Vielfaches dessen, was eine Seite ohne Erweiterung zahlt. Die Zeilenregel
 * haelt die Arbeit je Aufruf bei hoechstens PIXEL_BUDGET Mischwerten, und
 * an einem 720p-Bild wird damit nur jede vierte Zeile verrauscht, was fuer
 * einen Hash nach wie vor jede Wiedererkennung verhindert (ein Bit je Zeile
 * reicht, hier sind es Hunderttausende). Wie viel es kostet, MISST die
 * Probe (Verhaeltnis mit/ohne Erweiterung); die Zahl hier ist die Grenze,
 * nicht die Messung.
 */
export const PIXEL_BUDGET = 262_144;

/**
 * So viele Audioproben bekommen je Kanal hoechstens Rauschen; darueber nur
 * jede k-te.
 *
 * Ein Fingerabdruck-Buffer hat 5 000 Proben (FingerprintJS, CreepJS,
 * Cover Your Tracks: OfflineAudioContext mit 5 000 Frames) und liegt weit
 * darunter. Ein dekodiertes Zehn-Minuten-Stueck hat 26 Millionen Proben je
 * Kanal, und wavesurfer.js, Audio-Editoren und Wellenform-Zeichner lesen es
 * mit `getChannelData` ganz. Ueber der Grenze laeuft die Schleife in
 * Schritten von k, nicht ueber jeden Index mit `continue`: Bis zum
 * 05.09.2026 lief sie ueber alle 26 Millionen Indizes und die Arbeit hing an
 * der Kanal-Laenge statt am Budget (gemessen in Node: 65 ms fuer 26 Mio.,
 * davon der Grossteil die leere Schleife). Was es im Browser kostet, MISST
 * die Probe (`getChannelData` auf einem Puffer mit 26 Mio. Proben, mit und
 * ohne Erweiterung) und steht mit Datum im Katalog; die Zahl hier ist die
 * Grenze, nicht die Messung.
 */
export const PROBEN_BUDGET = 1_000_000;

/**
 * Bis zu dieser Pixelzahl wird fuer `toDataURL`/`toBlob` eine Kopie des
 * Canvas angelegt; darueber gibt es keinen Schutz, dafuer auch keinen Schaden.
 *
 * 4096 x 4096. Chrome wirft KEINE Ausnahme, wenn der Hintergrundspeicher
 * eines Canvas nicht angelegt werden kann: `getContext` liefert einen
 * Kontext, `drawImage` tut so, als haette es gemalt, und `toDataURL`
 * liefert stumm ein LEERES Bild. Eine Kopie eines 10 000 x 10 000-Posters
 * (400 MB im Original) braeuchte weitere 400 MB fuer die Kopie und 400 MB
 * fuer die ImageData, und der Nutzer bekaeme ein transparentes PNG ohne
 * jede Meldung. Fingerabdruck-Canvases sind winzig; der Schutz verliert an
 * dieser Grenze nichts.
 */
export const KOPIE_MAX_PIXEL = 16_777_216;

/**
 * Dieselbe Grenze fuer Canvases mit WEBGL-Kontext, aber viel enger:
 * 1024 x 1024.
 *
 * Bei 2D zahlt ein Canvas ohne Text nichts (Textregel); bei WebGL gibt es
 * keine Textregel, jeder Export nimmt die Kopiestrecke, und die kostet je
 * Bild `drawImage` vom WebGL-Puffer plus `getImageData`/`putImageData` auf
 * der Kopie - proportional zur Flaeche, nicht zum Rauschen. GEMESSEN
 * 05.09.2026 (Gegenprobe, Chrome for Testing 148, Apple Silicon, Mittel aus
 * drei Aufrufen): 1920 x 1080 `toDataURL` PNG 19 ms ohne / 51 ms mit,
 * JPEG 20 / 29 ms; 3840 x 2160 PNG 78 / 157 ms, `toBlob` WebP 331 / 510 ms.
 * Ein Bild-fuer-Bild-Recorder (CCapture: `toBlob` je Frame) fiel bei 4K
 * JPEG von rund 12 auf 7 Bilder je Sekunde. Die Probe misst diese Zeilen
 * seither selbst (`webglKosten`), und was sie zuletzt ergab, steht im
 * Katalog.
 *
 * Warum die Grenze nichts kostet: Fingerabdruck-Canvases sind winzig
 * (FingerprintJS2 und Cover Your Tracks 300 x 150, CreepJS kleiner), und ein
 * grosser WebGL-Export - Screenshot eines 3D-Viewers, Recorder - traegt
 * keine Wiedererkennung, die es nicht ohnehin ueber `readPixels` gaebe, das
 * bewusst offen bleibt (Objekt-Picking). Das WebGL-Rauschen richtet sich
 * gegen die Bibliotheken, die `toDataURL` auf dem kleinen Dreieck rufen,
 * nicht gegen jemanden, der es umgehen will; der hat `readPixels`.
 */
export const WEBGL_KOPIE_MAX_PIXEL = 1_048_576;

// ── Hashes ─────────────────────────────────────────────────────────────────

/**
 * FNV-1a, 32 Bit. Deterministisch, ohne Abhaengigkeit, in fuenf Zeilen.
 *
 * Er schluesselt Token und Host zum Seed; kryptographische Staerke braucht
 * das nicht (das Token selbst kommt aus `crypto.randomUUID`), wohl aber
 * dieselbe Zahl in jedem Rahmen derselben Seite, in jedem Browser, in Node.
 */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Die Endmischung aus MurmurHash3 (fmix32): Jedes Eingangsbit erreicht jedes
 * Ausgangsbit. Nur `Math.imul` und `>>>`, kein Gleitkomma: Gleitkomma
 * rundet je Plattform verschieden, und ein Rauschen, das auf zwei Rechnern
 * verschieden ausfaellt, waere selbst ein Merkmal.
 */
function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Zwei VERSCHIEDENE ungerade Konstanten fuer x und y. Waeren sie gleich,
 * gaebe `misch(s, 1, 2) === misch(s, 2, 1)`, und das Rauschen laege
 * spiegelsymmetrisch zur Diagonalen; ein Muster, das man sieht.
 */
const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;

/**
 * Ein Mischwert je Position, aus Seed und Koordinaten.
 *
 * SEQUENZIELL, nicht als XOR unabhaengiger Produkte: Erst x in den Seed
 * mischen und durchruehren, dann y. `seed ^ imul(x, C) ^ imul(y, C)` waere
 * kommutativ in x und y und gaebe keine Rauschflaeche, sondern ein Gitter.
 *
 * Koordinaten als int32 (`x | 0`): `getImageData` darf Bereiche ausserhalb
 * des Canvas lesen, dann sind absolute Koordinaten negativ, und `Math.imul`
 * verlangt ohnehin Ganzzahlen. So bleibt auch dort alles deterministisch.
 */
export function misch(seed: number, x: number, y: number): number {
  let h = seed | 0;
  h = fmix(h ^ Math.imul(x | 0, C1));
  h = fmix(h ^ Math.imul(y | 0, C2));
  return h >>> 0;
}

/** Seed einer Seite: Sitzungs-Token und Host, beides vom Hintergrund gebunden. */
export function seedAus(token: string, host: string): number {
  return hash32(`${token}|${host}`);
}

// ── Pixel ──────────────────────────────────────────────────────────────────

/**
 * Jede wievielte Zeile bearbeitet wird. Aus der Groesse des GANZEN Canvas,
 * nicht des gelesenen Ausschnitts: Ein 16 x 16-Ausschnitt und das Vollbild
 * muessen an derselben Stelle dieselben Werte tragen, sonst ist der
 * Unterschied zwischen beiden Aufrufformen selbst ein Merkmal.
 */
export function zeilenschritt(gesamtPixel: number): number {
  const k = Math.ceil(gesamtPixel / PIXEL_BUDGET);
  return k > 1 ? k : 1;
}

/** Dasselbe fuer Audioproben, aus der Laenge des ganzen Kanals. */
export function probenschritt(gesamtProben: number): number {
  const k = Math.ceil(gesamtProben / PROBEN_BUDGET);
  return k > 1 ? k : 1;
}

/**
 * Rauscht RGBA-Pixel in place. Ein Mischwert je Pixel aus den ABSOLUTEN
 * Koordinaten (`x0 + x`, `y0 + y`), damit Teilbereich und Vollbild an
 * derselben Stelle dasselbe ergeben.
 *
 * Die Regeln je Pixel, in dieser Reihenfolge:
 *
 * 1. Alpha != 255: Pixel unveraendert lassen. Chrome speichert Pixel
 *    vormultipliziert; bei halbtransparenten Pixeln ist schon der NATIVE
 *    Rundlauf getImageData → putImageData verlustbehaftet (gemessen:
 *    Abweichung bis 254 bei Alpha 3). Jede Aenderung dort waere weder
 *    idempotent noch klein. Deckende Pixel sind verlustfrei. Ein vollstaendig
 *    transparentes Canvas ergibt damit den nativen Leerhash; das ist
 *    gewollt, denn genau den liefert auch ein Browser ohne Erweiterung.
 * 2. Alpha wird NIE veraendert.
 * 2a. REINFARBEN bleiben, wie sie sind: Pixel, deren drei Kanaele je 0 oder
 *    255 sind (die acht Ecken des Farbwuerfels: Schwarz, Weiss, reines Rot,
 *    Gruen, Blau, Gelb, Cyan, Magenta). Phaser 3 (`MeasureText.js`) und
 *    PixiJS bis v7 (`TextMetrics.measureFont`) messen Schriftmetriken so:
 *    Canvas rot fuellen, Text schwarz malen, `getImageData`, von oben und
 *    unten die erste Zeile mit einem Pixel `R !== 255` suchen. Ein gesetztes
 *    Bit macht die Haelfte des roten Grunds zu 254, jede Zeile zur Textzeile,
 *    und ascent/descent sind falsch - je Schriftart gecacht, also jeder
 *    Text des Spiels falsch gesetzt (GEMESSEN 05.09.2026: 26px Arial
 *    ascent 24/descent 6 ohne, 30/14 mit Erweiterung). Die Entropie eines
 *    Fingerabdruck-Canvas steckt nicht in der Grundflaeche, sondern in den
 *    Kanten der Schrift, und die sind nie rein (Antialiasing); der Grund ist
 *    weiss oder ein Farbton wie #f60 (G = 102), und beide Muster
 *    (FingerprintJS, Cover Your Tracks) bleiben verschieden je Element.
 *    Idempotent bleibt es: Ein gesetztes Bit kann ein Pixel zur Reinfarbe
 *    machen (254 → 255); der zweite Durchlauf laesst es dann in Ruhe und
 *    liefert dasselbe wie der erste.
 * 3. In R, G und B wird das NIEDRIGSTE BIT GESETZT, nicht addiert:
 *    `wert = (wert & 0xFE) | bit`. Das ist idempotent (zweimal angewandt
 *    gibt dasselbe), die Abweichung vom Original bleibt fuer immer <= 1, und
 *    die Entropie ist dieselbe wie bei +-1 (jeder Kanal aendert sich mit
 *    Wahrscheinlichkeit 1/2). Ein additives Delta driftete in
 *    Lese-Schreib-Schleifen (p5.js `loadPixels`/`updatePixels` je Frame,
 *    Filterketten, Helligkeitsregler) linear bis zur Saettigung, weil
 *    derselbe Seed an derselben Position immer dasselbe Vorzeichen gab.
 * 4. Ueber PIXEL_BUDGET nur jede k-te Zeile (siehe `zeilenschritt`).
 */
/** Regel 2a: jeder Kanal 0 oder 255 - eine der acht Ecken des Farbwuerfels. */
export function istReinfarbe(r: number, g: number, b: number): boolean {
  return (r === 0 || r === 255) && (g === 0 || g === 255) && (b === 0 || b === 255);
}

export function verrauschePixel(
  daten: Uint8ClampedArray,
  breite: number,
  hoehe: number,
  seed: number,
  gesamtPixel: number,
  x0 = 0,
  y0 = 0,
): void {
  const k = zeilenschritt(gesamtPixel);
  for (let y = 0; y < hoehe; y++) {
    const ay = y0 + y;
    if (k > 1 && ay % k !== 0) continue;
    let i = y * breite * 4;
    for (let x = 0; x < breite; x++, i += 4) {
      if (daten[i + 3] !== 255) continue;
      if (istReinfarbe(daten[i]!, daten[i + 1]!, daten[i + 2]!)) continue;
      const m = misch(seed, x0 + x, ay);
      daten[i] = (daten[i]! & 0xfe) | (m & 1);
      daten[i + 1] = (daten[i + 1]! & 0xfe) | ((m >>> 1) & 1);
      daten[i + 2] = (daten[i + 2]! & 0xfe) | ((m >>> 2) & 1);
    }
  }
}

/**
 * Die Form, in der die Huellen es aufrufen: mit dem ganzen ImageData-Objekt.
 * Rauscht nur, wenn `data` ein `Uint8ClampedArray` ist, und sagt, ob es
 * das getan hat.
 *
 * Seit Chrome 133 liefert `getImageData(…, { pixelFormat: 'rgba-float16' })`
 * ein `Float16Array` mit Werten 0..1; Bitoperationen darauf zerstoeren das
 * Bild. HDR-Canvases sind als Fingerabdruckquelle bedeutungslos (kein
 * Tracker liest sie, die Hashes gaengiger Bibliotheken kommen aus
 * `toDataURL`) und bleiben deshalb bewusst unangetastet.
 */
export function verrauscheBild(
  bild: { data: unknown; width: number; height: number },
  seed: number,
  gesamtPixel: number,
  x0 = 0,
  y0 = 0,
): boolean {
  if (!(bild.data instanceof Uint8ClampedArray)) return false;
  verrauschePixel(bild.data, bild.width, bild.height, seed, gesamtPixel, x0, y0);
  return true;
}

/**
 * Der Ursprung eines `getImageData`-Aufrufs, so wie der Browser ihn
 * versteht. Zwei Dinge macht der Browser vor dem Lesen: Er wandelt jedes
 * Argument nach WebIDL `long` (`'10'` → 10, `0.9` → 0, `NaN` → 0), und bei
 * NEGATIVER Ausdehnung verschiebt er den Ursprung: `getImageData(100, 100,
 * -100, -100)` ist gueltig und liefert den Bereich 0,0,100,100. Zwei
 * Aufrufformen fuer denselben Bereich muessen dieselben Rauschwerte geben,
 * sonst ist der Unterschied selbst ein Merkmal; deshalb rechnet der Kern
 * denselben Ursprung aus wie der Browser.
 */
export function normiereBereich(sx: unknown, sy: unknown, sw: unknown, sh: unknown): { x0: number; y0: number } {
  const x = Math.trunc(Number(sx)) | 0;
  const y = Math.trunc(Number(sy)) | 0;
  const w = Math.trunc(Number(sw)) | 0;
  const h = Math.trunc(Number(sh)) | 0;
  return { x0: w < 0 ? x + w : x, y0: h < 0 ? y + h : y };
}

/**
 * Ob fuer ein Canvas dieser Groesse eine Kopie angelegt werden darf. Die
 * Grenze ist KOPIE_MAX_PIXEL (2D) bzw. WEBGL_KOPIE_MAX_PIXEL (WebGL); die
 * Huelle gibt die passende mit.
 */
export function darfKopieren(breite: number, hoehe: number, grenze: number = KOPIE_MAX_PIXEL): boolean {
  return breite > 0 && hoehe > 0 && breite * hoehe <= grenze;
}

// ── Audioproben ────────────────────────────────────────────────────────────

/**
 * Wie weit eine Probe hoechstens verschoben wird. Der Wert liegt weit unter
 * allem Hoerbaren (16-Bit-Audio loest 3e-5 auf), aber ueber der
 * Float32-Schrittweite bei Betraegen bis etwa 1 (6e-8), sodass ein
 * Summenwert wie der von FingerprintJS sich sicher aendert. Proben mit
 * Betrag ueber 2 haben eine groebere Schrittweite als das Delta und tragen
 * deshalb KEIN Rauschen; im Fingerabdruck-Fall (Kompressor, Betrag < 1)
 * kommt das nicht vor.
 */
export const PROBEN_DELTA = 1e-7;

/**
 * Rauscht Audioproben in place. Je Probe mit absolutem Index `i = start +
 * index` ein Delta aus `misch(seed, i, 0)`, auf -1..1 abgebildet und mit
 * PROBEN_DELTA skaliert.
 *
 * `start` gibt es nur fuer den Test (Teilstueck gleich Ganzes); die Huellen
 * rufen immer mit `start = 0` auf dem ganzen Kanal, und `gesamtProben`
 * ist dann `buffer.length`. Ueber PROBEN_BUDGET nur jede k-te Probe.
 *
 * PROBEN, DIE EXAKT 0 SIND, BLEIBEN 0. Das Gegenstueck zur Alpha-Regel bei
 * den Pixeln: Ein frisch angelegter Puffer (`createBuffer`) ist Stille, und
 * Seiten pruefen das exakt - `while (d[i] === 0) i++` schneidet fuehrende
 * Stille ab, Audio-Bibliotheken testen einen leeren Puffer auf lauter
 * Nullen. GEMESSEN 05.09.2026 ohne diese Regel: 1000 von 1000 Proben eines
 * leeren Puffers ungleich 0, der Stille-Schnitt fand keine Stille. Ein
 * Fingerabdruck liegt nie in der Stille; FingerprintJS summiert Proben
 * 4500..4999 hinter einem Kompressor, und die sind nie 0.
 *
 * NICHT idempotent, anders als die Pixel: Zweimal angewandt verschiebt es
 * doppelt. Die Huelle stellt deshalb sicher, dass jeder Kanal HOECHSTENS
 * EINMAL durch diese Funktion laeuft.
 */
export function verrauscheProben(daten: Float32Array, seed: number, start = 0, gesamtProben = start + daten.length): void {
  const k = probenschritt(gesamtProben);
  // Der erste Index >= start, der ein Vielfaches von k ist; danach in
  // Schritten von k, damit die Arbeit am Budget haengt und nicht an der
  // Laenge des Kanals (siehe PROBEN_BUDGET).
  const erster = k > 1 ? (k - (start % k)) % k : 0;
  for (let index = erster; index < daten.length; index += k) {
    const wert = daten[index]!;
    if (wert === 0) continue;
    const i = start + index;
    // 0..2^32-1 auf -1..1: erst teilen, dann verschieben, damit 0 und
    // 2^32-1 die Raender treffen.
    const delta = (misch(seed, i, 0) / 4294967295) * 2 - 1;
    daten[index] = wert + delta * PROBEN_DELTA;
  }
}

// ── Geraetezahlen und Plugins ──────────────────────────────────────────────

/**
 * Was `navigator.hardwareConcurrency` melden darf: drei haeufige Werte.
 * Bis zum 05.09.2026 stand fest 4 im Fenster. Das ist „haeufig", zaehlt bei
 * Cover Your Tracks aber nicht als randomisiert: Es vergleicht den Wert
 * zwischen zwei Domains (fetch_whorls.js, `hardware_concurrency`), und
 * dieselbe 4 auf beiden ist kein Unterschied. Ein Wert je Site verhindert
 * ausserdem, dass zwei Sites ueber die Kernzahl verknuepfen. Auf CYT trifft
 * er in zwei von drei Faellen einen anderen Wert als auf der Schwesterdomain;
 * das ist eine Wahrscheinlichkeit, keine Garantie, und so steht es im
 * Katalog.
 *
 * DIE RECHNUNG OHNE RESERVE, ehrlich: Sichere Punkte sind audio, canvas und
 * plugins. Der vierte ist WebGL - und nur, solange der Rechner WebGL hat.
 * Ohne GPU-Beschleunigung (VMs, Remote-Desktops, `--disable-gpu`) liefert
 * die FP2-Komponente auf beiden Domains dieselbe feste Antwort, der Hash
 * ist gleich, kein Punkt, und nichts in der Erweiterung aendert daran etwas.
 * Dann steht die Zaehlung bei 3 plus der Zwei-Drittel-Chance dieser Zeile.
 * Reserve gaebe es nur ueber einen weiteren Site-gebundenen Wert unter den
 * fuenf, und den gibt es nicht; das steht als offene Grenze im Katalog.
 */
export const KERNE_WERTE = [2, 4, 8] as const;

/**
 * Die y-Koordinate, unter der Kernzahl und Plugin aus dem Seed kommen.
 * Pixel mischen `misch(seed, x, y)` mit Canvas-Koordinaten, Audio mischt
 * `misch(kanalSeed, i, 0)`; eine Koordinate jenseits jeder Canvashoehe
 * haelt beides auseinander. Der Wert ist der ASCII-Text „KERN" bzw. „PLUG";
 * er bedeutet nichts, er muss nur eindeutig sein und in int32 passen.
 */
const KERNE_STROM = 0x4b45524e;
const PLUGIN_STROM = 0x504c5547;

/** Die Kernzahl einer Site: rein, deterministisch, immer aus KERNE_WERTE. */
export function kerneAus(seed: number): number {
  return KERNE_WERTE[misch(seed, 0, KERNE_STROM) % KERNE_WERTE.length]!;
}

/**
 * Begriffe, die in einem erfundenen Plugin-Namen nie vorkommen duerfen.
 * Erkennungscode (PDF-Viewer-Test, alte Flash-/Java-Weichen, DRM-Pruefung
 * auf Widevine) sucht `navigator.plugins` nach genau diesen Teilwoertern ab
 * und faende sonst etwas, das es nicht gibt - eine Seite, die dann das
 * Plugin anspricht, bricht. Die Woerter unten sind nach dem Muster
 * Konsonant-Vokal gebaut; von dieser Liste ist so nur „java" ueberhaupt
 * erreichbar, der Rest traegt Konsonantenhaeufungen. Geprueft wird trotzdem
 * die ganze Liste, damit ein anderes Buchstabenmuster spaeter nicht stumm
 * eine Luecke aufmacht.
 */
export const VERBOTENE_PLUGIN_BEGRIFFE = ['pdf', 'flash', 'java', 'silverlight', 'quicktime', 'shockwave', 'vlc', 'media', 'widevine'] as const;

/**
 * Die zweite Sperrliste: Teilwoerter, die ein Mensch nicht lesen soll, und
 * Marken, die niemandem untergeschoben werden sollen.
 *
 * Das Konsonant-Vokal-Muster erzeugt aus 14 Konsonanten und 5 Vokalen auch
 * das, was man nicht will. GEMESSEN 05.09.2026 (Gegenprobe, Node, 2 000 000
 * Seeds): „nazi" 528 je Million (z. B. „Naris Nazil"), „rape" 568 („Lerufar
 * Rapefa"), „anal" 272 („Bebas Pananal"), „tumor" 46 („Rigosa Tumor"),
 * „penis" 40 („Kamilo Penis"), „vagina" 3, dazu „kodak", „sonos", „lenovo",
 * „zotero". Der Name steht nicht mehr in einem Plugin-Dialog (Chrome zeigt
 * keinen), wohl aber in jedem Tracker-Log und jeder Bot-Erkennung, die die
 * Zeichenkette speichert - bei einem Namen je Site und Sitzung ueber alle
 * Nutzer sind das taeglich Hunderte.
 *
 * Eine LISTE, kein Beweis: Sie faengt, was aufgefallen ist und was sich mit
 * diesem Alphabet ueberhaupt bilden laesst (kein c, h, j, q, w, x, y; keine
 * Doppelkonsonanten). Wer einen Treffer findet, traegt ihn hier ein; der
 * Test unten fuehrt beide Listen ueber 100 000 Seeds. Geprueft wird als
 * Teilwort in beiden Pseudowoertern; ein Treffer wuerfelt neu (PLUGIN_VERSUCHE).
 */
export const VERBOTENE_TEILWOERTER = [
  // Gewalt, Sexuelles, Koerper
  'nazi', 'rape', 'anal', 'penis', 'vagina', 'vulva', 'semen', 'pedo', 'puta', 'pute', 'pene', 'boner', 'sado', 'labia',
  'tumor', 'gulag', 'satan', 'tote', 'neger', 'negro', 'niga', 'nigo', 'fuk', 'kut', 'lul', 'pik',
  // Kindersprache
  'kaka', 'pipi', 'popo', 'pupu',
  // Politik, Religion
  'putin', 'lenin', 'koran', 'bibel', 'obama', 'biden', 'modi',
  // Marken
  'kodak', 'sonos', 'lenovo', 'zotero', 'nokia', 'nike', 'puma', 'bose', 'sega', 'roku', 'vivo', 'moto', 'lego', 'nero',
  'nivea', 'duden', 'zara', 'mango', 'fila', 'tesa', 'adobe', 'opera',
] as const;

/**
 * Buchstaben der Pseudowoerter. Keine Halbvokale und keine Buchstaben, die
 * im Deutschen wie im Englischen nach Fremdwort aussehen (c, h, j, q, w, x,
 * y): Ein Name wie „Tolemi Vasuko" soll aussehen wie irgendein Firmenname,
 * nicht wie ein Zufallsstring - CYT und FingerprintJS hashen ihn nur, aber
 * ein Mensch im Plugin-Dialog eines Browsers liest ihn.
 */
const KONSONANTEN = 'bdfgklmnprstvz';
const VOKALE = 'aeiou';

/** Laenge eines Pseudoworts: 5 bis 7 Buchstaben (Kopf des Vertrags vom 05.09.2026). */
const WORT_MIN = 5;
const WORT_LAENGEN = 3;

/**
 * Wie oft `pluginAus` neu wuerfelt, wenn ein verbotener Begriff oder ein
 * gesperrtes Teilwort auftaucht oder beide Woerter gleich sind. Von der
 * Plugin-Liste ist nur „java" erreichbar (unter 1 zu 3000 je Wort); die
 * Teilwortliste trifft zusammen einige Promille je Wort. Nach so vielen
 * Versuchen bleibt praktisch nichts uebrig, und der Test unten prueft es an
 * 100 000 Seeds. Sind alle Versuche verbraucht, bleibt der letzte Wurf -
 * ein Name muss es geben, sonst fehlte der Plugin-Punkt ganz.
 */
const PLUGIN_VERSUCHE = 16;

/** Ein Pseudowort aus dem Seed, alles klein, Muster Konsonant-Vokal-Konsonant-… */
function pseudowort(seed: number, kanal: number): string {
  const laenge = WORT_MIN + (misch(seed, kanal, PLUGIN_STROM) % WORT_LAENGEN);
  let wort = '';
  for (let i = 0; i < laenge; i++) {
    const m = misch(seed, kanal, PLUGIN_STROM + 1 + i);
    wort += i % 2 === 0 ? KONSONANTEN[m % KONSONANTEN.length]! : VOKALE[m % VOKALE.length]!;
  }
  return wort;
}

function enthaeltVerbotenes(wort: string): boolean {
  for (const begriff of VERBOTENE_PLUGIN_BEGRIFFE) if (wort.includes(begriff)) return true;
  for (const teil of VERBOTENE_TEILWOERTER) if (wort.includes(teil)) return true;
  return false;
}

function gross(wort: string): string {
  return wort.charAt(0).toUpperCase() + wort.slice(1);
}

/** Die fuenf Felder, aus denen `fingerabdruck.ts` das erfundene Plugin samt MimeType baut. */
export type ErfundenesPlugin = {
  /** `Plugin.name`: „Wort1 Wort2". */
  name: string;
  /** `Plugin.description`: „Wort1 Wort2 Plugin". */
  beschreibung: string;
  /** `Plugin.filename`: „wort1-wort2.plugin". */
  datei: string;
  /** `MimeType.type`: „application/x-wort1-wort2". */
  mimeTyp: string;
  /** `MimeType.suffixes`: „wort1". */
  endung: string;
};

/**
 * Das erfundene Plugin einer Site, rein und deterministisch aus dem Seed.
 * Cover Your Tracks vergleicht die serialisierte Plugin-Liste zwischen
 * seinen zwei Domains (`identify_plugins` in fetch_whorls.js); ein Eintrag,
 * der je Site anders heisst, macht die Listen verschieden und gibt den
 * dritten sicheren Punkt neben Canvas und Audio (siehe KERNE_WERTE).
 *
 * DIE VORLAGE IST EINE SIGNATUR, nicht nur der Name. Ein Ausdruck auf
 * `filename` (`^[bdfgklmnprstvz][aeiou]…-[a-z]+\.plugin$`) und `type`
 * (`^application/x-[a-z]+-[a-z]+$`) trifft den erfundenen Eintrag in jedem
 * Lauf und keinen echten (GEMESSEN 05.09.2026: 3 von 3 mit, 0 von 3 ohne
 * Erweiterung). Wer die Zeile kennt, stellt die echte Liste wieder her und
 * gewinnt das Bit „AdSilence installiert", ohne die Erweiterungs-ID zu
 * kennen. Bewusst so gelassen: Auch eine gewuerfelte Endung und ein
 * gewuerfeltes MIME-Praefix liessen auf Chrome ab 94 jede sechste
 * Plugin-Zeile als Fremdkoerper stehen (dieselbe Klasse wie bei Brave), und
 * die Schicht ist gegen Massentracker gebaut, die die Zeichenkette hashen,
 * nicht gegen jemanden, der AdSilence sucht. Steht so im Katalog.
 */
export function pluginAus(seed: number): ErfundenesPlugin {
  let wort1 = '';
  let wort2 = '';
  for (let versuch = 0; versuch < PLUGIN_VERSUCHE; versuch++) {
    wort1 = pseudowort(seed, versuch * 2);
    wort2 = pseudowort(seed, versuch * 2 + 1);
    if (wort1 !== wort2 && !enthaeltVerbotenes(wort1) && !enthaeltVerbotenes(wort2)) break;
  }
  return {
    name: `${gross(wort1)} ${gross(wort2)}`,
    beschreibung: `${gross(wort1)} ${gross(wort2)} Plugin`,
    datei: `${wort1}-${wort2}.plugin`,
    mimeTyp: `application/x-${wort1}-${wort2}`,
    endung: wort1,
  };
}
