// Loudness Normalizer — content script.
//
// Each audible <video>/<audio> is routed through Web Audio:
//   source → norm gain → limiter → makeup → speakers   (limiter shared per page)
//   source → stereo mix → K-weighting → analysers      (meter, before any gain)
//
// Loudness is BS.1770 *integrated* over the whole program (absolute -70 LUFS
// gate, relative -10 LU gate via a histogram), so it converges to one static
// gain per video and quiet passages are gated out rather than boosted. Boost
// is earned slowly; a sticky short-term cap handles loud surprises.
//
// Idle cost before anything audible plays: two capturing listeners. Nothing
// else (storage, messaging, AudioContext) exists until then, and the context
// is suspended again whenever everything is paused.
"use strict";

const api = globalThis.browser ?? globalThis.chrome;
const TICK_MS = 100;
const MIN_GATED_BLOCKS = 10; // 1 s of non-silence before acting
const EARN_BLOCKS = 300; // boost allowance grows from 0 to maxBoost over 30 s of audio
const SHORT_BLOCKS = 30; // 3 s short-term loudness
const OUTLIER_LU = 8; // short-term may exceed the target by this much before a cut
const MAX_CUT = 30;
const UP_DB_PER_S = 1;
const DOWN_DB_PER_S = 15;
const HIST_MIN = -70; // absolute gate
const HIST_BINS = 750; // 0.1 LU bins up to +5 LUFS

const LIMITER = { threshold: -1, knee: 0, ratio: 20, attack: 0.003, release: 0.1 };
// DynamicsCompressorNode adds makeup gain derived from its curve; for
// threshold -1 dB / ratio 20 / knee 0 that's (1 / 10^(-0.95/20))^0.6.
const LIMITER_MAKEUP_DB = 0.6 * 0.95;
// Web Audio's highpass Q is in dB; BS.1770 stage 2 is Q = 0.5003 (linear).
const K_HIGHPASS_Q_DB = 20 * Math.log10(0.5003);

let settings = null;
let settingsReady = null;
let ctx = null;
let limiter = null;
let buf = null; // one analyser read buffer, shared (tick is synchronous)
let timer = 0;
const chains = new WeakMap(); // element -> chain; never deleted (an element can only be captured once)
const active = new Set(); // chains currently wired into the graph

const toLufs = (power) => -0.691 + 10 * Math.log10(power);
const audible = (el) => !el.paused && !el.muted && el.volume > 0;

// ---------- settings (loaded on first attach) ----------

function loadSettings() {
  return (settingsReady ??= api.storage.local.get(DEFAULTS).then((s) => {
    settings = s;
    api.storage.onChanged.addListener(onSettingsChanged);
    api.runtime.onMessage.addListener(onMessage);
  }));
}

function onSettingsChanged(changes) {
  for (const k in changes) if (k in DEFAULTS) settings[k] = changes[k].newValue;
  if (!changes.enabled) return; // target/maxBoost are read by tick(); no rewiring needed
  active.forEach(route);
  if (settings.enabled) for (const el of document.querySelectorAll("video,audio")) if (audible(el)) attach(el);
}

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
function afterGesture(fn) {
  if (!gestureWaiters) {
    gestureWaiters = new Set();
    const go = () => {
      for (const t of ["pointerdown", "keydown"]) removeEventListener(t, go, true);
      const fns = gestureWaiters;
      gestureWaiters = null;
      fns.forEach((f) => f());
    };
    for (const t of ["pointerdown", "keydown"]) addEventListener(t, go, true);
  }
  gestureWaiters.add(fn);
}

function createContext() {
  const c = new AudioContext();
  limiter = new DynamicsCompressorNode(c, LIMITER);
  const makeup = new GainNode(c, { gain: 10 ** (-LIMITER_MAKEUP_DB / 20) });
  limiter.connect(makeup).connect(c.destination);
  buf = new Float32Array(c.sampleRate > 50000 ? 8192 : 4096); // ~85-100 ms
  return c;
}

async function attach(el) {
  if (chains.has(el) || !canCapture(el)) return;
  await loadSettings();
  if (!settings.enabled || chains.has(el) || !audible(el)) return;
  ctx ??= createContext();
  if (ctx.state !== "running") await ctx.resume().catch(() => {});
  // Capturing into a suspended context would silence the element; wait instead.
  if (ctx.state !== "running") return afterGesture(() => attach(el));
  if (chains.has(el)) return;

  let src;
  try {
    src = ctx.createMediaElementSource(el);
  } catch {
    return; // the page captured it itself
  }
  const chain = {
    el,
    src,
    norm: null,
    mix: null,
    analysers: null,
    gainDb: 0,
    loudness: null,
    last: 0,
    hist: new Float64Array(HIST_BINS), // power sums per 0.1 LU bin (absolute-gated)
    histN: new Uint32Array(HIST_BINS),
    absSum: 0,
    absN: 0,
    short: new Float64Array(SHORT_BLOCKS), // last 3 s of block powers, ungated
    shortSum: 0,
    shortN: 0,
    shortAt: 0,
    capRel: Infinity, // sticky gain cap relative to target; only ever decreases
  };
  chains.set(el, chain);
  // A new source is a new program: start over. Seeking within one is not.
  const reset = () => {
    chain.hist.fill(0);
    chain.histN.fill(0);
    chain.short.fill(0);
    chain.absSum = chain.absN = chain.shortSum = chain.shortN = chain.shortAt = 0;
    chain.capRel = Infinity;
    chain.loudness = null;
    if (chain.gainDb > 0) {
      chain.gainDb = 0; // keep a cut across tracks, never a boost
      if (chain.norm) applyGain(chain);
    }
  };
  el.addEventListener("loadstart", reset);
  el.addEventListener("emptied", reset);
  wire(chain);
  start();
}

// Nodes are built when an element is live and torn down when it leaves the
// page, so a feed that cycles through hundreds of players doesn't accumulate
// graph. The source node (and thus the element) is kept via the WeakMap only.
function wire(chain) {
  const norm = new GainNode(ctx, { gain: 10 ** (chain.gainDb / 20) });
  norm.connect(limiter);
  // Meter exactly what reaches the speakers: mono → L=R, 5.1 → ITU downmix.
  const mix = new GainNode(ctx, { channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers" });
  // BS.1770 K-weighting: high shelf (+4 dB @ 1.68 kHz) then high-pass (38 Hz).
  const shelf = new BiquadFilterNode(ctx, { type: "highshelf", frequency: 1681.97, gain: 4 });
  const hp = new BiquadFilterNode(ctx, { type: "highpass", frequency: 38.13, Q: K_HIGHPASS_Q_DB });
  const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  mix.connect(shelf).connect(hp).connect(split);
  const analysers = [0, 1].map((i) => {
    const a = new AnalyserNode(ctx, { fftSize: buf.length });
    split.connect(a, i);
    return a;
  });
  Object.assign(chain, { norm, mix, analysers });
  active.add(chain);
  route(chain);
}

function unwire(chain) {
  chain.src.disconnect();
  chain.norm.disconnect();
  chain.mix.disconnect();
  chain.norm = chain.mix = chain.analysers = null;
  active.delete(chain);
}

// Enabled:  source → norm → limiter → speakers, plus the meter tap
// Disabled: source → speakers
function route(chain) {
  const { src } = chain;
  src.disconnect();
  if (settings.enabled) {
    src.connect(chain.mix);
    src.connect(chain.norm);
    applyGain(chain);
  } else {
    src.connect(ctx.destination);
  }
}

function applyGain(chain) {
  chain.norm.gain.setTargetAtTime(10 ** (chain.gainDb / 20), ctx.currentTime, 0.05);
}

// ---------- metering ----------

function meanSquare(analyser) {
  analyser.getFloatTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return s / buf.length;
}

// Integrated loudness with the relative gate applied over the histogram.
function integrated(c) {
  if (c.absN < MIN_GATED_BLOCKS) return null;
  const from = Math.max(0, ((toLufs(c.absSum / c.absN) - 10 - HIST_MIN) * 10) | 0);
  let sum = 0;
  let n = 0;
  for (let i = from; i < HIST_BINS; i++) {
    sum += c.hist[i];
    n += c.histN[i];
  }
  return n ? toLufs(sum / n) : null;
}

function tick() {
  let playing = 0;
  const now = ctx.currentTime;
  for (const chain of active) {
    const { el } = chain;
    if (el.paused) {
      if (!el.isConnected) unwire(chain);
      continue;
    }
    playing++;
    // Volume/mute are applied before Web Audio sees the signal; measure the
    // source by dividing volume back out, and don't measure at all when muted.
    if (!settings.enabled || ctx.state !== "running" || el.seeking || el.muted || el.volume === 0) {
      chain.last = now;
      continue;
    }
    const dt = Math.min(0.5, now - chain.last);
    chain.last = now;

    const power = (meanSquare(chain.analysers[0]) + meanSquare(chain.analysers[1])) / (el.volume * el.volume);

    const i = chain.shortAt;
    chain.shortSum += power - chain.short[i];
    chain.short[i] = power;
    chain.shortAt = (i + 1) % SHORT_BLOCKS;
    if (chain.shortN < SHORT_BLOCKS) chain.shortN++;
    else if (chain.shortAt === 0) chain.shortSum = chain.short.reduce((a, b) => a + b, 0); // kill drift

    const lufs = toLufs(power);
    if (lufs > HIST_MIN) {
      const b = Math.min(HIST_BINS - 1, ((lufs - HIST_MIN) * 10) | 0);
      chain.hist[b] += power;
      chain.histN[b]++;
      chain.absSum += power;
      chain.absN++;
    }

    const level = (chain.loudness = integrated(chain));
    if (level === null) continue; // silence or too little audio: hold gain
    // Loud surprise: cap the gain so short-term loudness stays within OUTLIER_LU
    // of the target. The cap never relaxes within a program, so there's no pump.
    if (chain.shortN >= MIN_GATED_BLOCKS) {
      chain.capRel = Math.min(chain.capRel, OUTLIER_LU - toLufs(chain.shortSum / chain.shortN));
    }
    const earned = settings.maxBoost * Math.min(1, chain.absN / EARN_BLOCKS);
    const want = Math.min(earned, settings.target + chain.capRel, Math.max(-MAX_CUT, settings.target - level));
    const d = want - chain.gainDb;
    if (Math.abs(d) < 0.01) continue;
    chain.gainDb += Math.max(-DOWN_DB_PER_S * dt, Math.min(UP_DB_PER_S * dt, d));
    applyGain(chain);
  }
  if (!playing) stop();
}

function start() {
  timer ||= setInterval(tick, TICK_MS);
  if (ctx.state !== "running") ctx.resume().catch(() => afterGesture(start));
}

function stop() {
  clearInterval(timer);
  timer = 0;
  for (const c of active) if (!c.el.isConnected) unwire(c);
  if (ctx.state === "running") ctx.suspend().catch(() => {});
}

// ---------- events ----------

// "play" and "volumechange" don't bubble, but they do reach capturing
// listeners on the document. Muted autoplay (feeds) is left alone until it
// becomes audible.
function onMedia(e) {
  const el = e.target;
  if (!(el instanceof HTMLMediaElement) || !audible(el)) return;
  const chain = chains.get(el);
  if (!chain) return attach(el);
  if (!chain.norm) wire(chain);
  start();
}
document.addEventListener("play", onMedia, true);
document.addEventListener("volumechange", onMedia, true);

// sendResponse (not a returned Promise) so it works in Chromium as well as Firefox.
function onMessage(msg, _sender, sendResponse) {
  if (msg?.type !== "status" || !active.size) return; // let a frame with media answer
  let c = null;
  for (const x of active) {
    c ??= x;
    if (!x.el.paused) {
      c = x;
      break;
    }
  }
  sendResponse({ loudness: c.loudness, gainDb: c.gainDb, playing: !c.el.paused });
}
