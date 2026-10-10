# Loudness Normalizer

Browser extension (Firefox, Chrome, Edge) that normalizes `<video>`/`<audio>` on any site to a target
loudness in LUFS (default −16; the popup sets the target, max boost and
on/off, and shows the measured level and gain applied).

## How it works

Each audible media element is routed through Web Audio:

```
source ─┬─ normalize gain ─ limiter (−1 dBFS, shared) ─ speakers
        └─ stereo mix ─ K-weighting ─ analysers   (meter, before any gain)
```

- Loudness is measured per ITU-R BS.1770: K-weighting, 100 ms blocks, −70 LUFS
  absolute gate, −10 LU relative gate. It is *integrated over the whole
  program* (histogram-gated, like libebur128), not a sliding window, so it
  converges to one static gain per video. Quiet passages fall under the
  relative gate and are ignored rather than boosted, so dynamics are kept and
  nothing pumps.
- Boost is earned: none for the first second, growing to the max boost over
  30 s of audio, and it only moves at 1 dB/s. Cuts move at 15 dB/s.
- Loud surprises: if the 3 s short-term loudness would land more than 8 LU
  above the target, the gain is capped so it doesn't. The cap only ever
  tightens within a program, so a loud section is never followed by a swell.
- A new source (`loadstart`/`emptied`) starts a fresh measurement; any boost
  is dropped, any cut is kept. Seeking within a program keeps the measurement.
- Silence holds the current gain.
- The page's own volume slider keeps working: Firefox applies it before Web
  Audio, and the meter divides it back out.

## Cost

- Idle: two capturing listeners (`play`, `volumechange`). No storage read,
  message listener or AudioContext exists until something audible plays.
- Muted autoplay (Reddit/X/TikTok feeds) is not captured until it is unmuted.
- The 100 ms timer only runs while something is playing, and the AudioContext
  is suspended whenever everything is paused, so the audio device is released.
- One limiter per page; per-element nodes are torn down when the element
  leaves the DOM and rebuilt if it comes back.
- Per tick, per element: two analyser reads and a pass over a 750-bin
  histogram. No allocation.

## Won't normalize

- Cross-origin media served without CORS (Web Audio would output silence), so
  it's left alone. Most big sites (YouTube, Twitch, Reddit, X) use `blob:`
  sources and work. A same-origin URL that redirects to a non-CORS CDN, or an
  element reused for a cross-origin source after it was captured, can't be
  detected up front and will go silent; capture is permanent, so toggling
  off won't restore it.
- DRM-protected media (Netflix, Spotify, Disney+, …).
- Players inside shadow DOM (open or closed) and detached `new Audio()`
  objects: their `play` events never reach the document.
- An element that is removed from the page and then played again without
  being re-inserted.

## Build

`./build.sh` writes `dist/firefox/` and `dist/chrome/` (unpacked) plus a
store-ready zip of each. The two manifests must carry the same version;
`manifest.json` is Firefox's, `manifest.chrome.json` is Chrome's and Edge's
(PNG icons, no `browser_specific_settings`). Everything else is shared.

## Install

- **Firefox, development:** `about:debugging#/runtime/this-firefox` →
  *Load Temporary Add-on…* → `manifest.json` (or `dist/firefox/manifest.json`).
- **Chrome / Edge, development:** `chrome://extensions` (or `edge://extensions`)
  → enable *Developer mode* → *Load unpacked* → `dist/chrome/`.
- **Firefox store:** upload `dist/lufs-normalizer-firefox-*.zip` at
  https://addons.mozilla.org/developers/.
- **Chrome Web Store:** upload `dist/lufs-normalizer-chrome-*.zip` at
  https://chrome.google.com/webstore/devconsole (one-time $5 developer fee).
- **Edge Add-ons:** upload the same Chrome zip at
  https://partner.microsoft.com/dashboard/microsoftedge (free).
