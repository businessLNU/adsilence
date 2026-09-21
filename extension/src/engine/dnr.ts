/**
 * Netzregeln (ABP) → declarativeNetRequest-Regeln (Chrome-Schema).
 *
 * Die EINE Stelle, die weiss, was DNR kann und was nicht. `zuDnr` benutzt sie
 * für ganze Listen, `eigene.ts` für das Textfeld der Optionsseite, die Tests
 * für jede Regel im Ausgabeordner. Ein Grund, an einer Stelle.
 *
 * Fünf Fallen, an denen DNR-Konverter in freier Wildbahn gescheitert sind,
 * und wie hier damit umgegangen wird:
 *
 *   1. `urlFilter` muss ASCII sein. Chrome lehnt die Regel beim Laden ab,
 *      wenn sie ein Nicht-ASCII-Zeichen trägt. Solche Regeln fallen weg
 *      (`nichtAscii`), das Ruleset bleibt ladbar.
 *   2. `regexFilter` läuft in RE2: kein Lookahead, kein Lookbehind, keine
 *      Rückverweise. Wer das durchreicht, bekommt beim Laden einen Fehler.
 *      Prüfung: `regexTauglich()`.
 *   3. `allowAllRequests` darf nur `main_frame`/`sub_frame` tragen. Wird hier
 *      fest gesetzt, egal was die ABP-Regel sonst noch nennt.
 *   4. Eine ABP-Blockregel ohne Typ trifft NICHT das Dokument selbst
 *      (`||a.com^` blockt keine Navigation zu a.com). DNR ohne `resourceTypes`
 *      trifft ALLES, auch `main_frame`. Deshalb bekommt jede Blockregel ohne
 *      Typ `excludedResourceTypes: ['main_frame']`. Ohne diese Zeile wären
 *      ganze Seiten unerreichbar, sobald ihr Host in EasyList steht.
 *   5. Jede Regel braucht eine Bedingung, die etwas eingrenzt. `$script`
 *      allein würde jedes Skript im Web blocken. Solche Regeln fallen weg
 *      (`leereBedingung`). Was gilt: Muster, `requestDomains`,
 *      `initiatorDomains`, oder ausdrückliche Typen PLUS `domainType`
 *      (`*$ping,third-party` ist EasyPrivacys Absicht, keine Panne).
 *
 * Und die Falle, die erst am echten Budget sichtbar wurde: EasyList hat 47123
 * reine Host-Regeln (`||host^`) für 20000 Plätze. Nach Listenreihenfolge
 * geschnitten lag `||pagead2.googlesyndication.com^` (Zeile 66016) HINTER dem
 * Schnitt (Zeile 34830) und ein Wegwerfhost davor. Deshalb werden Regeln mit
 * identischer Bedingung zu EINER DNR-Regel mit vielen `requestDomains`
 * zusammengelegt (so macht es auch uBO Lite): 47123 Hosts werden 48 Regeln,
 * und danach passen auch alle Pfadmuster ins Budget.
 *
 * Prioritäten (vertrag/erweiterung.md): block 1, `$important` 2, Ausnahme 3.
 * Die Ausnahmen je Site aus dem Hintergrund liegen bei 100 und schlagen alles.
 */
import type { Netzregel, Regel, Ressource } from './abp.ts';
import { DNR_RESSOURCEN } from './dnr-typen.ts';
import type { DnrBedingung, DnrRegel, DnrRessource } from './dnr-typen.ts';
import { zaehle } from './gruende.ts';
import type { Verwerfung } from './gruende.ts';

export const REGEX_MAX_LAENGE = 200;
export const MUSTER_MAX_LAENGE = 500;
/**
 * Chrome erlaubt 1000 Regex-Regeln je Erweiterung, über ALLE aktiven
 * Rulesets. Fünf Listen plus eigene Regeln müssen sich das teilen; 100 je
 * Liste lässt Luft. Regex-Regeln sind ausserdem die teuersten beim Abgleich.
 */
export const REGEX_BUDGET_STANDARD = 100;
/** Hosts je zusammengelegter Regel. Kein Chrome-Limit, nur Lesbarkeit der JSON. */
export const HOSTS_JE_REGEL = 1000;

/**
 * Bis zu wie vielen Hosts eine Gruppe EINZELN ausgegeben wird, statt
 * zusammengelegt zu werden.
 *
 * ── Warum es das gibt ─────────────────────────────────────────────────────
 * Das Zusammenlegen spart Regeln, kostet aber die Auskunft: Chrome nennt zu
 * einem Treffer nur die Regelnummer, und eine Regel mit dreissig Hosts kann
 * nicht sagen, welcher davon getroffen wurde. Im Popup steht dann „eine von
 * mehreren Domains" statt eines Namens.
 *
 * GEMESSEN am 08.09.2026 ueber alle 33 Regeldateien: 349 solcher Regeln,
 * zusammen ueber 46.000 Hosts. Sie fallen auf, weil wenige Regeln oft
 * greifen -- in einer Trefferliste mit sechs Zeilen stand der Satz dreimal.
 *
 * Bei hoechstens ZEHN Hosts lohnt das Zusammenlegen nicht: Es spart 335
 * Regeln von ueber 300.000 freien (gemessen mit `npm run probe:regelbudget`)
 * und kostet dafuer 164 von 349 Regeln ihren Namen. Darueber bleibt es beim
 * Buendel -- wer die 47.000ste Tracker-Domain liest, weiss auch nicht mehr
 * als vorher, und 46.000 Einzelregeln waeren teuer.
 */
export const EINZELN_BIS = 10;

const RESSOURCE_ZU_DNR: Record<Ressource, DnrRessource> = {
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  object: 'object',
  xmlhttprequest: 'xmlhttprequest',
  subdocument: 'sub_frame',
  ping: 'ping',
  websocket: 'websocket',
  media: 'media',
  font: 'font',
  other: 'other',
  document: 'main_frame',
  popup: 'main_frame',
};

/**
 * Jeder Typ, den `$all` meint - das Dokument eingeschlossen.
 *
 * Bewusst NICHT `csp_report`, `webtransport` und `webbundle`: Die kennt nicht
 * jede Chrome-Fassung, und ein unbekannter Wert laesst Chrome den GANZEN
 * Regelsatz abweisen. Was hier fehlt, kostet eine Nische; was hier zu viel
 * steht, kostet die ganze Liste.
 */
const ALLE_RESSOURCEN: DnrRessource[] = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'media',
  'websocket',
  'other',
];

/** Hostname, wie DNR ihn in `requestDomains`/`initiatorDomains` erwartet: ASCII, klein, ohne Port. */
const DOMAIN = /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*$/;

/**
 * IPv6 in eckigen Klammern: `[::1]`, `[::]`, `[fe80::1]`.
 *
 * Chrome nimmt diese Schreibweise in `initiatorDomains` an - uBlock Origin
 * Lite liefert genau sie aus. Unsere Hostpruefung war strenger als Chrome, und
 * das kostete nicht etwa die eine Angabe, sondern die GANZE Regel: In der
 * Heimnetz-Liste steht `domain=~localhost|~127.0.0.1|~[::1]|~[::]|~local` an
 * 71 von 99 Zeilen. Gemessen: 71 verworfen, 27 uebrig.
 *
 * Bewusst eng gehalten - nur Hexziffern und Doppelpunkte zwischen den
 * Klammern. Was Chrome nicht versteht, laesst es nicht etwa aus, sondern
 * weist den ganzen Regelsatz ab.
 */
const IPV6_LITERAL = /^\[[0-9a-f:]+\]$/;

export function domainGueltig(domain: string): boolean {
  if (domain.length > 253) return false;
  return DOMAIN.test(domain) || IPV6_LITERAL.test(domain);
}

/**
 * Wie GROSS wird dieser Regex, wenn Chrome ihn kompiliert?
 *
 * ── Warum die Länge nicht genügt ────────────────────────────────────────────
 * `REGEX_MAX_LAENGE` deckelt die ZEICHEN. Chrome deckelt etwas anderes: den
 * SPEICHER des kompilierten RE2-Programms, 2 kB je Regel. Beides hat kaum
 * miteinander zu tun, denn RE2 rollt Quantoren AUS: `X{n,m}` wird zu n
 * Pflichtkopien plus (m-n) optionalen, jede eine eigene Instruktion. Ein
 * Punkt im UTF-8-Modus zerfällt zudem in die Byte-Bereiche aller vier
 * Sequenzlängen.
 *
 * GEMESSEN am 03.09.2026 an der geladenen Erweiterung in Chrome 140: Von 49
 * `regexFilter`-Regeln hat Chrome mindestens 17 verworfen, mit der Meldung
 * „was skipped as the regexFilter value exceeded the 2KB memory limit when
 * compiled". Die kürzeste davon hatte **30 Zeichen**:
 * `(https?:\/\/)104\.154\..{100,}` - `.{100,}` sind hundert ausgerollte
 * Punkte. Die längste akzeptierte hatte 196. Die Länge sagt hier also gar
 * nichts.
 *
 * Das war die teuerste Sorte Fehler: Der Bericht zählte 3.777 Netzregeln für
 * EasyList, das Paket lieferte sie aus, die Verkaufsseite nannte die Zahl -
 * und Chrome warf beim Laden einen Teil davon weg. Sichtbar nur, wer
 * `chrome://extensions` aufklappt.
 *
 * ── Was diese Funktion ist, und was nicht ───────────────────────────────────
 * Eine SCHÄTZUNG, keine Nachbildung. RE2 exakt nachzurechnen hiesse, seinen
 * Compiler in TypeScript zu haben. Die Zahlen unten sind an der Messung
 * geeicht und haben keine tiefere Bedeutung; entscheidend ist die Reihenfolge,
 * die sie erzeugt, nicht ihr Betrag.
 *
 * Und sie ist ABSICHTLICH zu streng. Aus der Messung: Die günstigste von
 * Chrome verworfene Regel kommt hier auf 152, die teuerste sicher akzeptierte
 * auf 222 - die Schätzung kann diese beiden nicht trennen. Die Grenze liegt
 * deshalb bei 150, unter dem kleinsten bekannten Ausfall. Das verwirft eine
 * Regel mit, die in Chrome funktioniert hätte
 * (`ublock-privatsphaere`, `mudah.my`), und das ist der richtige Fehler:
 * Eine hier verworfene Regel steht mit Grund im Bericht, eine von Chrome
 * verworfene steht nirgends.
 *
 * Wer die Grenze anhebt, prüft am geladenen Paket in `chrome://extensions`,
 * dass keine Regel mehr übersprungen wird - nicht am Quelltext.
 */
export const REGEX_KOSTEN_MAX = 150;

/** Ein Punkt im UTF-8-Modus: die Byte-Bereiche aller vier Sequenzlängen. */
const KOSTEN_PUNKT = 16;
/** Je Bereich in einer Zeichenklasse. */
const KOSTEN_JE_BEREICH = 2;
/** `\w`, `\d`, `\s` und ihre Gegenstücke stehen für mehrere Bereiche. */
const KOSTEN_KUERZEL = 4;

/** Bereiche und Einzelzeichen in `[...]` zählen. */
function bereicheIn(inhalt: string): number {
  let bereiche = 0;
  for (let i = 0; i < inhalt.length; i++) {
    if (inhalt[i] === '\\') {
      i += 1;
      bereiche += 2;
      continue;
    }
    if (inhalt[i + 1] === '-' && i + 2 < inhalt.length) {
      bereiche += 1;
      i += 2;
      continue;
    }
    bereiche += 1;
  }
  return Math.max(1, bereiche);
}

/**
 * Geschätzte Instruktionszahl des kompilierten Programms. Vergleichbar nur
 * gegen `REGEX_KOSTEN_MAX`, nicht gegen Chromes 2 kB.
 */
export function regexKosten(regex: string): number {
  let kosten = 0;
  let i = 0;
  const offeneGruppen: number[] = [];

  while (i < regex.length) {
    const zeichen = regex[i]!;
    let element = 0;

    if (zeichen === '\\') {
      element = /[wdsWDS]/.test(regex[i + 1] ?? '') ? KOSTEN_KUERZEL : 1;
      i += 2;
    } else if (zeichen === '.') {
      element = KOSTEN_PUNKT;
      i += 1;
    } else if (zeichen === '[') {
      const ende = regex.indexOf(']', i + 1);
      const bis = ende < 0 ? regex.length : ende;
      element = bereicheIn(regex.slice(i + 1, bis)) * KOSTEN_JE_BEREICH;
      i = bis + 1;
    } else if (zeichen === '(') {
      offeneGruppen.push(kosten);
      kosten = 0;
      i += 1;
      if (regex.startsWith('?:', i)) i += 2;
      continue;
    } else if (zeichen === ')') {
      const innen = kosten;
      kosten = offeneGruppen.pop() ?? 0;
      element = innen + 2;
      i += 1;
    } else if (zeichen === '|') {
      kosten += 2;
      i += 1;
      continue;
    } else if (zeichen === '^' || zeichen === '$') {
      i += 1;
      continue;
    } else {
      element = 1;
      i += 1;
    }

    // Ein Quantor dahinter vervielfacht das Element.
    const rest = regex.slice(i);
    const quantor = /^\{(\d+)(,(\d*))?\}/.exec(rest);
    if (quantor) {
      const von = Number(quantor[1]);
      const hatKomma = quantor[2] !== undefined;
      const bis = quantor[3] === '' || quantor[3] === undefined ? null : Number(quantor[3]);
      // Offene Obergrenze (`{n,}`): n Pflichtkopien plus die Schleife.
      // Sonst so viele Kopien, wie die Obergrenze erlaubt.
      const kopien = hatKomma ? (bis === null ? von + 1 : bis) : von;
      element = element * kopien + 2;
      i += quantor[0].length;
    } else if (rest[0] === '*' || rest[0] === '+') {
      element += 3;
      i += 1;
    } else if (rest[0] === '?') {
      element += 2;
      i += 1;
    }

    kosten += element;
  }

  while (offeneGruppen.length > 0) kosten += offeneGruppen.pop()!;
  return kosten;
}

/**
 * RE2 kennt keine Lookarounds, keine Rückverweise, keine atomaren Gruppen.
 * JavaScript schluckt sie, Chrome lehnt die Regel beim Laden ab.
 */
export function regexTauglich(regex: string): boolean {
  if (!/^[\x21-\x7e]+$/.test(regex)) return false;
  if (/\(\?[=!]/.test(regex)) return false;
  if (/\(\?<[=!]/.test(regex)) return false;
  if (/\(\?>/.test(regex)) return false;
  if (/\\[1-9]/.test(regex)) return false;
  if (/\\k</.test(regex)) return false;
  try {
    // Syntaxprüfung mit der JS-Engine: was hier scheitert, scheitert auch in RE2.
    new RegExp(regex);
  } catch {
    return false;
  }
  return true;
}

export type Klasse = 1 | 2 | 3 | 4;

export type Uebersetzung =
  | {
      ok: true;
      regel: Omit<DnrRegel, 'id'>;
      /** Reihenfolge beim Auffüllen des Budgets, siehe `zuDnr`. */
      klasse: Klasse;
    }
  | { ok: false; verwerfung: Verwerfung };

function verworfen(v: Verwerfung): Uebersetzung {
  return { ok: false, verwerfung: v };
}

function ohneDoppelte<T>(liste: T[]): T[] {
  return Array.from(new Set(liste));
}

/**
 * Welche `$redirect=<name>` es im Paket gibt — und unter welcher Datei.
 *
 * Der Name links ist der von uBO; die Listen sprechen diese Sprache. Was hier
 * FEHLT, wird nicht ersatzweise auf `noop.js` abgebildet: Eine Attrappe, die
 * die erwartete Schnittstelle nicht mitbringt, bricht die Seite anders kaputt
 * als ein Block - und zwar unsichtbar. Solche Regeln bleiben verworfen
 * (`redirectUnbekannt`), also genau so, wie sie es vorher waren.
 *
 * GEMESSEN am 09.09.2026 in `listen/quellen/`: 660 Regeln mit `$redirect`,
 * 40 verschiedene Namen. Die hier gedeckten tragen den Grossteil davon.
 */
export const ATTRAPPEN: Record<string, string> = {
  noopjs: 'noop.js',
  'noop.js': 'noop.js',
  'noop.txt': 'noop.txt',
  nooptext: 'noop.txt',
  'noop.html': 'noop.html',
  noopframe: 'noop.html',
  'noop.css': 'noop.css',
  noopcss: 'noop.css',
  '1x1.gif': '1x1.gif',
  '1x1-transparent.gif': '1x1.gif',
  '2x2.png': '2x2.png',
  '2x2-transparent.png': '2x2.png',
  '32x32.png': '32x32.png',
  '32x32-transparent.png': '32x32.png',
  'googlesyndication_adsbygoogle.js': 'adsbygoogle.js',
  'googlesyndication.com/adsbygoogle.js': 'adsbygoogle.js',
  'fuckadblock.js-3.2.0': 'fuckadblock.js',
};

/** Der Ordner im Paket; `manifest/base.json` gibt ihn frei. */
const ATTRAPPEN_ORDNER = '/attrappen/';

/**
 * `||host^` oder `||host`: nur ein Hostname, nichts dahinter. Solche Regeln
 * werden zu `requestDomains`, das Chrome über einen Hash-Index abgleicht,
 * statt zu `urlFilter`, das ein Mustervergleich bleibt.
 */
const REINER_HOST = /^\|\|([A-Za-z0-9._-]+)\^?$/;

/**
 * Ein ABP-Muster als `urlFilter`. Die Grammatik ist dieselbe (`||`, `|`, `^`,
 * `*`), nur die Ränder sind strenger.
 */
function musterZuUrlFilter(musterRoh: string): { urlFilter: string | null } | Verwerfung {
  // Mehrfache und randständige Sternchen sagen nichts; `*` ist implizit.
  let muster = musterRoh.replace(/\*{2,}/g, '*');
  while (muster.startsWith('*')) muster = muster.slice(1);
  while (muster.endsWith('*')) muster = muster.slice(0, -1);
  if (muster === '' || muster === '|' || muster === '||') return { urlFilter: null };

  if (!/^[\x00-\x7f]*$/.test(muster)) return { grund: 'nichtAscii' };
  if (!/^[\x21-\x7e]*$/.test(muster)) return { grund: 'sonderzeichen' };
  if (muster.length > MUSTER_MAX_LAENGE) return { grund: 'zuLang' };

  // `|` nur als Anker: vorn (`|`, `||`) und hinten. Mittendrin kennt DNR es nicht.
  const anfang = muster.startsWith('||') ? 2 : muster.startsWith('|') ? 1 : 0;
  const ende = muster.endsWith('|') ? muster.length - 1 : muster.length;
  if (ende < anfang) return { grund: 'sonderzeichen' };
  if (muster.slice(anfang, ende).includes('|')) return { grund: 'sonderzeichen' };
  if (muster.slice(anfang, ende) === '') return { urlFilter: null };

  // `||*` ist ungültig: `||` ankert an einen HOSTNAMEN, und ein `*` direkt
  // dahinter ankert an nichts. Chrome lehnt eine solche Regel nicht etwa
  // einzeln ab, sondern verweigert das Laden der GANZEN Erweiterung.
  //
  // GEMESSEN am 03.09.2026, beim Aufnehmen der regionalen Listen: Zwölf
  // solcher Muster in drei Listen (`||*voluum.com^`, `||*.servimg.com/u/f45/`
  // und andere), und der Browser meldete nur
  // „regional-zh.json: Rule with id 1729 specifies an incorrect value for the
  // urlFilter key" — die Erweiterung war weg, mit einer Zeile über eine von
  // zwölf Regeln. Die Prüfung unten (`pruefeRegelsatz`) hatte sie ebenso
  // durchgelassen wie diese Stelle hier.
  //
  // Der Hostanker wird gestrichen statt der Regel: `||*voluum.com^` meint
  // „irgendwas, das auf voluum.com endet", und genau das leistet
  // `*voluum.com^` ohne Anker. Eine verworfene Regel wäre der größere
  // Verlust.
  if (muster.startsWith('||*')) return { urlFilter: muster.slice(2) };

  return { urlFilter: muster };
}

/**
 * `domain=`-Liste für DNR. Ein unbrauchbarer POSITIVER Eintrag (`wayfair.*`,
 * `[::1]`) wird übergangen: Die Regel gilt dann auf weniger Seiten, das ist
 * die sichere Richtung. Ein unbrauchbarer NEGATIVER Eintrag macht die Regel
 * ungültig: Ohne ihn griffe sie, wo sie ausdrücklich nicht sollte.
 */
function domainsFuerDnr(regel: Netzregel): { domains: string[]; ausgeschlossene: string[] } | Verwerfung {
  const ausgeschlossene = ohneDoppelte(regel.ausgeschlosseneDomains);
  if (!ausgeschlossene.every(domainGueltig)) return { grund: 'domainUngueltig' };
  const domains = ohneDoppelte(regel.domains).filter(domainGueltig);
  if (regel.domains.length > 0 && domains.length === 0) return { grund: 'domainUngueltig' };
  return { domains, ausgeschlossene };
}

/**
 * Eine Netzregel nach DNR übersetzen oder mit Grund ablehnen. Reine Funktion.
 */
export function uebersetzeNetzregel(regel: Netzregel, blocktNavigation = false): Uebersetzung {
  if (regel.fremdeOptionen.length > 0) {
    return verworfen({ grund: 'optionNichtUmsetzbar', option: regel.fremdeOptionen[0] });
  }
  if (regel.matchCase) return verworfen({ grund: 'optionNichtUmsetzbar', option: 'match-case' });

  const typen = ohneDoppelte(regel.typen);
  const ausgeschlosseneTypen = ohneDoppelte(regel.ausgeschlosseneTypen);
  const seitenTyp = typen.find((t) => t === 'document' || t === 'popup');

  if (!regel.ausnahme && seitenTyp) {
    // `$popup` und `$document` als Block: DNR hat keinen Popup-Blocker, und
    // eine Navigation zu blocken sperrt die Seite. Beides fällt weg.
    return verworfen({ grund: 'optionNichtUmsetzbar', option: seitenTyp });
  }
  if (regel.kosmetikOptionen.length > 0 && typen.length === 0) {
    // `@@||a.com^$generichide` schaltet Kosmetik ab, blockt oder erlaubt aber
    // nichts im Netz. Daraus eine allow-Regel zu machen, hiesse: Werbung
    // freischalten, wo nur Selektoren gemeint waren.
    return verworfen({ grund: 'optionNichtUmsetzbar', option: regel.kosmetikOptionen[0] });
  }

  const bedingung: DnrBedingung = {};

  // Muster
  if (regel.regex !== null) {
    if (regel.regex.length > REGEX_MAX_LAENGE) return verworfen({ grund: 'regexZuLang' });
    if (!regexTauglich(regel.regex)) return verworfen({ grund: 'regexNichtRe2' });
    // NACH der Tauglichkeit und VOR dem Einbauen: Chrome wuerde die Regel
    // beim Laden still ueberspringen, und im Bericht stuende sie als gebaut.
    if (regexKosten(regel.regex) > REGEX_KOSTEN_MAX) return verworfen({ grund: 'regexZuTeuer' });
    bedingung.regexFilter = regel.regex;
    bedingung.isUrlFilterCaseSensitive = false;
  } else {
    const hostTreffer = REINER_HOST.exec(regel.muster);
    const host = hostTreffer ? hostTreffer[1].toLowerCase() : null;
    if (host && host.includes('.') && domainGueltig(host)) {
      bedingung.requestDomains = [host];
    } else {
      const ergebnis = musterZuUrlFilter(regel.muster);
      if ('grund' in ergebnis) return verworfen(ergebnis);
      if (ergebnis.urlFilter !== null) {
        bedingung.urlFilter = ergebnis.urlFilter;
        bedingung.isUrlFilterCaseSensitive = false;
      }
    }
  }

  // Herkunft
  const herkunft = domainsFuerDnr(regel);
  if ('grund' in herkunft) return verworfen(herkunft);
  if (herkunft.domains.length > 0) bedingung.initiatorDomains = herkunft.domains;
  if (herkunft.ausgeschlossene.length > 0) bedingung.excludedInitiatorDomains = herkunft.ausgeschlossene;
  if (regel.drittanbieter !== null) {
    bedingung.domainType = regel.drittanbieter ? 'thirdParty' : 'firstParty';
  }

  // Typen und Aktion
  let aktion: DnrRegel['action']['type'];
  if (regel.ausnahme && typen.includes('document')) {
    aktion = 'allowAllRequests';
    bedingung.resourceTypes = ['main_frame', 'sub_frame'];
  } else {
    aktion = regel.ausnahme ? 'allow' : 'block';
    const positiv = ohneDoppelte(typen.map((t) => RESSOURCE_ZU_DNR[t]));
    const negativ = ohneDoppelte(ausgeschlosseneTypen.map((t) => RESSOURCE_ZU_DNR[t]));
    if (positiv.length > 0) {
      const uebrig = positiv.filter((t) => !negativ.includes(t));
      if (uebrig.length === 0) return verworfen({ grund: 'typenLeer' });
      bedingung.resourceTypes = uebrig;
    } else {
      // Falle 4: ohne Typ nie das Dokument selbst blocken - AUSSER bei `$all`.
      //
      // Und hier steckt eine Umkehrung, die man leicht falsch herum baut:
      // Chrome nimmt `main_frame` von sich aus AUS, sobald `resourceTypes`
      // fehlt. Ein blosses Weglassen von `excludedResourceTypes` genuegt also
      // NICHT, um die Navigation zu treffen - gemessen an einer echten
      // Malware-Adresse: als `fetch` fiel sie, als Seitenaufruf lud sie.
      // Wer `$all` umsetzen will, muss die Typen ausdruecklich AUFZAEHLEN.
      if (aktion === 'block' && regel.alleTypen && blocktNavigation) {
        const alle = ALLE_RESSOURCEN.filter((r) => !negativ.includes(r));
        if (alle.length === 0) return verworfen({ grund: 'typenLeer' });
        bedingung.resourceTypes = alle;
      } else {
        const ausgeschlossen: DnrRessource[] =
          aktion === 'block' ? ohneDoppelte<DnrRessource>(['main_frame', ...negativ]) : negativ;
        if (ausgeschlossen.length > 0) bedingung.excludedResourceTypes = ausgeschlossen;
      }
    }
  }

  // Falle 5: irgendetwas muss die Regel eingrenzen.
  if (!bedingungGrenztEin(bedingung)) return verworfen({ grund: 'leereBedingung' });

  let priority = regel.ausnahme ? 3 : regel.wichtig ? 2 : 1;
  let aktionsObjekt: DnrRegel['action'] = { type: aktion };

  if (regel.attrappe !== null) {
    // Eine Ausnahme, die zugleich umleitet, ist ein Widerspruch: Sie soll
    // durchlassen. `redirect-rule` an einer `@@`-Regel meint etwas anderes,
    // das DNR nicht kennt (siehe `attrappe` in abp.ts).
    if (regel.ausnahme) return verworfen({ grund: 'redirectAnAusnahme' });
    const datei = ATTRAPPEN[regel.attrappe];
    if (datei === undefined) return verworfen({ grund: 'redirectUnbekannt', option: regel.attrappe });
    aktionsObjekt = { type: 'redirect', redirect: { extensionPath: ATTRAPPEN_ORDNER + datei } };
    // Vorrang 3, derselbe wie eine Ausnahme. Der Grund steht in Chromes
    // Rangfolge: Bei GLEICHEM Vorrang gewinnt `allow` vor `block` vor
    // `redirect`. Mit 3 schlaegt die Attrappe jede Blockregel (1 und 2) -
    // sonst bliebe sie wirkungslos, weil block gewinnt -, und eine echte
    // Ausnahme schlaegt weiterhin sie.
    priority = 3;
  }

  let klasse: Klasse;
  if (regel.ausnahme || regel.attrappe !== null) klasse = 1;
  else if (bedingung.requestDomains) {
    const nurHost =
      !bedingung.initiatorDomains &&
      !bedingung.excludedInitiatorDomains &&
      !bedingung.domainType &&
      !bedingung.resourceTypes &&
      (bedingung.excludedResourceTypes ?? []).length === 1;
    klasse = nurHost ? 2 : 3;
  } else klasse = 4;

  return { ok: true, klasse, regel: { priority, action: aktionsObjekt, condition: bedingung } };
}

/** Falle 5 als Frage: grenzt diese Bedingung irgendetwas ein? */
export function bedingungGrenztEin(b: DnrBedingung): boolean {
  if (b.urlFilter || b.regexFilter) return true;
  if (b.requestDomains?.length || b.initiatorDomains?.length) return true;
  if (b.resourceTypes?.length && b.domainType) return true;
  return false;
}

/** Für `eigene.ts`: warum eine Netzregel nicht in DNR passt, oder null. */
export function pruefeNetzregel(regel: Netzregel): Verwerfung | null {
  const ergebnis = uebersetzeNetzregel(regel);
  return ergebnis.ok ? null : ergebnis.verwerfung;
}

export type DnrOptionen = {
  /** Erste Regel-ID; je Ruleset eigener Zahlenraum ab 1, eigene Regeln ab 100000. */
  startId: number;
  /** Höchstzahl Regeln in der Ausgabe. */
  budget: number;
  /** Höchstzahl `regexFilter`-Regeln; Standard `REGEX_BUDGET_STANDARD`. */
  regexBudget?: number;
  /** Bis zu wie vielen Hosts einzeln ausgegeben wird; Standard `EINZELN_BIS`. */
  einzelnBis?: number;
  /** Hosts je zusammengelegter Regel; Standard `HOSTS_JE_REGEL`. */
  hostsJeRegel?: number;
  /**
   * Darf `$all` auch die NAVIGATION blocken, also die Seite unerreichbar machen?
   *
   * Standard ist nein, und das ist die wichtige Haelfte. `$all` steht nicht nur
   * in Malware-Listen: EasyList fuehrt es acht Mal, Fanboy's Annoyances 32 Mal,
   * uBlocks Badware-Liste 1357 Mal. Wuerde die Option ueberall durchschlagen,
   * machte eine einzige Zeile in einer Werbeliste eine Seite unerreichbar - und
   * niemand koennte sagen, welche.
   *
   * Erlaubt wird es deshalb nur dort, wo die Quelle es ausdruecklich traegt
   * (`blocktNavigation: true` in `listen/quellen.json`). Sonst wird `$all`
   * behandelt wie bisher: alle Typen AUSSER dem Dokument.
   */
  blocktNavigation?: boolean;
};

export type DnrErgebnis = {
  rules: DnrRegel[];
  verworfen: Record<string, number>;
  /** DNR-Regeln je Klasse (1 Ausnahmen, 2 reine Hosts, 3 Hosts mit Optionen, 4 Muster). */
  klassen: Record<Klasse, number>;
  /** Wie viele Listenzeilen in `rules` stecken (zusammengelegte Hosts einzeln gezählt). */
  quellregeln: number;
};

type Einheit = {
  klasse: Klasse;
  regel: Omit<DnrRegel, 'id'>;
  /** Bei zusammengelegten Regeln: alle Hosts, sonst leer. */
  hosts: string[];
};

/**
 * Alle Netzregeln einer Liste nach DNR, im Rahmen des Budgets.
 *
 * Reihenfolge beim Auffüllen: erst alle Ausnahmen (sie verhindern Breakage),
 * dann reine Host-Blocks (billig und breit), dann Host-Blocks mit Optionen,
 * zuletzt Pfadmuster. Was danach noch übrig ist, zählt als `budget`.
 *
 * Regeln, die sich nur im Host unterscheiden (`||a.com^`, `||b.com^`), werden
 * zu einer Regel mit `requestDomains: [a.com, b.com, ...]`, höchstens
 * `hostsJeRegel` je Regel. Gleiche Semantik, ein Bruchteil der Regeln.
 */
export function zuDnr(regeln: Regel[], optionen: DnrOptionen): DnrErgebnis {
  const regexBudget = optionen.regexBudget ?? REGEX_BUDGET_STANDARD;
  const hostsJeRegel = optionen.hostsJeRegel ?? HOSTS_JE_REGEL;
  const einzelnBis = optionen.einzelnBis ?? EINZELN_BIS;
  const verworfen: Record<string, number> = {};
  const einheiten: Einheit[] = [];
  const gruppen = new Map<string, Einheit>();
  const gesehen = new Set<string>();

  for (const regel of regeln) {
    if (regel.typ !== 'netz') continue;
    const ergebnis = uebersetzeNetzregel(regel, optionen.blocktNavigation === true);
    if (!ergebnis.ok) {
      zaehle(verworfen, ergebnis.verwerfung);
      continue;
    }
    const { condition } = ergebnis.regel;
    // Listen wiederholen sich; eine identische Regel zweimal kostet Budget
    // und bringt nichts.
    const schluessel = JSON.stringify([ergebnis.regel.priority, ergebnis.regel.action, condition]);
    if (gesehen.has(schluessel)) {
      zaehle(verworfen, { grund: 'doppelt' });
      continue;
    }
    gesehen.add(schluessel);

    if (condition.requestDomains && condition.requestDomains.length === 1) {
      const { requestDomains, ...rest } = condition;
      const gruppenSchluessel = JSON.stringify([ergebnis.klasse, ergebnis.regel.priority, ergebnis.regel.action, rest]);
      const gruppe = gruppen.get(gruppenSchluessel);
      if (gruppe) {
        gruppe.hosts.push(requestDomains[0]);
        continue;
      }
      const neu: Einheit = { klasse: ergebnis.klasse, regel: ergebnis.regel, hosts: [requestDomains[0]] };
      gruppen.set(gruppenSchluessel, neu);
      einheiten.push(neu);
      continue;
    }
    einheiten.push({ klasse: ergebnis.klasse, regel: ergebnis.regel, hosts: [] });
  }

  // Stabil: innerhalb einer Klasse bleibt die Listenreihenfolge.
  einheiten.sort((a, b) => a.klasse - b.klasse);

  const rules: DnrRegel[] = [];
  const klassen: DnrErgebnis['klassen'] = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let quellregeln = 0;
  let regexAnzahl = 0;
  let id = optionen.startId;

  const nimm = (klasse: Klasse, regel: Omit<DnrRegel, 'id'>, zeilen: number): void => {
    if (rules.length >= optionen.budget) {
      for (let i = 0; i < zeilen; i += 1) zaehle(verworfen, { grund: 'budget' });
      return;
    }
    if (regel.condition.regexFilter !== undefined) {
      if (regexAnzahl >= regexBudget) {
        zaehle(verworfen, { grund: 'regexBudget' });
        return;
      }
      regexAnzahl += 1;
    }
    rules.push({ id, ...regel });
    klassen[klasse] += 1;
    quellregeln += zeilen;
    id += 1;
  };

  for (const einheit of einheiten) {
    if (einheit.hosts.length === 0) {
      nimm(einheit.klasse, einheit.regel, 1);
      continue;
    }
    /*
     * Kleine Gruppen einzeln, damit die Trefferliste im Popup einen NAMEN
     * zeigen kann statt „eine von mehreren Domains" (siehe `EINZELN_BIS`).
     */
    if (einheit.hosts.length <= einzelnBis) {
      for (const host of einheit.hosts) {
        nimm(
          einheit.klasse,
          { ...einheit.regel, condition: { ...einheit.regel.condition, requestDomains: [host] } },
          1,
        );
      }
      continue;
    }
    for (let i = 0; i < einheit.hosts.length; i += hostsJeRegel) {
      const hosts = einheit.hosts.slice(i, i + hostsJeRegel);
      nimm(
        einheit.klasse,
        { ...einheit.regel, condition: { ...einheit.regel.condition, requestDomains: hosts } },
        hosts.length,
      );
    }
  }

  return { rules, verworfen, klassen, quellregeln };
}

/**
 * Schemaprüfung eines fertigen Regelsatzes: was Chrome beim Laden ablehnen
 * würde, als Liste von Sätzen. Leer heisst: ladbar. Läuft im Build und in
 * den Tests über jede Ausgabedatei.
 */
export function pruefeRegelsatz(rules: DnrRegel[], budget?: number): string[] {
  const probleme: string[] = [];
  const ids = new Set<number>();
  if (budget !== undefined && rules.length > budget) {
    probleme.push(`${rules.length} Regeln, Budget ${budget}`);
  }
  for (const regel of rules) {
    const wo = `Regel ${regel.id}`;
    if (!Number.isInteger(regel.id) || regel.id < 1) probleme.push(`${wo}: id muss ganzzahlig und >= 1 sein`);
    if (ids.has(regel.id)) probleme.push(`${wo}: id doppelt`);
    ids.add(regel.id);
    if (!Number.isInteger(regel.priority) || regel.priority < 1) probleme.push(`${wo}: priority muss >= 1 sein`);
    if (!['block', 'allow', 'allowAllRequests', 'redirect'].includes(regel.action?.type)) {
      probleme.push(`${wo}: unbekannte Aktion ${String(regel.action?.type)}`);
    }
    const b = regel.condition;
    if (!b || typeof b !== 'object') {
      probleme.push(`${wo}: keine Bedingung`);
      continue;
    }
    if (regel.action?.type === 'redirect') {
      // Ohne Datei im Paket laedt Chrome nichts, und die Seite sieht denselben
      // Fehler wie bei einem Block - nur ohne dass es jemand merkt.
      const pfad = regel.action.redirect?.extensionPath;
      if (typeof pfad !== 'string' || !pfad.startsWith('/attrappen/')) {
        probleme.push(`${wo}: redirect ohne extensionPath unter /attrappen/`);
      }
    }
    if (!bedingungGrenztEin(b)) probleme.push(`${wo}: Bedingung grenzt nichts ein`);
    if (b.urlFilter !== undefined && b.regexFilter !== undefined) probleme.push(`${wo}: urlFilter und regexFilter zugleich`);
    if (b.urlFilter !== undefined) {
      if (b.urlFilter === '') probleme.push(`${wo}: urlFilter leer`);
      if (!/^[\x21-\x7e]*$/.test(b.urlFilter)) probleme.push(`${wo}: urlFilter nicht ASCII`);
      if (b.urlFilter.length > MUSTER_MAX_LAENGE) probleme.push(`${wo}: urlFilter zu lang`);
      // Siehe `musterZuUrlFilter`: Ein `*` direkt hinter dem Hostanker kostet
      // nicht diese Regel, sondern die ganze Erweiterung.
      if (b.urlFilter.startsWith('||*')) probleme.push(`${wo}: urlFilter beginnt mit ||* (Chrome lehnt das Paket ab)`);
      const kern = b.urlFilter.replace(/^\|\||^\|/, '').replace(/\|$/, '');
      if (kern.includes('|')) probleme.push(`${wo}: urlFilter hat | in der Mitte`);
    }
    if (b.regexFilter !== undefined) {
      if (b.regexFilter.length > REGEX_MAX_LAENGE) probleme.push(`${wo}: regexFilter länger als ${REGEX_MAX_LAENGE}`);
      if (!regexTauglich(b.regexFilter)) probleme.push(`${wo}: regexFilter nicht RE2-tauglich`);
      if (regexKosten(b.regexFilter) > REGEX_KOSTEN_MAX)
        probleme.push(`${wo}: regexFilter zu teuer (${regexKosten(b.regexFilter)} > ${REGEX_KOSTEN_MAX}); Chrome ueberspringt ihn`);
    }
    for (const feld of ['requestDomains', 'excludedRequestDomains', 'initiatorDomains', 'excludedInitiatorDomains'] as const) {
      const liste = b[feld];
      if (liste === undefined) continue;
      if (liste.length === 0) probleme.push(`${wo}: ${feld} leer`);
      for (const d of liste) if (!domainGueltig(d)) probleme.push(`${wo}: ${feld} enthält ungültige Domain ${d}`);
    }
    if (b.resourceTypes !== undefined && b.excludedResourceTypes !== undefined) {
      probleme.push(`${wo}: resourceTypes und excludedResourceTypes zugleich`);
    }
    for (const feld of ['resourceTypes', 'excludedResourceTypes'] as const) {
      const liste = b[feld];
      if (liste === undefined) continue;
      if (liste.length === 0) probleme.push(`${wo}: ${feld} leer`);
      for (const t of liste) if (!DNR_RESSOURCEN.includes(t)) probleme.push(`${wo}: unbekannter Typ ${t}`);
    }
    if (regel.action?.type === 'allowAllRequests') {
      const typen = b.resourceTypes ?? [];
      if (typen.length === 0 || !typen.every((t) => t === 'main_frame' || t === 'sub_frame')) {
        probleme.push(`${wo}: allowAllRequests nur mit main_frame/sub_frame`);
      }
    }
    if (b.domainType !== undefined && b.domainType !== 'firstParty' && b.domainType !== 'thirdParty') {
      probleme.push(`${wo}: domainType ${String(b.domainType)}`);
    }
  }
  return probleme;
}
