// Loudness Normalizer — content script.
// Routes each playing <video>/<audio> through Web Audio:
//   source → gain → limiter → speakers
//   source → K-weighting → per-channel analysers (meter, pre-gain)
// Loudness follows ITU-R BS.1770 (K-weighting, 400 ms-ish blocks, absolute
// -70 LUFS and relative -10 LU gates) over a sliding window, and the gain
// is eased toward (target - measured).
//
// Costs nothing until something plays: the only thing installed up front is
// one capturing "play" listener.
"use strict";

const api = globalThis.browser ?? globalThis.chrome;
const DEFAULTS = { enabled: true, target: -16, maxBoost: 12 };
const TICK_MS = 100;
const WINDOW_BLOCKS = 100; // 10 s of 100 ms blocks
const SHORT_BLOCKS = 30; // 3 s: lets the gain drop quickly when things get loud
const MIN_GATED_BLOCKS = 10; // need 1 s of non-silence before acting
const MAX_CUT = 30;
const UP_DB_PER_TICK = 0.3; // 3 dB/s boost
const DOWN_DB_PER_TICK = 1.5; // 15 dB/s cut (loud surprises get pulled down fast)

// DynamicsCompressorNode adds automatic makeup gain derived from its curve;
// for threshold -1 dB / ratio 20 / knee 0 that's (1 / 10^(-0.95/20))^0.6.
const LIMITER = { threshold: -1, knee: 0, ratio: 20, attack: 0.003, release: 0.1 };
const LIMITER_MAKEUP_DB = 0.6 * 0.95;

let settings = { ...DEFAULTS };
let ctx = null;
let timer = 0;
const chains = new Map(); // element -> chain

api.storage.local.get(DEFAULTS).then((s) => {
  settings = s;
  chains.forEach(route);
});
api.storage.onChanged.addListener((changes) => {
  for (const [k, { newValue }] of Object.entries(changes)) if (k in DEFAULTS) settings[k] = newValue;
  chains.forEach(route);
});

// ---------- capture ----------

// Cross-origin media without CORS would be silenced by Web Audio, so leave it alone.
// DRM (EME) media can't be captured at all, so leave it alone too.
function canCapture(el) {
  if (el.mediaKeys) return false;
  const src = el.currentSrc;
  if (!src || src.startsWith("blob:") || src.startsWith("data:")) return true;
  try {
    if (new URL(src).origin === location.origin) return true;
  } catch {
    return false;
  }
  return el.crossOrigin !== null;
}

let gestureWaiters = null;
function afterGesture(el) {
  if (!gestureWaiters) {
    gestureWaiters = new Set();
    const go = () => {
      for (const t of ["pointerdown", "keydown"]) removeEventListener(t, go, true);
      const els = gestureWaiters;
      gestureWaiters = null;
      els.forEach(attach);
    };
    for (const t of ["pointerdown", "keydown"]) addEventListener(t, go, true);
  }
  gestureWaiters.add(el);
}

async function attach(el) {
  if (chains.has(el) || !canCapture(el)) return;
  ctx ??= new AudioContext();
  if (ctx.state !== "running") await ctx.resume().catch(() => {});
  // Capturing into a suspended context would silence the element; wait instead.
  if (ctx.state !== "running") return afterGesture(el);
  if (chains.has(el)) return;

  const src = ctx.createMediaElementSource(el);
  const norm = ctx.createGain();
  const limiter = new DynamicsCompressorNode(ctx, LIMITER);
  norm.connect(limiter).connect(ctx.destination);

  // BS.1770 K-weighting: high shelf (+4 dB @ 1.68 kHz) then high-pass (38 Hz).
  const shelf = new BiquadFilterNode(ctx, { type: "highshelf", frequency: 1681.97, gain: 4 });
  const hp = new BiquadFilterNode(ctx, { type: "highpass", frequency: 38.13, Q: 0.5 });
  const split = ctx.createChannelSplitter(2);
  const size = ctx.sampleRate > 50000 ? 8192 : 4096; // ~85-100 ms
  const analysers = [0, 1].map((i) => {
    const a = new AnalyserNode(ctx, { fftSize: size });
    split.connect(a, i);
    return a;
  });
  shelf.connect(hp).connect(split);

  const chain = { el, src, norm, meterIn: shelf, analysers, buf: new Float32Array(size), blocks: [], gainDb: 0, loudness: null };
  chains.set(el, chain);
  // New track or a jump elsewhere: re-measure (gain holds until 1 s is in).
  const remeasure = () => (chain.blocks.length = 0);
  el.addEventListener("loadstart", remeasure);
  el.addEventListener("seeked", remeasure);
  route(chain);
  start();
}

// Enabled:  source → norm → limiter → speakers
// Disabled: source → speakers
// The meter always taps the source, before any gain.
function route(chain) {
  const { src } = chain;
  src.disconnect();
  src.connect(chain.meterIn);
  src.connect(settings.enabled ? chain.norm : ctx.destination);
  applyGain(chain);
}

function applyGain(chain) {
  chain.norm.gain.setTargetAtTime(10 ** ((chain.gainDb - LIMITER_MAKEUP_DB) / 20), ctx.currentTime, 0.05);
}

// ---------- metering ----------

function meanSquare(analyser, buf) {
  analyser.getFloatTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return s / buf.length;
}

const toLufs = (power) => -0.691 + 10 * Math.log10(power);

function gatedLoudness(blocks) {
  const abs = blocks.filter((p) => toLufs(p) > -70);
  if (abs.length < MIN_GATED_BLOCKS) return null;
  const rel = toLufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const kept = abs.filter((p) => toLufs(p) > rel);
  return toLufs(kept.reduce((a, b) => a + b, 0) / kept.length);
}

function tick() {
  let playing = 0;
  for (const chain of chains.values()) {
    const { el } = chain;
    if (!el.isConnected && el.paused) {
      chains.delete(el);
      continue;
    }
    if (el.paused || el.seeking) continue;
    playing++;
    // The element's volume is applied before Web Audio sees the signal; divide it
    // back out so turning the player down isn't "corrected" by boosting.
    if (el.muted || el.volume === 0) continue;

    const l = meanSquare(chain.analysers[0], chain.buf);
    const r = meanSquare(chain.analysers[1], chain.buf);
    // A mono source only fills channel 0 but plays on both speakers.
    const power = (r === 0 ? 2 * l : l + r) / (el.volume * el.volume);
    chain.blocks.push(power);
    if (chain.blocks.length > WINDOW_BLOCKS) chain.blocks.shift();

    chain.loudness = gatedLoudness(chain.blocks);
    if (chain.loudness === null) continue; // silence or too little audio: hold gain
    // React to sudden loud passages from the last 3 s; boost only on the full window.
    const recent = gatedLoudness(chain.blocks.slice(-SHORT_BLOCKS));
    const level = recent === null ? chain.loudness : Math.max(chain.loudness, recent);
    const want = Math.max(-MAX_CUT, Math.min(settings.maxBoost, settings.target - level));
    const d = want - chain.gainDb;
    chain.gainDb += Math.max(-DOWN_DB_PER_TICK, Math.min(UP_DB_PER_TICK, d));
    applyGain(chain);
  }
  if (!playing) stop();
}

function start() {
  timer ||= setInterval(tick, TICK_MS);
}

function stop() {
  clearInterval(timer);
  timer = 0;
}

// ---------- events ----------

// "play" doesn't bubble, but it does reach capturing listeners on the document.
document.addEventListener(
  "play",
  (e) => {
    const el = e.target;
    if (!(el instanceof HTMLMediaElement)) return;
    if (chains.has(el)) start();
    else attach(el);
  },
  true
);

api.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "status" || !chains.size) return; // let a frame with media answer
  const c = [...chains.values()].find((c) => !c.el.paused) || [...chains.values()][0];
  return Promise.resolve({ loudness: c.loudness, gainDb: c.gainDb, playing: !c.el.paused, count: chains.size });
});
