# Bird illustration prompt

This is the prompt sent to Gemini for every bird illustration. Edit it
to change the style — the entire visual feel of the collage flows
through this template.

Three placeholders get replaced per request:

- `{sci_name}` — the binomial Latin name, e.g. `Calypte anna`
- `{com_name}` — the English common name, e.g. `Anna's Hummingbird`
- `{pose}` — either `perched` (pose 1) or `in flight with wings spread` (pose 2)

The default style below is **kachō-e** — Edo-period Japanese
flower-and-bird woodblock prints, rendered in ink and watercolor.
Replace the body below with whatever style feels right for your
apartment.

---

## Prompt

Generate a {pose} {com_name} ({sci_name}) in the style of an Edo-period
Japanese kachō-e woodblock print. Confident sumi-e ink linework with
soft watercolor washes. Earthy, restrained palette — burnt umber,
ochre, indigo, vermillion, muted greens. Plumage details rendered with
short directional brush strokes; eye, beak, and feet drawn with crisp
ink. The bird should be the only subject — NO background, NO branch
unless the pose requires it (a single sparse twig is fine for
perched), NO border or frame, NO text or signature.

Anatomy must be biologically accurate for the named species:

- Exactly two wings. Two legs. One head. One beak. One tail.
- Posture and feather pattern matching {com_name} field-guide
  references — color, markings, and body proportions must match the
  real bird.
- For perched poses: one wing folded against the body, the other
  tucked behind. For flight: both wings extended in a natural flapping
  position.

Render at high resolution on a fully transparent background. The bird
must be cut out cleanly — no shadow, no paper texture, no caption.
