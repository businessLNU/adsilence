/**
 * Zeilenparser für Filterlisten in Adblock-Plus-Syntax (EasyList, EasyPrivacy,
 * Fanboy, uBO-Listen). Reines TypeScript: keine Node-, keine Browser-API.
 *
 * Er ENTSCHEIDET NICHT, ob eine Regel umsetzbar ist. Er zerlegt nur. Ob eine
 * Netzregel in DNR passt, sagt `dnr.ts`; ob ein Selektor sicher ist, sagt
 * `kosmetik.ts`. Deshalb kommt aus `parseZeile` für `||a.com^$csp=...` eine
 * `netz`-Regel mit `fremdeOptionen: ['csp']` und kein `unbekannt`. So bleibt
 * die eine Stelle, die DNR-Grenzen kennt, in `dnr.ts`, und `eigene.ts` kann
 * dieselbe Frage stellen, ohne sie zu wiederholen.
 *
 * `unbekannt` ist für Zeilen, die keine der drei Formen haben: erweiterte
 * Kosmetik (`#?#`, `#$#`, `#%#`), HTML-Filter (`##^`), leere Selektoren.
 */
import type { Grund } from './gruende.ts';

/** Ressourcentypen in ABP-Namen. `document` und `popup` sind nur bei Ausnahmen umsetzbar. */
export type Ressource =
  | 'script'
  | 'image'
  | 'stylesheet'
  | 'object'
  | 'xmlhttprequest'
  | 'subdocument'
  | 'ping'
  | 'websocket'
  | 'media'
  | 'font'
  | 'other'
  | 'document'
  | 'popup';

export type Netzregel = {
  typ: 'netz';
  roh: string;
  /** `@@`-Regel: erlaubt statt blockt. */
  ausnahme: boolean;
  /** Muster ohne `@@` und ohne `$optionen`; leer, wenn nur Optionen (`$script,domain=...`). */
  muster: string;
  /** Inhalt zwischen `/.../`, sonst null. */
  regex: string | null;
  /** `third-party` → true, `~third-party` → false, ungesetzt → null. */
  drittanbieter: boolean | null;
  /** `domain=a|b`: nur auf diesen Seiten. Kleinbuchstaben. */
  domains: string[];
  /** `domain=~c`: überall ausser dort. */
  ausgeschlosseneDomains: string[];
  typen: Ressource[];
  ausgeschlosseneTypen: Ressource[];
  wichtig: boolean;
  matchCase: boolean;
  /**
   * `$all`: gilt fuer JEDEN Ressourcentyp, das Dokument eingeschlossen.
   *
   * Der einzige Ort, an dem eine Blockregel auch `main_frame` treffen darf.
   * Malware-Listen fuehren fast nur solche Regeln: Wer auf einen Link zu einer
   * Schadadresse klickt, soll dort gar nicht erst ankommen - eine Regel, die
   * nur eingebettete Ressourcen aufhaelt, laesst genau den gefaehrlichen Fall
   * durch. Gemessen an der urlhaus-Liste: 7633 von 9533 Zeilen tragen `$all`.
   */
  alleTypen: boolean;
  /** Optionen ohne Netzwirkung (`generichide`, `elemhide`, ...): nur an Ausnahmen sinnvoll. */
  kosmetikOptionen: string[];
  /** Optionen, die DNR nicht ausdrücken kann: Name je Option. */
  /**
   * `$redirect=<name>`: Statt zu blocken eine Attrappe aus dem Paket
   * ausliefern. Der Name ist der von uBO (`noopjs`, `1x1.gif`, …); ein
   * angehaengtes `:5` ist eine Vorrangzahl und gehoert nicht zum Namen.
   *
   * `redirect-rule=` bleibt bewusst ungelesen: Es heisst „falls eine ANDERE
   * Regel blockt, dann umleiten". Diese Bedingung kennt DNR nicht, und eine
   * unbedingte Umleitung daraus zu machen hiesse, Anfragen umzubiegen, die
   * sonst durchgelaufen waeren.
   */
  attrappe: string | null;
  fremdeOptionen: string[];
};

export type Kosmetikregel = {
  typ: 'kosmetik';
  roh: string;
  /** `#@#`: hebt einen Selektor auf. */
  ausnahme: boolean;
  domains: string[];
  ausgeschlosseneDomains: string[];
  selektor: string;
  /**
   * Kam die Regel als `#?#` (prozedurale Kosmetik)? Dann steht im Selektor
   * MOEGLICHERWEISE ein Operator, den CSS nicht kennt (`:has-text(...)`).
   * Der Parser entscheidet das nicht — er sagt nur, woher die Zeile kommt;
   * ob der Selektor trotzdem reines CSS ist, prueft `zuKosmetik`.
   */
  prozedural: boolean;
};

export type Scriptletregel = {
  typ: 'scriptlet';
  roh: string;
  /** `#@#+js(...)`: nimmt ein Scriptlet zurück. */
  ausnahme: boolean;
  domains: string[];
  ausgeschlosseneDomains: string[];
  /** Name wie geschrieben, ohne `.js`; Kürzel löst `scriptlets.ts` auf. */
  name: string;
  args: string[];
};

export type Unbekannt = {
  typ: 'unbekannt';
  roh: string;
  grund: Grund;
};

export type Regel = Netzregel | Kosmetikregel | Scriptletregel | Unbekannt;

/** ABP-Typnamen samt Kürzeln aus uBO/AdGuard. */
const TYP_ALIAS: Record<string, Ressource> = {
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  css: 'stylesheet',
  object: 'object',
  xmlhttprequest: 'xmlhttprequest',
  xhr: 'xmlhttprequest',
  subdocument: 'subdocument',
  frame: 'subdocument',
  ping: 'ping',
  beacon: 'ping',
  websocket: 'websocket',
  media: 'media',
  font: 'font',
  other: 'other',
  document: 'document',
  doc: 'document',
  popup: 'popup',
};

/** Optionen ohne Netzwirkung; sie steuern Kosmetik und Snippets. */
const KOSMETIK_OPTIONEN = new Set([
  'generichide',
  'ghide',
  'elemhide',
  'ehide',
  'specifichide',
  'shide',
  'genericblock',
]);

/** Optionen, die nichts bewirken (uBO-Platzhalter). */
const LEERE_OPTIONEN = new Set(['_', 'noop']);

/**
 * Trennt `$optionen` vom Muster. Nur das LETZTE `$` zählt, und nur, wenn der
 * Rest wie eine Optionsliste aussieht. Ein `$` am Ende eines regulären
 * Ausdrucks (`/ads\.js$/`) bleibt so Teil des Musters.
 */
const OPTIONSLISTE = /^~?[a-z0-9_-]+(=[^,]*)?(,~?[a-z0-9_-]+(=[^,]*)?)*$/i;

function trenneOptionen(text: string): { muster: string; optionen: string[] } {
  const stelle = text.lastIndexOf('$');
  // Position 0 ist erlaubt: `$popup,domain=a.com` hat kein Muster, nur Optionen.
  if (stelle < 0) return { muster: text, optionen: [] };
  const rest = text.slice(stelle + 1);
  if (!OPTIONSLISTE.test(rest)) return { muster: text, optionen: [] };
  // Ein `$` direkt hinter `/` gehört zum Regex-Ende: `/foo/$script` hat den
  // Schrägstrich VOR dem Dollar; `/foo$/` hat ihn dahinter und keine Optionen.
  return { muster: text.slice(0, stelle), optionen: rest.split(',') };
}

function leseDomains(wert: string, trenner: string): { domains: string[]; ausgeschlossene: string[] } {
  const domains: string[] = [];
  const ausgeschlossene: string[] = [];
  for (const roh of wert.split(trenner)) {
    const eintrag = roh.trim().toLowerCase();
    if (!eintrag) continue;
    if (eintrag.startsWith('~')) {
      if (eintrag.length > 1) ausgeschlossene.push(eintrag.slice(1));
    } else {
      domains.push(eintrag);
    }
  }
  return { domains, ausgeschlossene };
}

function parseNetz(roh: string, zeile: string): Netzregel {
  const ausnahme = zeile.startsWith('@@');
  const ohneAusnahme = ausnahme ? zeile.slice(2) : zeile;
  const { muster: musterRoh, optionen } = trenneOptionen(ohneAusnahme);

  const regel: Netzregel = {
    typ: 'netz',
    roh,
    ausnahme,
    muster: musterRoh,
    regex: null,
    drittanbieter: null,
    domains: [],
    ausgeschlosseneDomains: [],
    typen: [],
    ausgeschlosseneTypen: [],
    wichtig: false,
    matchCase: false,
    kosmetikOptionen: [],
    alleTypen: false,
    attrappe: null,
    fremdeOptionen: [],
  };

  if (musterRoh.length > 2 && musterRoh.startsWith('/') && musterRoh.endsWith('/')) {
    regel.regex = musterRoh.slice(1, -1);
    regel.muster = '';
  }

  for (const rohOption of optionen) {
    const gleich = rohOption.indexOf('=');
    const name = (gleich === -1 ? rohOption : rohOption.slice(0, gleich)).trim().toLowerCase();
    const wert = gleich === -1 ? null : rohOption.slice(gleich + 1);
    const negiert = name.startsWith('~');
    const kern = negiert ? name.slice(1) : name;

    if (kern === 'third-party' || kern === '3p') {
      regel.drittanbieter = !negiert;
    } else if (kern === 'first-party' || kern === '1p') {
      regel.drittanbieter = negiert;
    } else if ((kern === 'domain' || kern === 'from') && wert !== null && !negiert) {
      const { domains, ausgeschlossene } = leseDomains(wert, '|');
      regel.domains.push(...domains);
      regel.ausgeschlosseneDomains.push(...ausgeschlossene);
    } else if (kern === 'important' && !negiert) {
      regel.wichtig = true;
    } else if (kern === 'match-case' && !negiert) {
      regel.matchCase = true;
    } else if (kern === 'all' && !negiert && wert === null) {
      regel.alleTypen = true;
    } else if (kern in TYP_ALIAS && wert === null) {
      const typ = TYP_ALIAS[kern];
      if (negiert) regel.ausgeschlosseneTypen.push(typ);
      else regel.typen.push(typ);
    } else if (kern === 'redirect' && wert !== null && !negiert) {
      regel.attrappe = wert.split(':')[0]!.trim().toLowerCase();
    } else if (KOSMETIK_OPTIONEN.has(kern) && !negiert) {
      regel.kosmetikOptionen.push(kern);
    } else if (LEERE_OPTIONEN.has(kern)) {
      // bewusst nichts
    } else {
      regel.fremdeOptionen.push(kern);
    }
  }

  return regel;
}

/**
 * Argumente von `+js(name, a, b)`: Kommas trennen, `\,` bleibt ein Komma,
 * Leerraum um jedes Argument fällt weg.
 */
function leseScriptletArgumente(inhalt: string): string[] {
  const teile: string[] = [];
  let aktuell = '';
  for (let i = 0; i < inhalt.length; i += 1) {
    const zeichen = inhalt[i];
    /*
     * Ein Argument in Anfuehrungszeichen (' " `) gilt wortwoertlich, samt
     * Kommas darin — so liest uBlock Origin seine Listen, und seine
     * YouTube-Regeln sind so geschrieben: `'"adPlacements"'` meint den Text
     * `"adPlacements"` MIT den doppelten Anfuehrungszeichen. Ohne diesen Zweig
     * kam das Argument mit den aeusseren Hochkommas an und traf nie.
     */
    if (aktuell.trim() === '' && (zeichen === "'" || zeichen === '"' || zeichen === '`')) {
      let ende = -1;
      for (let j = i + 1; j < inhalt.length; j += 1) {
        if (inhalt[j] !== zeichen) continue;
        const danach = inhalt.slice(j + 1).match(/^\s*(,|$)/);
        if (danach) { ende = j; break; }
      }
      if (ende !== -1) {
        teile.push(inhalt.slice(i + 1, ende));
        const rest = inhalt.slice(ende + 1).match(/^\s*(,|$)/)!;
        i = ende + rest[0].length;
        aktuell = '';
        if (rest[1] === '') return teile;
        continue;
      }
    }
    if (zeichen === '\\' && inhalt[i + 1] === ',') {
      aktuell += ',';
      i += 1;
    } else if (zeichen === ',') {
      teile.push(aktuell.trim());
      aktuell = '';
    } else {
      aktuell += zeichen;
    }
  }
  teile.push(aktuell.trim());
  return teile;
}

/**
 * Kosmetik: `domains##selektor`. Der Domainteil darf keine Zeichen enthalten,
 * die nur in Netzmustern vorkommen (`/ | @ " !`); sonst wäre `||a.com/x##y`
 * fälschlich Kosmetik. `*` bleibt erlaubt: uBO schreibt `tellows.*##...`
 * (Entity-Domain); ohne diese Ausnahme wurden 40 solcher Zeilen je Liste als
 * Netzregeln gelesen und als `sonderzeichen` verworfen.
 */
const KOSMETIK = /^([^/|@"!]*?)#(@?)([?$%]{0,2})#(.*)$/;

function parseKosmetik(roh: string, treffer: RegExpExecArray): Regel {
  const [, domainTeil, ausnahmeZeichen, erweiterung, selektorRoh] = treffer;
  /*
   * `#$#` (CSS-Injektion) und `#%#` (Snippets) bleiben draussen. `#?#` NICHT
   * mehr pauschal.
   *
   * GEMESSEN am 08.09.2026 ueber alle Quelllisten: 2.465 `#?#`-Zeilen, davon
   * 903 ohne einen einzigen Operator, den CSS nicht kann — fast durchweg
   * `:has(...)`, das jeder Zielbrowser nativ beherrscht. Sie fielen weg, weil
   * sie mit einem Fragezeichen geschrieben sind, nicht weil an ihnen etwas
   * unmoeglich waere.
   *
   * `:-abp-has(` ist ABPs Schreibweise fuer dasselbe und wird hier auf die
   * amtliche zurueckgeschrieben. Alles Weitere entscheidet die Grammatik in
   * `kosmetik.ts`: Was dort nicht in der Liste erlaubter Pseudoklassen steht
   * — `:has-text(`, `:-abp-contains(`, `:-abp-properties(` — faellt weiter
   * heraus, und zwar sichtbar als `erweiterteKosmetik`.
   */
  const prozedural = erweiterung === '?';
  if (erweiterung !== '' && !prozedural) return { typ: 'unbekannt', roh, grund: 'erweiterteKosmetik' };
  const selektor = (prozedural ? selektorRoh.replace(/:-abp-has\(/g, ':has(') : selektorRoh).trim();
  if (selektor === '') return { typ: 'unbekannt', roh, grund: 'syntax' };
  if (selektor.startsWith('^')) return { typ: 'unbekannt', roh, grund: 'htmlFilter' };

  const { domains, ausgeschlossene } = leseDomains(domainTeil, ',');
  const ausnahme = ausnahmeZeichen === '@';

  if (selektor.startsWith('+js(')) {
    if (!selektor.endsWith(')')) return { typ: 'unbekannt', roh, grund: 'syntax' };
    const inhalt = selektor.slice(4, -1).trim();
    const args = inhalt === '' ? [] : leseScriptletArgumente(inhalt);
    const name = (args.shift() ?? '').replace(/\.js$/, '');
    return {
      typ: 'scriptlet',
      roh,
      ausnahme,
      domains,
      ausgeschlosseneDomains: ausgeschlossene,
      name,
      args,
    };
  }

  return {
    typ: 'kosmetik',
    roh,
    ausnahme,
    domains,
    ausgeschlosseneDomains: ausgeschlossene,
    selektor,
    prozedural,
  };
}

/**
 * Eine Zeile einer Filterliste. `null` für alles, was keine Regel ist:
 * Leerzeilen, Kommentare (`!`, `# `), der `[Adblock Plus 2.0]`-Kopf.
 */
export function parseZeile(zeile: string): Regel | null {
  const roh = zeile.replace(/\r$/, '');
  const text = roh.trim();
  if (text === '') return null;
  if (text.startsWith('!')) return null;
  if (text.startsWith('[') && text.endsWith(']')) return null;
  if (text.startsWith('# ') || text === '#') return null;

  const kosmetik = KOSMETIK.exec(text);
  if (kosmetik) return parseKosmetik(roh, kosmetik);

  return parseNetz(roh, text);
}

/**
 * Nackte Hostzeilen (`beispiel.de`, `1.2.3.4`) zu Hostregeln (`||beispiel.de^`).
 *
 * In ABP-Syntax ist eine Zeile ohne Sonderzeichen ein TEILSTRING-Muster: Sie
 * trifft ueberall in der URL, auch in einem Abfrageparameter einer voellig
 * fremden Seite. Fuer EasyList ist das gewollt (`/ads/`), fuer eine Liste
 * boesartiger HOSTS ist es zweimal falsch: zu breit im Treffer und zu teuer
 * im Kontingent. Teuer, weil `zuDnr` nur reine Hostregeln zu EINER Regel mit
 * vielen `requestDomains` zusammenlegt; als Teilstring bleibt jede Zeile eine
 * eigene DNR-Regel.
 *
 * GEMESSEN am 09.09.2026 an `urlhaus`: 1696 nackte Zeilen ergaben 1696 von
 * 29.855 aktiven Regeln, bei 145 freien im ganzen Paket. Danach: 2 Regeln.
 *
 * IP-Zeilen wandern mit. Ob Chrome eine IPv4 in `requestDomains` vergleicht,
 * war die offene Frage dabei - eine angenommene, aber nie treffende Regel
 * haette 1265 Schadadressen still ungeschuetzt gelassen. Gemessen am
 * laufenden Browser mit `tests/laufzeit/ip-domains-probe.mjs`: Chrome nimmt
 * die Regel an UND blockt die Anfrage.
 *
 * Diese Funktion steht in der Engine und nicht im Bauskript, weil ZWEI Leser
 * sie brauchen: `extension/scripts/listen-bauen.mjs` baut das Paket damit,
 * `scripts/listenpflege.mjs` rechnet den taeglichen Zuwachs dagegen. Laufen
 * die beiden auseinander, haelt der Abdruckvergleich jede Hostregel fuer neu
 * und die Pflege liefert taeglich aus, was laengst im Paket steht.
 */
export function nackteHostzeilen(text: string): string {
  const host = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
  return text
    .split('\n')
    .map((zeile) => {
      const z = zeile.trim();
      if (!z || z.startsWith('!') || z.startsWith('[')) return zeile;
      return host.test(z) ? `||${z}^` : zeile;
    })
    .join('\n');
}

/** Alle Zeilen eines Listentexts; Kommentare und Leerzeilen fallen weg. */
export function parseListe(text: string): Regel[] {
  const regeln: Regel[] = [];
  for (const zeile of text.split('\n')) {
    const regel = parseZeile(zeile);
    if (regel) regeln.push(regel);
  }
  return regeln;
}
