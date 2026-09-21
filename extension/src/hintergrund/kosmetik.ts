/**
 * Seitenspezifische Kosmetik: `kosmetik/<id>.json` der aktiven Listen wird
 * zu einer Karte host → Selektoren zusammengelegt und dem Inhaltsskript auf
 * `{ typ: 'kosmetik', host }` beantwortet.
 *
 * Die Karte lebt im Speicher des Service Workers und, als Kopie, in
 * `storage.session`: Nach einem Neustart liest er sie von dort, statt die
 * JSON-Dateien noch einmal zu parsen. Passt sie nicht hinein (Kontingent),
 * ist das kein Fehler; dann wird eben neu gelesen.
 */

import { api } from '../gemeinsam/browser.ts';
import { ZAHLUNGSHOSTS } from '../gemeinsam/konstanten.ts';
import { liesLokal } from '../gemeinsam/speicher.ts';
import type { Einstellungen, KosmetikAntwort, Lizenz, Sites, Textregel } from '../gemeinsam/typen.ts';
import { hostKette, siteErlaubt } from './ausnahmen.ts';
import { tokenFuerSeite } from './fingerabdruck.ts';
import { lizenzWirksam } from './lizenz-regeln.ts';
import { aktiveListen, holePaketJson, holePaketText } from './regeln.ts';

type ListenDatei = {
  generisch?: string[];
  spezifisch?: Record<string, string[]>;
  ausnahmen?: Record<string, string[]>;
};

type ProzeduralDatei = Record<string, Textregel[]>;

export type KosmetikKarte = {
  /** Fuer welche Listen die Karte gebaut wurde; passt es nicht, ist sie alt. */
  listen: string[];
  spezifisch: Record<string, string[]>;
  ausnahmen: Record<string, string[]>;
  /**
   * Textregeln je Host. GEMESSEN am 08.09.2026: 1.157 Regeln auf 798 Hosts,
   * 889 davon ab Werk aktiv. Klein genug, um in derselben Karte und damit im
   * selben Sitzungsspeicher zu liegen - eine zweite Karte haette eine zweite
   * Entwertung gebraucht, und die waere irgendwann die vergessene.
   */
  prozedural: Record<string, Textregel[]>;
};

const SITZUNG_SCHLUESSEL = 'kosmetikKarte';

let karte: Promise<KosmetikKarte> | null = null;

export function kosmetikNeuLaden(): void {
  karte = null;
}

function schluesselVon(listen: string[]): string {
  return [...listen].sort().join(',');
}

async function ausSitzung(listen: string[]): Promise<KosmetikKarte | null> {
  if (!api.storage.session) return null;
  try {
    const roh = (await api.storage.session.get(SITZUNG_SCHLUESSEL)) as Record<string, KosmetikKarte | undefined>;
    const alt = roh[SITZUNG_SCHLUESSEL];
    if (alt && Array.isArray(alt.listen) && schluesselVon(alt.listen) === schluesselVon(listen)) return alt;
  } catch {
    // dann eben frisch lesen
  }
  return null;
}

async function inSitzung(k: KosmetikKarte): Promise<void> {
  if (!api.storage.session) return;
  try {
    await api.storage.session.set({ [SITZUNG_SCHLUESSEL]: k });
  } catch {
    // Kontingent voll: die Karte bleibt im Arbeitsspeicher.
  }
}

function fuege(ziel: Record<string, string[]>, quelle: Record<string, string[]> | undefined): void {
  if (!quelle) return;
  for (const host of Object.keys(quelle)) {
    const liste = quelle[host];
    if (!Array.isArray(liste) || liste.length === 0) continue;
    const h = host.toLowerCase();
    (ziel[h] ??= []).push(...liste);
  }
}

async function baueKarte(): Promise<KosmetikKarte> {
  const listen = await aktiveListen();
  const gemerkt = await ausSitzung(listen);
  if (gemerkt) return gemerkt;

  const k: KosmetikKarte = { listen, spezifisch: {}, ausnahmen: {}, prozedural: {} };
  const [dateien, textdateien] = await Promise.all([
    Promise.all(listen.map((id) => holePaketJson<ListenDatei>(`kosmetik/${id}.json`))),
    Promise.all(listen.map((id) => holePaketJson<ProzeduralDatei>(`prozedural/${id}.json`))),
  ]);
  for (const datei of dateien) {
    if (!datei) continue;
    fuege(k.spezifisch, datei.spezifisch);
    fuege(k.ausnahmen, datei.ausnahmen);
  }
  for (const datei of textdateien) {
    if (!datei) continue;
    for (const host of Object.keys(datei)) {
      const liste = datei[host];
      if (!Array.isArray(liste) || liste.length === 0) continue;
      (k.prozedural[host.toLowerCase()] ??= []).push(...liste);
    }
  }
  void inSitzung(k);
  return k;
}

function holeKarte(): Promise<KosmetikKarte> {
  if (!karte) {
    karte = baueKarte().catch((e) => {
      karte = null;
      throw e;
    });
  }
  return karte;
}

/** Selektoren fuer den Host und alle Domains darueber, minus Ausnahmen. */
export function selektorenAus(k: KosmetikKarte, host: string): string[] {
  const kette = hostKette(host);
  const gesperrt = new Set<string>();
  for (const h of kette) for (const s of k.ausnahmen[h] ?? []) gesperrt.add(s);
  const gesehen = new Set<string>();
  const ergebnis: string[] = [];
  for (const h of kette) {
    for (const s of k.spezifisch[h] ?? []) {
      if (gesperrt.has(s) || gesehen.has(s)) continue;
      gesehen.add(s);
      ergebnis.push(s);
    }
  }
  return ergebnis;
}

/**
 * Textregeln fuer diesen Host, ueber die ganze Hostkette und ohne Doppelte.
 *
 * Die Ausnahmen der normalen Kosmetik gelten hier NICHT mit: Ein
 * `#@#.werbung` hebt einen Selektor auf, keine Textregel. Wer eine Textregel
 * zuruecknehmen will, schreibt `#@?#` - und das hat die Engine schon beim
 * Bauen verrechnet.
 */
export function textregelnAus(k: KosmetikKarte, host: string): Textregel[] {
  const gesehen = new Set<string>();
  const ergebnis: Textregel[] = [];
  for (const h of hostKette(host)) {
    for (const t of k.prozedural[h] ?? []) {
      const schluessel = `${t.wahl} ${t.text}`;
      if (gesehen.has(schluessel)) continue;
      gesehen.add(schluessel);
      ergebnis.push(t);
    }
  }
  return ergebnis;
}

/** Einmal gelesen, dann aus dem Speicher: Der Text aendert sich nur mit einer neuen Version. */
const generischTexte = new Map<string, Promise<string>>();

/**
 * Der Text der generischen Stylesheets der genannten Listen, fuer Shadow
 * Roots im Inhaltsskript. Nur Listen, die gerade aktiv sind: Was der Nutzer
 * abgeschaltet hat, darf auch im Schatten nicht wirken.
 */
export async function generischesCss(gewuenscht: string[]): Promise<string> {
  let aktiv: string[];
  try {
    aktiv = await aktiveListen();
  } catch {
    return '';
  }
  const erlaubt = new Set(aktiv);
  const teile: string[] = [];
  for (const id of Array.isArray(gewuenscht) ? gewuenscht : []) {
    if (typeof id !== 'string' || !erlaubt.has(id)) continue;
    let text = generischTexte.get(id);
    if (!text) {
      text = holePaketText(`kosmetik/${id}.generisch.css`).then((t) => t ?? '');
      generischTexte.set(id, text);
    }
    const t = await text;
    if (t) teile.push(t);
  }
  return teile.join('\n');
}

/**
 * Ob die Hauptwelt auf diesem Rahmen rauschen soll, und mit welchem Token.
 *
 * ZWEI Hosts, und beide muessen frei von Ausnahmen sein: `top` ist die
 * oberste Seite, `host` der Rahmen. Wer `shop.example` freigibt, weil die
 * Zahlung hakt, hat damit auch den Zahlungsrahmen darin freigegeben - Stripe,
 * Adyen und PayPal Fraudnet sammeln Canvas und Audio als Betrugsmerkmal, und
 * ein Rahmen, der weiter rauscht, waere genau die Zahlung, die weiter hakt.
 * Umgekehrt: Wer `stripe.com` freigibt, meint den Zahlungsrahmen auf jeder
 * Seite, nicht nur auf einer.
 *
 * Das Token ist an `top` gebunden, nicht an `host` (siehe
 * `fingerabdruck.ts`). Scheitert seine Herleitung, bleibt `an` trotzdem
 * true: Dann wuerfelt die Hauptwelt je Seite, und der Schutz steht.
 *
 * PREMIUM, geprueft HIER und nicht nur am Schalter in den Optionen. Die
 * Oberflaeche zeigt ohne Lizenz ein Schloss und eine Attrappe - das ist eine
 * Anzeige, keine Sperre. Wer `einstellungen.fingerabdruck` von Hand auf true
 * setzt (der Speicher steht jedem offen, der die Erweiterung entpackt),
 * bekaeme das Rauschen sonst trotzdem. Der Engpass gehoert an die Stelle, die
 * die Antwort BAUT.
 *
 * `lizenzWirksam` und nicht `lizenz.premium`: Ein Stand, den der Server seit
 * ueber sieben Tagen nicht bestaetigt hat, faellt auf frei zurueck - dieselbe
 * Rechnung wie bei den Premium-Listen (`aktiveListen()`) und der
 * Listenpflege.
 */
/** Liegt dieser Host (oder ein Oberhost davon) auf der Zahlungsliste? */
export function istZahlungsrahmen(host: string): boolean {
  if (!host) return false;
  const kette = hostKette(host);
  return ZAHLUNGSHOSTS.some((z) => kette.includes(z));
}

async function fingerabdruckFuer(
  einstellungen: Einstellungen,
  lizenz: Lizenz | null,
  sites: Sites,
  host: string,
  top: string,
): Promise<KosmetikAntwort['fingerabdruck']> {
  const premium = lizenzWirksam(lizenz, Date.now()).premium;
  const an =
    premium && einstellungen.aktiv && einstellungen.fingerabdruck && !siteErlaubt(sites, top) && !siteErlaubt(sites, host);
  if (!an) return { an: false, token: null };
  /*
   * Der Zahlungsrahmen bleibt sauber - siehe `ZAHLUNGSHOSTS`. Geprueft wird
   * der RAHMEN (`host`), nicht die oberste Seite: Ein Shop soll rauschen,
   * das Stripe-Fenster darin nicht.
   */
  if (istZahlungsrahmen(host)) return { an: false, token: null };
  let token: string | null = null;
  try {
    token = await tokenFuerSeite(top);
  } catch {
    token = null;
  }
  return { an: true, token };
}

/**
 * `host` ist der Rahmen, der fragt; `top` die oberste Seite des Tabs (aus
 * `sender.tab.url`, siehe `nachrichten.ts`). Ohne `top` gilt der Rahmen
 * selbst als oberste Seite - so fragt `meldungVorschau`, dort IST er es.
 */
export async function kosmetikFuer(host: string, top: string = host): Promise<KosmetikAntwort> {
  const { einstellungen, sites, lizenz } = await liesLokal('einstellungen', 'sites', 'lizenz');
  const fingerabdruck = await fingerabdruckFuer(einstellungen, lizenz, sites, host, top);
  if (!einstellungen.aktiv || siteErlaubt(sites, host)) {
    return { selektoren: [], textregeln: [], aus: true, listen: [], fingerabdruck };
  }
  // Die aktiven Listen wandern immer mit, auch wenn es fuer diesen Host keine
  // spezifischen Selektoren gibt: Das Inhaltsskript braucht sie fuer Shadow
  // Roots, und genau dort ist der haeufige Fall, dass nur generische Regeln
  // greifen.
  let listen: string[] = [];
  try {
    listen = await aktiveListen();
  } catch {
    listen = [];
  }
  try {
    const k = await holeKarte();
    return { selektoren: selektorenAus(k, host), textregeln: textregelnAus(k, host), aus: false, listen, fingerabdruck };
  } catch {
    return { selektoren: [], textregeln: [], aus: false, listen, fingerabdruck };
  }
}
