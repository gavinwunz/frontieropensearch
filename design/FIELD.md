# The Field

The specification for pillar A: the surface that replaces the tab strip.

The command grammar that drives it is in `design/GRAMMAR.md`; the data it emits
is in `context-engine/SCHEMA.md`. The research and the verdicts behind every
decision here are in `agent/IDEAS.md` — this file is the design that follows
from them, not the argument for it.

---

## 1. What the Field is for

The Field replaces the tab strip. That is a strong claim, so it is worth being
precise about what is actually wrong with the thing being replaced, because the
answer is not "tabs are ugly" and it is not "there are too many of them".

From the tab-hoarding threads recorded in `IDEAS.md`: **a tab is unfinished
work.** People keep hundreds open not because they cannot find them but because
closing one loses the scroll position, the form state, and the reason it was
opened — so closing feels like abandoning the task. Bookmarks are where tabs go
to die. The strip is merely where the symptom is visible.

So the Field's job is not prettier switching. It is to make **closing things
cost nothing**, and to make **finding them again a matter of remembering where
you put them** rather than reading a row of 12-pixel favicons.

Two pieces of evidence set the shape of everything below.

- **Data Mountain** (UIST '98) measured a spatial layout of 100 page thumbnails
  against a bookmark list and beat it reliably on retrieval time, wrong
  retrievals, and outright failures to find the page. Spatial retrieval works.
- The same paper says the layouts that produced that result were **made by the
  user, by hand**, and contrasts itself with PadPrints, which used automatic
  layout "for short term use". Spatial memory is memory for where *you* put
  something. A position the system chose is not a place you remember.

That second point is the one that governs this design, and it is why the Field
is not "a canvas that arranges your tabs for you".

## 2. Decision 1 — the Field is bounded, not infinite

**This departs from the phase plan, which says "an infinite, zoomable spatial
canvas". The Field is finite. The overview always shows everything and always
fits the window.**

The reason is *desert fog* (Jul and Furnas, UIST '98): a view containing no
information on which to base a navigational decision. An infinite plane is
almost entirely empty, so almost every view reachable by panning or zooming is
featureless — and a user who lands in one has no way to tell which direction
anything lies in. Infinity does not add capacity here. It adds places to be lost
in.

It is also worth noting which of the two designs had evidence behind it: Data
Mountain deliberately used "a fixed viewpoint, so users need not navigate around
the space", and won. Navigability was not the feature. Getting to a known place
in one gesture was.

So:

- The overview is the **whole world, scaled to fit**. There is no pan at the
  overview level and no viewport that can be moved off the content.
- Growth is absorbed by the level structure in §3, never by the plane getting
  bigger.
- Zoom survives, because zoom is what shows a card *growing out of the region it
  belongs to*, which is the provenance made visible. But it moves between the
  defined levels in §3 rather than over a continuum of arbitrary scales.

Every reachable view therefore has content by construction. That is Jul and
Furnas's critical-zone insight applied at design time, instead of as a
wayfinding aid bolted on to a design that needed rescuing.

## 3. Three levels, not a continuum

Zoom is a **semantic** operation. Each level renders a different kind of object,
not the same objects at a different size.

| level | renders | how many | bounded by |
|---|---|---|---|
| **Overview** | regions — one per trail | 5–9 | the 6–7 item working-memory limit |
| **Region** | cards within one trail | tens | non-occlusion (§6) |
| **Page** | one page, filling the window | 1 | — |

Transitions between levels are animated and continuous — the card you entered
visibly grows out of its region and collapses back into it, so the spatial
relationship survives the transition. What is *addressable* is the three levels;
what is *rendered* during the move between them is a continuous zoom. The
animation is not decoration: it is the only thing that tells the user where the
page they are now looking at sits relative to everything else.

The overview shows regions rather than pages because of the 6–7 item limit
already recorded in `IDEAS.md`. Rendering 200 cards at once does not defeat that
limit, it relocates it. When trails exceed nine, the overview nests — the least
recently touched regions collapse into a single region-of-regions — rather than
the plane growing or the cards shrinking.

## 4. Decision 2 — the system seeds, the user owns

Every card has a position. Where it comes from is the crux of the design.

**A new card is auto-placed inside the region of the trail it came from.** That
is the seed, and it is what makes the Field usable from the first second without
any arranging. Placement means exactly one thing, always: **provenance — which
trail this page came from.** Never topic similarity, never recency, never
frecency.

Provenance is also what keeps this out of Smart Tab Grouping's territory. The
base browser already groups open tabs by topic using local embeddings, so
"clusters your pages by subject" is a shipped feature under a different name and
cannot be the Field's claim. Where a page *came from* is information a topic
model does not have and cannot recover.

**The moment the user moves a card, that card is pinned, and the system may
never move it again.** Not to make room, not to rebalance a region, not on
restart, not when the window resizes. A pinned card holds its position relative
to its region for as long as it exists.

This is the Data Mountain finding turned into an invariant. If the system is
free to tidy up, then position is not a place the user chose, no spatial memory
forms, and the Field degrades into a prettier tab strip with worse density. The
invariant is the feature.

It also gives the Field an honest answer to "what if I do not want to arrange
anything?" — then you never move a card, you get provenance clustering for free,
and you have lost nothing. Arrangement is optional work that pays a return only
to the people who do it, which is the correct bargain. It is the same bargain
Data Mountain's subjects took, and they took it for 100 pages.

**A pinned position is evidence.** Where the user chose to put a card — and next
to what — is an input to context membership, per the spatial-hypertext entry in
`IDEAS.md`. The weakest useful version ships first: proximity between two
manually placed cards contributes to their being in one context. Nothing more
elaborate until that proves out.

## 5. Regions are trails, and every region has a name

The Field's regions are not a second organising structure. **A region is a
trail** — the same object specified in pillar B, with the same name, the same
mark, and the same lifetime.

This is deliberate and it is what stops the Field decaying into the mess that
canvas tools in the wild are criticised for. The rule from that criticism:
*named regions are searchable, unnamed space is not.* Because a region is a
trail, and trails are nameable first-class objects with a `name` verb already in
the grammar, every region in the Field is reachable from the command bar by name
without touching the canvas at all.

So the Field is never the only way to get anywhere. It is the spatial view of a
structure that is equally addressable textually, and a user who cannot remember
where they put something types its name instead. Data Mountain's subjects did
exactly this in miniature — spatial memory got them to the neighbourhood, then
they riffled titles for the last metre.

Region boundaries are drawn persistently, and a region keeps its position across
sessions. Wayfinding research is consistent that stationary landmarks are what
make a space learnable; a region that moves between sessions is not a landmark.

## 6. The non-occlusion invariant

**Cards never overlap. At any level. Under any operation.**

This is not a polish item, it is the single largest measured effect in the Data
Mountain study: under its first collision model "some users effectively lost many
pages due to occlusion", and the fix — maintaining a minimum distance between all
pages at all times, propagating displacement transitively to neighbours — was
judged to have "contributed most to improved user performance" in the second
group of subjects.

Adopted with one modification that our design forces:

- Minimum spacing between cards is maintained continuously, including *during* a
  drag, so what the user sees mid-drag is exactly the state that results when
  they let go. No settle animation, no surprises.
- Displacement propagates to neighbours — but **only through unpinned cards. A
  pinned card is never displaced.** Data Mountain's remaining complaint was that
  a pushed cluster produces "more visual unrest than is really desirable"; here
  the unrest is confined to cards nobody has claimed a position for.
- If a drop would require displacing a pinned card, the drop is refused and the
  dragged card returns to its origin. Refusing is correct: the alternative is
  silently destroying a position the user deliberately chose.

## 7. The card

A card carries three things, and the reason for each is measured.

1. **A thumbnail.** Data Mountain's combined thumbnail-plus-text cue was its
   fastest condition and title-only was its weakest — while in the bookmark list
   the ordering reversed and thumbnails actively hurt. A spatial switcher and a
   list want opposite cues, so a card showing only a favicon and a truncated
   title is a list with extra steps and none of the benefits.
2. **A title, bound to its card, with no hover delay.** Both details are
   corrections Data Mountain made after watching users fail. A tooltip delay
   "precluded rapid inspection of multiple titles", and a floating title that
   users could not attribute to a thumbnail had to be tied to it with a matching
   coloured halo. Titles appear immediately and are visually bound to their card.
3. **Its mark** — the sticky letter from `design/GRAMMAR.md`, displayed on the
   card, spoken as its alphabet word. This is how `enter cap` and typing `c`
   resolve through one path, and it is why the Field needs no separate
   accessibility mode.

### Cards are snapshots, not live browsers

The phase plan says "live-thumbnail cards". Taken literally that means every open
page painting at once, and in Gecko every page is a `<browser>` backed by its own
content process which is deliberately deactivated when not selected. Fifty live
cards is fifty processes rendering to fill a switcher.

The tree already provides the pieces for the affordable version:

- `PageThumbs.captureToCanvas(browser, canvas, args)` renders a browser to a
  canvas through `drawSnapshot`, with `BackgroundPageThumbs` for off-screen
  capture and an existing storage service behind it. `tab-hover-preview.mjs`
  already uses this path for tab previews — reuse it, vendor nothing.
- `docShellIsActive` and `renderLayers` are separable on a remote browser:
  setting the former drives the latter, but `renderLayers` can be set on its own,
  so a browser can keep painting without being the active docshell.

Therefore: **a card is a cached snapshot**, captured on navigation, on dismissal,
and on leaving the page level. The focused card renders live. The number of live
cards is a pref-controlled budget, not a property of the design, so it can be
tuned or raised on capable hardware without any of the above changing.

Nothing is lost by this. Data Mountain's thumbnails were static 64×64 images and
it still beat the list on every measure.

## 8. Dismissal is free, and that is the point

`dismiss <mark>` removes a card from the Field. The page stays on its trail with
its scroll offset and form state intact, and one `enter` restores it — including
the scroll position, which `nsISHEntry` already carries (see `IDEAS.md`).

This is the load-bearing guarantee of the whole pillar. If dismissal is lossy,
users will not dismiss, the Field fills up, and we have built one more surface to
hoard on — at which point the project has failed at the one problem it set out
to solve. Every other decision here is negotiable. This one is not.

The corollary is that the Field is **not** where pages accumulate. It holds what
is in play. Trails hold everything that ever happened, losslessly, and the
Context Engine is what searches it. A user who dismisses aggressively should end
up with a better browser, not a worse one — that is the test.

## 9. How to tell whether this was built as specified

Four properties, each falsifiable, each mapping to a decision above.

1. **No reachable view is empty.** There is no pan gesture at the overview and no
   sequence of zooms that lands on nothing. (§2)
2. **The system never moves a pinned card.** Resize the window, restart the
   browser, open twenty pages into the same region: every pinned card is where it
   was left, relative to its region. (§4)
3. **No two cards overlap, at any moment, including mid-drag.** (§6)
4. **Dismiss and restore is lossless**, scroll position included, in one command.
   (§8)

## 10. Open questions

Recorded rather than guessed at, to be settled by building.

- **Nesting at overload.** Collapsing the least recently touched regions into a
  region-of-regions (§3) is the obvious rule, but "least recently touched" may be
  the wrong metric — a trail parked deliberately is not a trail abandoned. The
  Context Engine has the dwell data to do better; revisit once 2C has real data.
- **What a region looks like when its trail is a deep tree.** A region is a trail,
  but a trail is a tree, and this spec treats regions as flat. Whether branch
  structure should be visible inside a region, or stay in the trail rail where it
  is already rendered, is undecided. Resolve it after the rail exists — building
  the tree twice in two surfaces is the failure mode to avoid.
- **Whether pinning should be explicit as well as implicit.** Moving a card pins
  it. There may need to be a way to pin without moving, and to unpin. Cheap to
  add later, and premature to design before anyone has used it.
