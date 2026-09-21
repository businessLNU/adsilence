/**
 * Die Formen, die Hintergrund, Oberflaeche und Inhaltsskript teilen.
 * Nachrichten nach vertrag.md Abschnitt 7, Speicher nach Abschnitt 8.
 *
 * Alles hier sind reine Typen. Wer eine Form aendert, aendert zuerst den
 * Vertrag, dann diese Datei, dann den Code.
 */

export type Browser = 'chromium' | 'firefox' | 'safari';

export type Thema = 'system' | 'hell' | 'dunkel';

// ── Lizenz (Antwort von GET /api/adsilence/lizenz, gespeichert in local) ───

export type LizenzHinweis = 'zahlungOffen' | 'angehalten' | null;

export type Lizenz = {
  tarif: 'frei' | 'premium';
  premium: boolean;
  planKeys: string[];
  /** ISO-Zeitpunkt oder null (Datum wird als String gespeichert). */
  gueltigBis: string | null;
  endetZumTermin: boolean;
  hinweis: LizenzHinweis;
  /** Wann der Server das zuletzt gesagt hat, Millisekunden seit 1970. */
  geprueftAm: number;
};

// ── Speicher `storage.local` ──────────────────────────────────────────────

export type Einstellungen = {
  aktiv: boolean;
  /** Listen-ID → eingeschaltet. Fehlt eine ID, gilt die Vorgabe der Liste. */
  listen: Record<string, boolean>;
  sprache: string | null;
  thema: Thema;
  zaehlerBadge: boolean;
  /**
   * Der Verwechslungswarner (Premium). Vorgabe AN.
   *
   * Er stand zuerst auf AUS, mit der Begruendung, er greife sichtbar in fremde
   * Seiten ein. Das war die falsche Abwaegung: Wer eine gefaelschte Bankseite
   * nicht erkennt, sucht auch nicht in den Optionen nach einem Schalter
   * dagegen. Ein Schutz, den man erst einschalten muss, erreicht genau die
   * Leute nicht, fuer die er gebaut ist.
   *
   * Er wirkt ohnehin nur mit Premium, greift nur im Hauptrahmen und meldet
   * sich auf einer normalen Seite nie - der Eingriff ist also klein und der
   * Ausweg einen Klick entfernt.
   */
  warnung: boolean;
  /**
   * Cookie-Fenster automatisch beantworten (Premium).
   *
   * `aus` ist die Vorgabe, und das ist eine Entscheidung: Ein Klick im Namen
   * des Nutzers ist eine WILLENSERKLAERUNG. Ihn ungefragt zustimmen zu
   * lassen, waere anmassend; ihn ungefragt ablehnen zu lassen, sperrt ihn auf
   * manchen Seiten aus. Wer es will, waehlt es - und waehlt dabei auch, was
   * geklickt wird.
   */
  cookieAntwort: 'aus' | 'ablehnen' | 'annehmen';
  /**
   * Die Listen täglich nachziehen (Premium). Ab Werk AN: Eine Filterliste,
   * die drei Monate alt ist, kennt die Werbeserver von heute nicht, und
   * genau dafür ist die Erweiterung da.
   */
  listenPflege: boolean;
  /**
   * „Fingerabdruck verwischen": Canvas, Audio und Geraetedaten bekommen in
   * der Hauptwelt ein leichtes Rauschen (`inhalt/fingerabdruck.ts`).
   *
   * PREMIUM und ab Werk AN (seit 08.09.2026; vom 07. bis 08.09. ab Werk aus,
   * davor frei und an).
   *
   * Das Hin und Her hat einen Grund, und beide Male war er richtig. Ab Werk
   * AUS war die Bauart: Das Rauschen veraendert, was eine Seite ueber Canvas,
   * Audio und Geraet ausliest, und das ist bei Betrugserkennung waehrend
   * einer Zahlung genau das Merkmal, an dem eine Karte haengenbleibt (Stripe,
   * Adyen und PayPal Fraudnet lesen beides).
   *
   * Der Preis dafuer war zu hoch. GEMESSEN am 08.09.2026 mit
   * `tests/laufzeit/fingerabdruck-diagnose.mjs`: Ein Kunde MIT Premium bekam
   * denselben Canvas-Hash wie ein Browser ganz ohne Erweiterung, und Cover
   * Your Tracks meldete ihm „nearly-unique fingerprint". Er bezahlte fuer
   * eine Funktion, die stumm auslieferte, und nichts sagte ihm, dass ein
   * Schalter fehlt.
   *
   * Die Zahlung schuetzt seither nicht mehr die Vorgabe, sondern
   * `ZAHLUNGSHOSTS` in `konstanten.ts`: `fingerabdruckFuer()` gibt fuer diese
   * RAHMEN nie ein Rauschen aus. Der Shop rauscht, das Zahlungsfenster darin
   * nicht.
   *
   * Durchgesetzt wird Premium in `fingerabdruckFuer()`, nicht am Schalter:
   * Der Schalter zeigt es nur an.
   */
  fingerabdruck: boolean;
};

export type SiteEintrag = { erlaubt: boolean; seit: number };
export type Sites = Record<string, SiteEintrag>;

export type Konto = {
  refreshToken: string;
  /** Millisekunden seit 1970. */
  refreshLaeuftAb: number;
  email: string;
  name: string | null;
  seit: number;
};

/**
 * Warum kein Konto (mehr) da ist. `neuVerbinden`: der Server hat die Sitzung
 * entwertet, der Nutzer muss den Code-Weg noch einmal gehen. `gesperrt`: das
 * Konto ist gesperrt; die Token bleiben liegen, weil eine Sperre
 * zurueckgenommen werden kann (Regel 11).
 */
export type KontoHinweis = 'neuVerbinden' | 'gesperrt' | null;

/** Ein laufender Code-Abgleich; ueberlebt einen Neustart des Service Workers. */
export type VerbindungOffen = {
  code: string;
  abholGeheimnis: string;
  verbindenUrl: string;
  seit: number;
  laeuftAb: number;
};

export type Abgleich = { version: number; aktualisiertAm: string | null };

export type SpeicherLokal = {
  einstellungen: Einstellungen;
  sites: Sites;
  konto: Konto | null;
  kontoHinweis: KontoHinweis;
  lizenz: Lizenz | null;
  eigeneRegeln: string;
  verbindungOffen: VerbindungOffen | null;
  abgleich: Abgleich;
  stand: { version: number };
  /**
   * Was der letzte ERFOLGREICHE Lauf der Listenpflege ergeben hat; null vor
   * dem ersten.
   *
   * `am` bleibt bei einem Fehlschlag unangetastet: `istUeberfaellig()` rechnet damit, und ein Fehlversuch, der
   * das Datum vorstellt, verhindert den naechsten Versuch fuer 26 Stunden.
   * Was schiefging, steht daneben in `fehlend` und `fehlgeschlagenAm`.
   */
  listenPflegeStand: {
    am: string;
    neu: number;
    uebergangen: number;
    gelesen: string[];
    fehlend: string[];
    fehlgeschlagenAm?: string;
  } | null;
};

// ── Speicher `storage.session` ────────────────────────────────────────────

export type Sitzung = { accessToken: string; laeuftAb: number };

export type SpeicherSitzung = {
  sitzung: Sitzung | null;
  /** Letzter Grund, warum ein Ruleset nicht geschaltet werden konnte. */
  listenFehler: string | null;
  /** Letzter Fehler beim Code-Abgleich, fuer die Optionsseite. */
  verbindungFehler: string | null;
  /**
   * Das Sitzungs-Token fuer das Rauschen (`hintergrund/fingerabdruck.ts`).
   * In `session` und nicht in `local`, weil es genau so lange leben soll wie
   * die Browsersitzung: Ein dauerhaftes Token waere selbst ein
   * Wiedererkennungsmerkmal, ein je Start neues bricht den Wert innerhalb
   * eines Tages mehrfach.
   */
  fingerabdruckToken: string | null;
};

// ── Nachrichten Oberflaeche ↔ Hintergrund (vertrag.md 7) ──────────────────

export type ListenEintrag = {
  id: string;
  name: string;
  aktiv: boolean;
  /** Anzahl der DNR-Regeln laut `listen/bericht.json`, sonst null. */
  regeln: number | null;
  premium: boolean;
  /**
   * Ob die Liste ab Werk an ist. Die Oberflaeche fasst diese zu EINEM
   * Eintrag zusammen („Blocker Lite"): Elf einzelne Zeilen, die ohnehin alle
   * an sind, sind elf Entscheidungen, die niemand treffen will — und die
   * Namen dahinter (uBlock filters - Unbreak, Peter Lowe's List) sagen einem
   * Kunden nichts.
   */
  standard: boolean;
  /**
   * Bei einer regionalen Liste der Sprachcode. Die Oberflaeche macht daraus
   * den Namen der Sprache in ihrer eigenen Schreibweise - achtzehn Listen mal
   * zwanzig Sprachen waeren 360 Uebersetzungen fuer Namen, die ohnehin schon
   * in `sprachen.ts` stehen.
   */
  sprache?: string;
};

/**
 * Ein Tarif, wie ihn `GET /api/plans` liefert - nur die Felder, die das
 * Kauffenster zeigt.
 *
 * Betraege kommen FERTIG FORMATIERT (`formatted`) samt Waehrung. Hier wird
 * nichts gerechnet und nichts zusammengesetzt: Der Preis steht in der
 * Verwaltung, und ein zweiter Rechenweg in der Erweiterung ist der kurze Weg
 * zu einem Fenster, das 9 € sagt, waehrend 12 € abgebucht werden.
 */
export type TarifPreis = {
  perMonth: { formatted: string };
  billedTotal: { formatted: string };
  discountPercent?: number;
};

export type Tarif = {
  key: string;
  name: string;
  description: string;
  features: string[];
  /**
   * Testtage, die DIESER Aufrufer bekommt - nicht der Tarifwert.
   *
   * Der Server rechnet sie mit `testtageFuer()`, derselben Funktion, die sie
   * an der Kasse gewaehrt: Wer schon einmal abonniert hatte, bekommt 0, sonst
   * bliebe man durch Kuendigen und Neubuchen dauerhaft kostenlos. Damit das
   * hier stimmt, fragt `tarifeHolen()` MIT Token, sobald ein Konto verbunden
   * ist (siehe dort).
   *
   * 0 heisst: keine Testphase, und dann steht auch nichts im Fenster.
   */
  trialDays: number;
  /** Fehlt die Zahlweise in der Verwaltung, steht sie hier auf null. */
  monthly: TarifPreis | null;
  yearly: TarifPreis | null;
};

/**
 * Was `GET /api/plans` insgesamt sagt.
 *
 * `tarifmangel` unterscheidet „es gibt gerade keinen" von „wir konnten nicht
 * nachsehen". Beides als leere Liste zu zeigen hiesse dem Kunden sagen, es
 * gebe kein Premium - und das wuessten wir gar nicht.
 */
export type Tarifliste = {
  defaultInterval: 'monthly' | 'yearly';
  headlineDiscountPercent: number;
  tarifmangel: string | null;
  plans: Tarif[];
};

export type TabZustand = {
  host: string;
  erlaubt: boolean;
  /**
   * Vom Badge gelesen. `'amSymbol'`: Der Browser zaehlt und zeigt es am
   * Symbol, gibt die Zahl aber nicht heraus (siehe `hintergrund/badge.ts`).
   * `null`: Es gibt keinen Zaehler.
   */
  blockiert: number | 'amSymbol' | null;
  /**
   * Treffer je Liste, absteigend. Leer, wenn der Browser sie nicht herausgibt
   * (siehe `hintergrund/badge.ts`). Enthaelt NUR Listenkennung und Anzahl -
   * keine Adressen; `getMatchedRules` gibt gar keine heraus.
   *
   * `was` ist die Domain, die die Regel sperrt, oder `SAMMELREGEL` aus
   * `konstanten.ts`, wenn die Regel eine ganze Liste von Domains abdeckt.
   */
  jeListe: { id: string; anzahl: number; regeln: { was: string; anzahl: number }[] }[];
};

export type Zustand = {
  tab: TabZustand | null;
  aktiv: boolean;
  listen: ListenEintrag[];
  konto: { verbunden: boolean; email?: string; name?: string; hinweis: KontoHinweis };
  /** Der wirksame Stand nach Gnadenfrist, nie der rohe Speicherwert. */
  lizenz: Lizenz;
  verbindung: { code: string; verbindenUrl: string; laeuftAb: number } | null;
  version: string;
  browser: Browser;
  einstellungen: Einstellungen;
  listenFehler: string | null;
  verbindungFehler: string | null;
};

export type MeldungVorschau = {
  seite: string;
  browser: Browser;
  version: string;
  listen: string[];
  regeln: string[];
};

export type Nachricht =
  | { typ: 'zustand'; tabId?: number }
  | { typ: 'aktiv.setzen'; aktiv: boolean }
  | { typ: 'site.setzen'; host: string; erlaubt: boolean }
  | { typ: 'liste.setzen'; id: string; aktiv: boolean }
  | { typ: 'konto.verbinden' }
  | { typ: 'konto.trennen' }
  | { typ: 'lizenz.pruefen' }
  | { typ: 'premium.kaufen'; interval: 'monthly' | 'yearly'; zustimmung?: boolean }
  | { typ: 'tarife.holen' }
  | { typ: 'meldung.vorschau'; tabId: number }
  | { typ: 'meldung.senden'; seite: string; browser: Browser; version: string; listen: string[]; regeln: string[]; kommentar?: string }
  | { typ: 'regeln.eigene.setzen'; text: string }
  | { typ: 'abgleich.jetzt' }
  | { typ: 'kosmetik'; host: string }
  /**
   * Der Text der generischen Stylesheets der genannten Listen, fuer Shadow
   * Roots. Ueber den Hintergrund und nicht per `fetch` aus dem Inhaltsskript:
   * GEMESSEN am 03.09.2026 in Chrome for Testing 131 kam ein solcher `fetch`
   * auf `chrome-extension://…/kosmetik/basis.generisch.css` nie zurueck (die
   * Datei steht nicht in `web_accessible_resources`, und das soll so bleiben,
   * sonst koennte jede Seite die Erweiterung an dieser Datei erkennen).
   */
  | { typ: 'kosmetik.generisch'; listen: string[] }
  /**
   * Das Inhaltsskript fragt, ob dieser Host wie eine bekannte Marke aussieht.
   * Die Frage geht vom Inhaltsskript AUS und nicht umgekehrt: Ein Hinweis,
   * den der Hintergrund bei der Navigation schickt, kommt an, bevor es das
   * Inhaltsskript gibt (siehe `inhalt/warnung.ts`).
   */
  | { typ: 'verwechslung.pruefen'; host: string }
  /**
   * Das Inhaltsskript fragt, ob und wie es Cookie-Fenster beantworten soll.
   * Die Entscheidung faellt im Hintergrund: Dort liegen Einstellung UND
   * Lizenz, und eine davon im Inhaltsskript zu haben hiesse, sie auf einer
   * fremden Seite zu haben.
   */
  | { typ: 'cookies.antwort' }
  /** „Jetzt aktualisieren" in den Optionen: die Listenpflege sofort fahren. */
  | { typ: 'listen.pflegen' };

export type Antwort<T> =
  | ({ ok: true } & T)
  /**
   * `grund` ist der Klartext des Fehlers, den der Hintergrund gefangen hat —
   * bei einem geworfenen `fetch` etwa „Failed to fetch". Er wird NICHT
   * uebersetzt und ist nicht fuer die Anzeige gedacht, sondern fuer die
   * Fehlersuche: Der Code allein sagt „Netz", und das kann fuenferlei heissen.
   *
   * Angelegt am 06.09.2026, nachdem ein Rechner beim Verbinden „Keine
   * Verbindung zum Dienst" zeigte, waehrend derselbe Aufruf aus der Konsole
   * derselben Erweiterung mit 201 durchlief. Der Hintergrund KANNTE den
   * Grund — er warf ihn an dieser Grenze weg, und damit war er von aussen
   * nicht mehr zu bekommen.
   */
  | { ok: false; code: string; grund?: string };

/**
 * Antwort auf `{ typ: 'kosmetik', host }`.
 *
 * `listen` nennt die aktiven Listen, deren generische Selektoren als
 * `kosmetik/<id>.generisch.css` im Paket liegen. Das Inhaltsskript braucht
 * sie NICHT fuer das Dokument (dort haengt der Hintergrund die Dateien schon
 * als registriertes Inhaltsskript ein), sondern nur fuer Shadow Roots: Ein
 * Stylesheet des Dokuments endet an deren Grenze, und der Text muss deshalb
 * ein zweites Mal, als `CSSStyleSheet`, in jede Root uebernommen werden.
 *
 * GEMESSEN am 03.09.2026 in Chrome for Testing 131: Ohne dieses Feld blieb
 * ein `#AdBar` im offenen wie im geschlossenen Shadow Root sichtbar, waehrend
 * derselbe Koeder im Licht-DOM verschwand.
 */
/** Eine Textregel: Selektor plus das, was drinstehen muss. */
export type Textregel = {
  wahl: string;
  /** `/muster/` heisst regulaerer Ausdruck, sonst Teilstring. */
  text: string;
};

export type KosmetikAntwort = {
  selektoren: string[];
  /**
   * Regeln, die der Browser NICHT selbst anwenden kann, weil sie auf den
   * TEXT eines Elements sehen (`#?#.box:has-text(Werbung)`). Sie kommen nur
   * fuer Hosts mit, die welche haben - auf den allermeisten Seiten ist die
   * Liste leer, und dann laeuft im Inhaltsskript auch kein Laeufer.
   */
  textregeln: Textregel[];
  aus: boolean;
  listen: string[];
  /**
   * Ob die Hauptwelt auf dieser Seite rauschen soll, und mit welchem Token.
   * `an` haengt an der OBERSTEN Seite UND am Rahmen-Host (wer einen Shop
   * freigibt, gibt auch dessen Zahlungsrahmen frei); `token` ist an die
   * oberste Seite gebunden und nur gesetzt, wenn `an` gilt. `token: null`
   * bei `an: true` heisst: rauschen, aber ohne Sitzungsbindung.
   */
  fingerabdruck: { an: boolean; token: string | null };
};
