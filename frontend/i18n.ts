/**
 * Texte und Farben vom Backend holen – die Brücke zwischen `src/i18n/` und
 * den Komponenten in diesem Ordner.
 *
 * Ohne sie tragen die Komponenten ihre deutschen Vorgaben. Die sind
 * **Rückfall, kein Inhalt**: Sie sorgen dafür, dass ein Bildschirm auch ohne
 * Backend etwas anzeigt, statt leer zu bleiben. Was der Nutzer wirklich lesen
 * soll, kommt von hier.
 *
 * ── Voreingestellt ist die Sprache des Browsers ───────────────────────────
 * `navigator.languages` wird gegen die Liste des Backends gehalten. Wer
 * einmal umgeschaltet hat, bekommt seine Wahl (Cookie `locale`, das der
 * Server setzt) – niemand muss erst suchen, wo man die Sprache einstellt.
 *
 * ── Verwendung ────────────────────────────────────────────────────────────
 *     import { ladeOberflaeche, fuerLogin } from './i18n';
 *
 *     const o = await ladeOberflaeche();       // einmal beim Start
 *     o.themaAnwenden();                       // setzt die --marke-* Variablen
 *     <LoginDialog texte={fuerLogin(o.texte)} />
 *
 * Die `fuer…`-Funktionen bilden die `ui.*`-Schlüssel auf die Felder der
 * jeweiligen Komponente ab. Bewusst hier und nicht in den Komponenten: Die
 * sollen ohne Backend benutzbar bleiben, etwa in einer Vorschau.
 */

export type Texte = Record<string, string>;

export type Sprache = {
  code: string;
  name: string;
  nativeName: string;
  dir: 'ltr' | 'rtl';
};

export type Oberflaeche = {
  locale: string;
  dir: 'ltr' | 'rtl';
  texte: Texte;
  sprachen: Sprache[];
  thema: Record<string, string>;
  /** Setzt die `--marke-*`-Variablen und `dir` am `<html>`-Element. */
  themaAnwenden: () => void;
};

/**
 * Welche Sprache der Browser will – gegen die Liste des Backends gehalten.
 *
 * `navigator.languages` ist nach Vorliebe sortiert und enthält Einträge wie
 * `de-AT`. Verglichen wird deshalb auf dem Grundcode: Wer Österreichisch
 * eingestellt hat, bekommt Deutsch und nicht Englisch.
 */
export function browserSprache(verfuegbar: readonly string[], rueckfall = 'en'): string {
  const gewuenscht =
    typeof navigator !== 'undefined'
      ? navigator.languages?.length
        ? navigator.languages
        : [navigator.language]
      : [];

  for (const eintrag of gewuenscht) {
    if (!eintrag) continue;
    const grund = eintrag.toLowerCase().split('-')[0]!;
    const treffer = verfuegbar.find((v) => v.toLowerCase() === grund);
    if (treffer) return treffer;
  }
  return verfuegbar.includes(rueckfall) ? rueckfall : (verfuegbar[0] ?? rueckfall);
}

/**
 * Holt Sprachliste, Texte und Farbthema.
 *
 * Alle drei Anfragen laufen parallel: Sie hängen nicht voneinander ab, und
 * nacheinander wäre der erste Bildschirm dreimal so lange leer.
 *
 * `credentials: 'include'`, damit das `locale`-Cookie mitgeht – sonst wüsste
 * der Server nichts von einer früheren Wahl.
 */
export async function ladeOberflaeche(
  apiUrl = '',
  wunschsprache?: string,
): Promise<Oberflaeche> {
  /**
   * ── `cache: 'no-cache'` heisst NICHT „nicht zwischenspeichern" ────────────
   * Es heisst: zwischenspeichern ja, aber VOR JEDER BENUTZUNG nachfragen. Der
   * Browser schickt sein ETag mit und bekommt meist `304 Not Modified` – ein
   * paar hundert Byte statt siebzig Kilobyte, und trotzdem nie ein veralteter
   * Katalog.
   *
   * ── Warum es das braucht, obwohl die Route schon ein ETag setzt ──────────
   * Weil ein Browser, der noch einen FRISCHEN Eintrag aus der Zeit von
   * `max-age=86400` liegen hat, gar nicht erst fragt. Er nimmt ihn direkt.
   *
   * GEMESSEN: Nach dem Ergaenzen neuer Schluessel lieferte der Server sie
   * korrekt aus – am Browser kam der Katalog von gestern an. Die Oberflaeche
   * zeigte jeden alten Text und liess jeden neuen leer, und das ueberlebte
   * auch ein hartes Neuladen. Ein Server-seitiges ETag repariert diesen
   * Zustand nicht; nur der Aufrufer kann ihn beenden.
   */
  const hole = (pfad: string) =>
    fetch(`${apiUrl}${pfad}`, { credentials: 'include', cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`${pfad}: ${r.status}`);
      return r.json();
    });

  /*
   * ── `wunschsprache`: für Projekte mit Sprachadressen ──────────────────────
   * Steht die Sprache im PFAD (`/es/descargar`), kennt der Server sie beim
   * Ausliefern der Seite — `/api/languages` aber nicht: Diese Anfrage geht an
   * eine eigene Adresse ohne Sprachpräfix, und dort entscheiden wieder Cookie
   * und `Accept-Language`.
   *
   * GEMESSEN am 06.09.2026 im Browser: `/ru/skachat` kam mit `lang="ru"` und
   * russischem Titel an, und eine halbe Sekunde später stand die Seite auf
   * Englisch — `themaAnwenden()` setzt `lang` aus DIESER Antwort. Der Server
   * hatte recht, die Anwendung überschrieb ihn.
   *
   * Wer keine Sprachadressen hat, lässt den Parameter weg; dann bleibt alles
   * wie zuvor.
   */
  const abfrage = wunschsprache ? `?lang=${encodeURIComponent(wunschsprache)}` : '';
  const [sprachAntwort, thema] = await Promise.all([
    hole('/api/languages' + abfrage),
    hole('/api/theme'),
  ]);

  // ── Die Form, die `/api/languages` WIRKLICH liefert ──────────────────────
  //
  // `{ active, dir, visible, all, labels }`. Hier stand einmal
  // `sprachAntwort.languages ?? sprachAntwort` und `sprachAntwort.current`.
  // Beides gibt es nicht: Der Rückfall nahm also das ganze Objekt als Liste,
  // und `.map()` darauf wirft `sprachen.map is not a function`.
  //
  // GEMESSEN am 21.08.2026: Damit scheiterte JEDER Aufruf von
  // `ladeOberflaeche()` – keine Texte, keine Markenfarben, und im Demoprojekt
  // ein Band „Das Backend antwortet nicht", während das Backend einwandfrei
  // antwortete. Aufgefallen ist es erst, als eine Anwendung diese Funktion
  // zum ersten Mal wirklich benutzt hat.
  //
  // `all` und nicht `visible`: `visible` sind die acht ohne Suche sichtbaren.
  // Wer auf Thailändisch steht, fände seine eigene Sprache sonst nicht in der
  // Liste, und `dir` fiele auf `ltr` zurück – bei Arabisch und Persisch also
  // spiegelverkehrt.
  const sprachen: Sprache[] = sprachAntwort.all ?? sprachAntwort.languages ?? sprachAntwort;
  const codes = sprachen.map((s) => s.code);

  // Der Server kennt die Vorwahl aus Cookie oder Accept-Language und liefert
  // sie mit. Nur wenn er nichts weiß, entscheidet der Browser.
  //
  // Eine gewünschte Sprache schlägt beides — aber nur, wenn das Backend sie
  // wirklich kennt. Ein Pfad `/xx/…`, den niemand eingetragen hat, dürfte die
  // Oberfläche nicht auf eine Sprache ohne Texte stellen.
  const gewuenscht = wunschsprache && codes.includes(wunschsprache) ? wunschsprache : undefined;
  const locale: string =
    gewuenscht ?? sprachAntwort.active ?? sprachAntwort.current ?? browserSprache(codes);

  const texte: Texte = await hole(`/api/translations/${encodeURIComponent(locale)}`)
    .then((a) => a.messages ?? a)
    .catch(() => ({}));

  const dir = sprachen.find((s) => s.code === locale)?.dir ?? 'ltr';

  return {
    locale,
    dir,
    texte,
    sprachen,
    thema,
    themaAnwenden() {
      if (typeof document === 'undefined') return;
      const wurzel = document.documentElement;
      for (const [name, wert] of Object.entries(thema)) {
        if (typeof wert === 'string') wurzel.style.setProperty(`--marke-${name}`, wert);
      }
      // Arabisch und Farsi laufen von rechts nach links. Ohne dies stünden
      // Felder, Haken und Pfeile spiegelverkehrt zum Text.
      wurzel.setAttribute('dir', dir);
      wurzel.setAttribute('lang', locale);
    },
  };
}

/**
 * Nimmt nur die Schlüssel, die es wirklich gibt.
 *
 * Ein fehlender Schlüssel darf die Vorgabe der Komponente NICHT mit
 * `undefined` überschreiben – sonst stünde dort nichts, und ein leerer Knopf
 * ist schlimmer als ein deutscher.
 */
function waehle(texte: Texte, abbildung: Record<string, string>): Record<string, string> {
  const raus: Record<string, string> = {};
  for (const [feld, schluessel] of Object.entries(abbildung)) {
    const wert = texte[schluessel];
    if (typeof wert === 'string' && wert !== '') raus[feld] = wert;
  }
  return raus;
}

// ── Abbildungen je Komponente ───────────────────────────────────────────────
// Links das Feld der Komponente, rechts der i18n-Schlüssel.

// Bauteil: LoginDialog.tsx
export const fuerLogin = (t: Texte) =>
  waehle(t, {
    welcome: 'ui.auth.welcome',
    subtitle: 'ui.auth.welcomeSubtitle',
    google: 'ui.auth.continueWithGoogle',
    apple: 'ui.auth.continueWithApple',
    or: 'ui.auth.or',
    emailLabel: 'ui.auth.emailLabel',
    // Auch der Platzhalter im E-Mail-Feld. `max.mustermann@beispiel.de` ist
    // ein deutscher Beispielname mit deutscher Endung – Regel 4 nennt
    // `placeholder` ausdruecklich, und ein Beispiel, das der Leser nicht als
    // Beispiel erkennt, sieht aus wie eine bereits eingetragene Adresse.
    emailPlaceholder: 'ui.auth.emailPlaceholder',
    passwordLabel: 'ui.auth.passwordLabel',
    forgot: 'ui.auth.forgotLink',
    submit: 'ui.auth.loginTitle',
    toRegister: 'ui.auth.toRegister',
    // Der Registriermodus derselben Karte.
    registerTitle: 'ui.auth.registerTitle',
    registerSubtitle: 'ui.auth.registerSubtitle',
    registerSubmit: 'ui.auth.registerTitle',
    toLogin: 'ui.auth.toLogin',
    // Regel 4: auch das `aria-label` des Kreuzes und die beiden Fehlersaetze.
    // `networkError` entsteht im Browser, nicht am Server – ohne diesen
    // Schluessel gaebe es keine Sprache, in der er nicht deutsch waere.
    close: 'ui.auth.close',
    failed: 'ui.auth.requestFailed',
    networkError: 'ui.auth.networkError',
  });

// Bauteil: PasswortVergessen.tsx
export const fuerPasswortVergessen = (t: Texte) =>
  waehle(t, {
    // Kein `badge`: `PasswortVergessen.tsx` zeigt keine Kennmarke ueber dem
    // Titel – der Bildschirm ist gebaut, wie er gebaut ist. Die Zeile stand
    // hier und traf auf kein Feld; beim Kopieren in ein zweites Projekt sieht
    // so etwas aus wie ein angeschlossener Weg (Regel 6.5). Der Schluessel
    // `ui.auth.forgotBadge` bleibt in de.ts – er gehoert der im Backend
    // gerenderten Seite.
    title: 'ui.auth.forgotTitle',
    intro: 'ui.auth.forgotIntro',
    emailLabel: 'ui.auth.emailLabel',
    submit: 'ui.auth.forgotSubmit',
    sentTitle: 'ui.auth.forgotSentTitle',
    sentIntro: 'ui.auth.forgotSentIntro',
    back: 'ui.auth.toLogin',
    failed: 'ui.auth.requestFailed',
    networkError: 'ui.auth.networkError',
  });

// Bauteil: PasswortNeu.tsx
export const fuerPasswortNeu = (t: Texte) =>
  waehle(t, {
    title: 'ui.auth.resetTitle',
    intro: 'ui.auth.resetIntro',
    passwordLabel: 'ui.auth.newPasswordLabel',
    confirmLabel: 'ui.auth.confirmPasswordLabel',
    confirmMismatch: 'ui.auth.passwordMismatch',
    confirmMatch: 'ui.auth.passwordMatch',
    showPassword: 'ui.gate.showPassword',
    submit: 'ui.auth.resetSubmit',
    tooShort: 'ui.password.tooShort',
    weak: 'ui.password.weak',
    medium: 'ui.password.medium',
    strong: 'ui.password.strong',
    hintLength: 'ui.password.hintLength',
    hintCommon: 'ui.password.hintCommon',
    hintDigits: 'ui.password.hintDigits',
    hintPattern: 'ui.password.hintPattern',
    hintClasses: 'ui.password.hintClasses',
    classUpper: 'ui.password.classUpper',
    classLower: 'ui.password.classLower',
    classDigit: 'ui.password.classDigit',
    classSymbol: 'ui.password.classSymbol',
    // Kein eigener Schluessel fuer den abgelaufenen Link: `error.linkInvalid`
    // sagt in allen zehn Sprachen bereits genau das. Ein zweiter waere eine
    // zweite Quelle fuer denselben Satz (Regel 6.2).
    linkInvalid: 'error.linkInvalid',
    networkError: 'ui.auth.networkError',
  });

// Bauteil: KaufAbschluss.tsx
export const fuerKaufAbschluss = (t: Texte) =>
  waehle(t, {
    thanks: 'ui.purchase.thanks',
    passwordPrompt: 'ui.purchase.passwordPrompt',
    emailLabel: 'ui.auth.emailLabel',
    emailLocked: 'ui.purchase.emailLocked',
    passwordLabel: 'ui.auth.passwordLabel',
    submitNew: 'ui.purchase.submitNew',
    submitExisting: 'ui.purchase.submitExisting',
    loading: 'ui.purchase.loading',
    // Die drei Anzeigezustaende aus Ablauf II.1, Punkt 6. Sie stehen hier und
    // nicht als deutsche Vorgabe in der Komponente: Regel 4 – jeder sichtbare
    // Text laeuft ueber i18n, in allen zehn Sprachen.
    congratsTitle: 'ui.kauf.congratsTitle',
    congratsText: 'ui.kauf.congratsText',
    weiter: 'ui.kauf.weiter',
    pendingTitle: 'ui.kauf.pendingTitle',
    pendingText: 'ui.kauf.pendingText',
    // Fehlertexte zu Fehlercodes. Eine rohe Error.message bekommt der Kunde
    // nie zu sehen (Regel 4.4) – deshalb braucht jeder behandelte Code hier
    // seinen uebersetzten Satz.
    failed: 'ui.willkommen.failedText',
    // Zwei Lagen, zwei Saetze. `POST /api/claim` antwortet fuer beide mit
    // `zustand: 'gesperrt'` und nennt in `pfad`, welche es ist. Ein Satz fuer
    // beide war fuer die gesperrte Karte in jedem Satzteil falsch — siehe
    // `src/modules/geld/gesperrtgrund.ts`.
    disputed: 'ui.gesperrt.text',
    karteGesperrt: 'ui.gesperrt.karte.text',
    passwordTooShort: 'validation.passwordMin',
  });

// Bauteil: KontoGesperrt.tsx
export const fuerKontoGesperrt = (t: Texte) =>
  waehle(t, {
    badge: 'ui.blocked.badge',
    title: 'ui.blocked.title',
    reasonDispute: 'ui.blocked.reasonDispute',
    reasonRefund: 'ui.blocked.reasonRefund',
    reasonReview: 'ui.blocked.reasonReview',
    reassure: 'ui.blocked.reassure',
    reassureFinal: 'ui.blocked.reassureFinal',
    reassureContact: 'ui.blocked.reassureContact',
    imprint: 'email.legal.imprint',
    privacy: 'email.legal.privacy',
  });

// Bauteil: Wartungsfenster.tsx
export const fuerWartung = (t: Texte) =>
  waehle(t, {
    title: 'ui.maintenance.title',
    text: 'ui.maintenance.text',
    textOhneZeit: 'ui.maintenance.textOhneZeit',
    imprint: 'email.legal.imprint',
    privacy: 'email.legal.privacy',
  });

// Bauteil: CreditEinloesen.tsx
export const fuerCredits = (t: Texte) =>
  waehle(t, {
    title: 'ui.credits.title',
    cost: 'ui.credits.cost',
    submit: 'ui.credits.submit',
    // EIN Platzhalter {dokumente}, nicht drei feste. Nur so laesst sich der
    // Satz kuerzen, wenn ein Rechtstext fehlt (Regel 2.2) – bei drei festen
    // Platzhaltern bliebe das Bindewort stehen, und der Satz waere in jeder
    // der zehn Sprachen anders kaputt.
    accept: 'ui.zustimmung.satz',
    close: 'ui.credits.close',
    creditOne: 'ui.credits.one',
    creditMany: 'ui.credits.many',
    balance: 'ui.credits.balance',
    // `notEnough` ist ERSATZLOS entfallen. Zu wenig Guthaben ist kein Fehler,
    // sondern ein Kaufwunsch: das Fenster schliesst und die Kasse geht auf
    // (Regel 4.5). Eine rote Meldung dafuer waere genau der Zustand, den die
    // Regel abschafft – deshalb steht hier auch kein Schluessel mehr, den
    // jemand versehentlich wieder anschliesst.
    failed: 'error.internal',
    refunded: 'error.unlockFailed',
    balanceUnknown: 'error.balanceUnknown',
  });

/*
 * Fuer `/willkommen` und `/gesperrt` gibt es hier ABSICHTLICH keine
 * `fuer…`-Funktion.
 *
 * Beide Seiten werden im Backend gerendert (`src/modules/geld/*.page.ts`) und
 * holen ihre Texte dort direkt ueber `t()`. Eine Abbildung an dieser Stelle
 * waere eine zweite Quelle fuer dieselben Schluessel (Regel 6.2) und, da sie
 * niemand aufruft, toter Code mit Ablaufbeschreibung – beim Kopieren in ein
 * zweites Projekt sieht so etwas aus wie der Weg, den man anschliesst
 * (Regel 6.5).
 *
 * Wer die beiden Bildschirme im Frontend nachbaut, nimmt die Schluessel
 * `ui.willkommen.*` und `ui.gesperrt.*` und schreibt sich hier eine Abbildung
 * – dann gibt es sie, weil es die Komponente gibt.
 */
