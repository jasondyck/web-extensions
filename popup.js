"use strict";
const DEFAULTS = { enabled: true, target: -16, maxBoost: 12 };
const $ = (id) => document.getElementById(id);
const fmtDb = (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;

function show(s) {
  $("enabled").checked = s.enabled;
  $("target").value = s.target;
  $("targetOut").value = `${s.target} LUFS`;
  $("maxBoost").value = s.maxBoost;
  $("maxBoostOut").value = `${s.maxBoost} dB`;
}

browser.storage.local.get(DEFAULTS).then(show);

$("enabled").addEventListener("change", (e) => browser.storage.local.set({ enabled: e.target.checked }));
for (const key of ["target", "maxBoost"]) {
  $(key).addEventListener("input", (e) => {
    const v = Number(e.target.value);
    $(`${key}Out`).value = key === "target" ? `${v} LUFS` : `${v} dB`;
    browser.storage.local.set({ [key]: v });
  });
}

async function poll() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const r = await browser.tabs.sendMessage(tab.id, { type: "status" });
    if (!r) throw 0;
    $("status").textContent = r.loudness === null
      ? `Measuring…  gain ${fmtDb(r.gainDb)}`
      : `Source ${r.loudness.toFixed(1)} LUFS · gain ${fmtDb(r.gainDb)}${r.playing ? "" : " (paused)"}`;
  } catch {
    $("status").textContent = "No audio playing in this tab";
  }
}
poll();
setInterval(poll, 500);
