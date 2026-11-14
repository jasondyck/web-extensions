#!/bin/sh
# Builds unpacked dist/firefox and dist/chrome plus store-ready zips.
set -eu
cd "$(dirname "$0")"
v=$(jq -r .version manifest.json)
rm -rf dist
mkdir -p dist/firefox/icons dist/chrome/icons

# Firefox: manifest.json as-is (Gecko settings, SVG icon is fine).
cp manifest.json defaults.js content.js popup.html popup.css popup.js dist/firefox/
cp icons/icon.svg dist/firefox/icons/

# Chrome: drop the Gecko-only block and use PNG icons (Chrome ignores SVG).
jq 'del(.browser_specific_settings)
    | .minimum_chrome_version = "102"
    | .icons = { "16": "icons/icon16.png", "32": "icons/icon32.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
    | .action.default_icon = { "16": "icons/icon16.png", "32": "icons/icon32.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }' \
  manifest.json > dist/chrome/manifest.json
cp defaults.js content.js popup.html popup.css popup.js dist/chrome/
cp icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png dist/chrome/icons/

(cd dist/firefox && zip -qr "../loudness-normalizer-$v.zip" .)
(cd dist/chrome && zip -qr "../loudness-normalizer-$v-chrome.zip" .)
ls -1 dist/*.zip
