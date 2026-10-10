# Loudness Normalizer

Firefox extension that normalizes `<video>`/`<audio>` on any site to a target
loudness in LUFS (default −16; the popup sets the target, max boost and
on/off, and shows the measured level and gain applied).

## How it works

Each playing media element is routed through Web Audio:

```
source ─┬─ normalize gain ─ limiter (−1 dBFS) ─ speakers
        └─ K-weighting ─ analysers   (meter, before any gain)
```

- Loudness is measured per ITU-R BS.1770: K-weighting, 100 ms blocks, −70 LUFS
  absolute gate, −10 LU relative gate, over a sliding 10 s window. Tested
  against ffmpeg's `ebur128`: within 0.2 LU.
- Boosts ease in at 3 dB/s. Cuts react at 15 dB/s using the louder of the
  10 s and 3 s readings, so sudden loud parts get pulled down within about 1 s.
- Silence holds the current gain. A new track or a seek starts a fresh measurement.
- The page's own volume slider keeps working: Firefox applies it before Web
  Audio, and the meter divides it back out.
- Idle cost is one capturing `play` listener. The 100 ms timer only runs
  while something is playing.

## Won't normalize

- Cross-origin media served without CORS (Web Audio would output silence), so
  it's left alone. Most big sites (YouTube, Twitch, Reddit, X) use `blob:`
  sources and work.
- DRM-protected media (Netflix, Spotify, Disney+, …).
- Players hidden inside closed shadow DOM, since their `play` events don't reach the document.

## Install

Temporary: `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* →
`manifest.json`. Permanent: upload `dist/*.zip` at
https://addons.mozilla.org/developers/ → *Submit a New Add-on* → *On your own*,
then install the signed `.xpi`.
