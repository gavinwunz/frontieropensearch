# The design system

What every chrome surface in Frontier OpenSearch is styled from.
`browser/components/fos/content/fos-tokens.css` is the declaration; this is
what it means and why. `browser/components/fos/tests/browser/browser_designsystem.js`
is what keeps both true.

The fork has four chrome surfaces — the command bar, the trail rail, the
context sidebar and the Field — plus the retired address bar. They were styled
as each one landed, in that order, and each was written against the platform's
token set. That was the right starting point and it is not sufficient: the
platform names roles for a settings pane, and a browser that replaces the tab
strip with a canvas and history with a tree has roles the platform has never
needed. Where those went unnamed, four surfaces invented four answers, and
three of them carry comments asserting they match one of the others.

## 1. The rule about names

**Where the platform names a role, use the platform's name unchanged.** There
is no `--fos-border-color`, because `--border-color` already means the right
thing and a second name for the same role is how two surfaces begin to
disagree. The fork's token layer holds only what the platform does not settle:

- the part of the type scale chrome is missing (§2),
- roles this fork has and Firefox does not — a mark, a quieted label, a
  selected row in a tree (§3–§5),
- the stacking order of surfaces that all float above the toolbox (§7).

`fos-tokens.css` is also the only FOS stylesheet permitted a literal value.

## 2. Type: three steps, and the one chrome does not give you

```
--fos-font-size-small   0.867rem   ~11.6px    detail, count, caption, mark
        (inherited)         1rem   ~13.3px    body — labels, titles, input
--fos-font-size-large   1.133rem   ~15.1px    a surface's own heading
```

Upstream's `font.tokens.json` gives `font.size.root` and `font.size.small` a
platform value of `unset`, deliberately: chrome tracks the OS font size rather
than imposing one. But `font.size.large` carries no platform override, so the
upper half of the scale applies in chrome while the lower half does not.
`font-size: var(--font-size-small)` in a chrome window does not set a small
size — it resolves to nothing, and the declaration falls back to inheriting.

The fork had twenty-two of those, across four surfaces. Every one of them was
asking for secondary text and rendering body text, which is most of why the
rail, the sidebar and the Field read as flat: a label and its detail, a title
and its count are primary/secondary pairs in all three, and they were
identical.

So the fork restores the missing step under its own name, and never assigns to
`--font-size-small`, so that no upstream widget in the window changes size. In
`rem`, because in chrome the root size *is* the OS size — the thing upstream
was protecting — and `rem` tracks it where `px` would not and `em` would
compound down a nested row. The ratio is the platform's own: 0.867 is as far
below the base as `large`'s 1.133 is above it, so what lands is the symmetric
scale upstream already describes with the half chrome drops put back.

**If upstream ever gives chrome a small size, delete this token and defer.**
The test asserts the platform token is still inert, so it will say so.

## 3. Quiet text is a colour, never an opacity

`--fos-text-color-quiet` is the only way to say "secondary". The fork had two
mechanisms for one intent — six declarations using the colour, fourteen using
`--opacity-deemphasized-strong` — and both appeared *within* the same
stylesheet.

Opacity is the wrong one for text, for two reasons that are not about taste:

1. **It applies to the subtree.** A row quieted by opacity takes its own mark's
   accent and its current-node rule down with it. That was live: a dismissed
   node in the rail lost both the letter it answers to and the marker saying
   you were standing on it, and the sidebar — whose comment claimed to match
   the rail — quieted only the label and so did not.
2. **It defeats contrast tooling.** Automated checkers read the declared colour
   rather than the composited result, so an opacity-dimmed label can fail
   WCAG 1.4.3 while every checker reports a pass.

**Opacity remains correct for de-emphasising a whole object**, where dimming
the subtree is the point. There is exactly one such case — the Field dimming
cards outside the focused card's lineage, which dims their thumbnails too — and
the test allows that rule by name and no other.

## 4. The mark is one object

A mark is a single letter standing for a single node, and the same letter
appears in the command bar, the rail, the sidebar and on a Field card. It is
the only object in the fork that must be recognised as the same thing in four
places, which makes it the one that least survives four opinions. It had five
treatments: monospace or not, semibold or bold, accent or button-text or
plain-text or dimmed grey.

One treatment now, from `--fos-mark-*`: monospace, small, semibold, accent.
Monospace because the glyph sits in a fixed column in three of the four
surfaces and a proportional letter makes that column jitter under each
keystroke.

The single permitted variation is a **plate**: a mark laid over a thumbnail or
a header needs a background to stay legible, so it gets
`--fos-mark-plate-background`. The plate varies; the letter does not.

## 5. Selection

`--fos-selected-background` and `--fos-selected-text-color` — one treatment for
keyboard selection in a list, wherever the list is. The sidebar had reached for
the button hover tokens plus an inset focus ring, which read as a different
kind of state from the identical row in the rail beside it.

Hover on an enterable row stays distinct from selection, because they mean
different things: hover is the pointer, selection is where the keyboard is.

**The focus ring goes on the selected row, not around the container holding
it.** Every one of the fork's three focusable containers — the rail's list, the
sidebar's body, the Field's stage — fills the window, so `:focus-visible` on
the container drew an accent rectangle 700px tall down the side of the browser,
next to a row shaded 20% grey. That put the loudest mark in the surface on the
box rather than on the page Enter was about to open, and it said twice, in two
visual languages, the one thing selection already means. Both README
screenshots showed it.

So the container's ring is conditional, and it is still there for the case the
condition names: a list with nothing selected, which has nothing else to carry
it. WCAG 2.4.7 is met either way, by the row or by the container.

The condition is `[aria-activedescendant]` on the container, not `:has()` a
selected row. The two are the same fact — every one of the three surfaces sets
and clears that attribute in the same breath as the selection — but `:has()`
makes every keystroke down a long trail invalidate a subtree match, and the
tree's own `no-has-selector` lint rule says so. The attribute is not standing
in for the state; it *is* the state, already declared to assistive technology.

Two declarations, not one, and the second is explicit `outline: none`. The rule
this replaced was never adding a ring — it was **overriding** the one the UA
stylesheet draws on any focused element. Deleting it handed the container back
a 1px grey `outline: auto`, which looked exactly like a change that had done
nothing. Only a live test could see that, which is why all three surfaces check
their own ring in a running window and not just here.

A panel also opens with a row already selected — the page you are on, in both
the rail and the sidebar — so in practice the container's branch is reached
only by a surface with nothing in it.

On the Field the same rule applies to a tile or a card, and the ring is a
**widening** rather than a recolour: a focused card may also be pinned or may
have just refused a drop, and those are the colours that have something to say.

## 6. Spacing

Two axes, both properties of the **surface** rather than of the row.

**Inline.** `--fos-gutter-panel` (0.75rem) and `--fos-gutter-dialog` (1rem):
the padding shared by every row, header and heading, so that labels down a
panel share one left edge. A flanking panel is 22–24rem and a centred dialog is
44rem, and the wider surface carries the wider gutter. This was already what
the surfaces did; it was simply never stated, so individual rows had begun to
drift off it.

**Block.** The first version of this section settled the inline axis and said
nothing about the other one, and four surfaces then answered it four ways: a
rail row padded itself `xxsmall`, a sidebar row and a command bar row `xsmall`,
and the sidebar's list of entities nothing at all. The rail and the sidebar are
open at the same time on either side of the page, listing the same nodes at
different line rhythms; and the entity list, at no rhythm, read as a paragraph
rather than as rows.

```
--fos-row-padding-block    0.25rem    a row in any list
--fos-list-padding-block   0.5rem     a scrolling body, above its first row
--fos-heading-space-above  0.5rem     above a group heading
```

A group heading takes a full step above and a **row's** step below, so it binds
to the rows it labels instead of floating between two groups.

An entity row now sits on the same rhythm as every other row. What makes an
entity a topic rather than a destination is that it carries no mark, no time
and no hover — not that it is packed tighter than the rows above it.

Rows inside a Field tile are miniatures rather than panel rows and are exempt
from both axes. That exception is stated here because it is the one the rule
needs.

## 7. Layers

```
--fos-layer-command   2147483647   command bar, its backdrop, the report line
--fos-layer-panel     2147483646   trail rail, context sidebar
--fos-layer-field     2147483645   the Field
```

Every FOS surface floats above the toolbox, which is a flex item carrying
`z-index: 0` and therefore paints over anything lower however far up the
document the surface is appended — which is why these sit at the top of the
range rather than at 10. At `z-index: 10` the command bar's dim covered the
content area only, leaving the chrome looking live while the bar held the
keyboard.

The order between them is a design statement, and it was previously three
hand-written integers near maxint in three files with nothing anywhere saying
which was meant to be on top. Command surfaces take the keyboard and must cover
what they act on; the panels flank; the Field is the backdrop the panels are
read against.

## 8. Weight

`--fos-font-weight-emphasis` (600) means "where you are" — the current node,
the spine of the trail, the selected row, a group heading. The rail said
semibold and the sidebar said bold for the same claim about the same node.

`--fos-font-weight-heading` (700) is a surface's own title, and nothing else.

## 9. Why the lint rule is off here, and what replaced it

`stylelint-plugin-mozilla/use-design-tokens` resolves custom properties only
within the file it is checking. The fork's tokens are declared in one file and
consumed from five, so the rule reads every `--fos-*` use as an unknown
literal. It is disabled for `browser/components/fos/**` in `.stylelintrc.js`.

Its intent is kept, and strengthened, by `browser_designsystem.js`, which
checks in a running chrome window that:

- every `--fos-*` token a surface uses is declared, and **resolves to a
  non-empty value** — the failure mode the lint rule cannot see and the one
  that cost the fork its small type;
- the three type steps are ordered around the chrome base, and each *sets* a
  size rather than inheriting one;
- the platform's `--font-size-small` is still inert, so the fork stops carrying
  its own the day that changes;
- no surface de-emphasises text with opacity, except the one object-level rule
  §3 names;
- no surface reaches for the dead platform token again;
- every list row in the window, in whichever surface, has the same block
  padding, and it is the token's — measured on real rows rather than read out
  of the stylesheet, which is the only way to catch a later rule overriding it;
- every container that declares a focus ring for itself also gives it up, in
  as many words, once it points at a descendant (§5) — the live half of that
  claim is in each surface's own test file, because a computed `outline: auto`
  coming from the UA stylesheet is invisible to any amount of reading.

A lint rule can only see what a stylesheet says. The bug this system was built
around was a stylesheet that said the right thing and meant nothing.
