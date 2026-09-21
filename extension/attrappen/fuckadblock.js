/*
 * Attrappe fuer FuckAdBlock/BlockAdBlock (3.x).
 *
 * Die Bibliothek meldet einer Seite, ob ein Blocker laeuft. Diese Fassung
 * meldet immer „keiner" und ruft den `onNotDetected`-Rueckruf auf.
 */
(function () {
  'use strict';
  function Attrappe() {
    this._options = { checkOnLoad: false, resetOnEnd: false };
    this._var = { onDetected: [], onNotDetected: [] };
  }
  Attrappe.prototype = {
    setOption: function (a, b) { if (typeof a === 'object') Object.assign(this._options, a); else this._options[a] = b; return this; },
    on: function (erkannt, rueckruf) { this._var[erkannt ? 'onDetected' : 'onNotDetected'].push(rueckruf); return this; },
    onDetected: function (r) { return this.on(true, r); },
    onNotDetected: function (r) { return this.on(false, r); },
    clearEvent: function () { this._var.onDetected = []; this._var.onNotDetected = []; return this; },
    check: function () { const r = this._var.onNotDetected; setTimeout(function () { r.forEach(function (f) { try { f(); } catch (e) { /* der Rueckruf der Seite, nicht unserer */ } }); }, 1); return true; },
    emitEvent: function () { return this.check(); },
  };
  const w = window;
  for (const name of ['FuckAdBlock', 'BlockAdBlock', 'SniffAdBlock']) {
    w[name] = Attrappe;
    w[name.charAt(0).toLowerCase() + name.slice(1)] = new Attrappe();
  }
})();
