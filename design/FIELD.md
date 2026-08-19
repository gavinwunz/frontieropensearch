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
- **A chain that reaches the edge of the region re-seats the card it was
  pushing, rather than refusing.** This was found by running the model against
  a session-sized workload rather than by reasoning about it, and it matters:
  in any region that is merely busy, every push chain eventually reaches an
  edge, so refusing there meant that most ordinary drags did not work — while
  the seat the dragged card had vacated sat empty. An unpinned card has no
  position anybody chose, so the system may re-seat it exactly as it was free
  to seed it there. Refusal stays reserved for what it was written for: a
  position the user owns.

### Capacity, and what a full region does

A region holds what its extent and the minimum distance permit, which is the
"tens" of §3. Three things happen in order when a card arrives at a full region,
and the order is the design:

1. **Seed into a free seat.** The ordinary case.
2. **Evict the least recently used unpinned card**, dismissing it. This is §8
   rather than an eviction policy bolted on: dismissal is free and lossless, the
   Field holds what is in play, and a pinned card is never a candidate because
   the user put it there. Exactly one card is traded out, so arriving at a full
   region costs one dismissal and not a cleared board.
3. **Grow the region.** Needed when every card is pinned, and — the case only a
   real workload showed — when the freed seat is still covered by a card that
   was dragged off the seeding lattice, so the region has room that no lattice
   seat can reach. Growth is safe against §2 because the region level is scaled
   to fit and cannot be panned, so a taller region still has no empty reachable
   view.

**Placement must never fail.** It is driven by navigation, and a browser that
refuses to open a page because a canvas is untidy is not a browser. That is why
step 3 has no exit other than success.

**A drag climbs the same ladder, but skips the middle rung.** The re-seat rule
above answers "the push chain reached an edge"; it does not answer "and there
was no free seat", which is what a region at exactly its lattice capacity
always is. That case was reached by the drag path and refused, so 56 cards on
56 seats meant every drag was refused — not only a drag across the region, but
a drag of less than one seat-step, because until the dragged card has cleared
the minimum distance from the seat it vacated its own seat is not free either.
"You may not move anything" is not a corner of this design, it is the negation
of it: §2 says the user owns the layout.

So a drag that runs out of seats **grows the region**, on the same grounds step
3 already stands on. It does not evict. Eviction exists to bound the card count
against a page *arriving*, and a drag brings nothing — dismissing somebody's
page because they tidied would be a surprise the ladder never promised. A drag
seeds or grows, and never trades.

Growth is bounded by the arrangement rather than by the pointer: one added row
is a whole row of free seats, so the next pointer move of the same drag finds
one and grows nothing. Measured over twenty successive drags in a full region,
the region gained four rows and then stopped, and every refusal left was
`would-displace-pinned` — the one refusal this section wrote a rule for.

Open, and deliberately not decided here: a region's height only ever goes up.
Making it the smallest whole number of lattice rows that contains every card
would be tidier and cannot drift, but it is a derived quantity that changes
mid-drag, so it can rescale the region twice in one gesture. That is a worse
promise to break than an untidy height.

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

`done` is the same guarantee one level up, and it is in `GRAMMAR.md` §4 rather
than here because it is a statement about a trail that the Field then obeys.
`dismiss` takes a page off the Field and leaves it on its trail; `done` takes a
trail off the Field and leaves it in the store. Nothing is written to the nodes
when a trail is finished — a whole trail's worth of pages marked individually
dismissed would misreport what the user did, and would come back looking
discarded rather than filed if the trail were ever picked up again.

## 9. How to tell whether this was built as specified

Four properties, each falsifiable, each mapping to a decision above.

1. **No reachable view is empty.** There is no pan gesture at the overview and no
   sequence of zooms that lands on nothing. (§2)
2. **The system never moves a pinned card.** Resize the window, restart the
   browser, open twenty pages into the same region: every pinned card is where it
   was left, relative to its region. (§4)

   The restart clause was the last half of this to become true, and it was
   unbuilt for far longer than it looked: the table, the store method and the
   model's flag all existed and nothing joined them, so a restored session
   re-seeded every card and any arrangement the user had made was silently gone.
   What persists is *only* what a human chose. Seeding is deterministic, so an
   auto-placed card reproduces its own position for free, and writing a row for
   it would freeze a position the system is still entitled to revise. One
   consequence worth stating: a card that a *drag* displaced is not itself a
   chosen position, so it re-seeds to where provenance puts it rather than to
   where it was pushed. See `IDEAS.md` run 42.
3. **No two cards overlap, at any moment, including mid-drag.** (§6)
4. **Dismiss and restore is lossless**, scroll position included, in one command.
   (§8)
5. **Placement never fails and never refuses.** Navigating always produces a
   card, whatever state the region is in. (§6, capacity)

These live as `browser/components/fos/tests/unit/test_field.js`, run against a
session-sized workload rather than a handful of cards, because both defects
found so far were invisible at three cards and obvious at forty.

## 10. Open questions

Recorded rather than guessed at, to be settled by building.

- **Nesting at overload.** Collapsing the least recently touched regions into a
  region-of-regions (§3) is the obvious rule, but "least recently touched" may be
  the wrong metric — a trail parked deliberately is not a trail abandoned. The
  Context Engine has the dwell data to do better; revisit once 2C has real data.

  **Partly answered from the other end, by `done`.** The reason the metric had
  to guess is that nothing in the system knew which trails were finished, so it
  inferred it from silence. `done` lets the user say it outright, and a trail
  said to be finished leaves the Field entirely rather than being nested. That
  does not settle what to do with the trails nobody has said anything about —
  which is still the open half — but it takes the finished ones out of the
  population the metric has to guess over, which was the case it was worst at.
  A freed slot is given to the most recently touched nested region and a nest
  that empties gives its own slot back, so saying `done` buys back exactly the
  room the guess had taken.
- ~~**What a region looks like when its trail is a deep tree.**~~ **Settled: the
  structure is transient, and it is lineage rather than a tree.** See §11.
- **Whether pinning should be explicit as well as implicit.** Moving a card pins
  it. There may need to be a way to pin without moving, and to unpin. Cheap to
  add later, and premature to design before anyone has used it.

---

## 11. Lineage — the answer to §10's deep-tree question

A region is a trail, a trail is a tree, and §1–§8 treat regions as flat. The
question deferred until the rail existed was whether branch structure belongs
inside a region too.

**It does, but only while a card is focused, and as lineage rather than as a
tree.** Focus a card and its ancestors *within that region* stay lit while every
other card dims. Nothing is drawn persistently: no edges, no layout constraint,
no second rendering of the tree.

Three things decide it, and they pull in different directions until you notice
that they are answering different questions.

**Hierarchy earns its space at revisitation, and nowhere else.** PadPrints
(Hypertext '98) is the closest measured relative of this design — a zoomable
hierarchy of page thumbnails, tested against Netscape's own history — and its
two experiments split exactly along that line. On general browsing it produced
significantly fewer page accesses but *no* difference in task time. On tasks
that required returning to a page already seen, its users finished in 61.2% of
the time. Structure is not a constant benefit that justifies constant ink; it is
a benefit at the moment you are trying to get back to something.

**Users reach for proximity and leave explicit links alone.** That is the
consistent finding of the spatial-hypertext work already recorded in
`IDEAS.md`. Systems offering both an implicit spatial arrangement and an
explicit node-link overlay — Storyspace's map view, VKB — saw the spatial
relations do the work. And a persistent overlay is worse here than in those
systems, because the Field invites the user to drag cards: any edge set drawn
over an arrangement people rearrange becomes spaghetti inside a session.

**The rail already renders the tree properly.** §10's stated failure mode was
building the tree twice, and a transient highlight is not a second rendering —
it is derived from positions that already exist, which is why it survives a drag
without any maintenance.

The encoding is dimming the unrelated cards rather than tinting the chain. That
is not taste: three shades of outline on three neighbouring cards was not
tellable apart in a screenshot, and a highlight nobody can see is not a
highlight. It is the same correction Data Mountain made when it had to bind a
floating title to its thumbnail with a matching halo — contrast, not decoration.

### What this does not settle

Lineage is drawn *within one region*. A page reached from another trail has an
ancestor that is not in this region at all, and nothing on screen says so. That
is the trail-crossing case in `IDEAS.md`, and it belongs with the Context
Engine, which is where the relationship between trails is actually modelled.
