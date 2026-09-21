/**
 * Die einzige Stelle, die mit dem Backend spricht (vertrag.md 6).
 *
 * Jede Anfrage: `credentials: 'omit'` (kein Cookie, die Erweiterung hat eine
 * eigene Sitzung), `Authorization: Bearer` wo noetig, `Accept-Language` aus
 * der Browsersprache, damit `message` in der Antwort schon uebersetzt ist.
 *
 * Erneuerung des Zugangstokens single-flight ueber `navigator.locks`: Popup
 * und Service Worker koennten gleichzeitig erneuern, der Server dreht den
 * Refresh-Token bei jeder Erneuerung weiter, und eine Wiederverwendung
 * entwertet ALLE Sitzungen des Kontos. Im Lock wird zuerst nachgelesen, ob
 * ein anderer Kontext schon erneuert hat.
 *
 * Was den Server erreicht, hat der Nutzer ausgeloest: Verbinden, Kaufen,
 * Melden, Trennen. Keine URL, kein Verlauf, kein Zaehler.
 */

import { api } from '../gemeinsam/browser.ts';
import { ALARM_VERBINDUNG, API_BASIS, BROWSER, LOCK_SITZUNG, TARIF_KEY, TOKEN_PUFFER_MS, VERBINDUNG_MAX_MS, VERBINDUNG_TAKT_MS } from '../gemeinsam/konstanten.ts';
import { liesLokal, liesSitzung, schreibeLokal, schreibeSitzung } from '../gemeinsam/speicher.ts';
import type { Konto, MeldungVorschau, Tarifliste, VerbindungOffen } from '../gemeinsam/typen.ts';
import { allesAnwenden } from './anwenden.ts';
import { folgeFuer, type Folge } from './fehlercodes.ts';
import { freiLizenz } from './lizenz-regeln.ts';
import { lizenzPruefen } from './lizenz.ts';

/**
 * Ein Fehler vom Backend. `code` ist stabil, `message` schon uebersetzt.
 *
 * Die beiden Felder werden im Rumpf zugewiesen und NICHT als
 * Parameter-Eigenschaften geschrieben: Node fuehrt TypeScript nur im
 * strip-only mode aus, streicht also bloss die Typen heraus und erzeugt
 * keinen Code. `constructor(readonly code: string)` braucht aber erzeugten
 * Code und bricht mit ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX ab. Damit liess sich
 * diese Datei aus `node --test` nicht laden, und mit ihr nicht lizenz.ts und
 * abgleich.ts: elf Pruefungen des Kontowegs liefen als `todo` statt scharf.
 */
export class ApiFehler extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiFehler';
    this.code = code;
    this.status = status;
  }
}

type SitzungAntwort = {
  user: { email: string; name: string | null };
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
};

/**
 * Die Sprache, in der der Server antworten soll.
 *
 * ERST die Wahl des Nutzers (`einstellungen.sprache`), dann die des Browsers -
 * dieselbe Reihenfolge wie in der Oberflaeche (`oberflaeche/i18n.ts`).
 *
 * GEMESSEN am 07.09.2026: Hier stand nur `getUILanguage()`. Wer Chrome auf
 * Englisch hatte und AdSilence auf Deutsch stellte, bekam ein deutsches
 * Kauffenster mit ENGLISCHEN Tarifmerkmalen - die kommen aus `GET /api/plans`
 * und richten sich nach diesem Kopf.
 *
 * Keine Liste verfuegbarer Sprachen dazwischen: Was der SERVER anbieten kann,
 * weiss der Server. Ein Code, den er nicht fuehrt, faellt dort auf
 * `DEFAULT_LOCALE` zurueck - hier eine zweite Liste zu pflegen hiesse, sie
 * beim naechsten Sprachwechsel im Backend nachziehen zu muessen.
 *
 * Faellt der Speicher aus, bleibt der Browser die Auskunft. Ein Fenster in der
 * falschen Sprache ist besser als eine Anfrage, die daran scheitert.
 */
async function sprache(): Promise<string> {
  const vomBrowser = () => {
    try {
      return api.i18n.getUILanguage();
    } catch {
      return 'en';
    }
  };
  try {
    const { einstellungen } = await liesLokal('einstellungen');
    return einstellungen.sprache || vomBrowser();
  } catch {
    return vomBrowser();
  }
}

type AnfrageOptionen = { method?: string; body?: unknown; token?: string | null };

export async function anfrage<T>(pfad: string, optionen: AnfrageOptionen = {}): Promise<T> {
  const kopf: Record<string, string> = { 'Accept-Language': await sprache() };
  if (optionen.body !== undefined) kopf['Content-Type'] = 'application/json';
  if (optionen.token) kopf.Authorization = `Bearer ${optionen.token}`;

  let antwort: Response;
  try {
    antwort = await fetch(`${API_BASIS}${pfad}`, {
      method: optionen.method ?? (optionen.body !== undefined ? 'POST' : 'GET'),
      headers: kopf,
      credentials: 'omit',
      body: optionen.body !== undefined ? JSON.stringify(optionen.body) : undefined,
    });
  } catch (e) {
    throw new ApiFehler('NETZ', e instanceof Error ? e.message : String(e), 0);
  }

  const roh = await antwort.text();
  let daten: unknown = null;
  try {
    daten = roh ? JSON.parse(roh) : null;
  } catch {
    daten = null;
  }

  if (!antwort.ok) {
    const fehler = (daten as { error?: { code?: string; message?: string } } | null)?.error;
    const code = fehler?.code ?? (antwort.status === 429 ? 'RATE_LIMITED' : 'UNBEKANNT');
    throw new ApiFehler(code, fehler?.message ?? `HTTP ${antwort.status}`, antwort.status);
  }
  return daten as T;
}

// Ohne Web Locks (sehr alte Safari-Versionen) haelt eine Modulvariable die
// Reihenfolge wenigstens innerhalb dieses Kontexts.
let ersatzKette: Promise<unknown> = Promise.resolve();

function mitLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
  if (locks && typeof locks.request === 'function') return locks.request(LOCK_SITZUNG, fn) as Promise<T>;
  const naechste = ersatzKette.then(fn, fn);
  ersatzKette = naechste.catch(() => undefined);
  return naechste;
}

function gueltig(sitzung: { accessToken: string; laeuftAb: number } | null, jetzt: number): string | null {
  return sitzung && sitzung.laeuftAb - TOKEN_PUFFER_MS > jetzt ? sitzung.accessToken : null;
}

async function uebernehmeSitzung(s: SitzungAntwort, seit: number): Promise<void> {
  const jetzt = Date.now();
  const konto: Konto = {
    refreshToken: s.refreshToken,
    refreshLaeuftAb: jetzt + s.refreshExpiresIn * 1000,
    email: s.user.email,
    name: s.user.name ?? null,
    seit,
  };
  await schreibeSitzung({ sitzung: { accessToken: s.accessToken, laeuftAb: jetzt + s.expiresIn * 1000 } });
  await schreibeLokal({ konto, kontoHinweis: null });
}

/**
 * Fehlercode → Zustand (vertrag.md 6). Trennen loescht Token und Lizenz und
 * verlangt eine neue Verbindung; eine Sperre laesst die Token liegen, weil
 * sie zurueckgenommen werden kann. Alles andere: spaeter noch einmal.
 */
export async function verarbeiteKontoFehler(f: ApiFehler): Promise<Folge> {
  const folge = folgeFuer(f.code, f.status);
  if (folge === 'trennen') {
    await schreibeSitzung({ sitzung: null });
    await schreibeLokal({ konto: null, kontoHinweis: 'neuVerbinden', lizenz: freiLizenz(Date.now()) });
    await allesAnwenden();
  } else if (folge === 'gesperrt') {
    await schreibeSitzung({ sitzung: null });
    await schreibeLokal({ kontoHinweis: 'gesperrt', lizenz: freiLizenz(Date.now()) });
    await allesAnwenden();
  }
  return folge;
}

/**
 * Ein gueltiges Zugangstoken, oder null, wenn kein Konto verbunden ist.
 * Wirft `ApiFehler`, wenn die Erneuerung scheitert; der Speicher ist dann
 * schon auf den passenden Zustand gesetzt.
 */
export async function holeZugang(erzwingen = false): Promise<string | null> {
  const jetzt = Date.now();
  if (!erzwingen) {
    const { sitzung } = await liesSitzung('sitzung');
    const token = gueltig(sitzung, jetzt);
    if (token) return token;
  }
  const { konto } = await liesLokal('konto');
  if (!konto) return null;

  return mitLock(async () => {
    // Hat ein anderer Kontext inzwischen erneuert?
    if (!erzwingen) {
      const { sitzung } = await liesSitzung('sitzung');
      const token = gueltig(sitzung, Date.now());
      if (token) return token;
    }
    const { konto: aktuell } = await liesLokal('konto');
    if (!aktuell) return null;
    try {
      const s = await anfrage<SitzungAntwort>('/api/adsilence/geraete/auffrischen', {
        body: { refreshToken: aktuell.refreshToken },
      });
      await uebernehmeSitzung(s, aktuell.seit);
      return s.accessToken;
    } catch (f) {
      if (f instanceof ApiFehler) await verarbeiteKontoFehler(f);
      throw f;
    }
  });
}

/**
 * Anfrage mit Konto. Ohne verbundenes Konto: `NICHT_VERBUNDEN`. Antwortet der
 * Server mit 401, obwohl das Token lokal noch gueltig schien (Uhr, Neustart
 * des Servers), wird genau einmal erzwungen erneuert und wiederholt.
 */
export async function anfrageMitKonto<T>(pfad: string, optionen: Omit<AnfrageOptionen, 'token'> = {}, wiederholt = false): Promise<T> {
  const token = await holeZugang(wiederholt);
  if (!token) throw new ApiFehler('NICHT_VERBUNDEN', '', 0);
  try {
    return await anfrage<T>(pfad, { ...optionen, token });
  } catch (f) {
    if (!(f instanceof ApiFehler)) throw f;
    const folge = await verarbeiteKontoFehler(f);
    if (f.status === 401 && folge === 'fehler' && !wiederholt) return anfrageMitKonto<T>(pfad, optionen, true);
    throw f;
  }
}

// Verbindung ueber Code (vertrag.md 3: /verbindung, /verbindung/abholen)

function geraeteName(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const browser =
    BROWSER === 'firefox' ? 'Firefox'
    : BROWSER === 'safari' ? 'Safari'
    : /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Vivaldi/.test(ua) ? 'Vivaldi'
    : 'Chrome';
  const system =
    /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return (system ? `${browser}, ${system}` : browser).slice(0, 80);
}

let abholenLaeuft = false;

/** Code holen, Website oeffnen, Abholen anstossen. */
export async function verbindungStarten(): Promise<{ code: string; verbindenUrl: string }> {
  const a = await anfrage<{ code: string; abholGeheimnis: string; verbindenUrl: string; laeuftAbIn: number }>('/api/adsilence/verbindung', {
    body: { browser: BROWSER, geraet: geraeteName() },
  });
  const jetzt = Date.now();
  const laeuftAbIn = typeof a.laeuftAbIn === 'number' ? a.laeuftAbIn * 1000 : VERBINDUNG_MAX_MS;
  const offen: VerbindungOffen = {
    code: a.code,
    abholGeheimnis: a.abholGeheimnis,
    verbindenUrl: a.verbindenUrl,
    seit: jetzt,
    laeuftAb: jetzt + Math.min(laeuftAbIn, VERBINDUNG_MAX_MS),
  };
  await schreibeLokal({ verbindungOffen: offen, kontoHinweis: null });
  await schreibeSitzung({ verbindungFehler: null });

  try {
    await api.tabs.create({ url: a.verbindenUrl });
  } catch (e) {
    console.warn('[AdSilence] Tab oeffnen', e);
  }
  // Der Alarm faengt den Fall, dass der Browser den Service Worker vor dem
  // Abholen beendet; der Timer unten ist der schnelle Weg, solange er lebt.
  try {
    await api.alarms.create(ALARM_VERBINDUNG, { periodInMinutes: 0.5 });
  } catch {
    // Ohne Alarme bleibt der Timer.
  }
  void verbindungFortsetzen();
  return { code: a.code, verbindenUrl: a.verbindenUrl };
}

async function verbindungBeenden(fehler: string | null): Promise<void> {
  await schreibeLokal({ verbindungOffen: null });
  await schreibeSitzung({ verbindungFehler: fehler });
  try {
    await api.alarms.clear(ALARM_VERBINDUNG);
  } catch {
    // kein Alarm, nichts zu tun
  }
}

/** Ein Abholversuch. */
export async function verbindungAbholen(): Promise<'wartet' | 'fertig' | 'ende'> {
  const { verbindungOffen: offen } = await liesLokal('verbindungOffen');
  if (!offen) return 'ende';
  if (Date.now() > offen.laeuftAb) {
    await verbindungBeenden('VERBINDUNG_ABGELAUFEN');
    return 'ende';
  }
  try {
    const a = await anfrage<{ zustand: 'wartet' } | ({ zustand: 'fertig' } & SitzungAntwort)>('/api/adsilence/verbindung/abholen', {
      body: { code: offen.code, abholGeheimnis: offen.abholGeheimnis },
    });
    if (a.zustand !== 'fertig') return 'wartet';
    await uebernehmeSitzung(a, Date.now());
    await verbindungBeenden(null);
    await lizenzPruefen('verbindung');
    return 'fertig';
  } catch (f) {
    if (f instanceof ApiFehler && (f.status === 404 || f.status === 409 || f.status === 410 || f.status === 423)) {
      await verbindungBeenden(f.code);
      return 'ende';
    }
    // Netz, Bremse, Wartung: einfach weiter warten.
    return 'wartet';
  }
}

/**
 * Laeuft, solange eine Verbindung offen ist: alle 3 s ein Versuch. Wird beim
 * Aufwachen des Service Workers und vom Alarm gerufen; ein zweiter Aufruf
 * waehrend ein Lauf lebt, tut nichts.
 */
export async function verbindungFortsetzen(): Promise<void> {
  if (abholenLaeuft) return;
  const { verbindungOffen } = await liesLokal('verbindungOffen');
  if (!verbindungOffen) return;
  abholenLaeuft = true;
  try {
    for (;;) {
      const ergebnis = await verbindungAbholen();
      if (ergebnis !== 'wartet') return;
      await new Promise((r) => setTimeout(r, VERBINDUNG_TAKT_MS));
    }
  } finally {
    abholenLaeuft = false;
  }
}

/** Abmelden beim Server (bestmoeglich), dann alles Lokale weg. */
export async function kontoTrennen(): Promise<void> {
  const { konto } = await liesLokal('konto');
  if (konto) {
    try {
      await anfrage('/api/adsilence/geraete/abmelden', { body: { refreshToken: konto.refreshToken } });
    } catch {
      // Der Server kennt den Token vielleicht schon nicht mehr; lokal ist
      // die Trennung trotzdem vollstaendig.
    }
  }
  await schreibeSitzung({ sitzung: null, verbindungFehler: null });
  await schreibeLokal({ konto: null, kontoHinweis: null, lizenz: freiLizenz(Date.now()), verbindungOffen: null, abgleich: { version: 0, aktualisiertAm: null } });
  await allesAnwenden();
}

// Kauf und Meldung

/**
 * Checkout-Adresse fuer Premium. NUR mit verbundenem Konto: Ohne Token wuerde
 * der Server einen Gastkauf anlegen, und die Erweiterung erfuehre nie davon.
 * Freigeschaltet wird nie von hier aus, sondern vom Webhook; die Erweiterung
 * fragt danach nur die Lizenz ab (Regel 2).
 */
export async function checkoutUrl(interval: 'monthly' | 'yearly'): Promise<string> {
  const a = await anfrageMitKonto<{ url: string }>('/api/billing/checkout', {
    body: {
      plan: TARIF_KEY,
      interval,
      zustimmung: true,
      successPath: '/erweiterung/fertig',
      cancelPath: '/erweiterung/abgebrochen',
    },
  });
  return a.url;
}

/**
 * Die Tarife fuer das Kauffenster.
 *
 * MIT Token, sobald ein Konto verbunden ist - seit dem 08.09.2026, und das
 * war vorher anders begruendet: „die Frage `was kostet Premium` haengt nicht
 * daran, wer fragt". Das stimmt fuer den Preis und NICHT fuer `trialDays`.
 *
 * `/api/plans` haengt an `optionalAuth` und rechnet die Testtage mit
 * `testtageFuer(tarif, schonMalAbonniert)` - derselben Funktion, die sie an
 * der Kasse gewaehrt. Ohne Token weiss die Route nicht, wer fragt, nimmt
 * „noch nie abonniert" an und gibt die vollen Tage zurueck. Das Fenster
 * verspraeche einem Bestandskunden damit eine Testphase, die die Kasse ihm
 * nie gibt - genau der Fehler, den das Backend an `serialize()` schon einmal
 * hatte und dort behoben hat.
 *
 * Ohne Konto bleibt es anonym: Dann ist „noch nie abonniert" richtig.
 * Scheitert das Holen des Tokens, wird ebenfalls anonym gefragt - ein
 * Kauffenster ohne Preise waere die schlechtere Antwort als eines, das die
 * Testtage zu grosszuegig zeigt.
 */
export async function tarifeHolen(): Promise<Tarifliste> {
  let token: string | null = null;
  try {
    token = await holeZugang();
  } catch {
    token = null;
  }
  return anfrage<Tarifliste>('/api/plans', token ? { token } : {});
}

/** Ohne Token, ohne Personenbezug. Der Server kuerzt `seite` noch einmal. */
export async function meldungSenden(vorschau: MeldungVorschau, kommentar: string | undefined): Promise<{ id: string }> {
  return anfrage<{ id: string }>('/api/adsilence/meldung', {
    body: kommentar ? { ...vorschau, kommentar } : vorschau,
  });
}
