/**
 * Channel downmixing for positional sound effects.
 *
 * A `PannerNode` spatialises a *mono* source. Hand it a stereo buffer and the
 * existing left/right content fights the panner's own placement, so a footstep
 * meant to come from a specific point on the island arrives smeared across both
 * ears instead. The Kenney packs ship their effects in stereo, so anything the
 * game will eventually position in the world has to be collapsed to one channel
 * first — see `docs/ASSET_PLAN.md` §5 ("mono for positional SFX").
 *
 * Kept as a free function with no Web Audio types in its signature so the
 * arithmetic can be exercised directly under node: `npm run audio:verify`.
 */

/**
 * Averages `channels` into `out`, writing `out.length` samples.
 *
 * Simple averaging, which is what the Web Audio spec itself uses for a
 * stereo-to-mono down-mix (`0.5 * (L + R)`). For the correlated material that
 * real recordings consist of this holds perceived loudness; for deliberately
 * anti-phase content it cancels, which is inherent to any mono fold-down rather
 * than a property of this implementation.
 *
 * `out` may be shorter than the source channels; only its own length is written,
 * so a caller cannot overrun the destination buffer.
 */
export function mixToMono(channels: readonly Float32Array[], out: Float32Array): void {
  const count = channels.length;
  if (count === 0) {
    out.fill(0);
    return;
  }
  if (count === 1) {
    out.set(channels[0].subarray(0, out.length));
    return;
  }

  const scale = 1 / count;
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let c = 0; c < count; c++) sum += channels[c][i];
    out[i] = sum * scale;
  }
}
