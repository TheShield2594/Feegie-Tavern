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

| File | Pack |
| --- | --- |
| `kenney-CC0.txt` | Kenney — Nature / Fantasy Town / Furniture / Survival / Food kits, RPG Audio, Interface Sounds, Impact Sounds |
| `quaternius-CC0.txt` | Quaternius — Stylized Nature, Animated Animals, Animated Fish |
| `kaykit-CC0.txt` | Kay Lousberg — Characters, Character Animations, Resource Bits |
| `tallbeard-CC0.txt` | Tallbeard Studios — Music Loop Bundle |
| `polyhaven-CC0.txt` | Poly Haven — HDRIs |
| `fonts-OFL.txt` | UI font (SIL OFL 1.1 — the one licence here with a condition attached) |
| `freesound/<id>-<licence>.txt` | Individual Freesound ambience recordings |

Empty today: nothing has been downloaded yet. See `docs/ASSET_PLAN.md` §2.
