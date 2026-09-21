/**
 * Cookie-Fenster automatisch beantworten.
 *
 * ── Was das ist, und was es NICHT ist ──────────────────────────────────────
 * Die Liste `cookies` VERSTECKT Einwilligungsfenster - sie sind dann weg, aber
 * unbeantwortet. Viele Seiten merken das: Sie zeigen das Fenster beim
 * naechsten Besuch wieder, sperren Inhalte, oder ihr Skript wartet auf eine
 * Antwort, die nie kommt. Dieses Modul KLICKT stattdessen, und zwar den
 * Knopf, den der Nutzer selbst gewaehlt hat.
 *
 * ── Warum eine Tabelle je Werkzeug und keine Heuristik ─────────────────────
 * „Suche einen Knopf, auf dem 'Akzeptieren' steht" klingt einfach und ist
 * gefaehrlich: Auf einer Bestellseite steht das auch auf „AGB akzeptieren",
 * auf einer Bank auf „Ueberweisung bestaetigen". Ein Klick auf den falschen
 * Knopf ist schlimmer als ein stehengebliebenes Fenster. Deshalb wird nur
 * geklickt, was zu einem BEKANNTEN Einwilligungswerkzeug gehoert - erkannt an
 * dessen eigener Kennung, nicht am Text.
 *
 * Die Auswahl deckt die Werkzeuge ab, die im deutschsprachigen und
 * europaeischen Netz den Grossteil ausmachen. Was fehlt, bleibt stehen; das
 * ist der richtige Fehler.
 */

/** Ein Einwilligungswerkzeug und die zwei Knoepfe, die es kennt. */
export type Werkzeug = {
  /** Name des Anbieters, nur fuer Menschen (Berichte, Fehlersuche). */
  name: string;
  /**
   * Woran das Werkzeug zu ERKENNEN ist. Erst wenn das da ist, wird ueberhaupt
   * nach Knoepfen gesucht - ohne diesen Schritt klickt eine falsche Seite.
   */
  erkennung: string;
  /** Der Knopf „Alle ablehnen"; leer, wenn es ihn nicht gibt. */
  ablehnen: string[];
  /** Der Knopf „Alle annehmen". */
  annehmen: string[];
};

export const WERKZEUGE: readonly Werkzeug[] = [
  {
    name: 'OneTrust',
    erkennung: '#onetrust-banner-sdk, #onetrust-consent-sdk',
    ablehnen: ['#onetrust-reject-all-handler', '.ot-pc-refuse-all-handler', '#onetrust-pc-btn-handler + button'],
    annehmen: ['#onetrust-accept-btn-handler', '.onetrust-close-btn-handler.banner-close-button'],
  },
  {
    name: 'Cookiebot',
    erkennung: '#CybotCookiebotDialog',
    ablehnen: ['#CybotCookiebotDialogBodyButtonDecline', '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll'],
    annehmen: ['#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#CybotCookiebotDialogBodyButtonAccept'],
  },
  {
    name: 'Didomi',
    erkennung: '#didomi-host, .didomi-popup-container',
    ablehnen: ['#didomi-notice-disagree-button', '.didomi-continue-without-agreeing'],
    annehmen: ['#didomi-notice-agree-button'],
  },
  {
    name: 'Usercentrics',
    erkennung: '#usercentrics-root, [data-testid="uc-default-banner"]',
    ablehnen: ['[data-testid="uc-deny-all-button"]'],
    annehmen: ['[data-testid="uc-accept-all-button"]'],
  },
  {
    name: 'Quantcast',
    erkennung: '.qc-cmp2-container, .qc-cmp-cleanslate',
    ablehnen: ['.qc-cmp2-summary-buttons > button[mode="secondary"]'],
    annehmen: ['.qc-cmp2-summary-buttons > button[mode="primary"]'],
  },
  {
    name: 'Sourcepoint',
    erkennung: '.sp_message_container, .message-container',
    ablehnen: ['.sp_choice_type_13', 'button[title="Reject All"]'],
    annehmen: ['.sp_choice_type_11', 'button[title="Accept All"]', 'button[title="Alle akzeptieren"]'],
  },
  {
    name: 'Borlabs Cookie',
    erkennung: '#BorlabsCookieBox, #brlbs-cookie-box',
    ablehnen: ['a.borlabs-cookie-refuse', '[data-borlabs-cookie-handle="refuse"]'],
    annehmen: ['a.borlabs-cookie-btn-accept-all', '[data-borlabs-cookie-handle="accept-all"]'],
  },
  {
    name: 'Complianz',
    erkennung: '#cmplz-cookiebanner-container',
    ablehnen: ['.cmplz-deny'],
    annehmen: ['.cmplz-accept'],
  },
  {
    name: 'CookieYes',
    erkennung: '.cky-consent-container, #cookie-law-info-bar',
    ablehnen: ['.cky-btn-reject', '#cookie_action_close_header_reject'],
    annehmen: ['.cky-btn-accept', '#cookie_action_close_header'],
  },
  {
    name: 'Klaro',
    erkennung: '.klaro .cookie-notice, #klaro',
    ablehnen: ['.cn-decline', '.cm-btn-decline'],
    annehmen: ['.cn-buttons .cm-btn-success', '.cookie-notice .cm-btn-accept-all'],
  },
  {
    name: 'Osano',
    erkennung: '.osano-cm-window, .osano-cm-dialog',
    ablehnen: ['.osano-cm-denyAll'],
    annehmen: ['.osano-cm-accept-all'],
  },
  {
    name: 'TrustArc',
    erkennung: '#truste-consent-track, .truste_box_overlay',
    ablehnen: ['#truste-consent-required'],
    annehmen: ['#truste-consent-button'],
  },
  {
    name: 'Consent Manager',
    erkennung: '#cmpbox, .cmpboxBG',
    ablehnen: ['.cmpboxbtnno', '#cmpbntnotxt'],
    annehmen: ['.cmpboxbtnyes', '#cmpbntyestxt'],
  },
  {
    name: 'Iubenda',
    erkennung: '#iubenda-cs-banner',
    ablehnen: ['.iubenda-cs-reject-btn'],
    annehmen: ['.iubenda-cs-accept-btn'],
  },
  {
    name: 'Cookie Script',
    erkennung: '#cookiescript_injected',
    ablehnen: ['#cookiescript_reject'],
    annehmen: ['#cookiescript_accept'],
  },
  {
    name: 'Termly',
    erkennung: '#termly-code-snippet-support',
    ablehnen: ['[data-tid="banner-decline"]'],
    annehmen: ['[data-tid="banner-accept"]'],
  },
];

export type Antwort = 'annehmen' | 'ablehnen';

/**
 * Welcher Knopf ist auf dieser Seite zu klicken?
 *
 * Der Aufrufer reicht die Suchfunktionen herein, damit diese Datei ohne DOM
 * laeuft und ein Test sie ohne Browser fahren kann.
 *
 * Gibt es zur gewaehlten Antwort keinen Knopf - manche Werkzeuge kennen kein
 * „alles ablehnen" -, wird NICHTS geklickt. Ein Ausweichen auf den anderen
 * Knopf waere das Gegenteil dessen, was der Nutzer wollte.
 */
export function findeKnopf(
  antwort: Antwort,
  gibtEs: (selektor: string) => boolean,
  sichtbar: (selektor: string) => boolean,
): { werkzeug: string; selektor: string } | null {
  for (const w of WERKZEUGE) {
    if (!gibtEs(w.erkennung)) continue;
    for (const selektor of antwort === 'annehmen' ? w.annehmen : w.ablehnen) {
      if (sichtbar(selektor)) return { werkzeug: w.name, selektor };
    }
  }
  return null;
}
