/**
 * Exercises `mixToMono`, the channel fold-down applied to positional sound
 * effects before they reach a `PannerNode`.
 *
 *   npm run audio:verify
 *
 * Worth a test of its own because the failure mode is quiet: a downmix that
 * halves amplitude, or reads one sample past the end of a channel, produces
 * audio that still plays and merely sounds wrong, which is exactly the kind of
 * bug that survives a listen-through. Runs under plain node — no Web Audio, no
 * browser — because the function deliberately takes Float32Arrays rather than an
 * AudioBuffer.
 */
import { mixToMono } from '../src/audio/downmix';
import { SOUNDS } from '../src/audio/sounds';

let failures = 0;

/** Records one assertion and prints it, so every check reports in one run. */
function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures += 1;
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
}

/** Float comparison, tight: these are sample values, not measurements. */
function near(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) < epsilon;
}

/** Runs `mixToMono` over plain arrays, so a case reads as its numbers. */
function mix(channels: number[][], length = channels[0]?.length ?? 0): number[] {
  const out = new Float32Array(length);
  mixToMono(channels.map((c) => new Float32Array(c)), out);
  return [...out];
}

// Identical channels must come through at their original level: a correlated
// stereo recording folded to mono should not drop 6 dB.
const correlated = mix([
  [0.5, -0.25, 1, -1],
  [0.5, -0.25, 1, -1],
]);
check(
  'identical channels preserve amplitude',
  correlated.every((v, i) => near(v, [0.5, -0.25, 1, -1][i])),
  `got [${correlated.join(', ')}]`,
);

// Distinct channels average.
const averaged = mix([
  [1, 0, -1, 0.5],
  [0, 1, 1, -0.5],
]);
check(
  'distinct channels average',
  averaged.every((v, i) => near(v, [0.5, 0.5, 0, 0][i])),
  `got [${averaged.join(', ')}]`,
);

// Anti-phase content cancels. This is inherent to any mono fold-down, not a
// defect — asserted so the behaviour is recorded rather than discovered later.
const antiphase = mix([
  [1, -1, 0.3],
  [-1, 1, -0.3],
]);
check('anti-phase content cancels to silence', antiphase.every((v) => near(v, 0)), `got [${antiphase.join(', ')}]`);

// Mono passthrough must be exact, including the sign of every sample.
const passthrough = mix([[0.1, -0.2, 0.3, -0.4]]);
check(
  'single channel passes through unchanged',
  passthrough.every((v, i) => near(v, [0.1, -0.2, 0.3, -0.4][i])),
  `got [${passthrough.join(', ')}]`,
);

// More than two channels (some packs ship quad) average across all of them.
const quad = mix([[1, 0], [0, 0], [0, 0], [0, 0]]);
check('four channels average across all of them', near(quad[0], 0.25) && near(quad[1], 0), `got [${quad.join(', ')}]`);

// A destination shorter than the source must be respected, not overrun.
const truncated = mix([[1, 1, 1, 1], [1, 1, 1, 1]], 2);
check('writes only out.length samples', truncated.length === 2 && truncated.every((v) => near(v, 1)), `got [${truncated.join(', ')}]`);

// Degenerate input must not produce NaN — a NaN sample poisons the whole graph
// and silences the mixer rather than just that one sound.
const empty = mix([], 3);
check('no channels yields silence, not NaN', empty.every((v) => v === 0), `got [${empty.join(', ')}]`);

const allFinite = [...correlated, ...averaged, ...antiphase, ...passthrough, ...quad, ...truncated, ...empty].every(
  (v) => Number.isFinite(v),
);
check('every sample produced is finite', allFinite);

// The flag only means anything for sounds that actually load a file.
const monoWithoutSrc = SOUNDS.filter((sound) => sound.mono && !sound.src);
check(
  'no sound is flagged mono without a src',
  monoWithoutSrc.length === 0,
  monoWithoutSrc.map((s) => s.id).join(', ') || 'none',
);

// Positional world effects are the ones that need folding; UI, music and
// ambience should keep their stereo width.
const monoOffChannel = SOUNDS.filter((sound) => sound.mono && sound.channel !== 'sfx');
check(
  'only sfx-channel sounds are flagged mono',
  monoOffChannel.length === 0,
  monoOffChannel.map((s) => `${s.id} (${s.channel})`).join(', ') || 'none',
);

console.log(
  failures === 0
    ? `\nAll downmix checks passed (${SOUNDS.filter((s) => s.mono).length} sounds flagged mono).`
    : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
