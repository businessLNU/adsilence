/**
 * Inhaltsskript, HAUPTWELT (`"world": "MAIN"`), `document_start`, alle
 * Rahmen, auch `about:blank`, `blob:` und `data:`.
 *
 * Aufgabe: den Fingerabdruck des Browsers verwischen. Canvas-Pixel (2D und
 * WebGL), Audioproben, die Kernzahl und die Plugin-Liste bekommen ein
 * Rauschen, das je Browsersitzung und je oberster Seite anders ausfaellt.
 * Wer ohne Cookies wiedererkennen will (FingerprintJS, Cover Your Tracks,
 * die Betrugsmerkmale der Zahlungsrahmen), rechnet aus genau diesen Werten
 * einen Hash; ist der Hash auf jeder Seite ein anderer, gibt es nichts
 * wiederzuerkennen.
 *
 * DAS GEHT NUR IN DER HAUPTWELT, aus demselben Grund wie bei `schatten.ts`:
 * Die Prototypen der isolierten Welt sind nicht die der Seite. Und wie dort
 * gilt: KEINE GLOBALE AUF `window`, kein Attribut, kein Element. Alles lebt
 * in der Closure von `start`.
 *
 * DREI DINGE ENTSCHEIDEN DIE BAUART:
 *
 * 1. EIN SEED JE SITE UND SITZUNG, kein Anteil je Element (das Modell von
 *    Brave). Dieselbe Zeichnung auf zwei Canvases derselben Seite gibt
 *    DENSELBEN Hash, ein zweiter Tab derselben Site auch; eine andere
 *    oberste Site gibt einen anderen, ein neues Browserprofil auch.
 *
 *    Bis zum 05.09.2026 bekam jedes Canvas-Element ein eigenes Salz, weil
 *    Cover Your Tracks angeblich zwei verschiedene Canvases brauchte. Am
 *    Quelltext gemessen (EFForg/panopticlick, static/fetch_whorls.js,
 *    main.py) stimmt das nicht: CYT laesst FingerprintJS2 ZWEIMAL auf
 *    derselben Seite laufen, und sind beide Laeufe verschieden, heisst der
 *    Wert nur noch der Text „randomized". Gezaehlt wird DANACH, zwischen
 *    zwei Domains (coveryourtracks.eff.org und firstpartysimulator.net):
 *    Jeder der fuenf Werte audio, canvas, webgl, plugins und Kernzahl, der
 *    sich zwischen den Domains unterscheidet, gibt einen Punkt, und ab vier
 *    Punkten heisst das Urteil „Your browser has a randomized fingerprint".
 *    Zwei gleiche Texte „randomized" auf zwei Domains sind KEIN Unterschied:
 *    Das Salz je Element brachte fuer Canvas genau null Punkte. Ausserdem
 *    verlangt FingerprintJS v4 Stabilitaet innerhalb der Seite (`toDataURL`
 *    zweimal auf demselben Canvas; verschieden heisst „unstable"), und
 *    Bot-Erkennungen werten wechselnde Werte auf einer Seite als
 *    Manipulation. Der Seed je Site erfuellt alle drei.
 *
 * 2. TEXTREGEL: Pixel werden nur verrauscht, wenn auf dem Element je
 *    `fillText` oder `strokeText` gelaufen ist. Fingerabdruck-Canvases
 *    malen IMMER Text oder Emoji, denn die Schriftdarstellung liefert die
 *    Entropie. Hit-Canvases enthalten NIE Text: Konva (react-konva, Polotno,
 *    Whiteboards) findet die Form unter dem Mauszeiger ueber
 *    `getImageData(x, y, 1, 1)` auf einem Schluesselfarben-Canvas und schlaegt
 *    den Hex-Wert in einer Tabelle nach; jede Abweichung um 1 ist ein
 *    Fehlschlag, und ohne die Regel ginge rund jeder ACHTE Klick nur noch
 *    durch: Jeder der drei Kanaele bleibt mit 1/2 unveraendert, alle drei
 *    zusammen mit (1/2)^3 (gemessen an 512 x 512 Schluesselfarben: 0,124).
 *    Pipetten in Bild-Editoren laesen sonst #FE0101 statt #FF0000.
 *
 * 3. ES GIBT KEINEN RUECKBAU. Ist die Seite eine Ausnahme, kommt vom
 *    isolierten Skript ein „aus", und die Huellen werden zu reinen
 *    Durchreichern; sie bleiben stehen. Ein Zurueckschreiben der
 *    Original-Deskriptoren loeschte stumm, was Skripte im `head` bis dahin
 *    selbst eingehuellt haben (Sentry Session Replay, PostHog und Highlight
 *    huellen `getContext` und jede 2D-Methode ein), ausgerechnet auf den
 *    Seiten, die der Nutzer freigegeben hat. Und eine schon gesicherte
 *    Referenz (`const echt = HTMLCanvasElement.prototype.toDataURL`, wie
 *    html2canvas es tut) erreichte ein Rueckbau ohnehin nie.
 *
 * REGELN FUER JEDE HUELLE: Methoden-Kurzschreibweise (kein `prototype`,
 * nicht konstruierbar), Deskriptor lesen und nur `value` bzw. `get`
 * tauschen (native Methoden sind AUFZAEHLBAR; ein getipptes `enumerable`
 * waere ein Merkmal), der echte Aufruf ZUERST und AUSSERHALB des `try`,
 * damit die Seite die native Ausnahme sieht, und scheitert danach
 * irgendetwas, kommt das echte, unveraenderte Ergebnis zurueck.
 *
 * WAS DIE SEITE SIEHT, wenn sie gezielt sucht: `Error().stack` in einem
 * `valueOf`-Argument nennt die Erweiterungs-ID (siehe `tarnkappe.ts`), ein
 * Worker meldet die echten Geraetezahlen und die echte Plugin-Liste (siehe
 * den Kommentar ueber SPEICHER_GB), das erfundene Plugin traegt einen
 * Namen, den sonst niemand hat, und eine VORLAGE (`.plugin`,
 * `application/x-a-b`, striktes Konsonant-Vokal-Muster), die ein regulaerer
 * Ausdruck in jedem Lauf trifft (siehe `pluginAus` im Kern) - so wie bei
 * Brave. Ein Kopiervorgang (`drawImage` in ein frisches Canvas,
 * `createImageBitmap`, `bitmaprenderer`, `createPattern`) traegt die
 * Textmarke nicht weiter, und die Kopie exportiert nativ (siehe `Buch`).
 * Das ist bekannt und steht im Katalog; die Schicht ist gegen Massentracker
 * gebaut, nicht gegen jemanden, der AdSilence beim Namen kennt.
 *
 * WAS DIE SEITE NICHT KANN: den Schutz mit einem eigenen Ereignis
 * abschalten. Der Kanal vom isolierten Skript traegt ein Geheimnis, das
 * beide Skripte bei `document_start` tauschen, bevor das erste Seitenskript
 * laeuft (`gemeinsam/fingerabdruck-kanal.ts`).
 */

import {
  EREIGNIS_FINGERABDRUCK,
  HANDSCHLAG_ANTWORT,
  HANDSCHLAG_FERTIG,
  HANDSCHLAG_FRAGE,
  dekodiere,
} from '../gemeinsam/fingerabdruck-kanal.ts';
import { tarne } from './tarnkappe.ts';
import {
  KOPIE_MAX_PIXEL,
  WEBGL_KOPIE_MAX_PIXEL,
  darfKopieren,
  kerneAus,
  misch,
  normiereBereich,
  pluginAus,
  seedAus,
  verrauscheBild,
  verrauscheProben,
  type ErfundenesPlugin,
} from './fingerabdruck-kern.ts';

/**
 * Was `navigator.hardwareConcurrency` meldet, kommt aus `kerneAus(seed)`:
 * je Site einer von drei haeufigen Werten (Begruendung dort). NICHT
 * unauffaellig: Ein Worker (`new Worker(blob)`) meldet die echte Zahl, denn
 * dort laeuft kein Inhaltsskript, und der Unterschied Fenster/Worker ist
 * selbst ein Merkmal, das CreepJS misst. Der Wert steht trotzdem hier, weil
 * Massentracker (Cover Your Tracks, FingerprintJS) nur das Fenster fragen;
 * gegen einen Worker-Vergleich hilft nur der Browser selbst. Das steht so im
 * Katalog.
 */
/** Was `navigator.deviceMemory` meldet: Chrome deckelt selbst bei 8, mehr gibt es dort nie. */
const SPEICHER_GB = 8;

/**
 * Buchfuehrung je Canvas-Element (siehe Kopf, Punkt 2): der Kontexttyp des
 * ersten `getContext` und ob je Text darauf gemalt wurde. Eine laufende
 * Nummer je Element gab es bis zum 05.09.2026 als Anteil am Seed; sie ist
 * weg, weil der Seed je Site gilt (Kopf, Punkt 1).
 *
 * DIE MARKE WANDERT NICHT MIT. `ctx.drawImage(textCanvas, 0, 0)` in ein
 * frisches Canvas kopiert die Pixel, nicht den Eintrag im Buch; die Kopie
 * exportiert nativ (GEMESSEN 05.09.2026: Kopie eines FingerprintJS-Canvas
 * per `drawImage`, `toDataURL` gleich dem Grundwert; ebenso ueber
 * `createImageBitmap` und fuer das FP2-Dreieck in ein 2D-Canvas). Bewusst
 * nicht geschlossen: Die Marke haette ueber `drawImage`, `createImageBitmap`,
 * `transferFromImageBitmap`, `createPattern` und `texImage2D` weitergereicht
 * werden muessen, um den Weg wirklich zuzumachen - und `readPixels` bliebe
 * offen. Jeder zusammengesetzte Canvas (Ebenen eines Editors, Doppelpuffer
 * eines Spiels mit HUD-Text) truege dann die Marke, und die Pipette darauf
 * laese um 1 daneben. Die Bibliotheken, gegen die die Schicht gebaut ist
 * (FingerprintJS, FP2, CYT, CreepJS), exportieren das gezeichnete Canvas
 * selbst. Steht im Katalog unter „bewusst nicht geschuetzt", und die Probe
 * misst den Weg als BEKANNT.
 */
type Buch = { typ: string | null; text: boolean };

/**
 * Kontexttypen, deren Canvas immer verrauscht wird (Kopf, Punkt 2: die
 * Textregel gilt nur fuer 2D, WebGL hat kein `fillText`). Verrauscht wird
 * NUR der Export ueber `toDataURL`, `toBlob` und `convertToBlob`; `readPixels`,
 * `getParameter`, `getSupportedExtensions` und die Shader-Praezision bleiben
 * unangetastet: Objekt-Picking ueber Farbcodes (three.js, Babylon) liest
 * `readPixels` bitgenau, und Vendor/Renderer stehen im Katalog als bewusst
 * nicht geschuetzt.
 */
const WEBGL_TYPEN = new Set(['webgl', 'webgl2', 'experimental-webgl', 'experimental-webgl2']);

/** Das erfundene Plugin einer Seite: die Felder aus dem Kern und die beiden Objekte dazu. */
type Erfunden = { daten: ErfundenesPlugin; plugin: object; mime: object };

/**
 * Was hinter einem unserer Objekte steckt, fuer die Huellen auf
 * `PluginArray.prototype`, `MimeTypeArray.prototype` und `Plugin.prototype`:
 * die KLASSE (der Prototyp, zu dem das Objekt gehoert), das echte Objekt
 * (bei einem Proxy; das erfundene Plugin hat keines), der erfundene Eintrag
 * samt Namen und die vollstaendige Liste, echte zuerst.
 *
 * `eintrag` und `name` sind Funktionen, keine Werte: Das erfundene Plugin
 * kann nach dem Eintreffen des Tokens neu gerechnet werden (siehe
 * `nebenSeed`), und der Proxy um die echte Liste bleibt derselbe -
 * `navigator.plugins === navigator.plugins` gilt ueber den Wechsel hinweg.
 *
 * Die Klasse steht dabei, weil die Huellen sonst klassenblind waeren: Der
 * `name`-Getter von `Plugin.prototype`, mit dem erfundenen MimeType als
 * `this` gerufen, lieferte `undefined` statt der nativen TypeError, und
 * `MimeTypeArray.prototype.item.call(navigator.plugins, 0)` ein Plugin
 * statt „Illegal invocation" (GEMESSEN 05.09.2026, fuenf solche Aufrufe).
 * Fuer einen Luegendetektor, der Prototyp-Getter mit falschem `this`
 * prueft, waren das fuenf Aufrufe, die nur mit dieser Erweiterung nicht
 * werfen. Jetzt uebernimmt eine Huelle nur, wenn die Buchfuehrung zu ihrer
 * Klasse passt; sonst laeuft der native Aufruf mit demselben `this` und
 * wirft mit demselben Text wie ohne Erweiterung.
 */
type Hinter = { klasse: object; echt: object | null; eintrag: () => object; name: () => string; alle: () => unknown[] };

(function start() {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    /**
     * `Reflect.apply` gefangen, bevor die Seite laeuft: Jede Huelle ruft ihr
     * Original hierueber, und `Function.prototype.apply`/`.call` sind
     * Eigenschaften, die eine Seite spaeter umbauen darf.
     */
    const rufe = Reflect.apply;

    // ── Zustand ─────────────────────────────────────────────────────────

    /** `false`, sobald das isolierte Skript `'0'` meldet (Ausnahme oder aus). */
    let aktiv = true;
    /** Der Seed der Seite; `null`, solange niemand ihn gebraucht hat und kein Token da ist. */
    let seed: number | null = null;

    const buch = new WeakMap<object, Buch>();
    /**
     * Die Kernzahl und das erfundene Plugin dieser Seite, sobald jemand sie
     * gelesen hat (siehe `nebenSeed`). `undefined`: noch nie gebraucht;
     * beim Plugin heisst `null`: der Bau ist gescheitert, es bleibt beim
     * echten Objekt. `nebenVorlaeufig` sagt, ob einer der beiden Werte ohne
     * Token gewuerfelt wurde; dann werden beide beim Eintreffen des Tokens
     * verworfen und aus dem Seed neu gerechnet.
     */
    let kerne: number | undefined;
    let erfundenes: Erfunden | null | undefined;
    let nebenVorlaeufig = false;
    /**
     * Je AudioBuffer die Kanaele, die erledigt sind: entweder verrauscht,
     * oder von der Seite per `copyToChannel` beschrieben (dann gehoeren die
     * Werte der Seite, und sie muss sie bitgleich zurueckbekommen).
     */
    const verrauscht = new WeakMap<object, Set<number>>();

    let zufallsquelle: ((a: Uint32Array) => Uint32Array) | null = null;
    try {
      const c = crypto;
      const f = c.getRandomValues;
      zufallsquelle = (a) => rufe(f, c, [a]) as Uint32Array;
    } catch {
      zufallsquelle = null;
    }

    function zufall(): number {
      try {
        if (zufallsquelle) {
          const a = new Uint32Array(1);
          zufallsquelle(a);
          return a[0]!;
        }
      } catch {
        // Kein `crypto` (sehr alte Umgebung, exotische Rahmen): dann Math.random.
      }
      return (Math.random() * 4294967296) >>> 0;
    }

    /**
     * Der Seed, sobald eine Huelle ihn braucht. Ist das Token noch nicht da,
     * wird er zufaellig festgelegt und bleibt fuer die Lebensdauer der Seite;
     * ein spaeter eintreffendes Token aendert ihn NICHT. Konsistenz innerhalb
     * der Seite geht vor Sitzungsbindung: Ein Canvas, das vor und nach dem
     * Ereignis verschieden aussieht, ist genau die Instabilitaet, an der
     * FingerprintJS den Wert verwirft und an der CreepJs „lies" zaehlt.
     *
     * DIE GRENZE DAVON, ehrlich: Das Token kommt ueber Inhaltsskript,
     * Service Worker und Ereignis, also immer NACH einem synchronen Skript im
     * `head`. Ein Bot-Schutz, der dort schon Canvas oder Audio anfasst
     * (Akamai, DataDome, PerimeterX, Cloudflare-Challenges), bekommt damit
     * einen Seed je Seitenaufruf, nicht je Sitzung (GEMESSEN 05.09.2026: zwei
     * Ladevorgaenge derselben Seite mit Kopfskript, zwei Audiosummen; ohne
     * Kopfskript dieselbe). Die Sitzungsbindung gilt fuer alles, was nach der
     * Antwort liest - FingerprintJS und Cover Your Tracks tun das. Frueher
     * geht es nicht: Das isolierte Skript hat keinen synchronen Speicher, und
     * ein registriertes Hauptwelt-Skript kann kein Token als Konstante
     * tragen (nur Dateien). Steht so im Katalog.
     */
    function holeSeed(): number {
      if (seed === null) seed = zufall();
      return seed;
    }

    /**
     * Der Seed fuer Kernzahl und Plugin - und NICHT `holeSeed`, solange das
     * Token fehlt. `navigator.hardwareConcurrency` und `navigator.plugins`
     * liest fast jede Seite frueh, in synchronen Kopfskripten (Worker-Pools,
     * PDF-Weichen, Analytics), also vor der Antwort des Hintergrunds. Legte
     * dieser Zugriff ueber `holeSeed` den zufaelligen Seed fest, bekaeme
     * die Seite bei jedem Laden ein anderes Canvas und anderes Audio -
     * genau die Instabilitaet, die der Hintergrund als „zu zufaellig"
     * beschreibt, und das auf fast jeder Seite.
     *
     * Ohne Token kommt deshalb ein eigener Zufallswert, und er ist
     * VORLAEUFIG: Trifft das Token ein, werden Kernzahl und Plugin aus dem
     * Site-Seed neu gerechnet (`beiNachricht`). Bis zum 05.09.2026 blieb
     * der fruehe Wert fuer die ganze Seite stehen, mit der Begruendung, es
     * treffe „nur den einen Wert, der frueh gelesen wurde". GEMESSEN
     * (Gegenprobe, drei Ladevorgaenge derselben Site mit Kopfskript): Kerne
     * 4 / 2 / 4, Plugin „Farufat Midaba" / „Botel Limepe" / „Moguli Bipofo" -
     * bei jedem Laden anders, auch fuer alle SPAETEN Leser, denn der Wert war
     * gemerkt; und ein about:blank-Rahmen derselben Seite meldete den
     * Seed-Wert, also etwas anderes als sein Elternfenster. Ein Plugin-Name,
     * der je Seitenaufruf wechselt, waehrend das Canvas stabil ist, ist
     * auffaelliger als ein Canvas-Hash, und Eltern und Kind, die sich
     * widersprechen, ist genau der Vergleich, den CreepJS faehrt.
     *
     * Jetzt sehen alle Leser nach der Antwort (FingerprintJS, CYT, Bot-
     * Skripte nach dem Laden) und alle Rahmen den Wert je Site. Was bleibt:
     * Die erste, fruehe Lesung ist je Seitenaufruf zufaellig, und ein
     * Skript, das frueh UND spaet liest und vergleicht, sieht den Wechsel.
     * Das ist dieselbe Grenze wie beim Canvas (Token-Timing) und steht so
     * im Katalog. Ist der Seed schon da, kommt alles aus derselben Quelle.
     */
    function nebenSeed(): number {
      if (seed !== null) return seed;
      nebenVorlaeufig = true;
      return zufall();
    }

    /**
     * Der Seed wird erst beim Rauschen gebraucht, nicht schon beim Eintrag:
     * Sonst legte das erste `getContext` der Seite (meist ein WebGL- oder
     * UI-Canvas, lange vor der Antwort des Hintergrunds) den zufaelligen
     * Seed fest, und das Token kaeme nie mehr zum Zug.
     */
    function eintrag(canvas: object): Buch {
      let b = buch.get(canvas);
      if (!b) {
        b = { typ: null, text: false };
        buch.set(canvas, b);
      }
      return b;
    }

    /**
     * Der eigene Host fuer die Seed-Bindung. In `about:blank`-, `srcdoc`-,
     * `blob:`- und `data:`-Rahmen ist `location.hostname` leer; dort gilt
     * der Host des Elternrahmens (`ancestorOrigins` in Chromium, sonst
     * `parent.location`, was nur same-origin gelingt). Dieselbe Herleitung
     * macht `kosmetik.ts`, damit beide Welten vom selben Host reden.
     */
    function eigenerHost(): string {
      try {
        const p = location.protocol;
        const h = location.hostname;
        if (h && (p === 'http:' || p === 'https:')) return h.toLowerCase();
      } catch {
        // Kein Zugriff: weiter mit den Eltern.
      }
      try {
        const vorfahren = location.ancestorOrigins;
        if (vorfahren && vorfahren.length > 0) {
          const h = new URL(vorfahren[0]!).hostname;
          if (h) return h.toLowerCase();
        }
      } catch {
        // Firefox kennt `ancestorOrigins` nicht.
      }
      try {
        if (parent !== window) {
          const h = parent.location.hostname;
          if (h) return h.toLowerCase();
        }
      } catch {
        // Cross-Origin-Eltern (Firefox ohne `ancestorOrigins`): dann ist der
        // Host leer, wie im isolierten Skript, und der Seed kommt aus
        // Token und leerem Host - das Token ist ohnehin an die oberste
        // Seite gebunden.
      }
      return '';
    }

    // ── Der Handschlag mit dem isolierten Skript ─────────────────────────
    // Siehe `gemeinsam/fingerabdruck-kanal.ts`. Beides laeuft vor dem ersten
    // Seitenskript; danach gibt es das Geheimnis nur in zwei Closures.

    /** Das Geheimnis des Handschlags; `null`, solange keine Antwort kam. */
    let geheimnis: string | null = null;

    try {
      const beiAntwort = (e: Event): void => {
        if (geheimnis !== null) return;
        try {
          const detail = (e as CustomEvent<unknown>).detail;
          if (typeof detail !== 'string' || detail.length === 0) return;
          geheimnis = detail;
          document.removeEventListener(HANDSCHLAG_ANTWORT, beiAntwort, true);
          document.dispatchEvent(new CustomEvent(HANDSCHLAG_FERTIG));
        } catch {
          // Dann bleibt der Handschlag offen; die naechste Antwort zaehlt.
        }
      };
      document.addEventListener(HANDSCHLAG_ANTWORT, beiAntwort, true);
      document.dispatchEvent(new CustomEvent(HANDSCHLAG_FRAGE));
    } catch {
      // Ohne Handschlag gibt es kein Geheimnis, und ohne Geheimnis nimmt der
      // Lauscher unten nichts an: Der Schutz bleibt an, mit Seed je Seite.
      // Das ist die sichere Richtung; ein „aus", dem niemand trauen kann,
      // waere die andere.
    }

    // ── Der Kanal vom isolierten Skript ──────────────────────────────────

    // Auf WINDOW, capture. Das Skript hier laeuft vor jedem Seitenskript;
    // Lauscher am selben Ziel feuern in Registrierreihenfolge, und `window`
    // ist das erste Ziel im Capture-Pfad. `stopImmediatePropagation` dort
    // nimmt einem spaeter registrierten Lauscher der Seite das Token - aber
    // NUR bei einem Ereignis, das das Geheimnis traegt: Ein fremdes Ereignis
    // mit demselben Namen wird weder angehalten (die Seite soll ihr eigenes
    // Ereignis sehen wie ohne Erweiterung) noch verbraucht es den Lauscher.
    // KEIN `once: true`: Damit haette ein Kopfskript mit `detail: 'x'` den
    // Lauscher weggenommen, und die echte Antwort waere nie angekommen.
    try {
      const beiNachricht = (e: Event): void => {
        try {
          if (geheimnis === null) return;
          const f = dekodiere(geheimnis, (e as CustomEvent<unknown>).detail);
          if (!f) return;
          try {
            e.stopImmediatePropagation();
          } catch {
            // Fremdes Ereignisobjekt ohne die Methode: das Token ist dann ohnehin gelesen.
          }
          window.removeEventListener(EREIGNIS_FINGERABDRUCK, beiNachricht, true);
          if (!f.an) {
            aktiv = false;
            return;
          }
          if (f.token !== null && seed === null) {
            seed = seedAus(f.token, eigenerHost());
            // Kernzahl und Plugin, die vor dem Token gewuerfelt wurden,
            // werden verworfen; der naechste Zugriff rechnet sie aus dem
            // Seed (siehe `nebenSeed`). Der Proxy um `navigator.plugins`
            // bleibt derselbe - er fragt den Eintrag jedes Mal neu ab.
            if (nebenVorlaeufig) {
              nebenVorlaeufig = false;
              kerne = undefined;
              erfundenes = undefined;
            }
          }
        } catch {
          // Ein fremdes Ereignis mit demselben Namen: ignorieren, Lauscher behalten.
        }
      };
      window.addEventListener(EREIGNIS_FINGERABDRUCK, beiNachricht, true);
    } catch {
      // Kein `addEventListener`: dann bleibt der Seed seitenweise zufaellig.
    }

    // ── Argumente EINMAL umwandeln ───────────────────────────────────────

    /**
     * Ein Objekt-Argument (`{ valueOf() { … } }`) wird nativ genau einmal
     * in eine Zahl gewandelt. Ruft die Huelle nach dem echten Aufruf noch
     * `Number(arg)`, laeuft `valueOf` ein zweites Mal - ein Luegendetektor
     * derselben Klasse wie die im Kopf (GEMESSEN 05.09.2026: 1 Aufruf ohne,
     * 2 mit Erweiterung). Deshalb wandelt die Huelle Objekte VOR dem echten
     * Aufruf selbst um, mit `+v` (dieselbe ToNumber-Regel wie WebIDL, auch
     * fuer BigInt: TypeError), und reicht dem Original die Zahl. Primitive
     * bleiben unangetastet; dort wandelt der Browser ohne Nebenwirkung.
     * Nur die genannten Positionen: Das fuenfte Argument von `getImageData`
     * ist ein Einstellungsobjekt, das erste von `copyFromChannel` das
     * Ziel-Array - beides keine Zahl (GEMESSEN 05.09.2026: ein `+ziel` machte
     * daraus NaN, und der echte Aufruf warf).
     */
    /** Die Zahlpositionen: `getImageData(sx, sy, sw, sh)`, `getChannelData(kanal)` und `item(index)`, `copy…Channel(array, kanal)`. */
    const BEREICH = [0, 1, 2, 3] as const;
    const ERSTES_ARGUMENT = [0] as const;
    const ZWEITES_ARGUMENT = [1] as const;

    /**
     * Dasselbe fuer Zeichenketten: Ein Objektargument wird genau einmal
     * umgewandelt, und das Ergebnis geht an Vergleich UND echten Aufruf.
     * `namedItem(new String(name))` muss den erfundenen Eintrag ebenso
     * finden wie einen echten (siehe dort).
     */
    function einmalStrings(a: unknown[], positionen: readonly number[]): unknown[] {
      let kopie: unknown[] | null = null;
      for (const i of positionen) {
        if (i >= a.length) continue;
        const v = a[i];
        if ((typeof v === 'object' && v !== null) || typeof v === 'function') {
          if (!kopie) kopie = a.slice();
          kopie[i] = `${v as unknown as string}`;
        }
      }
      return kopie ?? a;
    }

    function einmalZahlen(a: unknown[], positionen: readonly number[]): unknown[] {
      let kopie: unknown[] | null = null;
      for (const i of positionen) {
        if (i >= a.length) continue;
        const v = a[i];
        if ((typeof v === 'object' && v !== null) || typeof v === 'function') {
          if (!kopie) kopie = a.slice();
          kopie[i] = +(v as unknown as number);
        }
      }
      return kopie ?? a;
    }

    // ── Werkzeug fuer Huellen ────────────────────────────────────────────

    type Deskriptorziel = { obj: object; name: string | symbol };

    /**
     * Tauscht `value` einer Methode gegen eine Huelle, die `bau` aus dem
     * Original macht. Liefert Original und Huelle, oder `null`, wenn es die
     * Methode nicht gibt (dann wird nichts erfunden).
     */
    function ersetzeMethode(ziel: Deskriptorziel, bau: (echt: Function) => Function): { echt: Function; huelle: Function } | null {
      try {
        const desk = Object.getOwnPropertyDescriptor(ziel.obj, ziel.name);
        if (!desk || typeof desk.value !== 'function') return null;
        const echt = desk.value as Function;
        const huelle = bau(echt);
        tarne(huelle, echt);
        desk.value = huelle;
        Object.defineProperty(ziel.obj, ziel.name, desk);
        return { echt, huelle };
      } catch {
        return null;
      }
    }

    /**
     * Tauscht einen Getter. Der Huellen-Getter ruft ZUERST den echten mit
     * demselben `this`: Bei fremdem `this` kommt so die native TypeError
     * „Illegal invocation". Erst danach rechnet `ab` aus dem echten Wert
     * den unseren; scheitert das, oder ist der Schutz aus, bleibt der echte.
     */
    function ersetzeGetter(ziel: Deskriptorziel, ab: (echterWert: unknown) => unknown): void {
      try {
        const desk = Object.getOwnPropertyDescriptor(ziel.obj, ziel.name);
        if (!desk || typeof desk.get !== 'function') return;
        const echt = desk.get as Function;
        const traeger = {
          get [ziel.name](): unknown {
            const echterWert = rufe(echt, this, []);
            if (!aktiv) return echterWert;
            try {
              return ab(echterWert);
            } catch {
              return echterWert;
            }
          },
        };
        const huelle = Object.getOwnPropertyDescriptor(traeger, ziel.name)!.get!;
        tarne(huelle, echt);
        desk.get = huelle;
        Object.defineProperty(ziel.obj, ziel.name, desk);
      } catch {
        // Ohne diesen Wert bleibt der Rest des Schutzes stehen.
      }
    }

    /** Ein Getter, unveraendert, zum spaeteren Aufruf mit `rufe`. */
    function getter(obj: object | undefined, name: string): Function | null {
      try {
        if (!obj) return null;
        const desk = Object.getOwnPropertyDescriptor(obj, name);
        return desk && typeof desk.get === 'function' ? desk.get : null;
      } catch {
        return null;
      }
    }

    function setter(obj: object | undefined, name: string): Function | null {
      try {
        if (!obj) return null;
        const desk = Object.getOwnPropertyDescriptor(obj, name);
        return desk && typeof desk.set === 'function' ? desk.set : null;
      } catch {
        return null;
      }
    }

    function methode(obj: object | undefined, name: string): Function | null {
      try {
        if (!obj) return null;
        const desk = Object.getOwnPropertyDescriptor(obj, name);
        return desk && typeof desk.value === 'function' ? desk.value : null;
      } catch {
        return null;
      }
    }

    // ── Die Prototypen, so wie der Browser sie mitbringt ─────────────────

    const g = globalThis as unknown as Record<string, { prototype?: object } | undefined>;
    const CanvasEl = g['HTMLCanvasElement'];
    const Offscreen = g['OffscreenCanvas'];
    const Ctx2d = g['CanvasRenderingContext2D'];
    const OffCtx2d = g['OffscreenCanvasRenderingContext2D'];
    const Audio = g['AudioBuffer'];
    const Nav = g['Navigator'];

    /**
     * Zugriff auf Masse und Kontext einer Canvas-Familie ueber die ECHTEN
     * Accessoren. `this.width` waere ein Aufruf in die Seite hinein, und
     * Seiten huellen `width` ein (Session Replay, Polyfills).
     */
    type Familie = {
      breite: Function | null;
      hoehe: Function | null;
      setzeBreite: Function | null;
      setzeHoehe: Function | null;
      getContext: Function | null;
    };

    function familie(klasse: { prototype?: object } | undefined): Familie {
      const p = klasse?.prototype;
      return {
        breite: getter(p, 'width'),
        hoehe: getter(p, 'height'),
        setzeBreite: setter(p, 'width'),
        setzeHoehe: setter(p, 'height'),
        getContext: null,
      };
    }

    const elementFamilie = familie(CanvasEl);
    const offscreenFamilie = familie(Offscreen);

    function masse(f: Familie, canvas: object): { breite: number; hoehe: number } | null {
      if (!f.breite || !f.hoehe) return null;
      const breite = rufe(f.breite, canvas, []) as number;
      const hoehe = rufe(f.hoehe, canvas, []) as number;
      return typeof breite === 'number' && typeof hoehe === 'number' ? { breite, hoehe } : null;
    }

    // ── getContext: nur Buchfuehrung ─────────────────────────────────────

    function huelleGetContext(f: Familie, klasse: { prototype?: object } | undefined): void {
      if (!klasse?.prototype) return;
      f.getContext =
        ersetzeMethode(
          { obj: klasse.prototype, name: 'getContext' },
          (echt) =>
            ({
              getContext(this: unknown, ...a: unknown[]) {
                const ctx = rufe(echt, this, a);
                try {
                  // Nur ein String wird vermerkt: `String(a[0])` riefe die
                  // Typumwandlung der Seite ein zweites Mal auf.
                  if (aktiv && ctx && typeof this === 'object' && this !== null) {
                    const b = eintrag(this);
                    if (b.typ === null) b.typ = typeof a[0] === 'string' ? a[0] : 'unbekannt';
                  }
                } catch {
                  // Buchfuehrung gescheitert; die Seite bekommt ihren Kontext.
                }
                return ctx;
              },
            }).getContext,
        )?.echt ?? null;
    }

    huelleGetContext(elementFamilie, CanvasEl);
    huelleGetContext(offscreenFamilie, Offscreen);

    // ── fillText / strokeText: die Textregel ─────────────────────────────

    function huelleText(klasse: { prototype?: object } | undefined): void {
      const p = klasse?.prototype;
      if (!p) return;
      const holeCanvas = getter(p, 'canvas');
      if (!holeCanvas) return;
      for (const name of ['fillText', 'strokeText']) {
        ersetzeMethode({ obj: p, name }, (echt) => {
          const traeger = {
            [name](this: unknown, ...a: unknown[]) {
              const r = rufe(echt, this, a);
              try {
                if (aktiv) {
                  const c = rufe(holeCanvas, this, []) as object | null;
                  if (c) eintrag(c).text = true;
                }
              } catch {
                // Kein Canvas hinter dem Kontext (abgeloester Kontext): nichts zu merken.
              }
              return r;
            },
          };
          return traeger[name]!;
        });
      }
    }

    huelleText(Ctx2d);
    huelleText(OffCtx2d);

    // ── getImageData: Rauschen auf der Kopie, die der Browser ohnehin liefert ─

    function huelleGetImageData(klasse: { prototype?: object } | undefined, f: Familie): void {
      const p = klasse?.prototype;
      if (!p) return;
      const holeCanvas = getter(p, 'canvas');
      if (!holeCanvas) return;
      ersetzeMethode(
        { obj: p, name: 'getImageData' },
        (echt) =>
          ({
            getImageData(this: unknown, ...a: unknown[]) {
              const args = einmalZahlen(a, BEREICH);
              const bild = rufe(echt, this, args) as { data: unknown; width: number; height: number };
              try {
                if (!aktiv) return bild;
                const c = rufe(holeCanvas, this, []) as object | null;
                const b = c ? buch.get(c) : undefined;
                if (!b || !b.text) return bild;
                const m = masse(f, c!);
                if (!m) return bild;
                // Breite und Hoehe aus dem RESULT, der Ursprung aus den
                // Argumenten, wie der Browser sie versteht.
                const { x0, y0 } = normiereBereich(args[0], args[1], args[2], args[3]);
                verrauscheBild(bild, holeSeed(), m.breite * m.hoehe, x0, y0);
              } catch {
                // Dann eben das echte Bild; besser als eine Ausnahme aus einer Huelle.
              }
              return bild;
            },
          }).getImageData,
      );
    }

    // Die NATIVEN Methoden der Kopiestrecke, gefangen BEVOR die Huellen um
    // `getImageData` stehen. Bis zum 05.09.2026 stand dieser Block hinter
    // `huelleGetImageData`, und `echtGetImageData2d` war die eigene Huelle;
    // doppeltes Rauschen blieb nur aus, weil die Kopie nicht im Buch steht.
    // Wer die Buchfuehrung aendert, haette es dann bekommen, und kein Test
    // haette es gefangen.
    const echtGetContextAttributes2d = methode(Ctx2d?.prototype, 'getContextAttributes');
    const echtDrawImage2d = methode(Ctx2d?.prototype, 'drawImage');
    const echtGetImageData2d = methode(Ctx2d?.prototype, 'getImageData');
    const echtPutImageData2d = methode(Ctx2d?.prototype, 'putImageData');
    const echtGetContextAttributesOff = methode(OffCtx2d?.prototype, 'getContextAttributes');
    const echtDrawImageOff = methode(OffCtx2d?.prototype, 'drawImage');
    const echtGetImageDataOff = methode(OffCtx2d?.prototype, 'getImageData');
    const echtPutImageDataOff = methode(OffCtx2d?.prototype, 'putImageData');

    huelleGetImageData(Ctx2d, elementFamilie);
    huelleGetImageData(OffCtx2d, offscreenFamilie);

    // ── Kopiestrecke fuer toDataURL, toBlob, convertToBlob ───────────────

    const echtCreateElementNS = methode(g['Document']?.prototype, 'createElementNS');

    /**
     * Der XHTML-Namensraum, vom Browser erfragt statt hingeschrieben: Ein
     * `HTMLImageElement` traegt ihn immer, gleich in welchem Dokument. Der
     * Waechter `tests/hintergrund/pruefe-netz.test.ts` haelt jede
     * ausgeschriebene http-Adresse im Quelltext fuer ein Netzziel; eine
     * Ausnahme dort waere die zweite Stelle, die diesen Namensraum kennt.
     */
    let XHTML: string | null = null;
    try {
      XHTML = new Image().namespaceURI;
    } catch {
      XHTML = null;
    }
    const OffscreenKonstruktor = Offscreen as unknown as (new (b: number, h: number) => object) | undefined;

    /**
     * Arbeitsflaechen, je Familie und je Kontextattribut-Kombination eine.
     *
     * Warum nicht genau EINE: `getContext('2d', attribute)` auf einem Canvas,
     * das schon einen Kontext hat, liefert DIESEN und ignoriert die
     * Attribute; `alpha` und `colorSpace` stehen nach dem ersten Aufruf fest.
     * Eine Flaeche fuer sRGB-mit-Alpha kann eine display-p3-Zeichnung nicht
     * aufnehmen, sie kaeme entsaettigt heraus. Also je Kombination eine, das
     * sind hoechstens vier je Familie, und jede steht zwischen zwei Aufrufen
     * auf 0 x 0, damit sie keinen Speicher haelt.
     */
    const arbeitsflaechen = new Map<string, object>();

    type Strecke = {
      f: Familie;
      getContextAttributes: Function | null;
      drawImage: Function | null;
      getImageData: Function | null;
      putImageData: Function | null;
      neu: (original: object, breite: number, hoehe: number) => object | null;
    };

    const elementStrecke: Strecke = {
      f: elementFamilie,
      getContextAttributes: echtGetContextAttributes2d,
      drawImage: echtDrawImage2d,
      getImageData: echtGetImageData2d,
      putImageData: echtPutImageData2d,
      neu: (original) => {
        if (!echtCreateElementNS || !XHTML) return null;
        // Ueber die ECHTE `createElementNS` auf dem eigenen Dokument des
        // Originals: Seiten ueberschreiben `document.createElement`, und in
        // einem XML-Dokument liefert `createElement('canvas')` kein
        // HTMLCanvasElement.
        const dok = (original as { ownerDocument?: Document }).ownerDocument ?? document;
        return rufe(echtCreateElementNS, dok, [XHTML, 'canvas']) as object;
      },
    };

    const offscreenStrecke: Strecke = {
      f: offscreenFamilie,
      getContextAttributes: echtGetContextAttributesOff,
      drawImage: echtDrawImageOff,
      getImageData: echtGetImageDataOff,
      putImageData: echtPutImageDataOff,
      neu: (_original, breite, hoehe) => (OffscreenKonstruktor ? new OffscreenKonstruktor(breite, hoehe) : null),
    };

    function setzeMasse(f: Familie, canvas: object, breite: number, hoehe: number): void {
      if (f.setzeBreite) rufe(f.setzeBreite, canvas, [breite]);
      if (f.setzeHoehe) rufe(f.setzeHoehe, canvas, [hoehe]);
    }

    function leere(f: Familie, canvas: object): void {
      try {
        setzeMasse(f, canvas, 0, 0);
      } catch {
        // Dann haelt die Flaeche ihren Speicher bis zum naechsten Aufruf.
      }
    }

    /**
     * Legt eine verrauschte Kopie des Originals auf eine Arbeitsflaeche und
     * gibt sie zurueck, oder `null`, wenn es dafuer keinen Grund oder keine
     * Moeglichkeit gibt. Dann ruft die Huelle das Original, und die Seite
     * sieht genau das, was sie ohne Erweiterung saehe, einschliesslich der
     * nativen Ausnahme: Ein SecurityError durch ein verunreinigtes Canvas
     * kommt hier aus `getImageData` der Kopie, wird geschluckt, und der
     * Aufruf am Original wirft ihn dann selbst.
     */
    /**
     * `getContextAttributes` und `drawingBufferColorSpace` der beiden
     * WebGL-Kontextklassen, nativ gefangen. Welche der beiden zu einem
     * Kontext gehoert, entscheidet der Aufruf selbst: Die falsche wirft
     * „Illegal invocation", dann kommt die andere dran.
     */
    const webglKlassen = [g['WebGL2RenderingContext'], g['WebGLRenderingContext']].map((k) => ({
      getContextAttributes: methode(k?.prototype, 'getContextAttributes'),
      farbraum: getter(k?.prototype, 'drawingBufferColorSpace'),
    }));

    /**
     * Alpha und Farbraum eines WebGL-Kontexts fuer die 2D-Kopie, oder
     * `null`, wenn die Kopie nicht treu waere: `premultipliedAlpha: false`
     * bei durchsichtigem Puffer. Die native `toDataURL` nimmt so einen
     * Puffer unvermultipliziert, wie er ist; eine 2D-Flaeche speichert
     * vormultipliziert, und halbtransparente Pixel kaemen aus ihr veraendert
     * zurueck - derselbe Verlust, den die Alpha-Regel im Kern bei 2D
     * vermeidet, hier aber schon vor dem Rauschen. Dann lieber kein Schutz
     * als ein falsches Bild; three.js und Babylon lassen den Vorgabewert
     * `true`, FingerprintJS2 auch.
     */
    function webglAttribute(ctx: object): { alpha: boolean; colorSpace: string } | null {
      for (const k of webglKlassen) {
        if (!k.getContextAttributes) continue;
        let attr: { alpha?: boolean; premultipliedAlpha?: boolean } | null;
        try {
          attr = rufe(k.getContextAttributes, ctx, []) as typeof attr;
        } catch {
          continue;
        }
        const alpha = attr?.alpha !== false;
        if (alpha && attr?.premultipliedAlpha === false) return null;
        let colorSpace = 'srgb';
        try {
          if (k.farbraum) {
            const f = rufe(k.farbraum, ctx, []);
            if (typeof f === 'string') colorSpace = f;
          }
        } catch {
          // Aelterer Browser ohne `drawingBufferColorSpace`: dort ist alles sRGB.
        }
        return { alpha, colorSpace };
      }
      return null;
    }

    function verrauschteKopie(strecke: Strecke, original: object, schluesselPraefix: string): { kopie: object; f: Familie } | null {
      const b = buch.get(original);
      if (!b || b.typ === null) return null;
      // WebGL immer, 2D nur mit Text (Kopf, Punkt 2 und WEBGL_TYPEN).
      const webgl = WEBGL_TYPEN.has(b.typ);
      if (!webgl && (b.typ !== '2d' || !b.text)) return null;
      const f = strecke.f;
      if (!f.getContext || !strecke.drawImage || !strecke.getImageData || !strecke.putImageData) return null;
      const m = masse(f, original);
      // WebGL hat die engere Grenze: kein Text, also zahlt jeder Export
      // (Begruendung und Messung an WEBGL_KOPIE_MAX_PIXEL im Kern).
      if (!m || !darfKopieren(m.breite, m.hoehe, webgl ? WEBGL_KOPIE_MAX_PIXEL : KOPIE_MAX_PIXEL)) return null;

      // Den Kontext des Originals holen: `getContext` mit dem vermerkten Typ
      // auf einem Canvas, das diesen Kontext schon hat, liefert ihn
      // unveraendert. `drawImage` vom WebGL-Canvas liest denselben
      // Zeichenpuffer wie die native `toDataURL` - das ist der Grund, warum
      // die Kopie treu ist, und nur der. Ob der Puffer nach dem Compositing
      // ohne `preserveDrawingBuffer` noch steht, entscheidet Chrome; beide
      // Wege sehen dasselbe. GEMESSEN 05.09.2026 (Gegenprobe, `clear` mit
      // Farbe, `toDataURL` sofort und nach zwei Frames plus 100 ms): ohne
      // Erweiterung derselbe Hash vorher und nachher, mit Erweiterung ein
      // anderer, aber ebenfalls vorher gleich nachher. „In beiden Faellen
      // leer" stand hier bis dahin und war so nicht messbar - Chrome behaelt
      // den Puffer bis zum naechsten Zeichenbefehl. Die Probe misst die
      // Zeile seither mit.
      const ctxOriginal = rufe(f.getContext, original, [b.typ]) as object | null;
      if (!ctxOriginal) return null;

      let alpha = true;
      let colorSpace = 'srgb';
      if (webgl) {
        const attr = webglAttribute(ctxOriginal);
        if (!attr) return null;
        alpha = attr.alpha;
        colorSpace = attr.colorSpace;
      } else if (strecke.getContextAttributes) {
        const attr = rufe(strecke.getContextAttributes, ctxOriginal, []) as { alpha?: boolean; colorSpace?: string } | null;
        if (attr) {
          if (typeof attr.alpha === 'boolean') alpha = attr.alpha;
          if (typeof attr.colorSpace === 'string') colorSpace = attr.colorSpace;
        }
      }
      // Ohne `getContextAttributes` kennt der Browser auch kein
      // `colorSpace` fuer 2D-Kontexte (beides kam gemeinsam); dann ist sRGB
      // die einzige Moeglichkeit, und die Kopie ist richtig.

      const schluessel = `${schluesselPraefix}|${alpha}|${colorSpace}`;
      let kopie = arbeitsflaechen.get(schluessel);
      if (!kopie) {
        kopie = strecke.neu(original, m.breite, m.hoehe) ?? undefined;
        if (!kopie) return null;
        arbeitsflaechen.set(schluessel, kopie);
      }

      try {
        setzeMasse(f, kopie, m.breite, m.hoehe);
        const ctx = rufe(f.getContext, kopie, ['2d', { alpha, colorSpace, willReadFrequently: true }]) as object | null;
        if (!ctx) return null;
        // Speichermangel meldet Chrome nicht; er zeigt sich daran, dass die
        // Masse nicht angenommen wurden.
        const mk = masse(f, kopie);
        if (!mk || mk.breite !== m.breite || mk.hoehe !== m.hoehe) return null;
        rufe(strecke.drawImage, ctx, [original, 0, 0]);
        const bild = rufe(strecke.getImageData, ctx, [0, 0, m.breite, m.hoehe]) as { data: unknown; width: number; height: number };
        // Die ECHTE getImageData (vor den Huellen gefangen, siehe oben):
        // kein doppeltes Rauschen, unabhaengig davon, was im Buch steht.
        if (!verrauscheBild(bild, holeSeed(), m.breite * m.hoehe, 0, 0)) return null;
        rufe(strecke.putImageData, ctx, [bild, 0, 0]);
        return { kopie, f };
      } catch {
        leere(f, kopie);
        return null;
      }
    }

    function huelleExport(klasse: { prototype?: object } | undefined, name: string, strecke: Strecke, praefix: string): void {
      const p = klasse?.prototype;
      if (!p) return;
      ersetzeMethode({ obj: p, name }, (echt) => {
        const traeger = {
          [name](this: unknown, ...a: unknown[]) {
            let kopie: { kopie: object; f: Familie } | null = null;
            try {
              if (aktiv && typeof this === 'object' && this !== null) kopie = verrauschteKopie(strecke, this, praefix);
            } catch {
              kopie = null;
            }
            if (!kopie) return rufe(echt, this, a);
            try {
              // Dieselben Argumente, dieselbe Methode, nur auf der Kopie:
              // Typ, Qualitaet und Ausnahmen sind die des Originals.
              return rufe(echt, kopie.kopie, a);
            } finally {
              // `toBlob` und `convertToBlob` kopieren die Bitmap SYNCHRON
              // beim Aufruf und kodieren erst danach nebenher; die Flaeche
              // darf deshalb sofort wieder leer sein.
              leere(kopie.f, kopie.kopie);
            }
          },
        };
        return traeger[name]!;
      });
    }

    huelleExport(CanvasEl, 'toDataURL', elementStrecke, 'element');
    huelleExport(CanvasEl, 'toBlob', elementStrecke, 'element');
    huelleExport(Offscreen, 'convertToBlob', offscreenStrecke, 'offscreen');

    // ── Audio: EIN Weg fuer getChannelData und copyFromChannel ───────────

    const ap = Audio?.prototype;
    const echtGetChannelData = methode(ap, 'getChannelData');
    const holeLaenge = getter(ap, 'length');

    /**
     * Verrauscht den Kanalspeicher HOECHSTENS EINMAL in place. Beide Lesewege
     * (`getChannelData` liefert den echten Speicher, `copyFromChannel`
     * kopiert daraus) sehen damit dieselben Werte in jeder Reihenfolge;
     * CreepJS vergleicht genau diese beiden, und ein wiederverwendetes,
     * groesseres Ziel-Array bekommt hinter der Kopie nichts dazu.
     */
    function erledigte(buffer: object): Set<number> {
      let menge = verrauscht.get(buffer);
      if (!menge) {
        menge = new Set<number>();
        verrauscht.set(buffer, menge);
      }
      return menge;
    }

    /** `kanal` ist schon eine Zahl (siehe `einmalZahlen`); hier nur noch die WebIDL-Rundung. */
    function verrauscheKanal(buffer: object, kanal: unknown): void {
      if (!aktiv || !echtGetChannelData || !holeLaenge) return;
      const k = Math.trunc(Number(kanal)) | 0;
      const menge = erledigte(buffer);
      if (menge.has(k)) return;
      const daten = rufe(echtGetChannelData, buffer, [k]) as unknown;
      if (!(daten instanceof Float32Array)) return;
      menge.add(k);
      const laenge = rufe(holeLaenge, buffer, []) as number;
      verrauscheProben(daten, misch(holeSeed(), k, laenge), 0, daten.length);
    }

    if (ap) {
      ersetzeMethode(
        { obj: ap, name: 'getChannelData' },
        (echt) =>
          ({
            getChannelData(this: unknown, ...a: unknown[]) {
              const args = einmalZahlen(a, ERSTES_ARGUMENT);
              const daten = rufe(echt, this, args);
              try {
                if (typeof this === 'object' && this !== null) verrauscheKanal(this, args[0]);
              } catch {
                // Dann bleibt der Kanal, wie er ist.
              }
              return daten;
            },
          }).getChannelData,
      );
      ersetzeMethode(
        { obj: ap, name: 'copyFromChannel' },
        (echt) =>
          ({
            copyFromChannel(this: unknown, ...a: unknown[]) {
              // ZUERST rauschen, DANN kopieren: Das Ziel wird nie angefasst.
              // Ein ungueltiger Kanal wirft hier still und gleich darauf
              // nativ aus dem echten Aufruf.
              const args = einmalZahlen(a, ZWEITES_ARGUMENT);
              try {
                if (typeof this === 'object' && this !== null) verrauscheKanal(this, args[1]);
              } catch {
                // Siehe oben.
              }
              return rufe(echt, this, args);
            },
          }).copyFromChannel,
      );
      ersetzeMethode(
        { obj: ap, name: 'copyToChannel' },
        (echt) =>
          ({
            copyToChannel(this: unknown, ...a: unknown[]) {
              // Was die Seite selbst in einen Kanal schreibt, gehoert ihr und
              // muss bitgleich zurueckkommen: `copyToChannel(src)`, dann
              // `getChannelData` - GEMESSEN 05.09.2026 ohne diese Huelle 864
              // von 1000 Proben abweichend. Der Kanal gilt danach als
              // erledigt; ein Puffer aus `startRendering` oder
              // `decodeAudioData`, der nie beschrieben wird, rauscht weiter.
              // Erst der echte Aufruf: Wirft er (falscher Kanal, fremdes
              // `this`), bleibt der Kanal, wie er war.
              const args = einmalZahlen(a, ZWEITES_ARGUMENT);
              const r = rufe(echt, this, args);
              try {
                if (typeof this === 'object' && this !== null) erledigte(this).add(Math.trunc(Number(args[1])) | 0);
              } catch {
                // Dann rauscht der Kanal beim ersten Lesen wie jeder andere.
              }
              return r;
            },
          }).copyToChannel,
      );
    }

    // ── Geraetezahlen ────────────────────────────────────────────────────

    // Nur, wenn die Eigenschaft auf dem Prototyp wirklich existiert: Ein
    // erfundenes `deviceMemory` in Firefox waere selbst ein Merkmal.
    if (Nav?.prototype) {
      ersetzeGetter({ obj: Nav.prototype, name: 'hardwareConcurrency' }, () => {
        if (kerne === undefined) kerne = kerneAus(nebenSeed());
        return kerne;
      });
      ersetzeGetter({ obj: Nav.prototype, name: 'deviceMemory' }, () => SPEICHER_GB);
    }

    // ── Plugins und MimeTypes: EIN erfundener Eintrag je Site ────────────
    //
    // `navigator.plugins` bekommt die ECHTEN Eintraege plus ein Plugin mit
    // einem MimeType, dessen Name aus dem Seed kommt (`pluginAus` im Kern,
    // Begruendung dort). Die Liste ist ein Proxy um das echte PluginArray:
    // `instanceof` und `Object.prototype.toString` bleiben nativ, der
    // Eintrag steht am Ende (Index `echt.length`) und unter seinem Namen,
    // und `has`, `ownKeys` und `getOwnPropertyDescriptor` kennen beide
    // Schluessel, damit `Array.from`, for-of, for-in und `Object.keys`
    // dieselbe Zahl liefern. Ein Proxy ist aber kein Plattformobjekt: Jede
    // native Methode des Prototyps (`item`, `forEach`, der `length`-Getter)
    // wirft mit ihm „Illegal invocation". Deshalb stehen um alle Methoden
    // und den Getter von `PluginArray.prototype` und `MimeTypeArray.prototype`
    // Huellen, die einen unserer Proxys erkennen und auf das echte Objekt
    // dahinter umlenken - so bleibt auch `PluginArray.prototype.item.call(
    // navigator.plugins, 0)` moeglich (GEMESSEN 05.09.2026: liefert das
    // erste echte Plugin, wie ohne Erweiterung), `item()` ohne Argument
    // wirft weiter die native TypeError, und `navigator.plugins.item ===
    // PluginArray.prototype.item` bleibt wahr.
    //
    // Das erfundene Plugin ist `Object.create(Plugin.prototype)` mit genau
    // den eigenen Eigenschaften, die ein echtes Plugin traegt: Index `0` und
    // der MimeType-Name. `name`, `description`, `filename`, `length` und die
    // Methoden liegen wie beim echten auf dem Prototyp; die Huellen dort
    // erkennen das erfundene Objekt an derselben Buchfuehrung wie die Proxys.
    // Der MimeType ebenso: `Object.create(MimeType.prototype)`, nichts
    // Eigenes, alles ueber die Huellen auf `MimeType.prototype`. Die Regel
    // „der echte Aufruf zuerst" gilt fuer sie nicht - fuer ein erfundenes
    // Objekt gibt es keinen echten Aufruf, der etwas anderes taete als
    // werfen. Scheitert irgendetwas beim Bau, bekommt die Seite die echte
    // Liste; fehlen `Plugin` oder `MimeType` als Konstruktor, wird nichts
    // erfunden.

    const PluginK = g['Plugin'];
    const MimeTypeK = g['MimeType'];
    const PluginArrayK = g['PluginArray'];
    const MimeTypeArrayK = g['MimeTypeArray'];
    const echtArrayValues = methode(Array.prototype, 'values');
    const echtArrayKeys = methode(Array.prototype, 'keys');
    const echtArrayEntries = methode(Array.prototype, 'entries');

    /** Proxy bzw. erfundenes Plugin → was dahintersteckt. */
    const hinter = new WeakMap<object, Hinter>();
    /** Erfundenes Plugin bzw. MimeType → die Werte seiner Getter. */
    const erfundeneWerte = new WeakMap<object, Record<string, unknown>>();
    /** Echte Liste → ihr Proxy, damit `navigator.plugins === navigator.plugins` bleibt. */
    const proxies = new WeakMap<object, object>();

    /**
     * Klassenprototyp → ein ECHTER Eintrag dieser Klasse, gefangen beim Bau
     * des Proxys.
     *
     * Er wird nur gebraucht, um eine native Ausnahme mit ihrem eigenen Text
     * zu erzeugen: `plugin.item()` ohne Argument wirft an einem echten
     * Plugin „1 argument required, but only 0 present", an unserem
     * erfundenen aber „Illegal invocation" - V8 prueft den Empfaenger vor
     * der Argumentzahl, und ein `Object.create(Plugin.prototype)` ist kein
     * Plattformobjekt. GEMESSEN 05.09.2026: Ein Vergleich der
     * Fehlermeldungen ueber alle Eintraege der Liste fand den erfundenen,
     * ohne irgendetwas ueber AdSilence zu wissen. Mit dem Spender als
     * Empfaenger ist der Text buchstabengleich.
     */
    const spender = new WeakMap<object, object>();

    /**
     * Die Buchfuehrung zu einem Objekt, aber NUR fuer die Klasse, deren
     * Huelle gerade fragt (`klasse` ist der Prototyp, auf dem die Huelle
     * liegt). Ohne diese Pruefung waeren die Huellen klassenblind: Der
     * `name`-Getter von `Plugin.prototype`, mit dem erfundenen MimeType als
     * `this` gerufen, lieferte einen Wert statt der nativen TypeError.
     */
    function hinterVon(obj: unknown, klasse: object): Hinter | undefined {
      if (typeof obj !== 'object' || obj === null) return undefined;
      const h = hinter.get(obj);
      return h && h.klasse === klasse ? h : undefined;
    }

    /** WebIDL `unsigned long`: NaN und Unendlich werden 0, alles andere modulo 2^32. */
    function alsIndex(v: unknown): number {
      const z = Number(v);
      return Number.isFinite(z) ? Math.trunc(z) >>> 0 : 0;
    }

    /** Ein kanonischer Array-Index als Schluessel („0", „12", nicht „012"). */
    function istIndexSchluessel(k: string | symbol): boolean {
      return typeof k === 'string' && /^(0|[1-9][0-9]*)$/.test(k);
    }

    function definiereWert(obj: object, name: string, value: unknown, enumerable: boolean): void {
      Object.defineProperty(obj, name, { value, writable: false, enumerable, configurable: true });
    }

    /**
     * Das erfundene Plugin samt MimeType, einmal je Dokument, beim ersten
     * Zugriff (Seed ueber `nebenSeed`, siehe dort). `null`, wenn der Bau
     * scheitert oder eine der Klassen fehlt.
     */
    function erfundener(): Erfunden | null {
      if (erfundenes !== undefined) return erfundenes;
      erfundenes = null;
      try {
        const pp = PluginK?.prototype;
        const mp = MimeTypeK?.prototype;
        if (!pp || !mp) return null;
        const daten = pluginAus(nebenSeed());
        const plugin = Object.create(pp) as object;
        const mime = Object.create(mp) as object;
        erfundeneWerte.set(mime, { type: daten.mimeTyp, suffixes: daten.endung, description: daten.beschreibung, enabledPlugin: plugin });
        erfundeneWerte.set(plugin, { name: daten.name, description: daten.beschreibung, filename: daten.datei, length: 1 });
        definiereWert(plugin, '0', mime, true);
        definiereWert(plugin, daten.mimeTyp, mime, false);
        hinter.set(plugin, { klasse: pp, echt: null, eintrag: () => mime, name: () => daten.mimeTyp, alle: () => [mime] });
        erfundenes = { daten, plugin, mime };
      } catch {
        erfundenes = null;
      }
      return erfundenes;
    }

    /**
     * Getter-Huellen mit Buchfuehrung, fuer `length` der Listenklassen und
     * die Felder von `Plugin` und `MimeType`. Drei Faelle, in dieser
     * Reihenfolge: ein erfundenes Objekt (der Wert kommt aus der
     * Buchfuehrung; einen echten Aufruf gibt es nicht, er wuerfe nur), einer
     * unserer Proxys (der echte Getter auf dem echten Objekt dahinter, bei
     * `length` um den Eintrag erhoeht), alles andere (der echte Aufruf mit
     * demselben `this`, also bei fremdem die native Ausnahme). Kein `aktiv`:
     * Proxy und erfundenes Objekt bleiben konsistent, solange die Seite sie
     * haelt, auch nach dem „aus".
     */
    function huelleBuchGetter(klasse: { prototype?: object } | undefined, namen: string[]): void {
      const p = klasse?.prototype;
      if (!p) return;
      for (const name of namen) {
        try {
          const desk = Object.getOwnPropertyDescriptor(p, name);
          if (!desk || typeof desk.get !== 'function') continue;
          const echt = desk.get as Function;
          const traeger = {
            get [name](): unknown {
              const werte = typeof this === 'object' && this !== null ? erfundeneWerte.get(this) : undefined;
              if (werte) return werte[name];
              const h = hinterVon(this, p);
              const echterWert = rufe(echt, h?.echt ?? this, []);
              return h && name === 'length' ? h.alle().length : echterWert;
            },
          };
          const huelle = Object.getOwnPropertyDescriptor(traeger, name)!.get!;
          tarne(huelle, echt);
          desk.get = huelle;
          Object.defineProperty(p, name, desk);
        } catch {
          // Dann bleibt dieser Getter nativ; ein erfundenes Objekt wirft dort.
        }
      }
    }

    /**
     * Die Huellen um eine Listenklasse (`PluginArray`, `MimeTypeArray`,
     * `Plugin`): Getter `length`, `item`, `namedItem`, `refresh` (nur
     * PluginArray) und, wo es sie gibt, `values` samt `Symbol.iterator`
     * (nativ DIESELBE Funktion, das bleibt so), `keys`, `entries`, `forEach`.
     * In Chromium und Firefox gibt es die vier NICHT: Dort ist
     * `Symbol.iterator` schlicht `Array.prototype.values`, eine generische
     * Funktion, die `length` und Indizes liest - am Proxy also unsere Fallen
     * (GEMESSEN 05.09.2026: for-of und `Array.from` zaehlen den Eintrag mit,
     * der Iterator heisst weiter „Array Iterator"). WebKit erklaert die
     * Listen als `iterable`, und dort stehen die vier Methoden; ohne Huelle
     * wuerfen sie am Proxy. Liefert die nativen `length` und `item`, aus
     * denen `alle()` die echten Eintraege liest.
     */
    function huelleListe(klasse: { prototype?: object } | undefined): { laenge: Function; item: Function } | null {
      const p = klasse?.prototype;
      if (!p) return null;
      const echtLaenge = getter(p, 'length');
      const echtItem = methode(p, 'item');
      if (!echtLaenge || !echtItem) return null;

      huelleBuchGetter(klasse, ['length']);

      ersetzeMethode({ obj: p, name: 'item' }, (echt) => ({
        item(this: unknown, ...a: unknown[]) {
          const h = hinterVon(this, p);
          if (!h) return rufe(echt, this, a);
          // Ohne Argument wirft der echte Aufruf nativ (1 argument
          // required) - aber nur an einem Plattformobjekt, siehe `spender`.
          if (a.length === 0) return rufe(echt, h.echt ?? spender.get(p) ?? this, a);
          const args = einmalZahlen(a, ERSTES_ARGUMENT);
          const liste = h.alle();
          const i = alsIndex(args[0]);
          return i < liste.length ? liste[i] : null;
        },
      }).item);

      ersetzeMethode({ obj: p, name: 'namedItem' }, (echt) => ({
        namedItem(this: unknown, ...a: unknown[]) {
          const h = hinterVon(this, p);
          if (!h) return rufe(echt, this, a);
          if (a.length === 0) return rufe(echt, h.echt ?? spender.get(p) ?? this, a);
          /*
           * DIE UMWANDLUNG EINMAL, VORGEZOGEN. Bis zum 06.09.2026 verglich
           * hier `a[0] === h.name()`, also nur ein primitives String. Damit
           * fand `namedItem(new String(name))` den erfundenen Eintrag NICHT,
           * waehrend derselbe Aufruf fuer jeden echten das Objekt lieferte
           * (GEMESSEN 05.09.2026) - ein Unterschied, den ein Vergleich ueber
           * die ganze Liste findet. `einmalStrings` wandelt wie
           * `einmalZahlen` genau einmal um und reicht das Ergebnis auch an
           * den echten Aufruf weiter, damit ein `toString` der Seite nicht
           * zweimal laeuft.
           */
          const args = einmalStrings(a, ERSTES_ARGUMENT);
          if (args[0] === h.name()) return h.eintrag();
          return h.echt ? rufe(echt, h.echt, args) : null;
        },
      }).namedItem);

      ersetzeMethode({ obj: p, name: 'refresh' }, (echt) => ({
        refresh(this: unknown, ...a: unknown[]) {
          const h = hinterVon(this, p);
          return rufe(echt, h?.echt ?? this, a);
        },
      }).refresh);

      const iteratoren: Array<[string, Function | null]> = [
        ['values', echtArrayValues],
        ['keys', echtArrayKeys],
        ['entries', echtArrayEntries],
      ];
      for (const [name, arrayMethode] of iteratoren) {
        if (!arrayMethode) continue;
        const ersetzt = ersetzeMethode({ obj: p, name }, (echt) => {
          const traeger = {
            [name](this: unknown, ...a: unknown[]) {
              const h = hinterVon(this, p);
              if (!h) return rufe(echt, this, a);
              // Ein Array-Iterator, wie ihn auch die native Methode liefert.
              return rufe(arrayMethode, h.alle(), []);
            },
          };
          return traeger[name]!;
        });
        if (name === 'values' && ersetzt) {
          try {
            const desk = Object.getOwnPropertyDescriptor(p, Symbol.iterator);
            if (desk && desk.value === ersetzt.echt) {
              desk.value = ersetzt.huelle;
              Object.defineProperty(p, Symbol.iterator, desk);
            }
          } catch {
            // Dann laeuft for-of ueber die native Funktion und wirft am Proxy.
          }
        }
      }

      ersetzeMethode({ obj: p, name: 'forEach' }, (echt) => ({
        forEach(this: unknown, ...a: unknown[]) {
          const h = hinterVon(this, p);
          // Kein Rueckruf: der echte Aufruf wirft die native TypeError.
          if (!h || typeof a[0] !== 'function') return rufe(echt, h?.echt ?? this, a);
          const liste = h.alle();
          for (let i = 0; i < liste.length; i++) rufe(a[0] as Function, a[1], [liste[i], i, this]);
          return undefined;
        },
      }).forEach);

      return { laenge: echtLaenge, item: echtItem };
    }

    const pluginListe = huelleListe(PluginArrayK);
    const mimeListe = huelleListe(MimeTypeArrayK);
    huelleListe(PluginK);
    huelleBuchGetter(PluginK, ['name', 'description', 'filename']);
    huelleBuchGetter(MimeTypeK, ['type', 'suffixes', 'description', 'enabledPlugin']);

    /**
     * Der Proxy um eine echte Liste, je echter Liste genau einer. Die
     * Fallen kennen nur die beiden neuen Schluessel und `length`; alles
     * andere geht mit dem ECHTEN Objekt als Empfaenger an das Original,
     * damit kein nativer Getter je den Proxy als `this` sieht.
     */
    function proxyFuer(
      echtListe: unknown,
      nativ: { laenge: Function; item: Function } | null,
      klasse: object,
      eintrag: () => object,
      name: () => string,
    ): unknown {
      if (typeof echtListe !== 'object' || echtListe === null || !nativ) return echtListe;
      const vorhanden = proxies.get(echtListe);
      if (vorhanden) return vorhanden;
      const ziel = echtListe;
      const echteLaenge = (): number => rufe(nativ.laenge, ziel, []) as number;
      const alle = (): unknown[] => {
        const n = echteLaenge();
        const aus: unknown[] = [];
        for (let i = 0; i < n; i++) aus.push(rufe(nativ.item, ziel, [i]));
        aus.push(eintrag());
        return aus;
      };
      /*
       * Ein echter EINTRAG, nur um native Ausnahmen mit ihrem eigenen Text
       * zu erzeugen (siehe `spender`). Abgelegt wird er unter dem Prototyp
       * des Eintrags (`Plugin.prototype`), nicht unter dem der Liste: Dort
       * liegt die Huelle, die ihn braucht. Hier ist die einzige Stelle mit
       * einem echten Eintrag in der Hand - das erfundene Objekt kennt die
       * echte Liste nicht.
       */
      if (echteLaenge() > 0) {
        const erster = rufe(nativ.item, ziel, [0]);
        if (typeof erster === 'object' && erster !== null) {
          const ep = Object.getPrototypeOf(erster) as object | null;
          if (ep) spender.set(ep, erster);
        }
      }
      const istNeuerIndex = (prop: string | symbol): boolean => typeof prop === 'string' && prop === String(echteLaenge());
      const proxy = new Proxy(ziel, {
        get(z, prop) {
          if (istNeuerIndex(prop) || prop === name()) return eintrag();
          if (prop === 'length') return echteLaenge() + 1;
          return Reflect.get(z, prop, z);
        },
        has(z, prop) {
          return istNeuerIndex(prop) || prop === name() || Reflect.has(z, prop);
        },
        ownKeys(z) {
          // Indizes, der neue Index, die Namen, der neue Name - die
          // Reihenfolge, die das echte Objekt haette, waere der Eintrag echt.
          const echte = Reflect.ownKeys(z);
          const indizes: (string | symbol)[] = [];
          const namen: (string | symbol)[] = [];
          for (const k of echte) (istIndexSchluessel(k) ? indizes : namen).push(k);
          const neuerIndex = String(echteLaenge());
          if (!echte.includes(neuerIndex)) indizes.push(neuerIndex);
          if (!echte.includes(name())) namen.push(name());
          return indizes.concat(namen);
        },
        getOwnPropertyDescriptor(z, prop) {
          if (istNeuerIndex(prop)) return { value: eintrag(), writable: false, enumerable: true, configurable: true };
          if (prop === name()) return { value: eintrag(), writable: false, enumerable: false, configurable: true };
          return Reflect.getOwnPropertyDescriptor(z, prop);
        },
        /*
         * OHNE DIESE FALLE VERRAET EIN `delete` DEN PROXY. Das Ziel kennt
         * den neuen Index nicht, also meldete das Standardverhalten „schon
         * weg" und gab `true` zurueck - waehrend jeder echte Index `false`
         * gibt (die Eintraege sind nicht loeschbar). GEMESSEN 05.09.2026:
         * `delete navigator.plugins[5]` mit Erweiterung `true`, `[0]`
         * `false`; ohne Erweiterung jeder Index `false`. Eine Zeile
         * JavaScript, die den erfundenen Eintrag findet.
         */
        deleteProperty(z, prop) {
          if (istNeuerIndex(prop) || prop === name()) return false;
          return Reflect.deleteProperty(z, prop);
        },
      });
      hinter.set(proxy, { klasse, echt: ziel, eintrag, name, alle });
      proxies.set(echtListe, proxy);
      return proxy;
    }

    if (Nav?.prototype) {
      /*
       * Der Proxy wird EINMAL gebaut und bleibt (`navigator.plugins ===
       * navigator.plugins`), das erfundene Objekt darin kann wechseln: Bis
       * das Token da ist, ist es je Seitenaufruf gewuerfelt, danach kommt
       * es aus dem Seed der Site. Deshalb fragen die Fallen den Eintrag
       * ueber eine Funktion ab und halten ihn nicht fest. Scheitert der
       * spaetere Bau, bleibt der erste Eintrag stehen - ein Proxy ohne
       * Eintrag waere in seinen Invarianten widerspruechlich.
       */
      ersetzeGetter({ obj: Nav.prototype, name: 'plugins' }, (echtListe) => {
        const e = erfundener();
        if (!e || !PluginArrayK?.prototype) return echtListe;
        return proxyFuer(
          echtListe,
          pluginListe,
          PluginArrayK.prototype,
          () => erfundener()?.plugin ?? e.plugin,
          () => erfundener()?.daten.name ?? e.daten.name,
        );
      });
      ersetzeGetter({ obj: Nav.prototype, name: 'mimeTypes' }, (echtListe) => {
        const e = erfundener();
        if (!e || !MimeTypeArrayK?.prototype) return echtListe;
        return proxyFuer(
          echtListe,
          mimeListe,
          MimeTypeArrayK.prototype,
          () => erfundener()?.mime ?? e.mime,
          () => erfundener()?.daten.mimeTyp ?? e.daten.mimeTyp,
        );
      });
    }
  } catch {
    // Was hier scheitert, scheitert leise. Eine Seite ohne verwischten
    // Fingerabdruck ist der Zustand ohne Erweiterung; eine Seite mit
    // kaputtem Canvas waere unbenutzbar.
  }
})();
