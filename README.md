# AdSilence — Quelltext der Erweiterung

Der vollstaendige Quelltext der AdSilence-Browsererweiterung, Version 1.0.3,
unter der **GNU GPL v3 oder spaeter** (siehe `extension/LICENSE`).

## Selber bauen

```bash
cd extension
npm ci
npm run build          # dist/chromium, dist/firefox, dist/safari
```

Die Filterlisten liegen als `extension/rules/*.json` mit im Baum — der Bau
braucht kein Netz und ist deshalb nachvollziehbar.

## Was hier NICHT liegt

Der Server hinter `adsilence.net` (Konten, Zahlung, Listenpflege) ist nicht
Teil dieses Repositorys und nicht Teil der Lizenz. Die Erweiterung laeuft ohne
ihn; ohne Konto blockt sie ab Werk.

- Website: https://adsilence.net
- Gebaute Staende: [chromium](../../../adsilence-chromium), [firefox](../../../adsilence-firefox)
