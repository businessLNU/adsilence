/**
 * Zahlen und Namen, die mehr als eine Datei braucht. Jede steht hier genau
 * einmal; wer sie aendert, aendert sie fuer Hintergrund, Oberflaeche und Tests.
 */

import type { Browser } from './typen.ts';

// In Node (Tests) gibt es kein `import.meta.env`; dort gelten die Rueckfaelle.
const umgebung = (import.meta as { env?: Partial<ImportMetaEnv> }).env ?? {};

/** Basisadresse des Backends, ohne Schraegstrich am Ende. */
export const API_BASIS: string = (umgebung.ADSILENCE_API ?? 'http://localhost:3000').replace(/\/+$/, '');
export const VERSION: string = umgebung.VERSION ?? '0.0.0';
export const BROWSER: Browser = umgebung.BROWSER ?? 'chromium';

// ── Die Grenzen von declarativeNetRequest ───────────────────────────
/**
 * Wie viele Regeln in AKTIVIERTEN statischen Regelsaetzen Chrome garantiert.
 *
 * Chrome zaehlt jede Regel in jedem Regelsatz, der beim Start `enabled` ist.
 * Was darueber hinausgeht, laedt es NICHT -- und zwar ohne Fehler: Die
 * Erweiterung installiert sich sauber, das Popup zaehlt, und einzelne Listen
 * blocken einfach nicht. Von aussen sieht das aus wie eine Liste, die nichts
 * findet.
 *
 * Die Zahl ist Chromes, nicht unsere. Sie steht hier, damit sie EINMAL im
 * Projekt steht: Test 34 rechnet die belegten Regeln aus `rules/` und
 * `LISTEN_VORGABE` dagegen, statt eine zweite Zahl danebenzustellen.
 *
 * Nicht aktivierte Regelsaetze zaehlen NICHT mit -- die laedt Chrome erst,
 * wenn jemand die Liste einschaltet, und dann gegen dasselbe Budget.
 */
export const DNR_REGELN_GARANTIERT = 30_000;

/**
 * Wie viele statische Regeln Chrome TATSAECHLICH noch frei hatte, nachdem das
 * ganze Paket geladen war.
 *
 * GEMESSEN am 08.09.2026 mit `npm run probe:regelbudget` in echtem Chrome:
 * 15 Regelsaetze geladen, 29.854 Regeln ab Werk aktiv, danach noch 300.146
 * frei. Die 30.000 oben sind also kein Deckel, sondern eine ZUSAGE -- der
 * Wert, den Chrome jeder Erweiterung garantiert, egal was sonst installiert
 * ist. Darueber laedt Chrome weiter, solange der browserweite Vorrat reicht.
 *
 * Warum die Zahl trotzdem nicht die Grenze ist, gegen die geprueft wird: Der
 * Vorrat ist GETEILT. Auf einem Rechner mit AdGuard (gemessen 71.148 aktive
 * Regeln) und uBO Lite (18.534) ist er kleiner als hier. Was ueber der Zusage
 * liegt, laedt auf dem einen Rechner und auf dem anderen nicht -- ohne
 * Fehlermeldung. Deshalb bleibt die Zusage die harte Grenze und diese Zahl
 * die Einordnung: Sie sagt, wie weit es bis zum wirklichen Reissen ist.
 */
export const DNR_REGELN_GEMESSEN_FREI = 300_146;

/**
 * Wie viele statische Regelsaetze ein Manifest ueberhaupt fuehren darf --
 * aktiviert oder nicht.
 */
export const DNR_REGELSAETZE_MAX = 100;

// ── Premium: der eine Tarif ─────────────────────────────────────────
/**
 * Der Tarifschluessel, den die Erweiterung kauft und anzeigt.
 *
 * Die Website kann mehrere Stufen fuehren; die Erweiterung fuehrt GENAU
 * EINE. Ein Kunde, der im Popup zwischen drei Stufen waehlen soll, waehlt
 * meistens gar nicht - und der Unterschied zwischen ihnen liesse sich in
 * einem Fenster dieser Groesse ohnehin nicht erklaeren.
 *
 * Derselbe Schluessel geht an `POST /api/billing/checkout` (`konto.ts`) und
 * sucht den Tarif in `GET /api/plans` heraus (`PremiumDialog.tsx`). EINE
 * Konstante fuer beides, weil ein Fenster, das einen anderen Tarif zeigt als
 * es kauft, den Preis falsch nennt. Findet sich der Schluessel nicht in der
 * Verwaltung, zeigt das Fenster KEINEN Preis - lieber gar keinen als einen
 * geratenen (Regel 10: Preise kommen aus der Verwaltung, nie aus dem Code).
 *
 * Der PREIS steht hier ausdruecklich nicht. Nur der Name des Regals.
 */
export const TARIF_KEY = 'premium';

// ── Trefferliste im Popup ───────────────────────────────────────────
/**
 * Der Platzhalter fuer `TabZustand.jeListe[].regeln[].was`, wenn eine Regel
 * eine ganze LISTE von Domains sperrt statt einer einzelnen.
 *
 * Chrome nennt zu einem Treffer nur die Regelnummer. Deckt diese Regel
 * tausend Domains ab, wissen wir, DASS sie griff - nie, WELCHE der tausend.
 * Eine davon zu nennen (frueher stand da `erste.example +999`) waere in 999
 * von 1000 Faellen die falsche, und die Zahl daneben half niemandem. Auch
 * zwei zu nennen hilft nicht: Es griff genau eine, und beide anzuzeigen
 * behauptet zwei Treffer.
 *
 * Deshalb steht hier kein Name; das Popup setzt dafuer einen uebersetzten
 * Satz ein (`popup.site.sammelregel`). Der leere String ist mit Absicht
 * gewaehlt: Aus einem Regelmuster kann er nie entstehen - `lesbaresMuster`
 * gibt sonst mindestens `'?'` zurueck -, kann also mit keinem echten Namen
 * zusammenfallen und mit ihm auch nicht in einer Zeile verschmelzen.
 */
export const SAMMELREGEL = '';

// ── Dynamische DNR-Regeln ──────────────────────────────────────────────────
/**
 * ID-Bereiche der DYNAMISCHEN Regeln (erweiterung.md N7).
 *
 * Die Zahlen sind keine Geschmackssache, sondern die Firefox-Deckelung:
 * `MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES` steht dort bei 5000, waehrend
 * Chrome seit 121 dreissigtausend erlaubt. Gerechnet wird mit der kleineren
 * Zahl, sonst faellt `updateDynamicRules()` in Firefox als Ganzes um - und
 * zwar nicht die eine Regel zu viel, sondern der ganze Aufruf: Ausnahmen und
 * eigene Regeln waeren dann zusammen weg.
 *
 * 1000 Ausnahmen plus 2999 eigene Regeln macht hoechstens 3999. Vorher standen
 * hier 9999 und ein Budget von 4000; das konnte die Grenze reissen, sobald
 * jemand ueber tausend Seiten freistellte.
 */
export const ID_AUSNAHME_VON = 1;
export const ID_AUSNAHME_BIS = 1000;
/** Eine Ausnahme muss jede Blockregel schlagen; statische Regeln haben 1 bis 3. */
export const PRIORITAET_AUSNAHME = 100;
/** Eigene Regeln des Nutzers schliessen direkt an die Ausnahmen an: 1001 bis 3999. */
export const ID_EIGENE_VON = 1001;
/*
 * 999 statt 2999 -- der Platz geht an die Listenpflege.
 *
 * GEMESSEN am 08.09.2026: Zwischen zwei Paketen kommen 133 neue Regeln pro
 * Tag dazu, zwei Drittel davon Malware-Adressen aus urlhaus. Mit 1000
 * Regeln trug die Listenpflege also SIEBEN TAGE; danach meldet der Server
 * "uebergangen" und liefert nur noch einen Teil.
 *
 * Sieben Tage sind kein Rhythmus, den ein Store-Release haelt: Jede Freigabe
 * dauert Tage, und eine abgelehnte Fassung kostet eine Woche. Mit 3000
 * Regeln sind es 22 Tage -- das reicht auch fuer eine Ablehnung dazwischen.
 *
 * Der Platz kommt von den EIGENEN Regeln, und das ist der richtige Ort:
 * 2999 waren nie gemessen, sondern der Rest, der uebrig blieb. Wer eigene
 * Filterregeln schreibt, schreibt zehn oder zwanzig, keine dreitausend --
 * und wem 999 nicht reichen, der braucht kein Textfeld in den Optionen,
 * sondern uBlock Origin.
 *
 * Die Zahl bleibt in BEIDEN Browsern gleich. Firefox deckelt bei 5000,
 * Chrome bei 30000 safe rules (gemessen mit
 * `npm run probe:regelbudget`) -- eine Erweiterung, die sich je Browser
 * anders verhaelt, ist zweimal zu pruefen, und der Gewinn waere hier nur
 * mehr Luft, wo schon genug ist.
 */
export const BUDGET_EIGENE = 999;

// ── Listenpflege: die Regeln, die seit dem Release dazugekommen sind ───────
/**
 * Nachgeladene Listenregeln belegen 4000 bis 4999.
 *
 * Damit ist die Firefox-Deckelung von 5000 dynamischen Regeln voll
 * ausgeschoepft: 1000 Ausnahmen, 999 eigene, 3000 nachgeladene. Mehr geht
 * nicht, und Chrome wird bewusst nicht ausgereizt - eine Erweiterung, die
 * sich in zwei Browsern verschieden verhaelt, ist zweimal zu pruefen.
 *
 * Was Chrome wirklich erlaubt, steht nicht mehr als Vermutung hier: 30000
 * safe rules, 5000 unsafe, gemessen am laufenden Browser mit
 * `npm run probe:regelbudget`.
 *
 * Tausend klingt wenig neben 22000 Regeln im Paket, und das ist es auch. Sie
 * tragen deshalb nicht die Listen, sondern nur den ZUWACHS seit dem letzten
 * Release: was EasyList und die anderen seitdem an neuen Werbeservern
 * eingetragen haben. Genau daran veraltet ein MV3-Blocker zwischen zwei
 * Store-Freigaben.
 */
export const ID_LISTENPFLEGE_VON = 2000;
export const BUDGET_LISTENPFLEGE = 3000;
/** Einmal am Tag genuegt: Die Listen selbst erscheinen nicht oefter. */
export const ALARM_LISTENPFLEGE = 'listenpflege';
export const LISTENPFLEGE_TAKT_MIN = 24 * 60;
/**
 * Aelter als das, und beim naechsten Start wird SOFORT nachgeholt.
 *
 * Ein Alarm allein genuegt nicht: Er feuert nur, solange der Browser laeuft.
 * Wer seinen Rechner eine Woche nicht anfasst, hat danach einen Alarm, der
 * irgendwann kommt - und bis dahin Listen von letzter Woche. Beim Start zu
 * pruefen kostet nichts und schliesst die Luecke.
 */
export const LISTENPFLEGE_UEBERFAELLIG_MS = 26 * 60 * 60 * 1000;
/**
 * Aelter als das, und die Optionsseite sagt es. Drei Tage sind grosszuegig
 * gerechnet - ein Rechner, der uebers Wochenende aus war, soll keine Warnung
 * ausloesen.
 */
export const LISTENPFLEGE_VERALTET_MS = 3 * 24 * 60 * 60 * 1000;

// ── Lizenz ────────────────────────────────────────────────────────────────
export const ALARM_LIZENZ = 'lizenz';
export const LIZENZ_TAKT_MIN = 360;
/** Offline gilt der letzte Stand sieben Tage; danach faellt der Tarif auf frei. */
export const GNADENFRIST_MS = 7 * 24 * 60 * 60 * 1000;
/** Aelter als eine Stunde: das Popup stoesst eine Pruefung an. */
export const LIZENZ_FRISCH_MS = 60 * 60 * 1000;
/** Nach der Rueckkehr vom Kauf: alle 3 s nachfragen, hoechstens 60 s lang. */
export const KAUF_TAKT_MS = 3000;
export const KAUF_MAX_MS = 60 * 1000;

// ── Verbindung Erweiterung ↔ Konto ────────────────────────────────────────
export const ALARM_VERBINDUNG = 'verbindung';
export const VERBINDUNG_TAKT_MS = 3000;
export const VERBINDUNG_MAX_MS = 10 * 60 * 1000;
/** Name des Web Locks, unter dem genau eine Erneuerung zur Zeit laeuft. */
export const LOCK_SITZUNG = 'adsilence-sitzung';
/** So lange vor Ablauf gilt ein Zugangstoken schon als verbraucht. */
export const TOKEN_PUFFER_MS = 30 * 1000;

// ── Speicher ──────────────────────────────────────────────────────────────
export const SPEICHER_VERSION = 3;

/**
 * Hosts, in deren RAHMEN nie gerauscht wird - auch bei eingeschaltetem
 * Fingerabdruckschutz.
 *
 * Der Grund steht an `Einstellungen.fingerabdruck` in `typen.ts`: Das
 * Rauschen veraendert Canvas, Audio und Geraetedaten, und genau daran haengt
 * die Betrugserkennung waehrend einer Zahlung. Eine Karte, die deshalb
 * abgelehnt wird, ist der teuerste Fehler, den diese Erweiterung machen
 * kann - teurer als ein Fingerabdruck, der auf der Bezahlseite durchkommt.
 *
 * Bis zum 08.09.2026 war die Absicherung dagegen, dass der Schalter AB WERK
 * AUS stand. Seit er ab Werk AN ist (fuer Premium), traegt diese Liste sie:
 * Die Seite rauscht, der Zahlungsrahmen darin nicht.
 *
 * Verglichen wird ueber die Host-Kette, `js.stripe.com` trifft also
 * `stripe.com`. Die Liste ist bewusst KURZ und nennt nur, was der Katalog
 * schon als Leser dieser Werte benennt: Stripe, Adyen, PayPal (samt
 * Braintree, das dazugehoert). Wer sie erweitert, oeffnet ein Loch im
 * Schutz - jeder Eintrag braucht einen Grund.
 */
export const ZAHLUNGSHOSTS = [
  'stripe.com',
  'stripe.network',
  'adyen.com',
  'paypal.com',
  'paypalobjects.com',
  'braintreegateway.com',
] as const;

// ── Kosmetik ──────────────────────────────────────────────────────────────
/** Kennung des dynamisch registrierten Stylesheets fuer generische Selektoren. */
export const INHALT_CSS_ID = 'adsilence-kosmetik-generisch';

/**
 * Kennung der registrierten Scriptlet-Skripte, eines je Liste.
 *
 * Sie laufen in `world: 'MAIN'` bei `document_start` — der einzige Zeitpunkt,
 * zu dem ein Gegenmittel gegen Adblock-Erkennung noch wirkt. GEMESSEN am
 * 08.09.2026 mit dem alten Weg (`executeScript` aus dem Service Worker):
 * beim ersten Seitenskript stand die Falle nicht, nach 400 ms schon.
 */
export const INHALT_SCRIPTLET_ID = 'adsilence-scriptlets';
/** Hoechstens so viele Selektoren je CSS-Regel; ein ungueltiger reisst nur seine Gruppe mit. */
export const SELEKTOREN_JE_REGEL = 100;

// ── Meldung „Seite kaputt" (Grenzen aus vertrag.md 3) ─────────────────────
export const MELDUNG_MAX_REGELN = 50;
export const MELDUNG_MAX_REGEL_LAENGE = 200;
export const MELDUNG_MAX_LISTEN = 20;
export const MELDUNG_MAX_KOMMENTAR = 500;
export const MELDUNG_MAX_SEITE = 500;

// ── Badge ─────────────────────────────────────────────────────────────────
/**
 * Hintergrund des Zaehlers auf dem Symbol. Der Badge ist eine Browser-API und
 * kennt keine CSS-Variable.
 *
 * ── Warum NICHT die Markenfarbe ────────────────────────────────────────────
 * Bis zum 05.09.2026 stand hier `--marke-von` — damals ein Blau, und das Symbol
 * darunter war ebenfalls blau. Aufgefallen ist es nicht, weil der Badge klein
 * ist und in der Ecke sitzt. Mit dem orangen Symbol waere daraus Orange auf
 * Orange geworden: eine Zahl, die man nur noch an ihrer Kante erkennt.
 *
 * Der Badge liegt AUF dem Symbol und braucht deshalb den Gegenton, nicht den
 * gleichen. Das Dunkel ist dasselbe wie `--marke-akzent-schrift`; Chrome waehlt
 * die Ziffernfarbe selbst und nimmt darauf Weiss.
 *
 * (Nebenbei liefen die beiden Werte schon vorher auseinander: hier #2a63d4,
 * in `tokens.css` #1e33c4. Zwei Zahlen, die "dasselbe" sein sollten, halten
 * das nicht durch — jetzt ist es ausdruecklich nicht dasselbe.)
 */
export const BADGE_FARBE = '#1a0702';

/**
 * Die Filterlisten, wie sie das Manifest kennt. Die Wahrheit ueber Namen,
 * Quellen und Budgets liegt in `listen/quellen.json` (Paket Engine); diese
 * Tabelle ist der Rueckfall, falls die Datei im Paket fehlt, und die eine
 * Stelle, die sagt, welche Liste Premium ist.
 */
export const LISTEN_VORGABE: ReadonlyArray<{ id: string; name: string; premium: boolean; standard: boolean; sprache?: string }> = [
  { id: "basis", name: "EasyList", premium: false, standard: true },
  { id: "privatsphaere", name: "EasyPrivacy", premium: false, standard: true },
  { id: "hosts", name: "Peter Lowe's List", premium: false, standard: true },
  { id: "tarnung", name: "AdSilence Tarnung", premium: false, standard: true },
  { id: "ublock", name: "uBlock filters", premium: false, standard: true },
  { id: "ublock-privatsphaere", name: "uBlock filters - Privacy", premium: false, standard: true },
  { id: "ublock-schadsoftware", name: "uBlock filters - Badware risks", premium: false, standard: true },
  { id: "urlhaus", name: "Online Malicious URL Blocklist", premium: false, standard: true },
  { id: "heimnetz", name: "Block Outsider Intrusion into LAN", premium: false, standard: true },
  { id: "ublock-eilig", name: "uBlock filters - Quick fixes", premium: false, standard: true },
  { id: "ublock-reparatur", name: "uBlock filters - Unbreak", premium: false, standard: true },
  { id: "antiadblock", name: "Adblock Warning Removal List", premium: false, standard: true },
  { id: "cookies", name: "EasyList Cookie", premium: false, standard: true },
  { id: "laestig", name: "Fanboy's Annoyances", premium: false, standard: true },
  { id: "regional-de", name: "EasyList Germany", premium: false, standard: false, sprache: "de" },
  { id: "regional-fr", name: "Liste FR", premium: false, standard: false, sprache: "fr" },
  { id: "regional-it", name: "EasyList Italy", premium: false, standard: false, sprache: "it" },
  { id: "regional-nl", name: "EasyList Dutch", premium: false, standard: false, sprache: "nl" },
  { id: "regional-es", name: "EasyList Spanish", premium: false, standard: false, sprache: "es" },
  { id: "regional-zh", name: "EasyList China", premium: false, standard: false, sprache: "zh" },
  { id: "regional-ru", name: "RU AdList", premium: false, standard: false, sprache: "ru" },
  { id: "regional-pl", name: "EasyList Polish", premium: false, standard: false, sprache: "pl" },
  { id: "regional-pt", name: "EasyList Portuguese", premium: false, standard: false, sprache: "pt" },
  { id: "regional-ja", name: "ABP Japanese filters", premium: false, standard: false, sprache: "ja" },
  { id: "regional-ko", name: "YousList", premium: false, standard: false, sprache: "ko" },
  { id: "regional-tr", name: "Turkish Filters", premium: false, standard: false, sprache: "tr" },
  { id: "regional-vi", name: "ABPVN List", premium: false, standard: false, sprache: "vi" },
  { id: "regional-id", name: "ABPindo", premium: false, standard: false, sprache: "id" },
  { id: "regional-ar", name: "Liste AR", premium: false, standard: false, sprache: "ar" },
  { id: "regional-sv", name: "Frellwits Swedish Filter", premium: false, standard: false, sprache: "sv" },
  { id: "regional-fa", name: "Adblock Iran", premium: false, standard: false, sprache: "fa" },
  { id: "regional-hi", name: "IndianList", premium: false, standard: false, sprache: "hi" },
];

/**
 * Welchem BEREICH eine Liste zugerechnet wird — der grobe Begriff statt des
 * Namens.
 *
 * ── Wogegen das steht ─────────────────────────────────────────────────────
 * Die Meldung „Ich sehe hier Werbung" zeigt dem Kunden vorher, was gesendet
 * wird, und schickt danach genau das. Unter „Aktive Listen" stand dabei die
 * rohe Kennung jeder Liste — also `ublock`, `urlhaus`, `antiadblock`. Damit
 * standen in einem Fenster, das unser Produkt zeigt, die Namen fremder
 * Projekte; ein Kunde liest das als Zutatenliste und weiss mit keinem der
 * Woerter etwas anzufangen.
 *
 * Gesendet wird deshalb der Bereich, nicht die Liste. Der Bereich sagt
 * demjenigen, der die Meldung bearbeitet, das Entscheidende — fehlte
 * `schadsoftware` oder `cookies`, sucht man woanders — und nennt niemanden
 * beim Namen.
 *
 * Die SCHLUESSEL gehen ueber die Leitung, nicht die uebersetzten Woerter: Die
 * Meldung wird in der Sprache des Kunden geschrieben und in unserer gelesen.
 * Uebersetzt wird erst beim Anzeigen (`popup.meldung.bereich.*`).
 */
const BEREICH_JE_LISTE: Readonly<Record<string, string>> = {
  basis: 'werbung',
  ublock: 'werbung',
  'ublock-eilig': 'werbung',
  tarnung: 'werbung',
  antiadblock: 'werbung',
  privatsphaere: 'privatsphaere',
  'ublock-privatsphaere': 'privatsphaere',
  hosts: 'privatsphaere',
  'ublock-schadsoftware': 'schadsoftware',
  urlhaus: 'schadsoftware',
  heimnetz: 'schadsoftware',
  cookies: 'cookies',
  laestig: 'laestiges',
  'ublock-reparatur': 'reparatur',
};

/**
 * Die Reihenfolge, in der Bereiche erscheinen. Fest und nicht alphabetisch:
 * Sie soll in jeder Sprache dieselbe sein, und alphabetisch waere sie das
 * nicht.
 */
const BEREICHE = ['werbung', 'privatsphaere', 'schadsoftware', 'cookies', 'laestiges', 'reparatur', 'regional'] as const;

/**
 * Aus Listenkennungen die Bereiche — ohne Wiederholung, in fester Reihenfolge.
 *
 * Alles, was mit `regional-` beginnt, faellt in `regional`: Welche Sprache es
 * war, steht ohnehin in der Meldung nicht zur Debatte, und die Aufzaehlung
 * von zwoelf Regionallisten waere genau die Zutatenliste, die hier weg soll.
 *
 * Eine Liste, die in der Tabelle fehlt, faellt still weg. Das ist Absicht: Sie
 * darf keine Kennung durchreichen — lieber ein Bereich weniger als ein
 * Projektname in der Meldung.
 */
export function bereicheVon(listenIds: readonly string[]): string[] {
  const gefunden = new Set<string>();
  for (const id of listenIds) {
    if (id.startsWith('regional-')) gefunden.add('regional');
    else if (BEREICH_JE_LISTE[id]) gefunden.add(BEREICH_JE_LISTE[id]!);
  }
  return BEREICHE.filter((b) => gefunden.has(b));
}
