/**
 * Ein fester Beispielzustand, damit Popup und Optionsseite im normalen
 * Browser anzusehen sind (Vite-Vorschau), ohne Service Worker dahinter.
 *
 * Eingeschaltet NUR, wenn `api.runtime` fehlt UND `?attrappe=…` in der URL
 * steht. Im Paket gibt es `api.runtime` immer; dort ist diese Datei toter
 * Code und faellt beim Buendeln nicht ins Gewicht.
 *
 * Varianten ueber den Wert: `?attrappe=1` (frei, kein Konto),
 * `verbunden` (Konto, freier Tarif), `premium`, `gesperrt`, `wartet`
 * (Verbindungscode offen), `leer` (kein Tab), `fehler` (Hintergrund weg).
 *
 * Die Werte sind bewusst erfunden (`beispiel.de`), Regel 1.
 *
 * Adressen kommen aus `API_BASIS` und stehen NICHT als `http://localhost:3000`
 * da. Der Grund ist das Auslieferungspaket: Diese Datei ist dort zwar toter
 * Code, ihre Zeichenketten landen aber im Buendel — und eine
 * Entwicklungsadresse im Store-Paket sieht bei der Pruefung wie ein
 * vergessener Rest aus (gemessen am 09.09.2026 in `dist/chromium`).
 */

import type {
  Antwort,
  Lizenz,
  MeldungVorschau,
  Nachricht,
  SpeicherLokal,
  Zustand,
} from '../gemeinsam/typen.ts';
import { API_BASIS, LISTEN_VORGABE, TARIF_KEY } from '../gemeinsam/konstanten.ts';
import { LOKAL_VORGABE } from '../gemeinsam/speicher.ts';
import type { Antworten } from './laufzeit.ts';

type Variante = '1' | 'verbunden' | 'premium' | 'gesperrt' | 'wartet' | 'leer' | 'fehler';

export function attrappeVariante(): Variante | null {
  if (typeof location === 'undefined') return null;
  const wert = new URLSearchParams(location.search).get('attrappe');
  if (!wert) return null;
  return (['1', 'verbunden', 'premium', 'gesperrt', 'wartet', 'leer', 'fehler'] as const).includes(
    wert as Variante,
  )
    ? (wert as Variante)
    : '1';
}

const TAG = 24 * 60 * 60 * 1000;
const jetzt = Date.now();

function lizenzFuer(variante: Variante): Lizenz {
  const premium = variante === 'premium';
  return {
    tarif: premium ? 'premium' : 'frei',
    premium,
    planKeys: premium ? ['premium'] : [],
    gueltigBis: premium ? new Date(jetzt + 23 * TAG).toISOString() : null,
    endetZumTermin: false,
    hinweis: null,
    geprueftAm: jetzt - 40 * 60 * 1000,
  };
}

const speicher: SpeicherLokal = structuredClone(LOKAL_VORGABE);
const zuhoerer = new Set<(aenderungen: Partial<SpeicherLokal>) => void>();

function melde(teil: Partial<SpeicherLokal>): void {
  Object.assign(speicher, teil);
  for (const cb of zuhoerer) cb(teil);
}

export function attrappeEinrichten(variante: Variante): void {
  const verbunden = variante === 'verbunden' || variante === 'premium' || variante === 'gesperrt';
  speicher.einstellungen = { ...LOKAL_VORGABE.einstellungen, listen: { basis: true, privatsphaere: true } };
  speicher.sites = {
    'shop.beispiel.de': { erlaubt: true, seit: jetzt - 3 * TAG },
    'forum.beispiel.org': { erlaubt: true, seit: jetzt - 19 * TAG },
  };
  speicher.eigeneRegeln = '||werbung.beispiel.de^\nbeispiel.de##.anzeige\n';
  speicher.lizenz = lizenzFuer(variante);
  speicher.konto = verbunden
    ? { refreshToken: 'attrappe', refreshLaeuftAb: jetzt + 30 * TAG, email: beispiele().email, name: beispiele().name, seit: jetzt - 12 * TAG }
    : null;
  speicher.kontoHinweis = variante === 'gesperrt' ? 'gesperrt' : null;
  speicher.verbindungOffen =
    variante === 'wartet'
      ? { code: 'K7PN-4QWX', abholGeheimnis: 'attrappe', verbindenUrl: `${API_BASIS}/verbinden?code=K7PN-4QWX`, seit: jetzt, laeuftAb: jetzt + 9 * 60 * 1000 }
      : null;
  speicher.abgleich = { version: 3, aktualisiertAm: variante === 'premium' ? new Date(jetzt - 2 * 60 * 60 * 1000).toISOString() : null };
}

/**
 * Die Listen der Attrappe kommen aus `LISTEN_VORGABE` und werden NICHT
 * danebengeschrieben. Vorher stand hier eine eigene Tabelle, und sie blieb
 * prompt zurueck: Sie fuehrte sechs der elf Listen, die fuenf uBlock-Listen
 * fehlten seit dem Tag, an dem sie dazukamen. Wer die Vorschau oeffnete, sah
 * eine Optionsseite, die es so nicht gibt.
 *
 * Erfunden ist nur die Regelzahl - im Paket steht sie in
 * `listen/bericht.json`, und die liest die Attrappe bewusst nicht: Sie soll
 * ohne jede Paketdatei laufen. Abgeleitet aus der Position, damit die Zahlen
 * verschieden und stabil sind.
 *
 * ── `sprache` muss mit ────────────────────────────────────────────────────
 * GEMESSEN am 07.09.2026 in der Vorschau: Alle achtzehn regionalen Listen
 * standen als EINZELNE Zeilen da, statt unter ihrer Sprache zusammengefasst.
 * Grund war diese Abbildung - sie nahm `id`, `name`, `premium` und `standard`
 * mit und liess `sprache` liegen. `Filterlisten.tsx` teilt aber genau daran
 * auf (`l.sprache ? … : …`), also fiel ohne das Feld jede regionale Liste in
 * den Topf „einzeln".
 *
 * Das ist derselbe Fehler wie oben, nur eine Ebene tiefer: nicht eine zweite
 * Tabelle, sondern eine unvollstaendige Abschrift derselben. Wer hier ein Feld
 * ergaenzt, das `ListenEintrag` kennt, ergaenzt es MIT.
 */
const LISTEN = LISTEN_VORGABE.map((l, i) => ({
  id: l.id,
  name: l.name,
  premium: l.premium,
  standard: l.standard,
  regeln: 1200 + i * 940,
  // Bedingt gesetzt und nicht `sprache: l.sprache`: Das Feld ist optional,
  // und ein ausdrueckliches `undefined` ist unter `exactOptionalPropertyTypes`
  // etwas anderes als „nicht da".
  ...(l.sprache ? { sprache: l.sprache } : {}),
}));

/**
 * Die erfundenen Angaben, die in der Oberflaeche SICHTBAR sind.
 *
 * ── Warum es davon zwei Saetze gibt ───────────────────────────────────────
 * `store-bilder.mjs` baut die Bildschirmfotos fuer die Store-Eintraege, je
 * Sprache einen Satz. Der deutsche Satz (`nachrichten.beispiel.de`,
 * `max.mustermann@beispiel.de`) steht in einem englischen Bild als einzige
 * deutsche Stelle da — und zwar in der Adresszeile und in der Kontozeile,
 * also an zwei der auffaelligsten.
 *
 * Erfunden sind beide Saetze (Regel 1): `beispiel.de` und `example.com` sind
 * reservierte Namen und gehoeren niemandem.
 *
 * ── Warum es ueber die Adresse kommt ──────────────────────────────────────
 * Die Buehne im Bilderskript zeichnet die Adresszeile SELBST. Beide muessen
 * dasselbe zeigen, sonst steht in der Leiste eine andere Seite als in der
 * Karte darueber. Ein Wert von aussen ist die einzige Form, in der das
 * zusammenbleibt.
 *
 * Ohne Angabe bleibt es beim deutschen Satz — Vite-Vorschau und Tests sehen
 * unveraendert dasselbe.
 */
type Beispielsatz = { host: string; email: string; name: string };

const BEISPIELE: Record<'de' | 'international', Beispielsatz> = {
  de: { host: 'nachrichten.beispiel.de', email: 'max.mustermann@beispiel.de', name: 'Max Mustermann' },
  international: { host: 'news.example.com', email: 'jane.doe@example.com', name: 'Jane Doe' },
};

function beispiele(): Beispielsatz {
  if (typeof location === 'undefined') return BEISPIELE.de;
  const wert = new URLSearchParams(location.search).get('beispiele');
  return wert === 'international' ? BEISPIELE.international : BEISPIELE.de;
}

function zustand(variante: Variante): Zustand {
  const host = beispiele().host;
  const e = speicher.einstellungen;
  return {
    tab:
      variante === 'leer'
        ? null
        : {
            host,
            erlaubt: speicher.sites[host]?.erlaubt ?? false,
            blockiert: e.aktiv ? 37 : 0,
            // Erfundene Aufschluesselung, deren Summe zu `blockiert` passt:
            // Eine Vorschau, in der Zahl und Details auseinanderlaufen, ist
            // schlimmer als gar keine.
            jeListe: e.aktiv
              ? [
                  { id: 'basis', anzahl: 21, regeln: [ { was: 'werbenetz.beispiel.de', anzahl: 12 }, { was: 'banner.beispiel.de', anzahl: 9 } ] },
                  { id: 'privatsphaere', anzahl: 11, regeln: [ { was: 'zaehler.beispiel.de', anzahl: 11 } ] },
                  { id: 'cookies', anzahl: 5, regeln: [ { was: 'zustimmung.beispiel.de', anzahl: 5 } ] },
                ]
              : [],
          },
    aktiv: e.aktiv,
    // `?? l.standard` und nicht `?? false`: Genau so rechnet
    // `aktiveListenIds()` in `hintergrund/regeln.ts`. Mit `false` zeigte die
    // Vorschau alle Standardlisten als ausgeschaltet - ein Zustand, den ein
    // frisch eingerichteter Browser nie hat.
    listen: LISTEN.map(({ standard, ...l }) => ({ ...l, standard, aktiv: e.listen[l.id] ?? standard })),
    konto: speicher.konto
      ? { verbunden: true, email: speicher.konto.email, name: speicher.konto.name ?? undefined, hinweis: speicher.kontoHinweis }
      : { verbunden: false, hinweis: speicher.kontoHinweis },
    lizenz: speicher.lizenz ?? lizenzFuer(variante),
    verbindung: speicher.verbindungOffen
      ? { code: speicher.verbindungOffen.code, verbindenUrl: speicher.verbindungOffen.verbindenUrl, laeuftAb: speicher.verbindungOffen.laeuftAb }
      : null,
    version: '0.1.0',
    browser: 'chromium',
    einstellungen: e,
    listenFehler: null,
    verbindungFehler: null,
  };
}

const vorschau: MeldungVorschau = {
  seite: 'https://nachrichten.beispiel.de/politik/artikel-123',
  browser: 'chromium',
  version: '0.1.0',
  // Bereiche, keine Listenkennungen — genau das, was `meldungVorschau()` seit
  // dem 10.09.2026 liefert (`bereicheVon` in `gemeinsam/konstanten.ts`).
  listen: ['werbung', 'privatsphaere'],
  regeln: ['||werbung.beispiel.de^', '||zaehler.beispiel.net^$third-party', 'nachrichten.beispiel.de##.anzeige'],
};

/** Antwortet wie der Hintergrund es taete, nur ohne Netz und ohne Browser. */
export async function attrappeSende<T extends Nachricht['typ']>(
  nachricht: Extract<Nachricht, { typ: T }>,
  variante: Variante,
): Promise<Antwort<Antworten[T]>> {
  // Ein bisschen Latenz, damit Skeleton und Knopfzustaende zu sehen sind.
  await new Promise((r) => setTimeout(r, 180));
  if (variante === 'fehler') return { ok: false, code: 'HINTERGRUND_FEHLT' };

  const n = nachricht as Nachricht;
  const fertig = (daten: object) => ({ ok: true as const, ...daten }) as Antwort<Antworten[T]>;

  switch (n.typ) {
    case 'zustand':
      return fertig(zustand(variante));
    case 'aktiv.setzen':
      melde({ einstellungen: { ...speicher.einstellungen, aktiv: n.aktiv } });
      return fertig({});
    case 'site.setzen': {
      const sites = { ...speicher.sites };
      if (n.erlaubt) sites[n.host] = { erlaubt: true, seit: Date.now() };
      else delete sites[n.host];
      melde({ sites });
      return fertig({});
    }
    case 'liste.setzen': {
      const liste = LISTEN.find((l) => l.id === n.id);
      if (liste?.premium && !speicher.lizenz?.premium) return { ok: false, code: 'LIZENZ_ERFORDERLICH' };
      melde({ einstellungen: { ...speicher.einstellungen, listen: { ...speicher.einstellungen.listen, [n.id]: n.aktiv } } });
      return fertig({});
    }
    case 'konto.verbinden': {
      const offen = { code: 'K7PN-4QWX', abholGeheimnis: 'attrappe', verbindenUrl: `${API_BASIS}/verbinden?code=K7PN-4QWX`, seit: Date.now(), laeuftAb: Date.now() + 10 * 60 * 1000 };
      melde({ verbindungOffen: offen });
      return fertig({ code: offen.code, verbindenUrl: offen.verbindenUrl });
    }
    case 'konto.trennen':
      melde({ konto: null, kontoHinweis: null, lizenz: lizenzFuer('1'), verbindungOffen: null });
      return fertig({});
    case 'lizenz.pruefen': {
      const lizenz = { ...(speicher.lizenz ?? lizenzFuer(variante)), geprueftAm: Date.now() };
      melde({ lizenz });
      return fertig({ lizenz });
    }
    case 'premium.kaufen':
      return fertig({ url: `${API_BASIS}/kauf-abschluss?attrappe=1` });
    /*
      Ein Tarif, wie ihn die Verwaltung liefern WUERDE - erfundene Betraege,
      damit sich das Kauffenster ohne Backend ansehen laesst. Sie stehen in
      der Attrappe und nirgends sonst; im Paket kommt jeder Betrag aus
      `GET /api/plans` (Regel 10).
    */
    case 'tarife.holen':
      return fertig({
        defaultInterval: 'yearly',
        headlineDiscountPercent: 25,
        tarifmangel: null,
        plans: [
          {
            key: TARIF_KEY,
            name: 'Premium',
            description: 'Alle Zusatzfunktionen.',
            trialDays: 7,
            features: ['Premium blocker', 'Cookie-Fenster beantworten', 'Fingerabdruck verwischen', 'Verwechslungswarner', 'Listen taeglich aktuell'],
            monthly: { perMonth: { formatted: '2,99 €' }, billedTotal: { formatted: '2,99 €' } },
            yearly: { perMonth: { formatted: '2,24 €' }, billedTotal: { formatted: '26,90 €' }, discountPercent: 25 },
          },
        ],
      });
    case 'meldung.vorschau':
      return fertig(vorschau);
    case 'meldung.senden':
      return fertig({ id: 'attrappe-meldung' });
    case 'regeln.eigene.setzen': {
      const zeilen = n.text.split('\n').map((z) => z.trim()).filter((z) => z && !z.startsWith('!'));
      const fehler = zeilen.map((z, i) => (z.includes('$redirect') ? `${i + 1}: redirect` : null)).filter((f): f is string => f !== null);
      melde({ eigeneRegeln: n.text });
      return fertig({ anzahl: zeilen.length - fehler.length, fehler });
    }
    case 'abgleich.jetzt': {
      if (!speicher.lizenz?.premium) return { ok: false, code: 'LIZENZ_ERFORDERLICH' };
      const aktualisiertAm = new Date().toISOString();
      melde({ abgleich: { version: speicher.abgleich.version + 1, aktualisiertAm } });
      return fertig({ aktualisiertAm });
    }
    default:
      return { ok: false, code: 'UNBEKANNT' };
  }
}

export async function attrappeLies<K extends keyof SpeicherLokal>(...schluessel: K[]): Promise<Pick<SpeicherLokal, K>> {
  const raus = {} as Pick<SpeicherLokal, K>;
  for (const k of schluessel) raus[k] = structuredClone(speicher[k]);
  return raus;
}

export async function attrappeSchreibe(teil: Partial<SpeicherLokal>): Promise<void> {
  melde(structuredClone(teil));
}

export function attrappeBeiAenderung(cb: (aenderungen: Partial<SpeicherLokal>) => void): () => void {
  zuhoerer.add(cb);
  return () => zuhoerer.delete(cb);
}
