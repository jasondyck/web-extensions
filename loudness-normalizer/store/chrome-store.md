# Chrome Web Store submission

Copy for the [developer console](https://chrome.google.com/webstore/devconsole)
when uploading `dist/loudness-normalizer-<version>-chrome.zip`.

## Store listing

**Name** (45 chars max)

```
Loudness Normalizer
```

**Summary** (132 chars max)

```
Normalizes audio and video on any site to a target loudness (LUFS), with a limiter so loud sources never clip.
```

**Category:** Tools

**Language:** English

**Detailed description**

```
Loudness Normalizer evens out the volume of everything you watch or listen to
in the browser. Quiet videos get boosted, loud ones get turned down, so you can
stop reaching for the volume slider between tabs.

It measures loudness the way broadcasters do — ITU-R BS.1770 integrated LUFS,
with the standard K-weighting, 100 ms blocks and −70 LUFS / −10 LU gates — over
the whole program rather than a sliding window. That gives one steady gain per
video instead of the pumping you get from a simple AGC.

- Target loudness is selectable (−30 to −6 LUFS, default −16).
- Boost is earned slowly (up to a configurable max, default +12 dB), cuts are
  fast, and loud surprises are capped so nothing swells.
- A shared −1 dBFS limiter keeps boosted material from clipping.
- Works on HTML5 video and audio elements on any site; per-tab on/off via the
  toolbar popup, which also shows the measured source loudness and applied gain.
- No network requests, no accounts, no analytics. Everything runs locally.

Not supported: DRM-protected media (Netflix, Spotify, Disney+, …), media served
cross-origin without CORS (Web Audio would silence it, so it is left untouched),
and players inside shadow DOM.

Known limitation: capture through Web Audio is permanent for an element. If a
cross-origin, non-CORS source is later played in an element that was already
captured, that element will be silent until the page is reloaded.
```

**Screenshots** (1280×800, already in this folder)

- `store/screenshot-popup.png`
- `store/screenshot-levels.png`

**Store icon:** `store/icon-128.png`

## Single purpose

```
Normalize the loudness of audio and video played in the browser to a user-selected target level.
```

## Permission justifications

**`storage`**

```
Saves the user's three settings (on/off, target loudness, maximum boost) so they
persist across sessions and are shared between the popup and the content script.
```

**Host permission (`<all_urls>` / content script on all sites)**

```
The extension's only purpose is to adjust audio in media elements on whatever
page the user is watching. To do that it must run its content script on pages
that contain <video>/<audio>, and it cannot know in advance which sites the user
will visit. The content script stays idle (two event listeners) until playback
starts, and it never reads page content, DOM text, or network traffic — it only
touches HTMLMediaElement and Web Audio nodes it creates.
```

## Data usage answers

- Does the extension collect or use any user data? **No.**
- Personally identifiable information, health, financial, authentication,
  personal communications, location, web history, user activity, website
  content: **none collected or transmitted.**
- Sold to third parties: no. Used for purposes unrelated to the single purpose:
  no. Used to determine creditworthiness: no.
- Remote code: **No.** All JavaScript is bundled in the zip; nothing is fetched
  or evaluated at runtime.
- Privacy policy URL: the console marks this field required, so use the policy in
  `PRIVACY.md` once it is pushed:
  https://github.com/jasondyck/web-extensions/blob/master/loudness-normalizer/PRIVACY.md

## Review notes

- The extension makes no network requests. `content.js` creates Web Audio nodes
  and an `AudioContext`; it reads `chrome.storage.local` and answers a `status`
  message from the popup.
- The `browser_specific_settings` block in the source `manifest.json` is
  Gecko-only and is stripped by `build.sh` for this package.
- Reproduce the package with `./build.sh` (requires `jq` and `zip`).

## Release checklist

1. Bump `version` in `manifest.json` (Chrome requires a higher version than the
   published one; it must be 1–4 dot-separated integers, no leading zeros).
2. `./build.sh`
3. Developer console → *New item* (first upload) or *Upload new package*.
4. Paste the listing copy above; upload the two screenshots and the 128 px icon.
5. Fill in the Privacy tab (single purpose, justifications, data usage) using the
   answers above.
6. Submit for review. Review usually takes a few days; changes to `content.js`
   that touch new permissions can add a manual review round.
