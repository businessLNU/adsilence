/**
 * Die Tarnkappe: `Function.prototype.toString` liefert fuer unsere Huellen
 * den Text des ECHTEN Gegenstuecks.
 *
 * Jede Bibliothek, die Manipulation sucht (FingerprintJS, CreepJS, die
 * Bot-Erkennung hinter Turnstile, reCAPTCHA v3, DataDome), liest als Erstes
 * `HTMLCanvasElement.prototype.toDataURL.toString()` und prueft auf
 * `[native code]`. Eine Huelle ohne Tarnkappe faellt an dieser Zeile auf,
 * und wer als manipuliert gilt, bekommt mehr Challenges und schaltet den
 * Blocker ab. Deshalb wird der Text nicht nachgebaut, sondern vom Browser
 * selbst geholt: `echtToString.call(echt)`. So stimmt er buchstabengetreu,
 * mit Name, Leerzeichen und Zeilenumbruch, in jedem Browser.
 *
 * ZWEI KOPIEN VERKETTEN SICH. `schatten.ts` und `fingerabdruck.ts` sind
 * getrennte Buendel und bringen je eine Kopie dieser Datei mit. Die zweite
 * liest den Deskriptor, findet die Huelle der ersten und huellt sie ein;
 * jede Schicht beantwortet ihre eigenen Huellen und reicht alles andere
 * weiter. Zone.js weist `Function.prototype.toString` per Zuweisung neu zu
 * und ruft das vorher gefangene Original; die Kette haelt (geprueft).
 *
 * FREMDE REALMS. Ein same-origin Rahmen bringt ein eigenes, natives
 * `Function.prototype.toString` mit, und die Seite kann es auf UNSERE
 * Huellen anwenden: `iframe.contentWindow.Function.prototype.toString.call(
 * HTMLCanvasElement.prototype.toDataURL)`. Genau so holt sich CreepJS
 * saubere Referenzen. Zwei Faelle:
 *
 * - Der Rahmen ist fertig injiziert: Dann steht dort dieselbe Tarnkappe,
 *   aber mit EIGENER Registrierung; die Huellen des Elternfensters kennt sie
 *   nicht. Sie erkennt sie trotzdem, ohne Kanal und ohne Marke: Jedes Buendel
 *   traegt denselben Quelltext, also hat die Huelle im Elternfenster
 *   buchstabengetreu den Text der gleichnamigen Huelle im Rahmen. Der
 *   Rueckfall unten vergleicht den nativen Text einer unbekannten Funktion
 *   mit den Texten der eigenen Huellen und antwortet mit dem nativen Text
 *   des Gegenstuecks gleichen Namens (GEMESSEN 05.09.2026, vorher: der
 *   Rumpf samt `rufe2`, `echt`, `ziel.name` stand im Klartext).
 * - Der Rahmen ist per Skript erzeugt und wird SYNCHRON nach `appendChild`
 *   gelesen: Chrome injiziert dort asynchron, das `toString` ist noch nativ,
 *   und es liefert den Rumpf. Dagegen hilft kein Umbau; das steht im Katalog
 *   unter „bewusst nicht geschuetzt", neben der Stack-Zeile.
 *
 * WAS SIE NICHT KANN: den Rahmen verbergen, auf dem die Huelle laeuft.
 * Uebergibt die Seite ein Objekt mit `valueOf` oder `toString` als Argument
 * (`ctx.getImageData({ valueOf() { s = new Error().stack; return 0 } }, 0, 1, 1)`),
 * laeuft die Typumwandlung im nativen Aufruf, und der steht auf unserem
 * Rahmen: In `s` steht dann `chrome-extension://<id>/inhalt/fingerabdruck.js`.
 * Kein Umbau hilft dagegen. Die Schicht ist gegen Massentracker gebaut, die
 * den Wert nehmen, nicht gegen einen Angreifer, der AdSilence gezielt sucht.
 * Wer den Quelltext einer Huelle nachbaut und `name` setzt, bekommt vom
 * Rueckfall ebenfalls einen nativen Text - dieselbe Klasse Angreifer.
 */

/** Huelle → echte Funktion. Schwach, damit nichts festgehalten wird. */
const registriert = new WeakMap<Function, Function>();

/**
 * Fuer fremde Realms (siehe Kopf): der Quelltext jeder eigenen Huelle, und
 * je Funktionsname der native Text des echten Gegenstuecks. Zwei Huellen
 * teilen sich einen Quelltext, wenn sie aus derselben Vorlage kommen
 * (`[name](...a) { … }` fuer fillText und strokeText); deshalb der Umweg
 * ueber den Namen, den `tarne` auf den des Originals setzt.
 */
const huellenTexte = new Set<string>();
const nativTextJeName = new Map<string, string>();

/**
 * `WeakMap.prototype.get` und `Reflect.apply` zu Beginn gefangen: Die
 * Tarnkappe laeuft bei jedem `toString` der Seite, und eine Seite darf
 * `WeakMap.prototype` umbauen, ohne dass wir dabei stolpern.
 */
const hole = WeakMap.prototype.get;
const rufe = Reflect.apply;

let eingebaut = false;

/**
 * Registriert eine Huelle und gleicht `name` und `length` an. Bei
 * Methoden-Kurzschreibweise stimmt der Name schon; `length` wird trotzdem
 * angeglichen, denn eine Huelle mit Restparameter hat `length` 0, und
 * `toDataURL.length` ist nativ ebenfalls 0, `getImageData.length` aber 4.
 */
export function tarne(huelle: Function, echt: Function): void {
  // Zuerst einbauen: `merke` braucht das native `toString`, das `baueEin`
  // faengt, bevor es die Huelle setzt.
  if (!eingebaut) baueEin();
  try {
    Object.defineProperty(huelle, 'name', { value: echt.name, configurable: true });
    Object.defineProperty(huelle, 'length', { value: echt.length, configurable: true });
  } catch {
    // Nicht schlimm; die Tarnkappe wirkt auch mit abweichender Stelligkeit.
  }
  try {
    registriert.set(huelle, echt);
  } catch {
    // Kein Objekt als Schluessel: dann gibt es nichts zu tarnen.
  }
  merke(huelle, echt);
}

/** Das native `Function.prototype.toString`, sobald `baueEin` es gefangen hat. */
let nativesToString: Function | null = null;

function merke(huelle: Function, echt: Function): void {
  try {
    if (!nativesToString) return;
    huellenTexte.add(rufe(nativesToString, huelle, []) as string);
    nativTextJeName.set(echt.name, rufe(nativesToString, echt, []) as string);
  } catch {
    // Dann bleibt diese Huelle in fremden Realms lesbar; im eigenen nicht.
  }
}

function baueEin(): void {
  eingebaut = true;
  try {
    // Deskriptor lesen und NUR `value` tauschen. Dort steht `enumerable:
    // false`, und das bleibt so, weil es gelesen und nicht getippt ist.
    const desk = Object.getOwnPropertyDescriptor(Function.prototype, 'toString');
    if (!desk || typeof desk.value !== 'function') return;
    const echt = desk.value as Function;
    nativesToString = echt;

    // Methoden-Kurzschreibweise: kein `prototype`, nicht konstruierbar,
    // `Object.getOwnPropertyNames` liefert `[length, name]` wie nativ.
    const huelle = {
      toString(this: unknown): string {
        const ziel = rufe(hole, registriert, [this]) as Function | undefined;
        if (ziel) return rufe(echt, ziel, []) as string;
        // Alles andere unveraendert weiter, mit demselben `this`: Bei einer
        // Nicht-Funktion kommt so die native TypeError.
        const text = rufe(echt, this, []) as string;
        // Eine Huelle aus einem anderen Realm (siehe Kopf): gleicher Text,
        // andere Registrierung. Erkannt am Text, beantwortet ueber den Namen.
        if (huellenTexte.has(text)) {
          const nativ = nativTextJeName.get((this as Function).name);
          if (nativ) return nativ;
        }
        return text;
      },
    }.toString;

    // Die Huelle registriert sich selbst: `toString.toString()` ist nativ.
    registriert.set(huelle, echt);
    desk.value = huelle;
    Object.defineProperty(Function.prototype, 'toString', desk);
    merke(huelle, echt);
  } catch {
    // Ohne Tarnkappe wirken die Huellen trotzdem; sie sind nur lesbar.
  }
}
