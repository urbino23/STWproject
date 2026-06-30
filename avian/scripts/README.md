# Illustrations

The frontend resolves a detection's scientific name to an image:
`cutout.php` turns `Calypte anna` into the slug `calypte-anna` and serves
`assets/illustrations/<slug>.{png,jpg}`. Anything that lands a correctly
named file in that folder shows up. There are two ways to fill it.

## A. Import finished plates (this fork)

This fork ships full Audubon *Birds of America* plates, named by common
name and mapped onto the BirdNET vocabulary by `import_plates.py`.

```bash
pip install -r requirements.txt

# dry run: report matches, skips, and slug collisions
python3 import_plates.py --source ~/plates

# install (downscale longest side to 1200px JPG); --replace clears the old set
python3 import_plates.py --source ~/plates --apply --replace
```

Source files are named by common name (`blue_jay.jpg`, `coopers_hawk.jpg`).
The script normalises the name, maps it to a scientific name via
`model/l18n/labels_en.json` *restricted to the BirdNET model vocabulary*
(so the slug matches what a detection emits), downscales, and writes
`<slug>.jpg`. It handles recent eBird/AOS renames the 6K v2.4 labels predate
(`ALIAS`), pins split common names to the binomial actually in the model
(`PIN`), and skips species the model doesn't know (`SKIP`). Edit those tables
at the top of the script for a different source set. After installing, bump
`IMG_VERSION` in `apt.js` so browsers drop cached copies.

Plates are single-pose; the flight tab (`?pose=2`) falls back to the perched
image automatically.

## B. Generate kachō-e (optional, legacy)

The original art was *generated* - kachō-e renders from Gemini, cut out and
shown as transparent silhouettes. That pipeline still works if you'd rather
have a generated set than finished plates:

1. `pregen.py` renders each bird with Gemini 2.5 Flash Image, on a flat cream ground.
2. `cutout.py` removes the ground with BiRefNet and crops to the bird.
3. `verify.py` (optional) runs an adversarial species-ID + anatomy check.

```bash
export GEMINI_API_KEY='your-key'

# 1. generate (cream ground) for your region's species
python3 pregen.py --labels ~/BirdNET-Pi/model/labels.txt --ebird-region US-CA

# 2. cut the ground off and crop
python3 cutout.py
```

`--labels` takes any `Sci|Com` per-line file (BirdNET-Pi's `labels.txt` works
directly). `--ebird-region` filters to species actually seen in your region
(needs `EBIRD_API_KEY`). Re-render one bird with
`--species "Calypte anna|Anna's Hummingbird" --force`.

> Note: the homepage is now a grid of whole plates, not the old silhouette
> collage, so there is no longer a mask-building step. `build_masks.py` was
> removed with the collage.

### Why a cream ground

The image model can't cut a clean transparent background on its own: it
leaves holes and fringes, worst on pale birds. Rendering on a flat,
consistent cream ground gives a known color that BiRefNet removes cleanly,
and the steady ground also holds the painting style together across the
whole set. `cutout.py` is the step that makes the backgrounds transparent.

### The prompt

`prompt.template.md` is the kachō-e prompt, sent verbatim per request with
`{sci_name}`, `{com_name}`, and `{pose}` substituted. Edit it to change the
style. `pregen.py` attaches up to three reference images per request:

- **Anatomy** (IMAGE 1): a Wikipedia photo of the target species, auto-fetched
  and cached in `assets/references/`. Anchors identity and markings. Drop your
  own `references/<slug>.jpg` to override.
- **Anti-reference** (IMAGE 2, optional): a photo of a look-alike the model
  drifts toward, captioned with what NOT to copy. Wired for blue corvids (vs
  Blue Jay) and swallows (vs Barn Swallow); add more in the `ANTI_REFS` table
  and place photos at `references/_anti_<key>.jpg`.
- **Style** (IMAGE 3, optional): a real Edo-period kachō-e print whose painting
  technique is borrowed. The genus-to-print mapping is in `pregen.py`'s
  `STYLE_REFS`. The prints are not bundled (they are someone else's art); put
  your own in `assets/references/styles/`. The Koson and Yoshida prints used
  originally are easy to find on the public web by the filenames in `STYLE_REFS`.

All three degrade gracefully: a missing reference is simply not attached.

### Hard species

`species-notes.json` holds one-line diagnostic addenda for species the model
gets wrong. Each note names the field marks that matter and the look-alikes to
avoid, and is appended to the prompt for that species. Add entries as you find
drift; they carry forward to every future regeneration of that bird.

### Verifying

`verify.py` sends each illustration back through Gemini Vision without telling
it the target species, then checks the guess, the wing/leg/tail counts, and
whether a stray perch crept in. It catches drift a quick eyeball misses.

```bash
python3 verify.py --labels labels.txt              # whole library -> verify-results.csv
python3 verify.py --labels labels.txt calypte-anna
```

### What actually goes wrong

- **Sticks.** Perched raptors often come back gripping a twig the prompt
  forbade. Generate 2-3 and keep the clean one.
- **Species drift.** The model collapses an uncommon species toward a common
  look-alike (a swift becomes a swallow). Fixes, in order: a sharper
  `species-notes.json` note with anti-feature language; an anti-reference; a
  different style print; a one-off `--species` regen.
