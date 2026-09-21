/*
 * Attrappe fuer `pagead2.googlesyndication.com/pagead/js/adsbygoogle.js`.
 *
 * Sie laedt keine Werbung. Sie sorgt nur dafuer, dass `window.adsbygoogle`
 * existiert und `push()` nichts tut: Seiten, die daran messen, ob ein
 * Blocker laeuft, finden ihre Schnittstelle vor. Genau so macht es uBO.
 */
(function () {
  'use strict';
  const w = window;
  const vorhanden = w.adsbygoogle;
  if (vorhanden && vorhanden.loaded === true) return;
  const liste = Array.isArray(vorhanden) ? vorhanden : [];
  liste.loaded = true;
  liste.push = function () { return 1; };
  w.adsbygoogle = liste;
})();
