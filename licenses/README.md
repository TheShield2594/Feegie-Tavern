# Licence files

The original, unedited licence text for every bundled asset pack.

**These files are the authoritative record.** `ASSET_CREDITS.md` at the repo root
is a generated summary of them and can be rebuilt at any time with
`npm run assets:credits`; the files here cannot be regenerated and must never be
edited, reformatted, or replaced with a summary.

## Rules

- One file per pack, named `<pack>-<licence>.txt`, copied verbatim out of the
  downloaded archive.
- A pack whose archive contains no licence file does not ship. The licence
  stated on a download page is not a substitute for the one in the archive — if
  they disagree, the asset is dropped and the discrepancy reported.
- Per-file licensing (Freesound, where each sound carries its own terms) gets a
  file per asset under `freesound/`, named for the sound id.

## Expected contents

Per `docs/ASSET_PLAN.md` the project ships CC0 art and audio only, so most of
these will be the same CC0 1.0 dedication from different creators. They are
still kept separately: the point is to be able to trace any single mesh or
sound back to the archive it came from.

Kenney ships a *separate* `License.txt` per pack — same CC0 grant, but different
pack name, version and date in each — so they are kept one-per-pack rather than
collapsed into a single `kenney-CC0.txt`. Collapsing them would mean editing at
least one of them, which the rule above forbids.

### Present

| File | Pack | Verified |
| --- | --- | --- |
| `kenney-nature-kit-CC0.txt` | Kenney — Nature Kit 2.1 | CC0, read in-archive 2026-09-14 |
| `kenney-rpg-audio-CC0.txt` | Kenney — RPG Audio | CC0, read in-archive 2026-09-14 |
| `kenney-interface-sounds-CC0.txt` | Kenney — Interface Sounds 1.0 | CC0, read in-archive 2026-09-14 |
| `kenney-impact-sounds-CC0.txt` | Kenney — Impact Sounds 1.0 | CC0, read in-archive 2026-09-14 |
| `kenney-fantasy-town-kit-CC0.txt` | Kenney — Fantasy Town Kit 2.0 | CC0, read in-archive 2026-09-14 |
| `kenney-survival-kit-CC0.txt` | Kenney — Survival Kit 2.0 | CC0, read in-archive 2026-09-14 |
| `kenney-furniture-kit-CC0.txt` | Kenney — Furniture Kit 2.0 | CC0, read in-archive 2026-09-14 |
| `kenney-food-kit-CC0.txt` | Kenney — Food Kit 2.0 | CC0, read in-archive 2026-09-14 |
| `fonts-OFL.txt` | Nunito (UI font) | **SIL OFL 1.1** — the one licence here with a condition; shipping this file is the condition |

### Not yet present

Nothing below has shipped, so no licence file exists for it. See
`docs/ASSET_PLAN.md` §9 for why each is still outstanding.

| File | Pack |
| --- | --- |
| `quaternius-CC0.txt` | Quaternius — Stylized Nature, Animated Animals, Animated Fish |
| `kaykit-CC0.txt` | Kay Lousberg — Characters, Character Animations, Resource Bits |
| `tallbeard-CC0.txt` | Tallbeard Studios — Music Loop Bundle |
| `polyhaven-CC0.txt` | Poly Haven — HDRIs |
| `freesound/<id>-<licence>.txt` | Individual Freesound ambience recordings |
