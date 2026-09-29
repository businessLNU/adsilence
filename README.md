# AdSilence — free, open-source ad blocker for Chrome and Firefox (Manifest V3)

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](extension/LICENSE)
[![Chrome Web Store](https://img.shields.io/badge/Chrome-Web%20Store-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/aapplploeajcbogegjgnnfgapdjjmoin)
[![Firefox Add-ons](https://img.shields.io/badge/Firefox-Add--ons-FF7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/firefox/addon/adsilence/)

AdSilence is a free ad blocker, tracker blocker and cookie-banner blocker for Chrome, Firefox and every Chromium browser. It is built for **Manifest V3** from the ground up: it does **not** request the `webRequest` permission — the browser applies the blocking rules itself via `declarativeNetRequest`, so your browsing never passes through us.

This repository contains the complete source code of the browser extension under the GNU GPL v3.

## Features

**Free, no account needed**

- Blocks ads, pop-ups and pop-unders
- Blocks trackers and analytics — including disguised first-party trackers
- Blocks addresses that are currently distributing malware
- Hides cookie banners
- 32 filter lists (EasyList, EasyPrivacy, uBlock filters, URLhaus and 18 regional lists); the list for your browser language is switched on automatically
- Per-site exceptions with one click
- No "acceptable ads" whitelist — nobody can pay to get their ads through

**Premium (optional)**

- Fingerprint protection: your browser looks different on every website
- Automatic answers to cookie banners — reject or accept, your choice
- Warnings for look-alike addresses (phishing)

## Measured, not claimed

100 of 100 points on [adblock-tester.com](https://adblock-tester.com/) with factory settings (measured 5 September 2026, version 1.0.0, median of three runs). Full method, all versions and how to repeat it: [adsilence.net/en/adblocker-test](https://adsilence.net/en/adblocker-test)

## Install

- **Chrome, Brave, Opera, Vivaldi, Edge:** [Chrome Web Store](https://chromewebstore.google.com/detail/aapplploeajcbogegjgnnfgapdjjmoin) (Chrome 121+)
- **Firefox:** [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/adsilence/) (Firefox 140+, Android 142+)

## Build from source

Requires Node.js 22 or newer.

```bash
cd extension
npm ci
ADSILENCE_API=https://adsilence.net npm run build   # → dist/chromium, dist/firefox, dist/safari
```

The filter lists are committed in `extension/rules/` and `extension/kosmetik/`, so the build needs no network access besides `npm ci` and is reproducible.

## Privacy

No telemetry. The only connections to adsilence.net are the daily filter-list update, the licence check if you sign in, and anything you send yourself (such as a site report).

## What is not in this repository

The server behind adsilence.net (accounts, payment, list updates) is not part of this repository or its licence. The extension works without it — without an account it blocks out of the box.

## Links

- Website: [adsilence.net](https://adsilence.net)
- Built releases: [adsilence-chromium](https://github.com/businessLNU/adsilence-chromium) · [adsilence-firefox](https://github.com/businessLNU/adsilence-firefox)
- Licence: [GNU GPL v3 or later](extension/LICENSE)

