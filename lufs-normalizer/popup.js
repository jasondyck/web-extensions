"use strict";
const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const fmtDb = (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
const label = (key, v) => (key === "target" ? `${v} LUFS` : `${v} dB`);
let enabled = DEFAULTS.enabled;

function show(s) {
  enabled = s.enabled;
  $("enabled").checked = s.enabled;
  for (const key of ["target", "maxBoost"]) {
    $(key).value = s[key];
    $(`${key}Out`).value = label(key, s[key]);
  }
}

api.storage.local.get(DEFAULTS).then(show).then(poll);

$("enabled").addEventListener("change", (e) => {
  enabled = e.target.checked;
  api.storage.local.set({ enabled });
  poll();
});
for (const key of ["target", "maxBoost"]) {
  // Label follows the drag; storage (and every tab) only hears the final value.
  $(key).addEventListener("input", (e) => ($(`${key}Out`).value = label(key, e.target.value)));
  $(key).addEventListener("change", (e) => api.storage.local.set({ [key]: Number(e.target.value) }));
}

async function poll() {
  if (!enabled) {
    $("status").textContent = "Off";
    return;
  }
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const r = await api.tabs.sendMessage(tab.id, { type: "status" });
    if (!r) throw 0;
    $("status").textContent = r.loudness === null
      ? `Measuring…  gain ${fmtDb(r.gainDb)}`
      : `Source ${r.loudness.toFixed(1)} LUFS · gain ${fmtDb(r.gainDb)}${r.playing ? "" : " (paused)"}`;
  } catch {
    $("status").textContent = "No audio playing in this tab";
  }
}
setInterval(poll, 500);
