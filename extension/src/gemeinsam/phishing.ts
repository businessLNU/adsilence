/**
 * Der Verwechslungswarner: Sieht dieser Hostname aus wie eine bekannte Marke,
 * ist es aber nicht?
 *
 * ── Wofuer das da ist ──────────────────────────────────────────────────────
 * `paypaI.com` mit grossem I statt kleinem l. `sparkasse-sicherheit.de`.
 * `xn--pypal-4ve.com`, das im Browser als `pаypal.com` erscheint, weil ein
 * kyrillisches а darin steckt. Wer gut sieht und weiss, worauf zu achten ist,
 * erkennt das. Wer beides nicht hat, klickt.
 *
 * ── Der Massstab: lieber eine Taeuschung uebersehen als eine echte Seite
 *    anschwaerzen ────────────────────────────────────────────────────────────
 * Eine Warnung auf der echten Seite der eigenen Bank ist der teuerste Fehler,
 * den dieses Werkzeug machen kann: Beim zweiten Mal glaubt ihm niemand mehr,
 * und dann schuetzt es auch nicht mehr vor der Faelschung. Jede Regel hier ist
 * deshalb so geschnitten, dass sie im Zweifel schweigt. Es gibt keine
 * Aehnlichkeitsschwelle „ab 80 Prozent"; jede Regel benennt einen konkreten,
 * nachvollziehbaren Trick.
 *
 * ── Was NICHT passiert ─────────────────────────────────────────────────────
 * Keine Anfrage nach draussen. Keine Liste besuchter Adressen. Die Pruefung
 * ist eine reine Funktion auf dem Hostnamen, die Markenliste liegt im Paket.
 * Ein Dienst, der jede besuchte Adresse zur Pruefung an einen Server schickt,
 * waere genau das, was diese Erweiterung nicht tut.
 */

/**
 * Punycode zurueck in Buchstaben: `xn--mazon-3ve` wird zu `аmazon`.
 *
 * ── Warum das hier stehen MUSS ─────────────────────────────────────────────
 * Genau hier sitzt der gefaehrlichste Fall ueberhaupt: Eine Adresse mit einem
 * kyrillischen `а` statt des lateinischen ist auf dem Bildschirm nicht zu
 * unterscheiden, und die passende Domain ist oft noch frei. Wer sie kauft und
 * die Seite nachbaut, hat eine Faelschung, die niemand am Namen erkennt.
 *
 * GEMESSEN am 03.09.2026: `pruefeHost('аmazon.de')` erkannte den Fall sofort -
 * aber `location.hostname` gibt einem Inhaltsskript NICHT `аmazon.de` zurueck,
 * sondern `xn--mazon-3ve.de`. Und darin steckt `mazon`, nicht `amazon`; jede
 * Regel lief ins Leere. Die Erkennung war also genau fuer den Fall blind, fuer
 * den sie gebaut wurde, und niemand haette es gemerkt: In den Tests stand die
 * lesbare Form.
 *
 * Die Umsetzung folgt RFC 3492. Sie ist bewusst kurz und ohne Abhaengigkeit:
 * Node hat `domainToUnicode`, ein Browser hat nichts Vergleichbares, und ein
 * Paket dafuer einzubinden hiesse, dem Werbeblocker fremden Code beizulegen.
 */

const BASIS = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMPF = 700;
const START_BIAS = 72;
const START_N = 128;
const TRENNER = 0x2d; // Bindestrich

function ziffernwert(zeichen: number): number {
  if (zeichen - 48 < 10) return zeichen - 22; // 0..9
  if (zeichen - 65 < 26) return zeichen - 65; // A..Z
  if (zeichen - 97 < 26) return zeichen - 97; // a..z
  return BASIS;
}

function anpassen(delta: number, anzahl: number, ersteRunde: boolean): number {
  let d = ersteRunde ? Math.floor(delta / DAMPF) : delta >> 1;
  d += Math.floor(d / anzahl);
  let k = 0;
  while (d > ((BASIS - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASIS - TMIN));
    k += BASIS;
  }
  return k + Math.floor(((BASIS - TMIN + 1) * d) / (d + SKEW));
}

/** Ein einzelnes Label. Ohne `xn--` davor oder bei Unsinn: unveraendert. */
export function entschluessleLabel(label: string): string {
  if (!/^xn--/i.test(label)) return label;
  const rest = label.slice(4);
  let n = START_N;
  let i = 0;
  let bias = START_BIAS;

  const trennerAn = rest.lastIndexOf(String.fromCharCode(TRENNER));
  const grund: number[] = [];
  if (trennerAn > 0) {
    for (let j = 0; j < trennerAn; j++) {
      const c = rest.charCodeAt(j);
      if (c >= 0x80) return label; // Grundteil muss ASCII sein
      grund.push(c);
    }
  }

  let index = trennerAn > 0 ? trennerAn + 1 : 0;
  while (index < rest.length) {
    const alt = i;
    let gewicht = 1;
    for (let k = BASIS; ; k += BASIS) {
      if (index >= rest.length) return label;
      const ziffer = ziffernwert(rest.charCodeAt(index++));
      if (ziffer >= BASIS) return label;
      if (ziffer > Math.floor((0x7fffffff - i) / gewicht)) return label;
      i += ziffer * gewicht;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (ziffer < t) break;
      if (gewicht > Math.floor(0x7fffffff / (BASIS - t))) return label;
      gewicht *= BASIS - t;
    }
    const laenge = grund.length + 1;
    bias = anpassen(i - alt, laenge, alt === 0);
    if (Math.floor(i / laenge) > 0x7fffffff - n) return label;
    n += Math.floor(i / laenge);
    i %= laenge;
    grund.splice(i++, 0, n);
  }
  try {
    return String.fromCodePoint(...grund);
  } catch {
    return label;
  }
}

/** Jeden Teil eines Hostnamens entschluesseln. */
export function entschluesseleHost(host: string): string {
  if (!/xn--/i.test(host)) return host;
  return host.split('.').map(entschluessleLabel).join('.');
}

/** Eine geschuetzte Marke und die Hosts, die WIRKLICH ihr gehoeren. */
export type Marke = {
  /** Anzeigename, so wie ihn ein Mensch kennt. */
  name: string;
  /** Die echten registrierbaren Domains, klein geschrieben. */
  domains: string[];
};

export type Verdacht = {
  /** Der geprüfte Host, so wie der Browser ihn nennt (ggf. Punycode). */
  host: string;
  /**
   * Die lesbare Form, wenn sie sich vom Host unterscheidet - also bei
   * internationalen Adressen. `xn--mazon-3ve.de` steht dann als `аmazon.de`
   * daneben, denn genau diese Form sieht der Nutzer in der Adresszeile, und
   * genau sie ist die Täuschung.
   */
  lesbar: string | null;
  /** Die Marke, die nachgeahmt wird. */
  marke: string;
  /** Die echte Adresse, auf die der Nutzer vermutlich wollte. */
  echt: string;
  /** Welcher Trick erkannt wurde. Die Oberflaeche macht daraus einen Satz. */
  grund: 'homoglyph' | 'punycode' | 'markeAlsTeil' | 'einZeichen';
};

/**
 * Zeichen, die auf dem Bildschirm kaum zu unterscheiden sind, auf einen
 * gemeinsamen Nenner gebracht.
 *
 * ── Warum keine lange Liste von Hand ───────────────────────────────────────
 * Der erste Entwurf zaehlte kyrillische und griechische Buchstaben einzeln
 * auf. Das ist eine Liste, die nie fertig wird: Es gibt armenische,
 * Cherokee-, vollbreite und mathematische Buchstaben, die genauso aussehen,
 * und jede Unicode-Fassung bringt neue. Wer sie pflegen muss, pflegt sie
 * irgendwann nicht mehr.
 *
 * Deshalb drei Stufen, von denen die ersten beiden ganz ohne Tabelle
 * auskommen:
 *
 *   1. NFKD-Zerlegung. Aus `é` wird `e` plus ein Akzent, aus dem vollbreiten
 *      `ａ` wird `a`, aus `①` wird `1`. Die Akzente fallen danach weg. Das
 *      erledigt Hunderte von Faellen, die keine Liste je aufzaehlen koennte.
 *   2. Die Tabelle darunter, nur noch fuer das, was NFKD NICHT
 *      zusammenfuehrt: Ein kyrillisches `а` ist ein eigener Buchstabe, keine
 *      Variante des lateinischen, und bleibt nach jeder Normalisierung
 *      verschieden. Solche Paare gibt es in ueberschaubarer Zahl.
 *   3. Formgleiche Folgen: `rn` sieht aus wie `m`, `vv` wie `w`.
 */
const SKELETT: Record<string, string> = {
  // Lateinisch, gleiche Form
  l: 'l', I: 'l', '1': 'l', '|': 'l', '!': 'l',
  O: 'o', '0': 'o',
  // Kyrillisch
  а: 'a', в: 'b', с: 'c', е: 'e', о: 'o', р: 'p', х: 'x', у: 'y', ѕ: 's', і: 'l', ј: 'j',
  ԁ: 'd', һ: 'h', ԛ: 'q', ԝ: 'w', м: 'm', т: 't', н: 'h', к: 'k', з: 'e', ч: 'y',
  А: 'a', В: 'b', Е: 'e', К: 'k', М: 'm', Н: 'h', О: 'o', Р: 'p', С: 'c', Т: 't', Х: 'x', У: 'y', Ѕ: 's', І: 'l', Ј: 'j',
  // Griechisch
  ο: 'o', ρ: 'p', α: 'a', ε: 'e', ν: 'v', τ: 't', υ: 'u', κ: 'k', ι: 'l', η: 'n', μ: 'm', σ: 'o', ς: 'c', χ: 'x', γ: 'y', ω: 'w',
  Α: 'a', Β: 'b', Ε: 'e', Ζ: 'z', Η: 'h', Ι: 'l', Κ: 'k', Μ: 'm', Ν: 'n', Ο: 'o', Ρ: 'p', Τ: 't', Υ: 'y', Χ: 'x',
  // Armenisch
  օ: 'o', ս: 'u', գ: 'q', ո: 'n', հ: 'h', ա: 'w', մ: 'd', տ: 'un', ք: 'p', ի: 'h',
  // Cherokee: eine ganze Schrift aus lateinisch aussehenden Zeichen
  Ꭺ: 'a', Ꮃ: 'w', Ꮖ: 'l', Ꮟ: 'b', Ꭼ: 'e', Ꮋ: 'h', Ꭻ: 'j', Ꮶ: 'k', Ꮇ: 'm', Ꮎ: 'z', Ꮪ: 'v', Ꮯ: 'c', Ꮲ: 'p', Ꮢ: 'r', Ꮪ2: 's',
  // Sonderformen, die NFKD stehen laesst
  ı: 'l', ȷ: 'j', ǀ: 'l', ǃ: 'l', ɑ: 'a', ɡ: 'g', ɩ: 'l', ɪ: 'l', ʟ: 'l', ᴠ: 'v', ᴡ: 'w', ᴏ: 'o',
  '': '', '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '−': '-', '․': '.', '。': '.', '｡': '.',
};

/**
 * Der Hostname auf seine FORM reduziert.
 *
 * Reihenfolge: erst NFKD (zerlegt Akzente und Breitenvarianten), dann die
 * Akzente weg, dann die Tabelle fuer echte Fremdschrift, dann die
 * Buchstabenfolgen.
 */
export function skelett(text: string): string {
  // NFKD zerlegt `é` in `e` + Akzent und macht aus vollbreiten Zeichen
  // schmale; die Akzente entfernt der zweite Schritt.
  const zerlegt = text.normalize('NFKD').replace(/\p{Mn}+/gu, '');
  let raus = '';
  for (const zeichen of zerlegt) raus += SKELETT[zeichen] ?? zeichen.toLowerCase();
  return raus.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/cl/g, 'd');
}

/**
 * Mischt dieses Label lateinische Buchstaben mit einer ANDEREN Schrift?
 *
 * Das ist der schaerfste allgemeine Hinweis auf eine Taeuschung, den es gibt,
 * und er braucht keine Zeichentabelle: Eine echte Adresse ist entweder ganz
 * lateinisch oder ganz in ihrer eigenen Schrift. `аmazon` mit einem
 * kyrillischen Buchstaben unter sechs lateinischen ist keine Sprache, das ist
 * Absicht.
 *
 * Geprueft wird je LABEL, nicht ueber den ganzen Hostnamen: `münchen.みんな`
 * ist eine gueltige Adresse, in der jedes Label bei seiner Schrift bleibt.
 */
export function mischtSchriften(label: string): boolean {
  const ohneZiffern = label.replace(/[\d\-_.]/gu, '');
  if (!ohneZiffern) return false;
  const lateinisch = /\p{Script=Latin}/u.test(ohneZiffern);
  if (!lateinisch) return false;
  // Irgendein Buchstabe, der WEDER lateinisch noch schriftneutral ist.
  return /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(ohneZiffern);
}

/**
 * Mehrteilige oeffentliche Endungen, bei denen die registrierbare Domain aus
 * DREI Teilen besteht (`bank.co.uk`, nicht `co.uk`).
 *
 * Bewusst eine kurze Liste statt der vollstaendigen Public Suffix List: Die
 * ist ueber 200 kB gross und aendert sich staendig, und fuer die Frage
 * „gehoert dieser Host der Marke?" reichen die Endungen, unter denen die
 * geschuetzten Marken wirklich stehen. Was hier fehlt, fuehrt zu einer
 * VERPASSTEN Warnung, nicht zu einer falschen.
 */
const ZWEITEILIGE_ENDUNGEN = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au', 'com.br', 'com.mx', 'com.ar', 'com.tr',
  'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'co.nz', 'co.za', 'co.in', 'com.cn',
  'com.sg', 'com.hk', 'com.tw', 'com.pl', 'com.es', 'com.pt', 'com.ua',
]);

/** Die registrierbare Domain: `signin.paypal.com` wird zu `paypal.com`. */
export function registrierbar(host: string): string {
  const teile = host.toLowerCase().replace(/\.$/, '').split('.');
  if (teile.length <= 2) return teile.join('.');
  const letzteZwei = teile.slice(-2).join('.');
  return ZWEITEILIGE_ENDUNGEN.has(letzteZwei) ? teile.slice(-3).join('.') : letzteZwei;
}

/** Gehoert dieser Host der Marke, als Domain selbst oder als Unterdomain? */
function gehoertZu(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Abstand nach Levenshtein, abgebrochen sobald er `grenze` ueberschreitet. */
export function abstand(a: string, b: string, grenze = 2): number {
  if (Math.abs(a.length - b.length) > grenze) return grenze + 1;
  let vorige = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const aktuelle = [i];
    let kleinste = i;
    for (let j = 1; j <= b.length; j++) {
      const kosten = a[i - 1] === b[j - 1] ? 0 : 1;
      const wert = Math.min(aktuelle[j - 1]! + 1, vorige[j]! + 1, vorige[j - 1]! + kosten);
      aktuelle.push(wert);
      if (wert < kleinste) kleinste = wert;
    }
    // Ganze Zeile schon ueber der Grenze: es kann nur noch schlimmer werden.
    if (kleinste > grenze) return grenze + 1;
    vorige = aktuelle;
  }
  return vorige[b.length]!;
}

/**
 * Traegt eines der Labels dieses Hosts den Markennamen an fuehrender Stelle?
 *
 * Siehe die Begruendung an Regel 4 in `pruefeHost`: Ein Name am ENDE eines
 * mehrteiligen Labels (`ssl-images-amazon`) ist der Normalfall echter
 * Firmenadressen und darf nicht warnen.
 */
function fuehrtMarke(hostSkelett: string, name: string): boolean {
  for (const label of hostSkelett.split('.')) {
    // Der Name IST das ganze Label.
    if (label === name) return true;
    // Der Name fuehrt das Label an, und dahinter kommt ein TRENNER, kein
    // Buchstabe. Ohne diese Bedingung traf die Regel `amazonas-shop.de` und
    // `microsofties.net` - beides gewachsene Woerter, die zufaellig so
    // anfangen. Der Preis: `paypallets.com` faellt ebenfalls durch. Die zwei
    // Faelle sind an der Zeichenkette nicht zu unterscheiden, und dann gilt
    // der Massstab dieser Datei: lieber eine Taeuschung uebersehen als eine
    // echte Seite anschwaerzen.
    if (label.startsWith(name) && /^[^a-z0-9]/.test(label.slice(name.length))) return true;
    // Ein zweiteiliges Label, dessen zweiter Teil der Name ist: `login-paypal`.
    const teile = label.split('-');
    if (teile.length === 2 && teile[1] === name) return true;
  }
  return false;
}

/**
 * Prueft einen Hostnamen gegen die Markenliste.
 *
 * Gibt `null` zurueck, wenn nichts auffaellt - das ist der Normalfall und der
 * einzige, in dem der Nutzer nichts sieht.
 */
export function pruefeHost(host: string, marken: readonly Marke[]): Verdacht | null {
  const roh = host.replace(/\.$/, '');
  if (!roh || !roh.includes('.')) return null;

  // ZUERST entschluesseln. `location.hostname` gibt eine internationale
  // Adresse als Punycode heraus: aus `аmazon.de` wird `xn--mazon-3ve.de`, und
  // darin steckt `mazon`, nicht `amazon`. Ohne diesen Schritt war die
  // Erkennung genau fuer den gefaehrlichsten Fall blind - fuer den, bei dem
  // der Nutzer die Faelschung am Namen ueberhaupt nicht sehen kann.
  const lesbar = entschluesseleHost(roh);
  const klein = lesbar.toLowerCase();

  for (const marke of marken) {
    // 1. Es IST die Marke: fertig, nie eine Warnung. Steht vor allem anderen,
    //    damit keine spaetere Regel die echte Seite treffen kann.
    if (marke.domains.some((d) => gehoertZu(klein, d))) return null;
  }

  const domain = registrierbar(klein);
  // Aus der LESBAREN Form und nicht aus `klein`: `skelett()` schlaegt vor dem
  // Kleinschreiben nach, sonst faellt das grosse I durch.
  const domainSkelett = skelett(lesbar.slice(lesbar.length - domain.length));
  const hostSkelett = skelett(lesbar);
  // Mischt irgendein Label Latein mit einer anderen Schrift? Das allein ist
  // noch keine Warnung - es macht nur den Unterschied zwischen „sieht
  // aehnlich aus" und „ist so gebaut, dass es gleich aussieht".
  const gemischt = lesbar.split('.').some(mischtSchriften);

  for (const marke of marken) {
    for (const echt of marke.domains) {
      const echtSkelett = skelett(echt);
      const echtName = echt.split('.')[0]!;

      // 2. Gleiche FORM, anderer Text: `paypaI.com`, `pаypal.com`,
      //    `xn--mazon-3ve.de`. Der sicherste Treffer, den es gibt - hier ist
      //    Taeuschung die einzige Erklaerung.
      if (domainSkelett === echtSkelett) {
        return { host: roh, lesbar: lesbar === roh ? null : lesbar, marke: marke.name, echt, grund: gemischt ? 'punycode' : 'homoglyph' };
      }

      // 3. Fremde Schrift UND der Markenname steckt in der Form: Auch wenn die
      //    Endung abweicht (`аmazon.shop`), ist ein gemischtschriftliches
      //    Label mit einem Markennamen darin kein Zufall.
      if (gemischt && domainSkelett.includes(echtName)) {
        return { host: roh, lesbar: lesbar === roh ? null : lesbar, marke: marke.name, echt, grund: 'punycode' };
      }

      // 4. Der Markenname steht im Host, aber die Domain gehoert ihr nicht:
      //    `paypal.com.sicherheit-pruefung.xyz`, `paypal-login.de`.
      //
      //    NICHT einfach `includes`: Damit traf die Regel
      //    `images-eu.ssl-images-amazon.de`, und das ist eine echte
      //    Amazon-Adresse. Firmen haengen ihren Namen ans Ende
      //    zusammengesetzter Labels, Faelscher stellen ihn nach vorn oder
      //    machen ein eigenes Label daraus. Genau diese zwei Formen zaehlen:
      //      - der Name IST ein Label            (`paypal`.com.betrug.xyz)
      //      - ein Label FAENGT mit ihm an       (`paypal`-login.xyz)
      //      - ein zweiteiliges Label endet mit ihm (login-`paypal`.xyz),
      //        aber nicht ein drei- oder mehrteiliges (ssl-images-amazon)
      //    Nur bei Namen ab fuenf Zeichen, sonst traefe es zu viel.
      //    Ohne Ausschluss ueber `domainSkelett`: Die echten Domains der Marke
      //    sind in Schritt 1 laengst heraus, und die Bedingung sperrte genau
      //    die Faelle aus, um die es geht (`amazon-kundenservice.tk` faengt mit
      //    der Marke an - das ist der Trick, nicht die Entlastung).
      if (echtName.length >= 5 && fuehrtMarke(hostSkelett, echtName)) {
        return { host: roh, lesbar: lesbar === roh ? null : lesbar, marke: marke.name, echt, grund: 'markeAlsTeil' };
      }

      // 5. Ein Zeichen daneben, bei gleicher Endung: `paypa.com`, `payypal.com`.
      //    Nur ab sechs Zeichen Markenname; bei kurzen Namen sind
      //    Nachbardomains oft echte, andere Firmen.
      const endung = echt.slice(echtName.length);
      if (echtName.length >= 6 && domain.endsWith(endung)) {
        const name = domain.slice(0, domain.length - endung.length);
        if (name !== echtName && abstand(skelett(name), echtName, 1) === 1) {
          return { host: roh, lesbar: lesbar === roh ? null : lesbar, marke: marke.name, echt, grund: 'einZeichen' };
        }
      }
    }
  }
  return null;
}
