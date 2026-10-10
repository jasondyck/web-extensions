#!/bin/sh
# Builds dist/firefox and dist/chrome (unpacked, for loading during development)
# and a store-ready zip of each. The Chrome package also serves Edge.
set -eu
cd "$(dirname "$0")"

v=$(jq -r .version manifest.json)
vc=$(jq -r .version manifest.chrome.json)
[ "$v" = "$vc" ] || { echo "version mismatch: manifest.json $v, manifest.chrome.json $vc" >&2; exit 1; }

rm -rf dist
mkdir -p dist/firefox/icons dist/chrome/icons
shared="defaults.js content.js popup.html popup.css popup.js"

cp $shared manifest.json dist/firefox/
cp icons/icon.svg dist/firefox/icons/

cp $shared dist/chrome/
cp manifest.chrome.json dist/chrome/manifest.json
cp icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png dist/chrome/icons/

(cd dist/firefox && zip -qr "../lufs-normalizer-firefox-$v.zip" .)
(cd dist/chrome && zip -qr "../lufs-normalizer-chrome-$v.zip" .)
ls -1 dist/*.zip
