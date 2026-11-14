---
title: Privacy Policy — Loudness Normalizer
---


Last updated: 2026-11-14

Loudness Normalizer does not collect, transmit, sell, or share any user data.

## What the extension does with data

- **Audio and video** from the pages you visit are processed locally in your
  browser using the Web Audio API, in order to measure loudness and adjust the
  playback gain. Audio is never recorded, stored, or sent anywhere.
- **Settings** (on/off, target loudness, maximum boost) are stored locally in
  the browser's extension storage (`chrome.storage.local` / `browser.storage.local`)
  so they persist between sessions. They stay on your device and contain no
  personal information.
- **No page content** (text, DOM, form data, URLs, browsing history) is read,
  stored, or transmitted by the extension.
- **No analytics, telemetry, accounts, cookies, or advertising** are used.
- The extension makes **no network requests** of any kind.

## Permissions

- `storage` — saves the three settings listed above on your device.
- Access to all sites — required so the extension can adjust playback on any
  page containing audio or video. The content script stays idle until media is
  actually playing.

## Third parties

None. No data is transferred to the developer or to any third party.

## Children's privacy

The extension collects no data from anyone, including children under 13.

## Changes

If this policy ever changes, the updated version will be published at this URL
and the extension's store listing will reflect the new data practices. Because
the extension collects nothing, no such change is anticipated.

## Contact

Questions about this policy: open an issue at
https://github.com/jasondyck/web-extensions/issues

Source code: https://github.com/jasondyck/web-extensions
