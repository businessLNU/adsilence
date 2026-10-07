# AdSilence — Free Open-Source Ad Blocker for Chrome & Firefox (Manifest V3)

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![Chrome Web Store](https://img.shields.io/badge/Chrome-Web%20Store-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/aapplploeajcbogegjgnnfgapdjjmoin)
[![Firefox Add-ons](https://img.shields.io/badge/Firefox-Add--ons-FF7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/firefox/addon/adsilence/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success)](#manifest-v3-ad-blocker-without-webrequest)

**AdSilence** is a free, open-source **ad blocker**, **tracker blocker**, **pop-up blocker** and **cookie banner blocker** for **Google Chrome**, **Mozilla Firefox**, **Brave**, **Opera**, **Vivaldi** and **Microsoft Edge**. It blocks ads, trackers, pop-ups, malware domains and cookie consent pop-ups out of the box — no account, no setup, no "acceptable ads".

Built for **Manifest V3** from day one: AdSilence does **not** request the `webRequest` permission. The browser applies the blocking rules itself through `declarativeNetRequest`, so your browsing history never passes through us. A privacy-first **uBlock Origin alternative for Chrome** after the Manifest V3 switch.

This repository contains the complete source code of the browser extension, version 1.0.4, under the **GNU GPL v3**.

## Features

### Free — no account needed

- **Ad blocker:** removes banner ads, video ads, text ads and sponsored content
- **YouTube ad blocker:** blocks YouTube video ads with uBlock Origin's filters and scriptlets, including the countermeasures against YouTube's "Ad blockers are not allowed" wall
- **Pop-up blocker:** stops pop-ups, pop-unders and forced redirects
- **Tracker blocker & anti-tracking:** blocks analytics, tracking pixels and disguised first-party trackers (CNAME-cloaked tracking)
- **Malware & malvertising protection:** blocks domains that are currently distributing malware (URLhaus)
- **Cookie banner blocker:** hides GDPR cookie consent pop-ups
- **Facebook & Instagram:** hides sponsored posts in the feed
- **32 filter lists:** EasyList, EasyPrivacy, uBlock filters, Fanboy's lists, URLhaus and 18 regional lists (EasyList Germany, Liste FR, EasyList Italy, EasyList Spanish and more). The regional list for your browser language is switched on automatically
- **Per-site exceptions** with one click
- **No acceptable-ads whitelist:** nobody can pay to get their ads through

### Premium (optional)

- **Fingerprint protection:** your browser shows each website a different canvas, font and audio fingerprint, so sites cannot recognise you without cookies
- **Automatic cookie consent:** answers cookie banners for you — reject all or accept, your choice
- **Phishing protection:** warns about look-alike domains that imitate well-known brands

## Measured, not claimed

**100 of 100 points** on [adblock-tester.com](https://adblock-tester.com/) with factory settings (measured on 5 September 2026, version 1.0.0, median of 3 runs). Full method, all versions and how to repeat the ad blocker test yourself: [adsilence.net/en/adblocker-test](https://adsilence.net/en/adblocker-test)

## Install

| Browser | Where |
|---|---|
| Google Chrome (121+) | [Chrome Web Store](https://chromewebstore.google.com/detail/aapplploeajcbogegjgnnfgapdjjmoin) |
| Brave, Opera, Vivaldi, Microsoft Edge | [Chrome Web Store](https://chromewebstore.google.com/detail/aapplploeajcbogegjgnnfgapdjjmoin) — all Chromium browsers install from there |
| Mozilla Firefox (140+) & Firefox for Android (142+) | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/adsilence/) |

## Manifest V3 ad blocker without webRequest

Most classic ad blockers read every network request your browser makes. Under Manifest V3 that is no longer necessary: AdSilence hands its rules to the browser, and Chrome or Firefox blocks the requests itself. The extension never sees your browsing history — you can verify this in [`extension/manifest`](extension/manifest).

## Build from source

Requires Node.js 22 or newer.

```bash
cd extension
npm ci
ADSILENCE_API=https://adsilence.net npm run build   # → dist/chromium, dist/firefox, dist/safari
```

The filter lists are committed in `extension/rules/` and `extension/kosmetik/`, so the build needs no network access besides `npm ci` and is reproducible.

## Privacy

No telemetry, no analytics, no data collection in the extension. The only connections to adsilence.net are the daily filter-list update, the licence check if you sign in, and anything you send yourself, such as a site report.

## FAQ

**Is AdSilence free?**
Yes. Blocking ads, trackers, pop-ups, malware and cookie banners is free, without an account and without a time limit. Premium adds fingerprint protection, automatic cookie consent answers and phishing warnings.

**Does AdSilence work with Manifest V3?**
Yes. It was built for Manifest V3 from the start and uses `declarativeNetRequest` in Chrome and Firefox.

**Is AdSilence a uBlock Origin alternative?**
For Chrome users who lost uBlock Origin after the Manifest V3 switch: yes. AdSilence uses uBlock Origin's own filter lists and scriptlets, and many more lists are switched on by default.

**Does AdSilence block YouTube ads?**
Yes, using uBlock Origin's YouTube filters and scriptlets. YouTube changes its anti-adblock measures often; fixes arrive with extension updates.

**Does AdSilence block cookie banners?**
Yes. Hiding cookie consent pop-ups is free. Premium can answer them automatically, rejecting or accepting as you choose.

**Is AdSilence open source?**
Yes. The complete extension source code is in this repository under the GNU GPL v3.

## In other languages

**Deutsch:** AdSilence ist ein kostenloser Werbeblocker und Adblocker für Chrome und Firefox. Er blockt Werbung, Tracker, Pop-ups, YouTube-Werbung und Cookie-Banner — ohne Konto, ohne Whitelist, Open Source. [adsilence.net/de](https://adsilence.net/de)

**Français :** AdSilence est un bloqueur de pub gratuit et open source pour Chrome et Firefox : anti-pub, anti pop-up, anti-pistage et bloqueur de bandeaux cookies, sans compte. [adsilence.net/fr](https://adsilence.net/fr)

**Español:** AdSilence es un bloqueador de anuncios gratis y de código abierto para Chrome y Firefox: bloquea anuncios, rastreadores, ventanas emergentes y avisos de cookies, sin cuenta. [adsilence.net/es](https://adsilence.net/es)

## What is not in this repository

The server behind adsilence.net (accounts, payment, list updates) is not part of this repository or its licence. The extension works without it — without an account it blocks out of the box.

## Links

- Website: [adsilence.net](https://adsilence.net)
- Built releases: [adsilence-chromium](https://github.com/businessLNU/adsilence-chromium) · [adsilence-firefox](https://github.com/businessLNU/adsilence-firefox)
- Licence: [GNU GPL v3 or later](LICENSE)

---

**Keywords:** ad blocker · adblocker · adblock · free ad blocker · open source ad blocker · Chrome ad blocker · Firefox ad blocker · Manifest V3 ad blocker · MV3 · declarativeNetRequest · uBlock Origin alternative · YouTube ad blocker · pop-up blocker · popup blocker · tracker blocker · anti-tracking · privacy extension · cookie banner blocker · cookie consent · GDPR · malware blocker · malvertising · phishing protection · fingerprint protection · browser fingerprinting · EasyList · EasyPrivacy · filter lists · Brave · Opera · Vivaldi · Edge · Werbeblocker · bloqueur de pub · bloqueador de anuncios
