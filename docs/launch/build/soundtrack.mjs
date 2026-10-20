// Original soundtrack for the Rolecall demo video, synthesised from scratch (no samples, no third-party music).
// Usage: node soundtrack.mjs <out.wav> <durationSeconds> <sectionStarts as comma list: bass,beat,arp,outro>
import { writeFileSync } from 'node:fs';

const [, , out = 'soundtrack.wav', durArg = '56', sectionsArg = '4.5,13,23,50.7'] = process.argv;
const SR = 44100;
const DUR = Number(durArg);
const [BASS_AT, BEAT_AT, ARP_AT, OUTRO_AT] = sectionsArg.split(',').map(Number);
const N = Math.ceil(SR * DUR);
const L = new Float32Array(N);
const R = new Float32Array(N);

const BPM = 96;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const midi = (m) => 440 * 2 ** ((m - 69) / 12);

// Am – F – C – G, voiced around middle C. Roots for the bass an octave or two down.
const CHORDS = [
  { root: 45, notes: [57, 60, 64, 69] }, // A minor
  { root: 41, notes: [57, 60, 65, 69] }, // F major
  { root: 48, notes: [55, 60, 64, 67] }, // C major
  { root: 43, notes: [55, 59, 62, 67] }, // G major
];
const chordAt = (t) => CHORDS[Math.floor(t / BAR) % CHORDS.length];

// Deterministic noise so every render is identical.
let seed = 1234567;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296 - 0.5;
};

function add(i, l, r) {
  if (i >= 0 && i < N) {
    L[i] += l;
    R[i] += r;
  }
}

// Section gain: fades a layer in over `fade` seconds from `start`, and out from the outro.
function layer(t, start, fade = 1.5, outroKeep = 0) {
  if (t < start) return 0;
  const inG = Math.min(1, (t - start) / fade);
  const outG = t < OUTRO_AT ? 1 : outroKeep + (1 - outroKeep) * Math.max(0, 1 - (t - OUTRO_AT) / 1.2);
  return inG * outG;
}

// Pad: soft additive tone per chord note, slow attack per bar, gentle detune for width.
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const chord = chordAt(t);
  const inBar = (t % BAR) / BAR;
  // Rise over the first sixth of the bar, release over the last tenth, so chord changes never click.
  const env = Math.min(1, inBar * 6) * Math.min(1, (1 - inBar) * 10) * (0.85 + 0.15 * Math.cos(inBar * Math.PI * 2));
  let l = 0;
  let r = 0;
  for (const [k, n] of chord.notes.entries()) {
    const f = midi(n);
    for (const [h, a] of [
      [1, 1],
      [2, 0.28],
      [3, 0.1],
    ]) {
      l += a * Math.sin(2 * Math.PI * f * h * 1.0015 * t + k);
      r += a * Math.sin(2 * Math.PI * f * h * 0.9985 * t + k * 1.7);
    }
  }
  const g = 0.028 * env * layer(t, 0, 2.5, 1);
  L[i] += l * g;
  R[i] += r * g;
}

// Bass pluck on beats 1 and 3, a sixteenth pickup on the last beat.
for (let b = 0; b * BEAT < DUR; b++) {
  const t0 = b * BEAT;
  const beatInBar = b % 4;
  const hits = beatInBar === 0 || beatInBar === 2 ? [t0] : beatInBar === 3 ? [t0 + BEAT * 0.75] : [];
  for (const start of hits) {
    const g = 0.16 * layer(start, BASS_AT);
    if (!g) continue;
    const f = midi(chordAt(start).root);
    const s0 = Math.floor(start * SR);
    for (let j = 0; j < SR * 0.55; j++) {
      const tt = j / SR;
      const env = Math.min(1, tt * 200) * Math.exp(-tt * 5);
      const v = g * env * (Math.sin(2 * Math.PI * f * tt) + 0.3 * Math.sin(4 * Math.PI * f * tt));
      add(s0 + j, v, v);
    }
  }
}

// Kick on 1 and 3, closed hats on eighths with a softer off-beat.
for (let b = 0; b * BEAT < DUR; b++) {
  const t0 = b * BEAT;
  if (b % 2 === 0) {
    const g = 0.42 * layer(t0, BEAT_AT, 0.01);
    const s0 = Math.floor(t0 * SR);
    let phase = 0;
    for (let j = 0; g && j < SR * 0.3; j++) {
      const tt = j / SR;
      phase += (2 * Math.PI * (45 + 90 * Math.exp(-tt * 28))) / SR;
      const v = g * Math.sin(phase) * Math.exp(-tt * 9);
      add(s0 + j, v, v);
    }
  }
  for (const half of [0, 0.5]) {
    const start = t0 + half * BEAT;
    const g = (half ? 0.05 : 0.035) * layer(start, BEAT_AT, 0.01);
    if (!g) continue;
    const s0 = Math.floor(start * SR);
    let prev = 0;
    for (let j = 0; j < SR * 0.05; j++) {
      const n = rand();
      const hp = n - prev; // crude high-pass for a crisp hat
      prev = n;
      const v = g * hp * Math.exp(-(j / SR) * 90);
      add(s0 + j, v * 0.8, v * 1.2);
    }
  }
}

// Bright arpeggio in eighths from the fix onwards, panned left and right.
for (let e = 0; e * (BEAT / 2) < DUR; e++) {
  const start = e * (BEAT / 2);
  const g = 0.05 * layer(start, ARP_AT, 2);
  if (!g) continue;
  const notes = chordAt(start).notes;
  const pattern = [0, 2, 1, 3, 2, 3, 1, 2];
  const f = midi((notes[pattern[e % 8]] ?? notes[0]) + 12);
  const pan = e % 2 ? 0.7 : 1.3;
  const s0 = Math.floor(start * SR);
  for (let j = 0; j < SR * 0.35; j++) {
    const tt = j / SR;
    const env = Math.min(1, tt * 400) * Math.exp(-tt * 9);
    const v = g * env * (Math.sin(2 * Math.PI * f * tt) + 0.2 * Math.sin(6 * Math.PI * f * tt));
    add(s0 + j, v * pan, v * (2 - pan));
  }
}

// Master: fades, soft clip, normalise to -1 dBFS, write 16-bit stereo WAV.
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = Math.min(1, t / 1.2) * Math.min(1, (DUR - t) / 2.5);
  L[i] = Math.tanh(L[i] * 1.2) * fade;
  R[i] = Math.tanh(R[i] * 1.2) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = (10 ** (-1 / 20)) / (peak || 1);
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + N * 4, 4);
buf.write('WAVEfmt ', 8);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm)) * 32767), 46 + i * 4);
}
writeFileSync(out, buf);
console.log(`wrote ${out}: ${DUR}s, peak normalised from ${peak.toFixed(3)}`);
