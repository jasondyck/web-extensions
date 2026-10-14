#!/bin/sh
# Builds dist/firefox (unpacked, for about:debugging) and a store-ready zip.
set -eu
cd "$(dirname "$0")"
v=$(jq -r .version manifest.json)
rm -rf dist
mkdir -p dist/firefox/icons
cp manifest.json defaults.js content.js popup.html popup.css popup.js dist/firefox/
cp icons/icon.svg dist/firefox/icons/
(cd dist/firefox && zip -qr "../loudness-normalizer-$v.zip" .)
ls -1 dist/*.zip
