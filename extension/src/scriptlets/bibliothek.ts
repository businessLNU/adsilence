/**
 * Die Scriptlet-Bibliothek: EINE eigenstaendige Funktion, die der Hintergrund
 * mit `scripting.executeScript({ func: scriptletLoader, args: [liste] })` in
 * den Seitenkontext (`world: 'MAIN'`) schickt.
 *
 * Sie wird SERIALISIERT: Der Browser wandelt sie in Text und fuehrt den in der
 * Seite aus. Deshalb darf sie NICHTS von aussen benutzen, keinen Import, keine
 * Modulvariable, keine Klasse (esbuild legt Klassenhelfer ausserhalb der
 * Funktion ab, und die waeren in der Seite nicht da). Alles, was sie braucht,
 * steht in ihr.
 *
 * Jedes Scriptlet laeuft in try/catch. Ein Fehler in einem Eintrag darf weder
 * die anderen noch die Seite stoeren; ein Werbeblocker, der Seiten kaputt
 * macht, wird abgeschaltet.
 *
 * Bewusst nur die Scriptlets, die in EasyList und Fanboy wirklich vorkommen
 * und deren Wirkung sich erklaeren laesst - welche das sind, steht unten in
 * `BEKANNTE_SCRIPTLETS`, und `tests/engine/scriptlets.test.ts` haelt diese
 * Liste gegen die hier gebauten Eintraege. `abort-on-property-*` werfen absichtlich, weil
 * genau das Skript, das die Eigenschaft anfasst, abbrechen soll; der Fehler
 * traegt eine Kennung und wird vom eigenen `error`-Lauscher verschluckt,
 * damit die Konsole der Seite sauber bleibt.
 */

export type ScriptletEintrag = { name: string; args: string[] };

export function scriptletLoader(eintraege: ScriptletEintrag[]): void {
  /*
   * Der Lauscher unten wird EINMAL JE SEITE gesetzt, die Kennung entstand bis
   * zum 08.09.2026 JE AUFRUF. Auf einem Host, den zwei Listen kennen, laeuft
   * der Loader zweimal: Der zweite Aufruf bekommt keinen Lauscher mehr, seine
   * Kennung kennt der vorhandene nicht -- und sein Abbruch stand als
   * `Uncaught ReferenceError: AdSilence-Abbruch-...` in der Konsole der Seite.
   * Also genau das Merkmal, gegen das der Kopf dieser Datei geschrieben ist.
   * GEZAEHLT ueber die gebauten Karten: 106 Hosts bekommen Eintraege aus mehr
   * als einer Liste.
   *
   * Der Lauscher vergleicht deshalb den festen VORSATZ, nicht die ganze
   * Kennung. Der Zufallsteil bleibt fuer die Eindeutigkeit.
   */
  const VORSATZ = 'AdSilence-Abbruch-';
  const KENNUNG = VORSATZ + Math.random().toString(36).slice(2);
  const w = globalThis as unknown as Record<string, unknown>;

  // Pro Seite nur einmal je Eintrag, auch wenn zwei Listen dasselbe wollen.
  const MERKER = '__adsilenceScriptlets';
  const erledigt: Set<string> = (w[MERKER] as Set<string>) ?? new Set<string>();
  w[MERKER] = erledigt;

  // Hilfen

  function abbruch(): never {
    throw new ReferenceError(KENNUNG);
  }

  // Der Abbruchfehler soll nirgends als Fehler der Seite erscheinen.
  if (!erledigt.has('#lauscher')) {
    erledigt.add('#lauscher');
    try {
      globalThis.addEventListener(
        'error',
        (ev: ErrorEvent) => {
          const text = typeof ev.message === 'string' ? ev.message : '';
          const grund = ev.error as { message?: string } | undefined;
          const inGrund = grund !== undefined && grund !== null && typeof grund.message === 'string' && grund.message.indexOf(VORSATZ) !== -1;
          if (text.indexOf(VORSATZ) !== -1 || inGrund) {
            ev.stopImmediatePropagation();
            ev.preventDefault();
          }
        },
        true,
      );
    } catch {
      // Ohne Lauscher laeuft alles weiter; nur die Konsole ist dann lauter.
    }
  }

  /** Wert eines set-constant-Arguments. */
  function konstante(text: string): unknown {
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text === 'null') return null;
    if (text === 'undefined' || text === '') return undefined;
    if (text === 'noopFunc') return function () {};
    if (text === 'trueFunc') return function () { return true; };
    if (text === 'falseFunc') return function () { return false; };
    if (text === 'emptyArr') return [];
    if (text === 'emptyObj') return {};
    if (text === 'noopPromiseResolve') return function () { return Promise.resolve(); };
    if (/^-?\d+$/.test(text)) {
      const zahl = parseInt(text, 10);
      return Math.abs(zahl) <= 32767 ? zahl : undefined;
    }
    if (text.length <= 100) return text;
    return undefined;
  }

  /**
   * Faengt Lesen und/oder Schreiben auf `pfad` (z. B. `a.b.c`) ab. Fehlt ein
   * Zwischenglied, wird ein Setter gelegt, der die Falle nachtraeglich setzt,
   * sobald das Glied entsteht. `beiLesen`/`beiSchreiben` sind die Fallen.
   */
  function fallen(pfad: string, beiLesen: ((aktuell: unknown) => unknown) | null, beiSchreiben: ((v: unknown) => unknown) | null): void {
    const teile = pfad.split('.');
    function anlegen(wurzel: Record<string, unknown>, ab: number): void {
      const name = teile[ab]!;
      const letztes = ab === teile.length - 1;
      if (!letztes) {
        const vorhanden = wurzel[name];
        if (vorhanden !== undefined && vorhanden !== null && (typeof vorhanden === 'object' || typeof vorhanden === 'function')) {
          anlegen(vorhanden as Record<string, unknown>, ab + 1);
          return;
        }
        // Noch nicht da: warten, bis jemand es setzt.
        let wert: unknown = vorhanden;
        Object.defineProperty(wurzel, name, {
          configurable: true,
          enumerable: true,
          get() { return wert; },
          set(neu: unknown) {
            wert = neu;
            if (neu !== null && (typeof neu === 'object' || typeof neu === 'function')) anlegen(neu as Record<string, unknown>, ab + 1);
          },
        });
        return;
      }
      const beschreibung = Object.getOwnPropertyDescriptor(wurzel, name);
      if (beschreibung && beschreibung.configurable === false) return;
      let wert: unknown = wurzel[name];
      Object.defineProperty(wurzel, name, {
        configurable: true,
        enumerable: beschreibung ? beschreibung.enumerable !== false : true,
        get() { return beiLesen ? beiLesen(wert) : wert; },
        set(neu: unknown) { wert = beiSchreiben ? beiSchreiben(neu) : neu; },
      });
    }
    anlegen(w, 0);
  }

  /** Zeigt der Text (Aufrufer/Callback) das Muster? Leer heisst „immer". */
  function passt(text: string, muster: string): boolean {
    if (!muster) return true;
    if (muster.length > 2 && muster.charAt(0) === '/' && muster.charAt(muster.length - 1) === '/') {
      try { return new RegExp(muster.slice(1, -1)).test(text); } catch { return false; }
    }
    return text.indexOf(muster) !== -1;
  }

  function verneint(muster: string): { muster: string; negiert: boolean } {
    return muster.charAt(0) === '!' ? { muster: muster.slice(1), negiert: true } : { muster, negiert: false };
  }

  function alsText(x: unknown): string {
    try { return String(x); } catch { return ''; }
  }

  /** Umhuellt window.setTimeout/setInterval: passt der Aufruf, faellt er aus. */
  function timerFalle(name: 'setTimeout' | 'setInterval', muster: string, verzoegerung: string): void {
    const original = w[name] as (...a: unknown[]) => number;
    if (typeof original !== 'function') return;
    const m = verneint(muster);
    const soll = verzoegerung ? parseInt(verzoegerung, 10) : NaN;
    w[name] = function (this: unknown, cb: unknown, ms: unknown, ...rest: unknown[]) {
      const textTrifft = passt(alsText(cb), m.muster) !== m.negiert;
      const zeitTrifft = Number.isNaN(soll) || Number(ms) === soll;
      if (textTrifft && zeitTrifft) {
        // Ein Timer, der nie feuert, aber eine gueltige Kennung hat.
        return original.call(this, function () {}, 2147483647);
      }
      return original.call(this, cb, ms, ...rest);
    };
  }

  /**
   * Entfernt `pfad` aus `obj`. Gibt zurueck, ob sich etwas geaendert hat.
   *
   * `[]` heisst „jedes Element", `*` „jeder Schluessel", und `[-]` (uBlock
   * Origin) heisst: das ELEMENT selbst aus dem Array nehmen, wenn der Rest des
   * Pfads darin steht. YouTube-Regeln schreiben so
   * `entries.[-].command.reelWatchEndpoint.adClientParams.isAd` — ein Kurzvideo,
   * das Werbung ist, faellt als Ganzes aus der Liste. Bis zum 26.09.2026 las
   * diese Funktion `[-]` als Feldnamen, und die Regel lief ins Leere.
   */
  function loesche(obj: unknown, pfad: string): boolean {
    const teile = pfad.split('.');
    let geaendert = false;
    function ab(o: unknown, i: number): void {
      if (o === null || typeof o !== 'object') return;
      const name = teile[i]!;
      if (name === '[-]' && Array.isArray(o)) {
        const rest = teile.slice(i + 1).join('.');
        for (let k = o.length - 1; k >= 0; k -= 1) {
          if (rest === '' || hatPfad(o[k], rest)) { o.splice(k, 1); geaendert = true; }
        }
        return;
      }
      if (i === teile.length - 1) {
        if (name === '[]' && Array.isArray(o)) { if (o.length) geaendert = true; o.length = 0; return; }
        if (Object.prototype.hasOwnProperty.call(o, name)) geaendert = true;
        delete (o as Record<string, unknown>)[name];
        return;
      }
      if (name === '[]' && Array.isArray(o)) { for (const e of o) ab(e, i + 1); return; }
      if (name === '*') { for (const k of Object.keys(o)) ab((o as Record<string, unknown>)[k], i + 1); return; }
      ab((o as Record<string, unknown>)[name], i + 1);
    }
    ab(obj, 0);
    return geaendert;
  }

  function hatPfad(obj: unknown, pfad: string): boolean {
    let o: unknown = obj;
    for (const name of pfad.split('.')) {
      if (o === null || typeof o !== 'object' || !(name in (o as object))) return false;
      o = (o as Record<string, unknown>)[name];
    }
    return true;
  }

  /**
   * Zerlegt `url:/muster/ method:POST` in Paare. Ein blosses Wort meint die
   * Adresse, `*` heisst „egal". Der Doppelpunkt in `https://` trennt nicht -
   * sonst waere `https` ein Feldname. Ein Ausdruck, der als `/.../` beginnt
   * und endet, bleibt am Stueck: Regeln aus den Listen sind fast immer genau
   * das, und ein Leerzeichen darin gehoert zum Ausdruck.
   */
  function eigenschaften(text: string): { feld: string; muster: string }[] {
    if (text.length > 2 && text.charAt(0) === '/' && text.charAt(text.length - 1) === '/') {
      return [{ feld: 'url', muster: text }];
    }
    const paare: { feld: string; muster: string }[] = [];
    for (const teil of text.split(/\s+/)) {
      if (!teil) continue;
      const i = teil.indexOf(':');
      const feld = i > 0 ? teil.slice(0, i) : '';
      if (feld && /^[a-zA-Z]+$/.test(feld) && teil.slice(i + 1, i + 3) !== '//') {
        paare.push({ feld, muster: teil.slice(i + 1) });
      } else {
        paare.push({ feld: 'url', muster: teil === '*' ? '' : teil });
      }
    }
    return paare;
  }

  /** Trifft die Anfrage ALLE Paare? Ohne Paar: nein - sonst fiele jede aus. */
  function trifftAnfrage(paare: { feld: string; muster: string }[], werte: Record<string, string>): boolean {
    if (paare.length === 0) return false;
    for (const paar of paare) {
      const m = verneint(paar.muster);
      if (passt(werte[paar.feld] ?? '', m.muster) === m.negiert) return false;
    }
    return true;
  }

  /** Der vorgetaeuschte Rumpf: leer, `{}` oder `[]`. */
  function rumpfVon(text: string | undefined): string {
    if (text === undefined || text === '' || text === 'emptyStr') return '';
    if (text === 'emptyObj') return '{}';
    if (text === 'emptyArr') return '[]';
    return text;
  }

  /**
   * Eine Antwort, die aussieht wie eine geglueckte, mit leerem Inhalt.
   * Wichtig ist der Status 200: Ein Detektor prueft meist nicht den Inhalt,
   * sondern OB die Anfrage durchkam. Ein Fehler waere sein Beweis.
   */
  function bauAntwort(rumpf: string, adresse: string): unknown {
    const Antwort = w.Response as (new (a: string, b: unknown) => unknown) | undefined;
    if (typeof Antwort === 'function') {
      try {
        const r = new Antwort(rumpf, { status: 200, statusText: 'OK' });
        try { Object.defineProperty(r as object, 'url', { configurable: true, value: adresse }); } catch { /* fest */ }
        return r;
      } catch { /* kein Response in diesem Fenster */ }
    }
    return {
      ok: true, status: 200, statusText: 'OK', url: adresse, type: 'basic', redirected: false,
      headers: { get: function () { return null; }, has: function () { return false; } },
      text: function () { return Promise.resolve(rumpf); },
      json: function () {
        try { return Promise.resolve(JSON.parse(rumpf === '' ? '{}' : rumpf)); } catch { return Promise.resolve({}); }
      },
      arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(0)); },
      clone: function () { return bauAntwort(rumpf, adresse); },
    };
  }

  /**
   * Der Aufrufstapel ohne unsere eigenen Zeilen. Sie muessen weg: Sonst
   * traefe ein Muster wie `inject` auf unseren eigenen Dateinamen, und die
   * Falle schnappte bei jedem Lesezugriff zu.
   */
  function stapel(): string {
    let text = '';
    try { text = alsText(new Error().stack); } catch { return ''; }
    const zeilen: string[] = [];
    for (const zeile of text.split('\n')) {
      if (zeile.indexOf('-extension://') !== -1) continue;
      zeilen.push(zeile);
    }
    return zeilen.join('\n');
  }

  /**
   * BlockAdBlock und FuckAdBlock sind dieselbe Bibliothek unter zwei Namen.
   * Sie meldet ueber `onDetected`, wenn sie einen Blocker sieht. Die Attrappe
   * kennt dieselben Methoden, meldet aber ausschliesslich „nichts gefunden" -
   * und zwar von selbst, sobald jemand einen Rueckruf dafuer hinterlegt.
   *
   * GRENZE, ehrlich benannt: Die beiden Namen liegen als Zugriffsfalle, die
   * Schreibversuche verschluckt. Eine Seite, die die echte Bibliothek als
   * `function BlockAdBlock() {}` auf oberster Ebene deklariert, ersetzt uns
   * trotzdem - eine Funktionsdeklaration schreibt eine aenderbare Eigenschaft
   * neu. Der verbreitete Weg ist `window.blockAdBlock = ...`, und den faengt
   * die Falle.
   */
  function babFalle(gross: string, klein: string): void {
    const wartend: Array<() => void> = [];
    let geplant = false;
    function melde(): void {
      const jetzt = wartend.splice(0, wartend.length);
      for (const cb of jetzt) {
        try { cb(); } catch { /* der Rueckruf der Seite ist nicht unsere Sache */ }
      }
    }
    function plane(): void {
      if (geplant) return;
      geplant = true;
      globalThis.setTimeout(function () { geplant = false; melde(); }, 1);
    }
    const attrappe: Record<string, unknown> = {};
    function selbst(): unknown { return attrappe; }
    function merke(cb: unknown): unknown {
      if (typeof cb === 'function') { wartend.push(cb as () => void); plane(); }
      return attrappe;
    }
    attrappe.setOption = selbst;
    attrappe.setOptions = selbst;
    attrappe.clearEvent = selbst;
    attrappe.emitEvent = function () { melde(); return attrappe; };
    // `on(true, cb)` ist der Erkennungsfall - der bleibt stumm.
    attrappe.on = function (erkannt: unknown, cb: unknown) { return erkannt ? attrappe : merke(cb); };
    attrappe.onDetected = selbst;
    attrappe.onNotDetected = function (cb: unknown) { return merke(cb); };
    attrappe.check = function () { melde(); return true; };
    const bau = function () { return attrappe; };
    (bau as unknown as Record<string, unknown>).prototype = attrappe;
    fallen(gross, () => bau, () => bau);
    fallen(klein, () => attrappe, () => attrappe);
  }

  // Die Scriptlets


  /*
   * ── Hilfen fuer die Scriptlets, die Antworten und Seitenskripte umschreiben ─
   * Nachgebaut nach uBlock Origin (GPL-3.0). Keine DOM-Typen: Diese Datei wird
   * auch fuer den Service Worker uebersetzt, und der kennt `Node` nicht.
   */

  /** Das unberuehrte `JSON.parse`, festgehalten beim ERSTEN Lauf auf der Seite. */
  const PARSE_ROH: (t: string) => unknown = (() => {
    const ablage = '__adsilenceJsonParse';
    if (typeof w[ablage] !== 'function') w[ablage] = (w.JSON as { parse: (t: string) => unknown }).parse;
    return w[ablage] as (t: string) => unknown;
  })();

  /** uBlocks `patternToRegex`: `/…/flags` als Ausdruck, sonst woertlich. */
  function regexAus(text: string, flags?: string, ganz = false): RegExp {
    if (text === '') return /^/;
    const m = /^\/(.+)\/([gimsu]*)$/.exec(text);
    if (m) {
      try { return new RegExp(m[1]!, m[2] || undefined); } catch { return /^/; }
    }
    const woertlich = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(ganz ? '^' + woertlich + '$' : woertlich, flags);
  }

  /** Paare hinter den festen Argumenten: `propsToMatch, /player?, sedCount, 1`. */
  function zusatz(rest: string[]): Record<string, string> {
    const aus: Record<string, string> = {};
    for (let i = 0; i + 1 < rest.length; i += 2) aus[rest[i]!] = rest[i + 1]!;
    return aus;
  }

  /** Leeres `propsToMatch` heisst „jede Anfrage" (uBlock), nicht „keine". */
  function trifftProps(props: string, werte: Record<string, string>): boolean {
    if (props === '') return true;
    return trifftAnfrage(eigenschaften(props), werte);
  }

  function fetchWerte(a: unknown[]): Record<string, string> {
    const werte: Record<string, string> = { url: '', method: 'GET' };
    const quelle = a[0];
    const optionen = a[1] as { method?: unknown } | null | undefined;
    if (quelle !== null && typeof quelle === 'object' && 'url' in (quelle as object)) {
      werte['url'] = alsText((quelle as { url: unknown }).url);
      const m = (quelle as { method?: unknown }).method;
      if (m) werte['method'] = alsText(m);
    } else {
      werte['url'] = alsText(quelle);
    }
    if (optionen && typeof optionen === 'object' && optionen.method) werte['method'] = alsText(optionen.method);
    return werte;
  }

  type AntwortArt = {
    clone?: () => { text: () => Promise<string> };
    status?: number; statusText?: string; headers?: unknown;
    ok?: boolean; redirected?: boolean; type?: string; url?: string;
  };

  /** `fetch` so umhuellen, dass `aendere` den Text jeder passenden Antwort sieht. */
  function umschreibeFetch(props: string, aendere: (text: string) => string | null): void {
    const alt = w.fetch as ((...a: unknown[]) => Promise<unknown>) | undefined;
    const Antwort = w.Response as (new (b: string, i: unknown) => object) | undefined;
    if (typeof alt !== 'function' || typeof Antwort !== 'function') return;
    w.fetch = new Proxy(alt, {
      apply(f, dies, a: unknown[]) {
        const versprochen = Reflect.apply(f, dies, a) as Promise<unknown>;
        let werte: Record<string, string>;
        try { werte = fetchWerte(a); } catch { return versprochen; }
        if (!trifftProps(props, werte)) return versprochen;
        return versprochen.then((vorher) => {
          const v = vorher as AntwortArt;
          if (!v || typeof v.clone !== 'function') return vorher;
          let kopie: { text: () => Promise<string> };
          try { kopie = v.clone(); } catch { return vorher; }
          return kopie.text().then((text) => {
            let neu: string | null = null;
            try { neu = aendere(text); } catch { neu = null; }
            if (neu === null) return vorher;
            const n = new Antwort(neu, { status: v.status, statusText: v.statusText, headers: v.headers });
            try {
              Object.defineProperties(n, {
                ok: { value: v.ok }, redirected: { value: v.redirected }, type: { value: v.type }, url: { value: v.url },
              });
            } catch { /* eingefroren */ }
            return n;
          }, () => vorher);
        });
      },
    });
  }

  /**
   * `XMLHttpRequest` so umhuellen, dass passende Antworten beim LESEN
   * umgeschrieben werden. Ein Text geht an `aendereText`, ein fertig
   * geparstes Objekt (`responseType = 'json'`) an `aendereObjekt`.
   */
  function umschreibeXhr(
    props: string,
    aendereText: (t: string) => string | null,
    aendereObjekt?: (o: unknown) => boolean,
  ): void {
    const Basis = w.XMLHttpRequest as { new (): XMLHttpRequest; prototype: XMLHttpRequest } | undefined;
    if (typeof Basis !== 'function') return;
    type Merk = { laenge?: number; antwort?: unknown; fertig?: boolean };
    const merk = new WeakMap<object, Merk>();
    w.XMLHttpRequest = class extends Basis {
      open(methode: string, adresse: string | URL, ...rest: unknown[]): void {
        try {
          if (trifftProps(props, { url: alsText(adresse), method: alsText(methode) })) merk.set(this, {});
          else merk.delete(this);
        } catch { /* ungewoehnliche Adresse */ }
        (Basis.prototype.open as (...a: unknown[]) => void).call(this, methode, adresse, ...rest);
      }
      get response(): unknown {
        const innen = super.response as unknown;
        const eintrag = merk.get(this);
        if (!eintrag) return innen;
        const laenge = typeof innen === 'string' ? innen.length : undefined;
        if (eintrag.laenge !== laenge) { eintrag.fertig = false; eintrag.laenge = laenge; }
        if (eintrag.fertig) return eintrag.antwort;
        let aus: unknown = innen;
        try {
          if (typeof innen === 'string') {
            const neu = aendereText(innen);
            if (neu !== null) aus = neu;
          } else if (innen !== null && typeof innen === 'object' && aendereObjekt) {
            aendereObjekt(innen);
          }
        } catch { /* Antwort bleibt, wie sie ist */ }
        // Nur FERTIGE Antworten merken: solange geladen wird, waechst der Text.
        if (this.readyState === 4) { eintrag.antwort = aus; eintrag.fertig = true; }
        return aus;
      }
      get responseText(): string {
        const r = this.response;
        return typeof r === 'string' ? r : super.responseText;
      }
    };
  }

  /** JSON-Text beschneiden; `null`, wenn es nichts zu tun gab. */
  function beschneideText(text: string, pfade: string[], pflicht: string[]): string | null {
    const erstes = text.trimStart().charAt(0);
    if (erstes !== '{' && erstes !== '[') return null;
    let daten: unknown;
    try { daten = PARSE_ROH(text); } catch { return null; }
    if (pflicht.length && !pflicht.every((p) => hatPfad(daten, p))) return null;
    let geaendert = false;
    for (const p of pfade) if (loesche(daten, p)) geaendert = true;
    return geaendert ? JSON.stringify(daten) : null;
  }

  type Knoten = { nodeName: string; textContent: unknown; content?: Knoten };
  type Beobachtung = { addedNodes: ArrayLike<Knoten> };

  /**
   * uBlocks `replace-node-text`: Den Text passender Knoten (meist `script`)
   * umschreiben, BEVOR der Browser ihn ausfuehrt — ueber einen
   * MutationObserver ab `document_start`. Standardmaessig bis
   * `DOMContentLoaded`; `stay` haelt ihn offen, `quitAfter` verlaengert.
   */
  function ersetzeKnotentext(knoten: string, musterText: string, ersatz: string, rest: string[]): void {
    const doc = w.document as {
      documentElement: Knoten | null; readyState: string; currentScript: unknown;
      createTreeWalker: (wurzel: unknown, was: number) => { nextNode: () => Knoten | null };
      addEventListener: (typ: string, f: () => void, o?: unknown) => void;
    } | undefined;
    if (!doc) return;
    const knotenRe = regexAus(knoten, 'i', true);
    const muster = regexAus(musterText, 'gms');
    const extra = zusatz(rest);
    const bedingung = extra['includes'] || extra['condition'];
    const nur = bedingung ? regexAus(bedingung, 'ms') : null;
    const ohne = extra['excludes'] ? regexAus(extra['excludes'], 'ms') : null;
    let uebrig = extra['sedCount'] ? parseInt(extra['sedCount'], 10) : Number.MAX_SAFE_INTEGER;
    if (isNaN(uebrig)) uebrig = Number.MAX_SAFE_INTEGER;
    const bleibt = Boolean(extra['stay']);
    const spaeter = extra['quitAfter'] ? parseInt(extra['quitAfter'], 10) || 0 : 0;

    // Trusted Types: YouTube verlangt fuer `script.textContent` ein
    // TrustedScript. uBlock legt dafuer eine eigene Richtlinie an; wir auch.
    let alsSkript = (t: string): unknown => t;
    try {
      const tt = w.trustedTypes as {
        getPropertyType?: (a: string, b: string) => string | null;
        createPolicy: (n: string, r: { createScript: (t: string) => string }) => { createScript: (t: string) => unknown };
      } | undefined;
      if (tt && typeof tt.getPropertyType === 'function' && tt.getPropertyType('script', 'textContent') === 'TrustedScript') {
        const richtlinie = tt.createPolicy('adsilence' + Math.random().toString(36).slice(2), { createScript: (t) => t });
        alsSkript = (t) => richtlinie.createScript(t);
      }
    } catch { /* ohne Trusted Types */ }

    const behandle = (n: Knoten): void => {
      const vorher = alsText(n.textContent ?? '');
      if (nur) { nur.lastIndex = 0; if (!nur.test(vorher)) return; }
      if (ohne) { ohne.lastIndex = 0; if (ohne.test(vorher)) return; }
      muster.lastIndex = 0;
      if (!muster.test(vorher)) return;
      muster.lastIndex = 0;
      const nachher = musterText !== '' ? vorher.replace(muster, ersatz) : ersatz;
      n.textContent = n.nodeName === 'SCRIPT' ? alsSkript(nachher) : nachher;
      uebrig -= 1;
    };
    const baum = (wurzel: Knoten): void => {
      const gang = doc.createTreeWalker(wurzel, 1 | 4);
      const aktuell = doc.currentScript;
      for (;;) {
        const n = gang.nextNode();
        if (n === null) break;
        if (n === aktuell) continue;
        if (knotenRe.test(n.nodeName)) behandle(n);
        else if (n.nodeName === 'TEMPLATE' && n.content) baum(n.content);
        else continue;
        if (uebrig <= 0) break;
      }
    };
    try { if (doc.documentElement) baum(doc.documentElement); } catch { /* weiter mit dem Beobachter */ }
    if (uebrig <= 0 && !bleibt) return;

    const Beobachter = w.MutationObserver as (new (cb: (l: Beobachtung[]) => void) => {
      observe: (z: unknown, o: unknown) => void; disconnect: () => void; takeRecords: () => Beobachtung[];
    }) | undefined;
    if (typeof Beobachter !== 'function') return;
    const verarbeite = (liste: Beobachtung[]): void => {
      for (const m of liste) {
        for (const n of Array.from(m.addedNodes)) {
          if (knotenRe.test(n.nodeName)) behandle(n);
          else if (n.nodeName === 'TEMPLATE' && n.content) baum(n.content);
          else continue;
          if (uebrig <= 0 && !bleibt) { beobachter.disconnect(); return; }
        }
      }
    };
    const beobachter = new Beobachter(verarbeite);
    const halt = (): void => {
      try { verarbeite(beobachter.takeRecords()); beobachter.disconnect(); } catch { /* schon zu */ }
    };
    beobachter.observe(doc, { childList: true, subtree: true });
    if (bleibt) return;
    const beiInteraktiv = (): void => { if (spaeter === 0) halt(); else globalThis.setTimeout(halt, spaeter); };
    if (doc.readyState !== 'loading') beiInteraktiv();
    else doc.addEventListener('DOMContentLoaded', beiInteraktiv, { once: true });
  }

  const bibliothek: Record<string, (args: string[]) => void> = {
    'abort-on-property-read'(args) {
      if (!args[0]) return;
      fallen(args[0], abbruch, null);
    },
    'abort-on-property-write'(args) {
      if (!args[0]) return;
      fallen(args[0], null, abbruch);
    },
    'abort-current-script'(args) {
      const pfad = args[0];
      if (!pfad) return;
      const muster = args[1] ?? '';
      const pruefe = () => {
        const doc = w.document as { currentScript?: { textContent?: string | null } | null } | undefined;
        const skript = doc ? doc.currentScript : null;
        const text = skript && typeof skript.textContent === 'string' ? skript.textContent : '';
        if (skript && passt(text, muster)) abbruch();
      };
      // Der Leser gibt den EIGENEN Wert zurueck, nicht `undefined`.
      //
      // GEMESSEN am 09.09.2026 an vidmoly.biz: Mit `undefined` war
      // `document.createElement` fuer die GANZE Seite weg, sobald irgendeine
      // Regel `acs` auf diese Eigenschaft legte - der Videoplayer lud nie
      // (`window.jwplayer === undefined`, kein `<video>` im Dokument). Das
      // Scriptlet soll ein bestimmtes SKRIPT abbrechen, nicht die
      // Eigenschaft stilllegen; `abbruch()` in `pruefe()` erledigt das.
      fallen(pfad, (aktuell) => { pruefe(); return aktuell; }, (v) => { pruefe(); return v; });
    },
    'set-constant'(args) {
      const pfad = args[0];
      if (!pfad) return;
      const wert = konstante(args[1] ?? '');
      fallen(pfad, () => wert, () => wert);
    },
    'no-setTimeout-if'(args) { timerFalle('setTimeout', args[0] ?? '', args[1] ?? ''); },
    'no-setInterval-if'(args) { timerFalle('setInterval', args[0] ?? '', args[1] ?? ''); },
    'json-prune'(args) {
      const pfade = (args[0] ?? '').split(/\s+/).filter(Boolean);
      const pflicht = (args[1] ?? '').split(/\s+/).filter(Boolean);
      if (pfade.length === 0) return;
      const beschneide = (wert: unknown): unknown => {
        if (pflicht.length && !pflicht.every((p) => hatPfad(wert, p))) return wert;
        for (const p of pfade) loesche(wert, p);
        return wert;
      };
      const JSONx = w.JSON as { parse: (...a: unknown[]) => unknown };
      const parseAlt = JSONx.parse;
      JSONx.parse = function (this: unknown, ...a: unknown[]) { return beschneide(parseAlt.apply(this, a)); };
      const Antwort = w.Response as { prototype?: { json?: (...a: unknown[]) => Promise<unknown> } } | undefined;
      if (Antwort && Antwort.prototype && typeof Antwort.prototype.json === 'function') {
        const jsonAlt = Antwort.prototype.json;
        Antwort.prototype.json = function (this: unknown, ...a: unknown[]) {
          return jsonAlt.apply(this, a).then(beschneide);
        };
      }
      // Der dritte Weg, auf dem JSON in eine Seite kommt: XMLHttpRequest.
      // `responseText` und `response` gehen an `JSON.parse` VORBEI, wenn die
      // Seite `responseType = 'json'` setzt - dann parst der Browser selbst.
      const XHR = w.XMLHttpRequest as { prototype?: object } | undefined;
      if (XHR && XHR.prototype) {
        for (const feld of ['responseText', 'response']) {
          const b = Object.getOwnPropertyDescriptor(XHR.prototype, feld);
          if (!b || typeof b.get !== 'function' || b.configurable === false) continue;
          const leseAlt = b.get;
          Object.defineProperty(XHR.prototype, feld, {
            configurable: true,
            enumerable: b.enumerable !== false,
            get(this: unknown) {
              const roh = leseAlt.call(this);
              if (roh !== null && typeof roh === 'object') return beschneide(roh);
              if (typeof roh !== 'string' || roh.length === 0) return roh;
              const erstes = roh.charAt(0);
              if (erstes !== '{' && erstes !== '[') return roh;
              try { return JSON.stringify(beschneide(JSON.parse(roh))); } catch { return roh; }
            },
          });
        }
      }
    },
    'prevent-addEventListener'(args) {
      const typMuster = args[0] ?? '';
      const handlerMuster = args[1] ?? '';
      const Ziel = w.EventTarget as { prototype?: { addEventListener?: (...a: unknown[]) => void } } | undefined;
      if (!Ziel || !Ziel.prototype || typeof Ziel.prototype.addEventListener !== 'function') return;
      const alt = Ziel.prototype.addEventListener;
      Ziel.prototype.addEventListener = function (this: unknown, typ: unknown, handler: unknown, ...rest: unknown[]) {
        if (passt(alsText(typ), typMuster) && passt(alsText(handler), handlerMuster)) return;
        return alt.call(this, typ, handler, ...rest);
      };
    },
    nowebrtc() {
      // Eine Verbindung, die nie zustande kommt, aber jede Methode kennt:
      // Aufrufer laufen ins Leere statt in einen Fehler.
      const nichts = function () {};
      const attrappe = function () {
        return {
          createDataChannel: function () { return { close: nichts, send: nichts, addEventListener: nichts }; },
          createOffer: function () { return Promise.resolve({}); },
          createAnswer: function () { return Promise.resolve({}); },
          setLocalDescription: function () { return Promise.resolve(); },
          setRemoteDescription: function () { return Promise.resolve(); },
          addIceCandidate: function () { return Promise.resolve(); },
          addEventListener: nichts,
          removeEventListener: nichts,
          close: nichts,
        };
      };
      for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection']) {
        if (w[name] !== undefined) {
          try { Object.defineProperty(w, name, { configurable: true, writable: true, value: attrappe }); } catch { /* unveraenderlich */ }
        }
      }
    },
    noeval() {
      try { Object.defineProperty(w, 'eval', { configurable: true, writable: true, value: function () { return undefined; } }); } catch { /* unveraenderlich */ }
    },
    nobab() { babFalle('BlockAdBlock', 'blockAdBlock'); },
    nofab() { babFalle('FuckAdBlock', 'fuckAdBlock'); },
    'abort-on-stack-trace'(args) {
      const pfad = args[0];
      const muster = args[1] ?? '';
      // Ohne Muster waere es `abort-on-property-read` - und zwar fuer JEDEN
      // Leser. Gemessen an den Listen tragen alle 33 Regeln ein Muster.
      if (!pfad || !muster) return;
      fallen(pfad, (aktuell) => {
        if (passt(stapel(), muster)) abbruch();
        return aktuell;
      }, null);
    },
    'no-xhr-if'(args) {
      const paare = eigenschaften(args[0] ?? '');
      if (paare.length === 0) return;
      const rumpf = rumpfVon(args[1]);
      const XHR = w.XMLHttpRequest as { prototype?: Record<string, unknown> } | undefined;
      const bau = XHR && XHR.prototype ? XHR.prototype : null;
      if (!bau) return;
      const oeffneAlt = bau.open as ((...a: unknown[]) => unknown) | undefined;
      const sendeAlt = bau.send as ((...a: unknown[]) => unknown) | undefined;
      if (typeof oeffneAlt !== 'function' || typeof sendeAlt !== 'function') return;
      const MERK = '__adsilenceAnfrage';
      bau.open = function (this: Record<string, unknown>, methode: unknown, adresse: unknown, ...rest: unknown[]) {
        this[MERK] = { method: alsText(methode), url: alsText(adresse) };
        return oeffneAlt.call(this, methode, adresse, ...rest);
      };
      bau.send = function (this: Record<string, unknown>, ...rest: unknown[]) {
        const werte = this[MERK] as Record<string, string> | undefined;
        if (!werte || !trifftAnfrage(paare, werte)) return sendeAlt.apply(this, rest);
        // Eigene Felder verdecken die Getter des Prototyps: Die Anfrage sieht
        // fuer den Aufrufer geglueckt aus, ohne dass sie je gestellt wurde.
        const setze = (name: string, wert: unknown): void => {
          try { Object.defineProperty(this, name, { configurable: true, value: wert }); } catch { /* fest */ }
        };
        setze('readyState', 4);
        setze('status', 200);
        setze('statusText', 'OK');
        setze('responseURL', werte.url ?? '');
        setze('responseText', rumpf);
        setze('response', rumpf);
        const ziel = this as unknown as { dispatchEvent?: (e: unknown) => boolean };
        // Nicht im selben Zug: Eine echte Anfrage antwortet auch nicht sofort,
        // und der Aufrufer haengt seine Lauscher erst nach `send()` an.
        globalThis.setTimeout(function () {
          for (const typ of ['readystatechange', 'load', 'loadend']) {
            try { if (ziel.dispatchEvent) ziel.dispatchEvent(new Event(typ)); } catch { /* egal */ }
          }
        }, 1);
        return undefined;
      };
    },
    'no-fetch-if'(args) {
      const paare = eigenschaften(args[0] ?? '');
      if (paare.length === 0) return;
      const rumpf = rumpfVon(args[1]);
      const holeAlt = w.fetch as ((...a: unknown[]) => Promise<unknown>) | undefined;
      if (typeof holeAlt !== 'function') return;
      w.fetch = function (this: unknown, eingabe: unknown, ...rest: unknown[]) {
        let adresse = '';
        let methode = 'GET';
        try {
          if (typeof eingabe === 'string') {
            adresse = eingabe;
          } else if (eingabe !== null && typeof eingabe === 'object') {
            const anfrage = eingabe as Record<string, unknown>;
            adresse = typeof anfrage.url === 'string' ? anfrage.url : alsText(eingabe);
            if (typeof anfrage.method === 'string') methode = anfrage.method;
          }
          const init = rest[0];
          if (init !== null && typeof init === 'object') {
            const m = (init as Record<string, unknown>).method;
            if (typeof m === 'string') methode = m;
          }
        } catch { /* dann eben ohne Angaben */ }
        if (trifftAnfrage(paare, { url: adresse, method: methode })) {
          return Promise.resolve(bauAntwort(rumpf, adresse));
        }
        return holeAlt.call(this, eingabe, ...rest);
      };
    },
    'remove-class'(args) {
      const klassen = (args[0] ?? '').split(/[\s,|]+/).filter(Boolean);
      if (klassen.length === 0) return;
      const wahl = args[1] ?? '';
      // `stay` heisst: dranbleiben. Sonst schaut der Beobachter nur so lange
      // zu, wie eine Seite zum Aufbau braucht - ein Laeufer, der eine Stunde
      // lang bei jeder DOM-Aenderung anspringt, kostet mehr als er bringt.
      const bleibt = (args[2] ?? '').indexOf('stay') !== -1;
      // Die Form des Dokuments steht hier ausgeschrieben statt als `Document`:
      // Diese Datei wird auch gegen die Worker-Umgebung geprueft, und die
      // kennt die DOM-Typen nicht. Gebraucht werden ohnehin nur vier Felder.
      type Dok = {
        querySelectorAll: (wahl: string) => ArrayLike<unknown>;
        getElementsByClassName: (klasse: string) => ArrayLike<unknown>;
        addEventListener: (typ: string, cb: () => void, erfassen?: boolean) => void;
        documentElement?: unknown;
      };
      type Knoten = { classList?: { remove: (klasse: string) => void } };
      const doc = w.document as Dok | undefined;
      if (!doc || typeof doc.querySelectorAll !== 'function') return;
      const raeume = (): void => {
        for (const klasse of klassen) {
          let liste: unknown[] = [];
          try {
            liste = Array.prototype.slice.call(
              wahl ? doc.querySelectorAll(wahl) : doc.getElementsByClassName(klasse),
            ) as unknown[];
          } catch { continue; }
          for (const el of liste) {
            const knoten = el as Knoten;
            try { if (knoten.classList) knoten.classList.remove(klasse); } catch { /* kein Element */ }
          }
        }
      };
      raeume();
      try { doc.addEventListener('DOMContentLoaded', raeume, true); } catch { /* egal */ }
      const Beobachter = w.MutationObserver as (new (cb: () => void) => { observe: (z: unknown, o: unknown) => void; disconnect: () => void }) | undefined;
      if (typeof Beobachter !== 'function') return;
      let laeuft = false;
      const beobachter = new Beobachter(function () {
        // Unser eigenes Entfernen loest den Beobachter erneut aus. Erst im
        // naechsten Zug raeumen, sonst dreht sich das im Kreis.
        if (laeuft) return;
        laeuft = true;
        globalThis.setTimeout(function () { laeuft = false; raeume(); }, 0);
      });
      const starte = (): void => {
        try {
          beobachter.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
        } catch { /* noch kein Dokument */ }
      };
      if (doc.documentElement) starte();
      else try { doc.addEventListener('DOMContentLoaded', starte, true); } catch { /* egal */ }
      if (!bleibt) globalThis.setTimeout(function () { try { beobachter.disconnect(); } catch { /* schon zu */ } }, 15000);
    },

    /*
     * ── Antworten umschreiben, BEVOR die Seite sie liest ────────────────────
     *
     * Nachgebaut nach uBlock Origin (GPL-3.0, wie AdSilence), weil YouTube
     * seit 2025 genau darauf antwortet: Ein Blocker, der die Werbeanfragen
     * abweist, die Werbeplaetze in der Player-Antwort aber stehen laesst, wird
     * erkannt — „Werbeblocker sind auf YouTube nicht erlaubt". GEMESSEN am
     * 26.09.2026: Die YouTube-Regeln aus uBlocks Schnellkorrekturen brauchten
     * sieben Scriptlets, die es hier nicht gab; unser Paket liess sie beim Bau
     * fallen. Diese hier kommen nur aus vertrauenswuerdigen Listen
     * (`brauchtVertrauen()` in src/engine/scriptlets.ts).
     */
    'trusted-replace-fetch-response'(args) {
      const roh = args[0] ?? '';
      if (roh === '') return;
      const muster = regexAus(roh === '*' ? '.*' : roh);
      const ersatz = args[1] ?? '';
      const props = args[2] ?? '';
      const extra = zusatz(args.slice(3));
      const nur = extra['includes'] ? regexAus(extra['includes']) : null;
      umschreibeFetch(props, (text) => {
        if (nur) { nur.lastIndex = 0; if (!nur.test(text)) return null; }
        muster.lastIndex = 0;
        const neu = text.replace(muster, ersatz);
        return neu === text ? null : neu;
      });
    },
    'trusted-replace-xhr-response'(args) {
      const roh = args[0] ?? '';
      if (roh === '') return;
      const muster = regexAus(roh === '*' ? '.*' : roh);
      const ersatz = args[1] ?? '';
      const props = args[2] ?? '';
      const extra = zusatz(args.slice(3));
      const nur = extra['includes'] ? regexAus(extra['includes']) : null;
      umschreibeXhr(props, (text) => {
        if (nur) { nur.lastIndex = 0; if (!nur.test(text)) return null; }
        muster.lastIndex = 0;
        const neu = text.replace(muster, ersatz);
        return neu === text ? null : neu;
      });
    },
    'json-prune-fetch-response'(args) {
      const pfade = (args[0] ?? '').split(/\s+/).filter(Boolean);
      const pflicht = (args[1] ?? '').split(/\s+/).filter(Boolean);
      const extra = zusatz(args.slice(2));
      if (pfade.length === 0) return;
      umschreibeFetch(extra['propsToMatch'] ?? '', (text) => beschneideText(text, pfade, pflicht));
    },
    'json-prune-xhr-response'(args) {
      const pfade = (args[0] ?? '').split(/\s+/).filter(Boolean);
      const pflicht = (args[1] ?? '').split(/\s+/).filter(Boolean);
      const extra = zusatz(args.slice(2));
      if (pfade.length === 0) return;
      umschreibeXhr(extra['propsToMatch'] ?? '', (text) => beschneideText(text, pfade, pflicht), (obj) => {
        if (pflicht.length && !pflicht.every((p) => hatPfad(obj, p))) return false;
        let geaendert = false;
        for (const p of pfade) if (loesche(obj, p)) geaendert = true;
        return geaendert;
      });
    },
    /*
     * Die Umgehung ueber einen leeren Rahmen: Eine Seite haengt ein
     * `about:blank`-iframe an und holt sich dort ein UNBERUEHRTES `fetch` oder
     * `JSON.parse` — an allen Scriptlets oben vorbei. Nach dem Anhaengen
     * bekommt der Rahmen deshalb unsere Fassung.
     */
    'trusted-prevent-dom-bypass'(args) {
      const methode = args[0] ?? '';
      const ziel = args[1] ?? '';
      if (methode === '') return;
      const kette = methode.split('.');
      const name = kette.pop()!;
      let traeger: unknown = w;
      for (const glied of kette) traeger = traeger == null ? undefined : (traeger as Record<string, unknown>)[glied];
      if (traeger == null) return;
      const t = traeger as Record<string, unknown>;
      const alt = t[name];
      if (typeof alt !== 'function') return;
      const Element = w.HTMLElement as (new () => unknown) | undefined;
      t[name] = new Proxy(alt as (...a: unknown[]) => unknown, {
        apply(f, dies, a: unknown[]) {
          const ergebnis = Reflect.apply(f, dies, a);
          for (const el of a) {
            try {
              if (!Element || !(el instanceof Element)) continue;
              const fenster = (el as { contentWindow?: unknown }).contentWindow as Record<string, unknown> | null | undefined;
              if (!fenster || alsText(fenster) !== '[object Window]') continue;
              const adresse = (fenster['location'] as { href?: string }).href;
              if (adresse !== 'about:blank' && adresse !== (w.location as { href?: string }).href) continue;
              if (ziel === '') {
                Object.defineProperty(el, 'contentWindow', { value: w });
                continue;
              }
              const glieder = ziel.split('.');
              const letztes = glieder.pop()!;
              let ich: Record<string, unknown> = w;
              let es: Record<string, unknown> = fenster;
              for (const g of glieder) { ich = ich[g] as Record<string, unknown>; es = es[g] as Record<string, unknown>; }
              es[letztes] = ich[letztes];
            } catch { /* fremder Rahmen: nicht unsere Sache */ }
          }
          return ergebnis;
        },
      });
    },
    /*
     * Timer beschleunigen: Wartet die Seite `verzoegerung` Millisekunden auf
     * einen Rueckruf, der zum Muster passt, wird die Wartezeit mit `faktor`
     * multipliziert (0,001 bis 50). uBlocks `nano-setTimeout-booster`.
     */
    'nano-setTimeout-booster'(args) {
      const muster = regexAus(args[0] ?? '');
      let verzoegerung = (args[1] ?? '') !== '*' ? parseInt(args[1] ?? '', 10) : -1;
      if (isNaN(verzoegerung) || !isFinite(verzoegerung)) verzoegerung = 1000;
      let faktor = parseFloat(args[2] ?? '');
      faktor = !isNaN(faktor) && isFinite(faktor) ? Math.min(Math.max(faktor, 0.001), 50) : 0.05;
      const alt = w.setTimeout as (...a: unknown[]) => unknown;
      if (typeof alt !== 'function') return;
      w.setTimeout = new Proxy(alt, {
        apply(f, dies, a: unknown[]) {
          try {
            if ((verzoegerung === -1 || a[1] === verzoegerung) && muster.test(alsText(a[0]))) {
              a[1] = (a[1] as number) * faktor;
            }
          } catch { /* unlesbarer Rueckruf */ }
          return Reflect.apply(f, dies, a);
        },
      });
    },
    'remove-node-text'(args) {
      ersetzeKnotentext(args[0] ?? '', '', '', ['includes', args[1] ?? '', ...args.slice(2)]);
    },
    'trusted-replace-node-text'(args) {
      ersetzeKnotentext(args[0] ?? '', args[1] ?? '', args[2] ?? '', args.slice(3));
    },
  };

  // Die Kuerzel aus uBlock Origin, damit Listen mit `##+js(aopr, ...)` gehen.
  const kuerzel: Record<string, string> = {
    aopr: 'abort-on-property-read',
    aopw: 'abort-on-property-write',
    acs: 'abort-current-script',
    set: 'set-constant',
    nostif: 'no-setTimeout-if',
    nosiif: 'no-setInterval-if',
    aeld: 'prevent-addEventListener',
    aost: 'abort-on-stack-trace',
    'prevent-xhr': 'no-xhr-if',
    'prevent-fetch': 'no-fetch-if',
    rc: 'remove-class',
    'nano-stb': 'nano-setTimeout-booster',
    rmnt: 'remove-node-text',
    rpnt: 'trusted-replace-node-text',
    'trusted-rpnt': 'trusted-replace-node-text',
    'replace-node-text': 'trusted-replace-node-text',
  };

  for (const eintrag of eintraege) {
    try {
      if (!eintrag || typeof eintrag.name !== 'string') continue;
      const name = (kuerzel[eintrag.name] ?? eintrag.name).replace(/\.js$/, '');
      const args = Array.isArray(eintrag.args) ? eintrag.args.map(alsText) : [];
      const schluessel = name + ' ' + args.join(' ');
      if (erledigt.has(schluessel)) continue;
      const fn = bibliothek[name];
      if (!fn) continue;
      erledigt.add(schluessel);
      fn(args);
    } catch {
      // Nie nach aussen: die Seite darf von einem fehlgeschlagenen Scriptlet
      // nichts merken.
    }
  }
}

/** Die Namen, die der Loader kennt; der Konverter (Engine) prueft dagegen. */
export const BEKANNTE_SCRIPTLETS = [
  'abort-on-property-read',
  'abort-on-property-write',
  'abort-current-script',
  'set-constant',
  'no-setTimeout-if',
  'no-setInterval-if',
  'json-prune',
  'prevent-addEventListener',
  'nowebrtc',
  'noeval',
  'nobab',
  'nofab',
  'abort-on-stack-trace',
  'no-xhr-if',
  'no-fetch-if',
  'remove-class',
  'trusted-replace-fetch-response',
  'trusted-replace-xhr-response',
  'json-prune-fetch-response',
  'json-prune-xhr-response',
  'trusted-prevent-dom-bypass',
  'nano-setTimeout-booster',
  'remove-node-text',
  'trusted-replace-node-text',
] as const;
