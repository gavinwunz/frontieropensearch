# IDEAS

The research log. Every interface idea considered, with a verdict and a reason —
including the rejected ones, so no future run reconsiders ground already covered.

## Format

One entry per idea. Append; never delete an entry, even a rejected one.

```
### <Idea name>
- **Found:** <where — search terms, source URL, date>
- **What it is:** <two lines maximum>
- **Verdict:** adopt / adapt / reject
- **Why:** <which of the four criteria it passes or fails>
- **Phase:** <if adopted — where it gets built>
```

## The four criteria

An idea is adopted only if it clears all four:

1. Genuinely novel or genuinely unshipped — not a Chrome feature renamed.
2. Actually more useful — name the task it makes faster and what it replaces.
3. Implementable in Gecko's frontend — no special hardware, no cloud service, no
   model that can't run locally.
4. Coherent with the Field, Trails, or the Context Engine — it strengthens one of
   the three rather than adding a fourth paradigm.

Most novel interface ideas are novel because they are bad. The value of this file
is in the rejections as much as the adoptions.

## Starting leads

Not yet researched. Nothing below is adopted — these are search directions for
Run 1 onward, to be replaced by real entries.

**Hands-free and non-pointer input** — voice-first search, gaze and dwell
selection, head tracking, switch control, gesture input. Accessibility research
is decades ahead of mainstream browser UI and largely unmined.

**The unbuilt canon** — Vannevar Bush's memex and associative trails; Ted
Nelson's Xanadu and transclusion; Engelbart's NLS; Xerox PARC; HyperCard; Bret
Victor on dynamic media; spatial hypertext (VIKI, Tinderbox); Alan Kay on the
desktop metaphor's failure. Much of what was promised between 1960 and 1995 was
never shipped.

**Adjacent tools that solved this better** — tiling window managers; Zettelkasten
and graph views in Obsidian and Roam; node-based editors in Blender, Houdini,
Figma; DAW timelines; Kagi; Arc and Zen (learn from what failed, not only what
worked); terminal multiplexers; tldraw and infinite canvases.

**Emerging input and output** — spatial computing interaction patterns; ambient
and peripheral displays; agentic browsing; local on-device models for clustering
and summarisation; CRDTs for offline-first state; radial and marking menus;
command palettes done properly.

**Real pain** — Reddit, Hacker News, and blog complaints about tabs, history,
bookmarks, and search. Tab hoarding, lost context, the back button destroying a
branch, bookmark graveyards. Real complaints beat invented personas.

---

## Entries

### Firefox already ships a local ML runtime (`toolkit/components/ml`)
- **Found:** 2026-08-18, `./mach bootstrap` pulling an `onnxruntime` toolchain, then reading the tree directly.
- **What it is:** An in-tree, on-device inference stack: ONNX Runtime, a vendored
  Transformers.js, `nlp/EmbeddingsGenerator.sys.mjs`, `ClusterAlgos.sys.mjs`, and a
  `backends/llama` directory. It runs in a dedicated engine process, models cached in OPFS.
- **Verdict:** adopt — as infrastructure, not as a feature.
- **Why:** Criterion 3 was the live risk for the Context Engine: local clustering with no
  cloud. It is already solved in-tree, tested, and shipping. Embeddings for query and page
  text, cosine distance, and cluster assignment are all available without adding a single
  dependency. Building our own would be strictly worse.
- **Phase:** 2C. `EmbeddingsGenerator` backs context clustering; `ClusterAlgos` backs the
  cluster assignment step. Do not vendor anything new.

### Smart Tab Grouping already ships in Firefox
- **Found:** 2026-08-18, `browser/components/tabbrowser/SmartTabGrouping.sys.mjs` in the tree.
- **What it is:** Firefox already groups tabs by topic using local embeddings, with tests
  and telemetry, and suggests group names.
- **Verdict:** reject as a novelty claim; adopt as prior art to reuse.
- **Why:** Fails criterion 1 outright. "The Field auto-clusters your open pages by topic" is
  a feature the base browser has under a different name. This is the single most important
  correction this run produced: the Field cannot be justified by clustering.
  What survives as genuinely unshipped is the rest of it — a zoomable spatial canvas as the
  *only* page switcher, clustering by **provenance** (which trail a page came from) rather
  than by topic similarity, and dismissal that is non-destructive because Trails retain the
  page. Clustering is a supporting detail, not the idea.
- **Phase:** 2A. Read `SmartTabGrouping.sys.mjs` before writing Field clustering and reuse
  its engine plumbing.

### Tabs are unfinished work, not bookmarks
- **Found:** 2026-08-18, Hacker News tab-hoarding threads (items 46529797, 46530684, 23175643).
- **What it is:** The recurring complaint is not that tabs are hard to find. It is that a tab
  is an open loop — unfinished work — and closing it feels like abandoning the task, because
  reopening loses the scroll position and the in-page state that made it useful. Bookmarks
  are where tabs go to die, which is why people keep thousands open instead.
- **Verdict:** adopt as the central design constraint for the Field.
- **Why:** Criterion 2, stated precisely. The task made possible is *closing things without
  losing them*. A card dismissed from the Field must remain in its trail with scroll offset
  and form state intact, and must be restorable in one keystroke. If dismissal is lossy, the
  Field becomes another surface to hoard on and the project has failed.
- **Phase:** 2A and 2B jointly — dismissal is a Field gesture whose durability is a Trails
  guarantee. Restoring scroll position is a hard requirement, not polish.

### The 6–7 item overview limit
- **Found:** 2026-08-18, same threads — "open tabs function like working memory, but more
  than 6-7 makes it harder to keep an overview".
- **What it is:** A ceiling on how many peers a person can hold in mind at once, independent
  of how they are displayed.
- **Verdict:** adopt as a constraint that bounds the Field's design.
- **Why:** It is a direct argument against the naive version of the Field. Rendering 200
  cards on an infinite canvas does not defeat the limit; it relocates it. The zoomed-out
  view must therefore show *clusters* as single objects — roughly 5–9 of them — and only
  expand to individual cards on approach. Zoom is a semantic operation, not a scale one.
- **Phase:** 2A. The overview level renders trails, not pages.

### Spatial hypertext: the spatial parser and constructive ambiguity
- **Found:** 2026-08-18, Marshall and Shipman on VIKI; "Spatial Hypertext: An Alternative to
  Navigational and Semantic Links" (cs.brown.edu/memex/ACM_HypertextTestbed/papers/37.html).
- **What it is:** VIKI let users arrange items freely, then ran a *spatial parser* over the
  layout to infer structure — lists, stacks, composites — from clustering and shared visual
  adornment. The claim is "constructive ambiguity": a link exists or it does not, but
  proximity can express a relationship the user cannot yet articulate.
- **Verdict:** adapt.
- **Why:** Passes all four. It is genuinely unshipped in browsers, and it inverts the usual
  flow: instead of the browser clustering for you, where you *put* a card is evidence about
  what you think, and that evidence feeds the Context Engine. It makes the Field's manual
  arrangement load-bearing rather than decorative, which is what stops a spatial canvas
  decaying into a messy desktop.
- **Phase:** 2A into 2C. Start with the weakest useful version — proximity between manually
  moved cards contributes to context membership — and only add list/stack parsing if the
  simple version proves out.

### Gaze and dwell selection for the hands-free path
- **Found:** 2026-08-18, dwell-time and gaze-interaction literature (Majaranta et al.;
  "Designing for the eye"; dwell-then-gesture work).
- **What it is:** Selection by resting gaze on a target for a fixed period. The two standing
  problems are the Midas touch (unintended activation) and limited tracking accuracy,
  mitigated by large targets and short dwell.
- **Verdict:** reject for this project.
- **Why:** Fails criterion 3. It needs an eye tracker. The command grammar should stay
  *capable* of being driven by dwell — every action addressable by name, targets large enough
  to dwell on — but building the gaze path itself is out of scope.
- **Phase:** none. Revisit only if the grammar work makes it near-free.

### The Web Speech API is cloud-only in Gecko
- **Found:** 2026-08-18, `dom/media/webspeech/recognition/` contains only
  `OnlineSpeechRecognitionService.cpp`.
- **What it is:** Gecko's speech recognition ships a single backend that posts audio to a
  remote service.
- **Verdict:** reject the API; adopt local Whisper on the in-tree ML runtime instead.
- **Why:** "No cloud, ever" is a project rule, so the obvious path is closed. The in-tree ML
  runtime already vendors Transformers.js, which supports Whisper ONNX models, and already
  has a model cache and an engine process. That makes voice the hands-free path that clears
  criterion 3 — unlike gaze, it needs only a microphone.
- **Phase:** 2. Voice is the one hands-free path built end to end, driving the same command
  grammar as the keyboard. Push-to-talk, not always-listening, to avoid the Midas touch
  problem in its audio form.


### Nyxt shipped the history tree already (atlas-engineer/history-tree)
- **Found:** 2026-08-18, searching for tree-history prior art;
  https://github.com/atlas-engineer/history-tree
- **What it is:** A Common Lisp library backing the Nyxt browser's *global* history tree.
  Models "owners" (tabs) with a current node each over one shared tree, so several tabs
  navigate interleaved branches of the same structure. States the problem exactly as this
  project does: "A -> B, go back to A, then to C — linear history becomes A -> C. We lost
  the information that we visited B."
- **Verdict:** adapt, and drop any claim that branching history is unshipped.
- **Why:** Criterion 1 is only partly met — a real browser ships this. What remains novel is
  not the tree but what Trails do *with* it: restoring scroll and form state on node re-entry,
  and being nameable, exportable objects that feed the Context Engine. Nyxt's tree is a
  navigation structure; Trails are a memory structure. Say it that way and stop overclaiming.
  Its stated limitation is the one to design against: **unbounded growth** — nodes are only
  freed when their owner disappears, so the tree grows forever. Trails need an explicit
  pruning or archival policy from day one, not bolted on once it is slow.
- **Phase:** 2B. Read this model before designing the node/owner relationship; adopt the
  separation of "owner's current node" from "the tree" so several cards can sit on one trail.

### A tree you can only look at is a curiosity
- **Found:** 2026-08-18, Tree Style History user reviews (chrome-stats.com, Chrome Web Store).
- **What it is:** The most-repeated complaint about the main tree-history extension is not
  the tree — it is "you can't manage the history at all, only view it tree style and that's
  it", alongside "the interface isn't the most intuitive".
- **Verdict:** adopt as the acceptance bar for 2B.
- **Why:** Criterion 2, sharpened by a decade of someone else's user feedback. Visualising
  history as a tree adds a pretty panel and no capability; every action a user wants —
  re-enter a branch, name it, prune it, export it — has to be performed *on* the tree, or
  Trails is the same curiosity with better typography. Concretely: no read-only tree rail
  ships. Every node supports re-entry, rename, prune and export from the keyboard.
- **Phase:** 2B.

### The HTML spec does not require history to be presented linearly
- **Found:** 2026-08-18, MDN History API and whatwg/html#7832 discussion.
- **What it is:** The spec defines the linear `history` object exposed to content, but
  explicitly does not define how that list is derived from the real session history, and
  does not restrict how implementations present session history to the user.
- **Verdict:** adopt as the standards-compliance argument.
- **Why:** Removes the main criterion-3 worry about Trails — a branching UI is not a spec
  violation, and content-facing `history.length` and `history.back()` can keep their linear
  semantics while the *user-facing* surface is a tree. Trails is a presentation and storage
  layer over session history, not a change to web-visible behaviour. Nothing we build here
  should break a page's own history handling.
- **Phase:** 2B.

### Scroll and form state are already in the session history entry
- **Found:** 2026-08-18, reading `docshell/shistory/nsISHEntry.idl` in-tree.
- **What it is:** `nsISHEntry` carries `layoutHistoryState` — documented as "for scroll
  position and form values" — plus explicit `setScrollPosition`/`getScrollPosition` and
  `initLayoutHistoryState`.
- **Verdict:** adopt.
- **Why:** This is the criterion-3 clearance for the project's central promise. "Tabs are
  unfinished work" makes lossless dismissal a hard requirement: a card dropped from the Field
  must come back with scroll offset and half-filled forms intact, or the Field becomes one
  more surface to hoard on. That state does not need inventing or scraping from content — it
  already exists per entry, which is also how Gecko's own bfcache restores it. Trail nodes
  should hold a reference to the session history entry rather than a bare URL.
- **Phase:** 2B, and it gates 2A's dismissal gesture. A trail node is an entry reference,
  never just a URL.

### Speech recognition is not on the ML engine's supported-task list
- **Found:** 2026-08-18, `toolkit/components/ml/docs/extensions.md` "Default models", plus
  grepping the whole component: outside the vendored Transformers.js bundle there is no
  reference to Whisper or `automatic-speech-recognition` anywhere in the tree.
- **What it is:** The in-tree engine documents defaults for about twenty tasks including
  `text-to-speech` (`Xenova/speecht5_tts`), but `automatic-speech-recognition` is absent.
  The docs do add that "any model in Hugging Face compatible with Transformers.js should work".
- **Verdict:** keep voice as the hands-free path, but downgrade it from settled to unproven,
  and prove it with a spike before anything is built on top.
- **Why:** This qualifies the earlier "local Whisper on the in-tree runtime" entry, which
  treated the ML runtime as sufficient evidence. It is not. Transformers.js supports Whisper,
  so the model side is likely fine, but ASR needs audio capture and a log-mel spectrogram
  step, and the engine runs in a restricted inference process that may not offer the audio
  APIs that pipeline expects. That is a criterion-3 risk on the *plumbing*, not the model,
  and it is exactly the kind of thing that looks free until the week it is built.
  Two consequences worth having now. First, the spike is small and must come first in the
  hands-free work: capture a few seconds of microphone audio, get a transcript out of the
  engine, and nothing else. If it fails, the fallback is a push-to-talk path that shells the
  audio to a local model outside the engine process — still no cloud, still criterion 3.
  Second, `text-to-speech` *is* supported out of the box, which makes the output half of a
  hands-free loop essentially free and is worth using regardless of how input resolves.
- **Phase:** 2. The ASR spike gates the voice work; TTS for confirmations is independent
  of it and can land either way.

### Cursorless hats: every target on screen carries a spoken name
- **Found:** 2026-08-18, searching for hands-free command grammars — Talon's in-depth
  review at handsfreecoding.org led to Cursorless, https://www.cursorless.org/docs/.
- **What it is:** A VS Code voice-coding system that draws a small coloured mark — a "hat" —
  over one character of every token on screen. A hat's spoken name is colour + shape +
  character ("blue fox bat"), and every command is *action + target*: "chuck bat" deletes
  the token wearing the hat on `b`. Hats attach to tokens rather than to screen positions,
  so they survive the content moving.
- **Verdict:** adopt the mechanism, under the name **marks**, as the addressing layer for
  the whole UI.
- **Why:** It answers the question the master prompt's hands-free requirement actually turns
  on, which is not "how do I say the verb" but **"how do I name the thing"**. A keyboard user
  names a target by pointing or by typing a substring; a voice user cannot point, so every
  addressable object needs a short, stable, pronounceable name. Cursorless is the proof this
  is tractable at the density of a code editor — the Field's card count and a trail rail's
  node count are both far smaller.
  The reason it is the right fit here rather than a bolt-on: a mark is not an accessibility
  affordance painted over the UI, it is the object's *name*. `enter cap` typed into the
  command bar and "enter cap" spoken resolve through one code path, which is what makes the
  brief's "no separate accessibility mode" literally true rather than aspirational. It also
  gives the command bar a grammar it otherwise lacks — without marks, "switch to that card"
  has no way to say *which*.
  Criterion 4 is the strong one: marks serve all three pillars at once rather than adding a
  fourth. Field cards, trail nodes and contexts become nameable by the same rule.
- **Risk to design against:** Cursorless's own hard problem is mark *stability* — when
  content shifts, naive assignment reshuffles every name and muscle memory dies. Marks must
  therefore be sticky per object for the lifetime of a session, not recomputed per render.
  Assign on first appearance, keep until the object goes away.
- **Phase:** 2. Marks land before the voice work, because they are just as useful to the
  keyboard and they are what the ASR spike would otherwise have to invent.

### "Show numbers" already ships — the mark claim has to be narrower
- **Found:** 2026-08-18, checking the above for criterion 1 before adopting it. Apple's
  Voice Control "item number overlays" (support.apple.com/guide/mac-help/mchl26854b08) and
  the equivalent "show numbers" / "show grid" in Windows Voice Access.
- **What it is:** Both operating systems already label interactive elements on demand and let
  you speak the label — "Click 36" — with a numbered grid fallback for anything unlabelled.
- **Verdict:** reject any claim that labelling targets for voice is novel. Keep marks, but
  claim only what is actually unshipped.
- **Why:** This is the sort of thing that would have been embarrassing to discover after
  building. Labelling targets so they can be spoken is a solved, shipped, decades-old
  accessibility idea, and the Field would not be the first browser surface to be driven that
  way. What survives the check is narrow but real, and worth stating precisely:
  1. **Numbers are positional and transient; marks are semantic and sticky.** "Click 36"
     means a different thing every time the layout moves, so nothing can ever be learned.
     A mark that stays attached to the same card all session becomes memorable, and a name
     you remember can be spoken without looking — which is the whole point.
  2. **Words work in both modalities; numbers and letter-hints each work in only one.**
     Digits collide with typing digits, and Vimium-style letter hints ("VF", "VJ") are chosen
     for alternating hands and are miserable to say aloud. A short word alphabet is the only
     encoding that is simultaneously speakable and typeable, which is what lets one grammar
     serve both.
  3. **The OS is labelling guessed-at clickables; we label objects that mean something.**
     Voice Control cannot know what a trail node or a context is. Marks on first-class
     objects let the grammar talk about *browsing* — `graft cap`, `name cap` — rather than
     about clicking pixels.
  So the honest claim is not "voice can select things" but "one stable naming layer over
  browsing objects, shared by keyboard and voice". Novelty lives in stickiness, the word
  alphabet, and what gets marked — not in the overlay.
- **Phase:** 2, as the constraint on the marks design. Not a separate feature.

### Talon's grammar shape: action + target, and chaining in one utterance
- **Found:** 2026-08-18, https://handsfreecoding.org/2021/12/12/talon-in-depth-review/.
- **What it is:** Talon commands are verb-then-noun and chain freely — several commands in a
  single utterance with no pause or separator, because the grammar is unambiguous enough to
  segment. The review names mode-switching between dictation and commands as the single
  biggest friction point in daily hands-free use.
- **Verdict:** adopt the shape; treat the mode-switch warning as a design constraint.
- **Why:** Action-first is the right order for our command bar for a reason specific to us —
  the action narrows what can legally follow, so the bar can filter marks to the ones the verb
  can actually apply to, and the same filtering gives keyboard users a live-narrowing list for
  free. Chaining matters more than it looks: `enter cap` then `branch` then `name it gecko` as
  one utterance is the difference between voice being a demo and voice being usable, and it
  costs nothing at parse time if the grammar is kept regular.
  The mode-switch warning is the part to take seriously, because our command bar has exactly
  this hazard: it must accept both a *command* and a *search query*, which is dictation. If
  the user has to declare which one they are doing, we have rebuilt the friction Talon's
  heaviest users complain about. The resolution to design toward is that the command bar
  parses action-first and treats anything not starting with a known verb as a query — so
  search is the unmarked default and commands are the marked case, in both modalities.
- **Phase:** 2C, as the command bar's grammar.

### Bush's trails were curated and shared, not recorded
- **Found:** 2026-08-18, re-reading "As We May Think" against our own pillar B —
  en.wikipedia.org/wiki/Memex and themarginalian.org/2012/10/11/as-we-may-think-1945/.
- **What it is:** A memex trail was an *authored* object. The user deliberately joined
  documents into a path, **named it**, wrote the name into a code book, and could hand the
  whole trail to another researcher to drop into their own memex. Bush treats trails as
  first-class citizens of the environment, as important as the documents they run through,
  and imagined trail-blazing as a profession.
- **Verdict:** adopt the distinction. It is the answer to the Nyxt problem.
- **Why:** We named pillar B after Bush and then specified something he did not describe.
  Our trail is captured automatically — every click spawns a node — which makes it a
  *recording*. Bush's trail is a *selection*. That gap matters commercially and not just
  historically, because run 2 established that Nyxt already ships an automatic browsing
  history tree, leaving the tree itself unable to carry any novelty claim.
  The resolution is to keep both and stop conflating them, and it is the strongest idea
  this run produced. Capture stays automatic and total, because that is the half browsers
  are genuinely good at and the manual tapping was the weakest part of the memex — Bush's
  users had to know a path mattered *before* walking it, which nobody does. But a **Trail**
  proper is then a named, curated selection promoted out of that raw tree, by a deliberate
  act. The automatic tree is the raw material; the Trail is the artefact.
  This is what separates us from Nyxt rather than a claim we cannot support, and the
  primitives it needs already exist in `design/GRAMMAR.md` without having been designed for
  it: `name` promotes, `graft` curates by reattaching, and export makes the result
  shareable — which is Bush's whole point, since a trail nobody else can take is just a
  private bookmark folder.
- **Phase:** 2B. The promotion step is the pillar's acceptance criterion, not a nice-to-have —
  a tree you can only look at is a curiosity, per the earlier entry.

### Trail crossings: the same page on several trails is the memex's actual payload
- **Found:** 2026-08-18, checking Bush's "the same document may be part of many trails at
  once" against `context-engine/SCHEMA.md`.
- **What it is:** In the memex the value compounds because trails *mesh* — one document sits
  on many paths, so arriving at it from one line of enquiry exposes the others.
- **Verdict:** adopt as a Context Engine surface. No schema change needed.
- **Why:** Worth recording that the schema already survives this, since it looked at first
  like a tree-versus-DAG problem. It is not: `trail_node` is a *visit*, not a document, so
  one URL already appears as many nodes across many trails, and `trail_node` is already
  indexed on `url`. The multi-trail document falls out for free.
  What is missing is that nothing ever *tells* the user. "You have hit this page from three
  different trails" is the memex's compounding effect, it is cheap on an index we already
  have, and it is exactly the sort of thing flat history cannot express — a recency list
  can say you have been here before, but not that this page keeps turning up from unrelated
  directions, which is a much stronger signal that it matters.
  It belongs to the Context Engine rather than to Trails: a crossing is evidence that two
  contexts are related, which is a clustering input, and it feeds the context sidebar's
  "what you know so far" directly.
- **Phase:** 2C, as a signal in the sidebar and a ranking input in the command bar.

### Data Mountain: spatial memory works, but only for layouts the user made
- **Found:** 2026-08-18, Robertson, Czerwinski, Larson, Robbins, Thiel and van Dantzich,
  "Data Mountain: Using Spatial Memory for Document Management", UIST '98
  (microsoft.com/en-us/research/wp-content/uploads/1998/01/p153-robertson.pdf).
- **What it is:** 100 web page thumbnails freely placed by the user on an inclined plane,
  measured against IE4 Favorites for storage and retrieval. Data Mountain was reliably
  faster (F(2,18) = 4.84, p < .02), had reliably fewer incorrect retrievals and reliably
  fewer failures to find the page inside two minutes.
- **Verdict:** adopt — this is the empirical foundation the Field was missing.
- **Why:** It is the strongest evidence that a spatial page-switcher beats a list, and it is
  from a controlled study rather than a product's marketing. But the finding that matters
  most is the one buried in the related-work section, and it contradicts the naive Field:

  > "PadPrints uses an automatic layout for short term use; the Data Mountain uses a manual
  > layout to exploit spatial memory for long term use."

  Spatial memory is memory for *where you put something*. A layout the system generated is
  not a place the user chose, so it builds no memory to retrieve by — which means "the Field
  auto-clusters your pages" cannot be the mechanism the Field's value rests on. Auto-layout
  is a starting position; only user placement is load-bearing. This is the same shape as the
  Smart Tab Grouping correction: clustering is a supporting detail, not the idea.

  Three further results that are direct design constraints:
  - **Occlusion is the dominant failure.** Under the early collision model "some users
    effectively lost many pages due to occlusion"; the fix — maintaining a minimum distance
    between all pages at all times, propagating displacement transitively — was judged to
    have "contributed most to improved user performance" in the second group. Cards must
    never overlap, ever, at any zoom level.
  - **Thumbnail plus title, together.** In Data Mountain the combined cue was fastest and
    title-only was its weakest condition; in IE4's list the reverse held — thumbnails
    actively *hurt* retrieval. A spatial switcher and a list want opposite cues, so a card
    carrying only a favicon and a title is a list with extra steps.
  - **No hover delay, and bind the title to its card.** A standard tooltip delay was
    rejected in piloting because it "precluded rapid inspection of multiple titles"; the
    first design also failed because users could not tell which thumbnail a floating title
    belonged to, fixed with a matching coloured halo. Users riffle titles once spatial
    memory has got them to the neighbourhood — the last metre is textual.
  - Users needed no category labels: they "built a very accurate mental map of their
    categories even without explicit labels", some promoting a salient thumbnail to serve as
    their own landmark.
- **Phase:** 2A. Every one of these lands in `design/FIELD.md`.

### Desert fog: the argument against an infinite canvas
- **Found:** 2026-08-18, Jul and Furnas, "Critical Zones in Desert Fog: Aids to Multiscale
  Navigation", UIST '98; plus the Hornbæk, Bederson and Plaisant ZUI overview studies
  (dl.acm.org/doi/abs/10.1145/586081.586086).
- **What it is:** Desert fog is the state where a view of the world "contains no information
  on which to base navigational decisions" — you have zoomed or panned into emptiness, and
  nothing on screen tells you which way anything is. Their remedy is *critical zone
  analysis*: group objects by their visibility in views rather than by their spatial layout.
- **Verdict:** adapt — and it forces a deliberate departure from the phase plan's wording.
- **Why:** An infinite zoomable canvas is a desert fog generator by construction: almost all
  of an infinite plane is empty, so almost every reachable view is featureless. Note that
  Data Mountain, the design with the actual evidence behind it, went the other way — "the
  system is designed with a fixed viewpoint, so users need not navigate around the space."
  Its win came partly from *not* being navigable.

  So the Field is bounded, not infinite: the overview always shows the whole world, always
  fits the window, and cannot be panned into emptiness. Zoom stays, because zoom is what
  shows a card's provenance as it grows out of its region — but it moves between a few
  defined semantic levels rather than over a continuum of scales. Every reachable view then
  has content by construction, which is the critical-zone insight applied at design time
  instead of as a navigational aid bolted on afterwards.

  This contradicts "an infinite, zoomable spatial canvas" in the phase plan. Taking it
  anyway: the brief's own instruction is that a better finding beats the plan, and infinity
  here is a property no user asked for that costs the interface its navigability.
- **Phase:** 2A. Recorded in `design/FIELD.md` as decision 1, flagged as a plan deviation.

### Named regions are searchable; unnamed space is not
- **Found:** 2026-08-18, surveying complaints about infinite-canvas tools in practice —
  Miro, FigJam, Obsidian Canvas, tldraw (storyflow.so, omnicanvasnotes.com round-ups).
- **What it is:** The recurring criticism of canvas tools is not the drawing, it is that
  boards decay into places you cannot find anything in, and that the tools lack the folders,
  tags and search that would let you. The one-line rule from the survey: named regions are
  searchable and unnamed space is not; pick one spatial convention and hold it.
- **Verdict:** adopt as the constraint that keeps the Field from decaying into a messy desk.
- **Why:** This is the real-world failure of the thing we are building, from people using
  spatial canvases daily, and it is the objection the Field has to answer. It resolves
  neatly, because we already have the names: the Field's regions are trails, and trails are
  already nameable first-class objects with a `name` verb in `design/GRAMMAR.md`. So every
  region carries a name and is reachable from the command bar without touching the canvas at
  all — spatial and textual retrieval over one structure.
  It also settles the "one spatial convention" question: placement means provenance. A
  card's region is the trail it came from, and that never means anything else.
- **Phase:** 2A, with the naming path already specified in 2B.

### Field cards are snapshots, not live browsers
- **Found:** 2026-08-18, reading `toolkit/components/thumbnails/PageThumbs.sys.mjs` and
  `toolkit/content/widgets/browser-custom-element.mjs` in tree.
- **What it is:** The phase plan calls for "live-thumbnail cards". Every open page in Gecko
  is a `<browser>` whose content lives in its own process, and unselected browsers are
  deliberately deactivated so they neither paint nor consume CPU. Painting fifty at once to
  fill a canvas means keeping fifty content processes rendering.
- **Verdict:** adapt — snapshots by default, live only where it is affordable.
- **Why:** Criterion 3. What the tree already gives us:
  - `PageThumbs.captureToCanvas(browser, canvas, args)` renders a browser to a canvas via
    `drawSnapshot`, with `BackgroundPageThumbs` for off-screen capture and an existing
    storage service. `tab-hover-preview.mjs` already does exactly this for tab previews.
  - `docShellIsActive` and `renderLayers` are *separable* on a remote browser: the setter for
    the former drives the latter, but `renderLayers` can be set alone, so a browser can keep
    painting without being the active docshell. This is the mechanism behind warm tab
    switching, and it is the budget knob for the Field.
  So: a card is a cached snapshot, refreshed on navigation and on dismissal; the focused card
  renders live. Data Mountain says this costs nothing that matters — its thumbnails were
  static 64×64 images and it still beat Favorites on every measure.
- **Phase:** 2A. Reuse `PageThumbs`; vendor nothing; treat the count of live cards as a
  budget with a pref, not as a property of the design.

### Talon's free-text problem: a timeout cannot be the segmentation rule
- **Found:** 2026-08-18, implementing the parser and searching for how Talon decides where a
  dictated argument ends — https://talon.wiki/Basic%20Usage/basic_usage/ and
  https://www.fileside.app/blog/2025-04-14_voice-computing/.
- **What it is:** Talon's `capture` takes a single word; longer free text needs a temporary
  dictation command (`say <phrase>`), and the boundary back to command mode is a silence
  timeout defaulting to 0.3s. Users report the predictable failure: pause mid-phrase and the
  next subclause is executed as a command instead of dictated.
- **Verdict:** adopt the problem, reject the solution. Free text is terminal — an action
  taking free text consumes the rest of the utterance and cannot be chained after.
- **Why:** This is the sharpest instance yet of the constraint in GRAMMAR.md §5. The reported
  misfires are reason enough to want something better, but they are not the fatal objection.
  The fatal objection is that silence has no meaning for typed input. A timeout would give the
  keyboard and the voice front end two genuinely different grammars, which is the separate
  accessibility mode the brief forbids, arrived at through the back door — and it would arrive
  looking like a reasonable implementation detail rather than like a design decision, which is
  what makes it worth writing down. A syntactic rule costs one free-text command per utterance
  and is identical in both modalities.
  Worth noting what this does *not* cost: `name` and `search` are the only free-text verbs in
  the table, and both are naturally the last thing you say.
- **Phase:** 2, built — `FOSCommandParser.sys.mjs`, and GRAMMAR.md §6.

### VS Code's removable palette prefix, and why our escape is a verb instead
- **Found:** 2026-08-18, searching for how unified command palettes disambiguate a command
  from a search — https://destiner.io/blog/post/designing-a-command-palette/ and
  https://uxpatterns.dev/patterns/advanced/command-palette.
- **What it is:** Sublime prefixes queries with `@` or `:` to switch palette mode; VS Code lets
  you add or delete a leading `>` to move between the file finder and the command palette,
  making the mode a visible, editable character rather than a hidden state.
- **Verdict:** adapt. Take the idea that the escape is ordinary editable text; reject the
  prefix as the primary mechanism, because a punctuation mark has no spoken form.
- **Why:** GRAMMAR.md §3 left the escape unspecified, and the obvious fix — a `/` or `>`
  prefix — fails criterion 3 for us specifically: it is unsayable, so it would be an action
  reachable from only one modality, which §5 calls a bug rather than an omission. Inverting it
  costs nothing: our default is already the opposite of VS Code's, since prose is unmarked
  here and commands are marked, so the escape has to mark the *query*. Making it the ordinary
  verb `search <text>` folds it into the existing grammar with no new mechanism at all — it is
  just another action with terminal free text — and `?` survives as pure typing sugar that
  parses to the identical command. The test asserting `?enter the dragon` and `search enter
  the dragon` are deep-equal is the one that keeps that true.
- **Phase:** 2, built — GRAMMAR.md §3.

### Cursorless hats sit on a character of the token, so a mark can be guessable
- **Found:** 2026-08-18, re-reading the Cursorless entry above while writing the allocator.
- **What it is:** A hat is drawn over a character *of the token it names*, so the spoken name
  is derived from the thing rather than assigned from a counter.
- **Verdict:** adopt as the allocation order. A new object takes the first free letter that
  appears in its own label, first letter preferred, before falling back to the alphabet.
- **Why:** Stickiness makes a mark learnable, but it does nothing for the first use, when the
  user has not learned it yet. Deriving the letter from the label makes the mark *guessable*
  before it is learned — a card titled "gecko" takes `g` — which closes the gap stickiness
  leaves open at the start of a session. It costs one loop in the allocator and cannot
  conflict with stickiness, since preference only ever decides which free letter to take and
  never moves a letter already held. Degrades honestly: an untitled object just takes the next
  free letter, which is where an arbitrary allocator would have started anyway.
- **Phase:** 2, built — `FOSMarks.sys.mjs`.

### Chrome retreated from space-triggered keywords, and it settles our fallback rule

Searched for how shipped omniboxes disambiguate a command from a search when the
two collide. Chrome is the strongest datapoint available: before 88.0.4324.150
(February 2021) typing a custom-search keyword followed by a space invoked that
keyword's engine, and the change made triggering require a deliberate <kbd>Tab</kbd>
instead, so `g foo` now searches for the literal "g foo".
<https://scarff.id.au/blog/2021/chrome-omnibox-keyword-search-broken/>

Keyword users were unhappy — the blog above is one of them, and the workaround
was to disable the `omnibox-keyword-search-button` flag. That complaint is the
honest cost and worth recording rather than glossing. But Google had the usage
data and still chose it, which says the asymmetry is real: a search silently
hijacked by a prefix the user did not mean as a command is a worse failure than
a command that needs one more keystroke.

**Verdict: adopt, adapted.** Not the Tab gesture — a keypress has no spoken form,
which is the same objection that killed the `>` prefix. What transfers is the
priority: a bare prefix does not get to steal the line. Our version tests the
*whole* line rather than the first token — a complete unambiguous command still
wins with no gesture, because unlike a bare keyword it cannot be confused with
prose, and only a line that fails to parse falls back to search.

This closed a live bug rather than decorating the design. GRAMMAR.md §3 said
prose is anything not *beginning* with an action word, and the parser implemented
exactly that, so `what is a memex` parsed `what` as the context verb and returned
a syntax error. Eight of the twelve action words are ordinary English, so the
collisions are the most obvious things anyone would type: `back pain`, `field of
view`, `branch prediction`, `up arrow unicode`, `pack rat`, `enter the dragon`.
Every one of them returned an error before this change and returns a search now.

Worth noting how it was found: the node tests were 34/34 green across two runs
and never caught it, because they asserted the specified behaviour. It surfaced
the first time the modules were imported into a real Gecko runtime and fed a
sentence a person would actually type. Test the specification and you only ever
confirm the specification.

### Whisper is already in the tree — the ASR gate was never real
- **Found:** 2026-08-18, reading `toolkit/components/ml/vendor/transformers.js` and
  `actors/MLEngineParent.sys.mjs` directly, after run 2 recorded speech recognition as
  absent from the ML engine's supported-task list.
- **What it is:** The vendored Transformers.js ships the complete Whisper stack —
  `WhisperForConditionalGeneration`, `WhisperProcessor`, `WhisperTokenizer`,
  `WhisperFeatureExtractor`, `WhisperTextStreamer` — and carries the
  `automatic-speech-recognition` pipeline tag. On the parent side, `checkTaskName()`
  validates a task name against a *character pattern* (alphanumerics, dashes,
  underscores) and nothing else. There is no allowlist of permitted tasks.
- **Verdict:** adopt — and correct the earlier entry. The voice path is not gated.
- **Why:** Criterion 3 was the only one in doubt for the hands-free requirement, and the
  doubt came from reading a documentation table rather than the code. What run 2 found was
  that ASR is not on the list of tasks Mozilla *ships a model for*; it inferred that the
  engine would refuse the task. The engine does not check. The model is the only missing
  piece and it is an ordinary ONNX Whisper checkpoint cached in OPFS like any other.
- **Phase:** 2. The end-to-end hands-free path is voice → Whisper → the same
  `FOSCommandParser` the keyboard uses, which is exactly the "no separate accessibility
  mode" property the brief demands. Remaining unknowns are model size and latency on this
  hardware, not availability — measure those, do not re-litigate whether ASR is possible.
- **Lesson:** run 2's claim came from a capability table; this one came from the dispatch
  code. When a feature looks blocked, check the code that would do the blocking.

### Node overlap removal (VPSC) is the wrong shape for a drag
- **Found:** 2026-08-18, Dwyer, Marriott and Stuckey, "Fast Node Overlap Removal", GD 2005
  (people.eng.unimelb.edu.au/pstuckey/papers/gd2005b.pdf); Gansner and Hu, "Efficient,
  Proximity-Preserving Node Overlap Removal", JGAA 2010 (graphviz.org/documentation/GH10.pdf).
- **What it is:** The graph-drawing literature's answer to exactly our problem — adjust a
  layout so equal or unequal rectangles do not overlap while staying as close as possible to
  where they started. VPSC generates a linear number of separation constraints and solves
  them per axis, a horizontal pass then a vertical one, minimising total displacement.
- **Verdict:** reject for the drag path; keep in mind for a future batch reflow.
- **Why:** Two mismatches, and the first is fatal. It is a *batch* method that minimises
  displacement *globally*, so re-running it each frame of a drag can flip between optima and
  move a card the user is not touching a long way for a small pointer movement. FIELD.md §6
  promises the opposite — that what is on screen mid-drag is exactly what a drop commits,
  which is what removes the settle animation. Second, VPSC has no notion of refusing:
  pinned cards enter as hard constraints and the problem simply becomes infeasible, whereas
  our design needs "this drop is not possible, nothing moved" as a first-class outcome.

  Our case is also strictly easier than the one the papers solve, which is worth saying so
  nobody reaches for the heavy tool again. Only one card moves at a time and every other
  card was already legal, so it is a single-source incremental problem: a push front
  spreading from the moved card, each overlap resolved along its axis of least penetration,
  propagating only through unpinned cards. That is also what Data Mountain describes, and it
  is O(cards touched) rather than O(all cards).

  It would be the right tool for a batch reflow — importing a trail, or a region whose
  extent changed — if that ever needs to preserve relative arrangement. Nothing needs it yet.
- **Phase:** 2A, decided and built.

### A session-sized workload is a different test from a correct one
- **Found:** 2026-08-18, from this project's own defects rather than from a source.
- **What it is:** Both Field defects — a busy region refusing ordinary drags, and placement
  throwing once a card sat off the seeding lattice — passed a full unit suite and appeared
  the first time the model saw forty cards in a real runtime.
- **Verdict:** adopt as a testing rule.
- **Why:** Neither was a logic error that a smaller case would have exposed; both were
  *density* effects. At three cards a push chain never reaches a region edge and the lattice
  is never fragmented, so the invariant tests were all true and all uninformative. This is
  the third time on this project that a green suite hid a live bug, after the grammar bug and
  the truncated wordmark, and the pattern is the same each time: the test exercised the code
  but not the condition. Field tests now run at session scale, and the two defects are
  regression tests at the size that produced them.
- **Phase:** 2, standing.

### Command palettes fail at discoverability, and ours inverts the usual critique
- **Found:** 2026-08-18, surveying command-palette UX writing (UX Patterns' and
  uxpatterns.dev's palette entries, Retool's write-up on designing theirs, Destiner's
  "Designing a Command Palette").
- **What it is:** The consistent complaints are not about parsing or speed. They are
  (1) users never find the palette, (2) a palette that withholds what the menus expose
  is worse than the menus, and (3) opening to a bare input — or to an alphabetical dump
  of every command — teaches nothing. The recurring advice is to show useful suggestions
  at the moment of opening.
- **Verdict:** adopt (3), and note that (2) inverts here.
- **Why:** (2) assumes the palette is an accelerator sitting beside menus. Ours is the
  *only* entry surface, so there is nothing to be incomplete with respect to — but that
  removes the safety net (2) is really describing. A user who does not know the twelve
  action words has nowhere else to learn them, which makes the empty state the one screen
  in the product that must teach. So the bar opens showing the whole action table grouped
  by pillar: twelve is small enough to show entire, and the pillar grouping is what stops
  it reading as the alphabetical dump the same sources warn against.

  The follow-on problem is subtler and mattered more. GRAMMAR.md §3 makes a half-typed
  action word prose — `fie` is a query and Enter must search for it — but showing nothing
  while the user types `fie` wastes exactly the moment they are reaching for `field`. The
  resolution is to separate what is *shown* from what Enter *does*: a single token lists
  the action words it prefixes, Tab completes one, and the parse is untouched. Anything
  stronger would be the mode §3 exists to prevent, arriving through the suggestion list
  instead of through the grammar.

  Tab needs no spoken form and this is not an exception to §5. The requirement is that
  every *action* be reachable in both modalities; Tab reaches no action, it shortens the
  path to one a voice user would simply say outright. A completion affordance is not a
  command — worth stating because "add a keyboard-only shortcut" is precisely how a
  separate accessibility mode gets built by accident.
- **Phase:** 2, built.

### URL-or-search is an execution question, not a grammar one
- **Found:** 2026-08-18, while wiring the bar's execution path.
- **What it is:** GRAMMAR.md §3 settles command versus query and stops there. But a query
  covers both `gecko session history` and `example.org/docs`, and nothing in the grammar
  distinguishes them.
- **Verdict:** adopt — settle it at execution, on `nsIURIFixup`, and never in the parser.
- **Why:** The answer depends on what schemes and hosts exist rather than on how the line
  is shaped, so it is not a syntactic property and putting it in the grammar would make the
  parser depend on Gecko — which would end the ability to test the grammar in node and, worse,
  give the transcript front end a second thing to agree with. Gecko has owned this decision
  for two decades: fixup knows the scheme typos, the alternate-URI prefs and the keyword
  fallback, and it reports which of the two it chose, so reading its answer keeps the bar in
  step with the address bar instead of drifting from it. A hand-rolled "does this look like a
  URL" check is the kind that gets `localhost:8080` and `pack rat` wrong in opposite
  directions.
- **Phase:** 2, built.

### Hoisting: outliners bound tree depth by re-rooting, not by squeezing indent
- **Found:** 2026-08-18, searching outliner navigation technique; Dynalist's
  "Outliner 101" (help.dynalist.io/article/129-outliner-101), molodtsov.me
  "The Evolution of Outliners", and Workflowy's zoom-by-bullet.
- **What it is:** Outliners distinguish *collapsing*, which hides part of the
  current outline, from *hoisting* (Workflowy calls it zoom), which changes the
  root: the chosen node becomes the whole view and its ancestors become a
  breadcrumb. MORE shipped this in the 1980s and every serious outliner since
  has it.
- **Verdict:** adopt for the trail rail.
- **Why:** Criterion 2 — it names the specific failure it fixes. A rail is a few
  hundred pixels wide and a real trail runs deep, so indentation runs out; the
  obvious answers are all bad (shrink the indent until the tree stops reading as
  a tree, truncate with an ellipsis, or scroll horizontally). Hoisting spends no
  horizontal space at all, because depth becomes zero again at the new root.
  Criterion 4 is what makes it the right choice rather than merely a workable
  one: it is the *same gesture* as the Field's zoom into a region — "this part,
  larger" — so the two pillars share one idea instead of each inventing a way to
  handle scale. It is also honest about what it is: a view operation that moves
  nothing and runs no action, so it needs no verb in the action table and no
  spoken form, by the same argument that keeps Tab out of the grammar.
- **Phase:** 2B, built — `FOSTrailRailView.railFor`'s `hoistRoot`, `z` and
  Backspace in the rail.

### A mark derived from a URL is derived from "https"
- **Found:** 2026-08-18, looking at the rail's first screenshot in a real build.
- **What it is:** Marks are assigned when an object first becomes addressable.
  For a trail node that is the moment it is created, which is *before* the page
  reports a title — so the only label available was the URL, and
  `preferenceOrder` walks the label's distinct letters in order. Every URL
  begins `https://`, so the first four nodes of every session took h, t, p, s.
- **Verdict:** adopt the fix — derive the mark from the rail's display label
  (title, else host) rather than the raw URL.
- **Why:** Worth recording because the bug is not in the mark allocator, which
  did exactly what it was designed to do, nor in stickiness, which correctly
  refused to change the letters afterwards. It is in what was handed in as the
  label, and the two correct rules combined to make a bad outcome permanent.
  The general lesson: **stickiness makes the quality of the first label matter
  much more than it looks**, because a mark assigned from a poor label is not
  merely unhelpful once, it is unhelpful for the object's whole lifetime. Any
  future pillar registering marks — cards, contexts — has to ask what its label
  looks like at *creation* time, not at steady state.
- **Phase:** 2B, fixed.

### Capture the page you left from history, not at the moment you leave
- **Found:** 2026-08-18, instrumenting `SessionStore.getTabState` during a real
  navigation after the scroll assertion failed.
- **What it is:** The intuitive capture point for "where was the user on the page
  they just left" is the start of the next load. In practice the parent process's
  collected state at that instant is routinely `{"entries":[]}` — the content
  process has not reported yet — so most ordinary forward navigations captured
  nothing. Once the *next* page settles, session history holds the previous entry
  complete, with the scroll offset in its `presState`.
- **Verdict:** adopt: capture after the fact from session history, guarded by a
  URL check.
- **Why:** Criterion 3, and it also corrects the earlier in-tree reading. The
  `nsISHEntry` entry in this file said scroll and form state already exist per
  entry, which is true, but implied they could be read at will; the missing half
  is *when* they are populated. Two further details worth keeping: the offset
  lives in `entry.presState`, not the top-level `scroll` key, which only appears
  while the entry is current and the live collector has reported it; and waiting
  is affordable here precisely because the entry being read is the one *behind*
  the current page, so nothing more is going to change it. A flush at departure
  would resolve after the tab had already moved on and would faithfully record
  the wrong document.
- **Phase:** 2B, built — `FOSTrailSession.#backfillPrevious`.

### PadPrints: a thumbnail hierarchy pays at revisitation, and only there

**Searched:** PadPrints zoomable graphical history evaluation; Hightower, Ring,
Helfman, Bederson, Hollan, *Graphical Multiscale Web Histories: A Study of
PadPrints*, Hypertext '98.
<https://research.cs.vt.edu/ns/cs5724papers/6.theoriesofuse.distcog.hightower.padprints.pdf>

**Found:** the closest measured relative of the Field, and one this project had
only met second-hand through Data Mountain's dismissal of it. PadPrints builds a
left-to-right hierarchy of thumbnails as you browse, in a zooming UI, beside an
unmodified Netscape. Two experiments, and the split between them is the finding:

- Experiment 1, general navigation over two site collections, 37 subjects:
  significantly *fewer pages accessed* (p = .0002) but **no** difference in task
  time (p = .34). Satisfaction was significantly higher on every QUIS section
  that moved.
- Experiment 2, tasks explicitly requiring returns to prior pages: users
  finished in **61.2% of the time** taken without it.

Its own framing of the problem is still exactly right thirty years on, and is
worth quoting against the fork's own premise: 0.1% of page accesses went through
the history list while 42% went through the Back button — "pages are revisited
with a high frequency, [but] the history list is largely unused", because it is
incomplete (branches vanish), textual, and buried behind a menu.

**Verdict: adopt, narrowly — and the narrowness is the useful part.** Hierarchy
is not a constant benefit that earns constant screen space; it is a benefit at
the moment you are trying to get back to something. That is the argument for
showing lineage *transiently*, on focus, rather than drawing the tree inside
every region — and it settles `FIELD.md` §10, now written up as §11. It also
corrects an impression this project had taken from Data Mountain's related work:
PadPrints is cited there as automatic layout "for short term use", which is true
and is why the Field seeds rather than arranges, but it is not evidence that
showing hierarchy failed. It did not fail. It was measured, and it won where the
task was revisitation.

### Users reach for proximity and leave the explicit links alone

**Searched:** spatial hypertext implicit structure versus explicit node-link
overlay; Shipman & Marshall on spatial hypertext; Storyspace's map view; VKB.
<https://dl.acm.org/doi/pdf/10.1145/3720553.3746683>,
<https://scispace.com/pdf/spatial-hypertext-designing-for-change-3532t615lt.pdf>

**Found:** systems that offered both an implicit spatial arrangement and an
explicit link overlay in the same view — Storyspace's map, the Visual Knowledge
Builder — consistently saw users express relationships through proximity and
visual attributes and avoid the explicit linking mechanism. Implicit structure
is not the poor relation of explicit structure in these tools; it is what people
actually used.

**Verdict: adopt as the argument against a persistent overlay.** Combined with
the PadPrints entry it gives the Field a coherent answer rather than a
compromise: the structure is real and worth showing, and the way to show it is
not a drawn graph. It matters more here than in the systems studied, because the
Field invites dragging — any edge set drawn over an arrangement people rearrange
becomes spaghetti within a session. Lineage is derived on focus, so there is
nothing to maintain and nothing to tangle.


### The 30-second dwell threshold, and why it is a floor rather than a fact
- **Found:** 2026-08-18, the click-satisfaction and dwell-time literature (Kim, Hassan,
  White et al., *Modeling Dwell Time to Predict Click-level Satisfaction*, WSDM 2014, and
  the industrial practice it describes).
- **What it is:** Industrial search systems treat a click with 30s or more of dwell as a
  "satisfied click", and use it as the implicit relevance signal where no human judgement
  exists.
- **Verdict:** adopt the number, adopt the caveat with it.
- **Why:** `SCHEMA.md` needs `visit.outcome` to be `bounced | read | saved` and the
  boundary had to come from somewhere. 30s is the only number in this area with a large
  body of evidence behind it, so inventing one would have been strictly worse. But the
  same literature is clear that a single fixed threshold is crude: the satisfying duration
  moves with the document, peaking near 30s at a medium reading level and past 50s at a
  difficult one. So this will call a skimmed reference page bounced and a slowly-read hard
  page bounced too. It is written down as `READ_DWELL_MS` with the limitation in the
  comment and an override on the function, so the day there is per-page evidence the fix
  is a parameter rather than an excavation.
- **Phase:** 2C, done. Improving it needs real usage data, which is exactly what the
  engine is now collecting.

### Task boundaries cannot be found with a clock — which is why a context is provenance
- **Found:** 2026-08-18, the search-task-extraction literature: Lucchese, Orlando, Perego,
  Silvestri and Tolomei, *Identifying Task-based Sessions in Search Engine Query Logs*
  (WSDM 2011), and the session-boundary work it surveys.
- **What it is:** Three families of session-boundary detection — time-based, content-based
  and heuristic. The measured result that matters: timeouts, whatever their length, are of
  limited utility for *task* boundaries, topping out around 70% precision, and about 75% of
  submitted queries are issued while the user is multi-tasking.
- **Verdict:** adopt, as the argument against the obvious design.
- **Why:** This is the run's most useful finding because it killed the thing I would
  otherwise have built. "The active context is whatever you have been doing for the last
  N minutes" is the natural first implementation, it is what a recency window gives you
  almost for free, and it is wrong most of the time it matters — if three quarters of
  queries are interleaved with another task, a single clock-derived context is mislabelling
  the majority of them. What the browser has that a query log does not is provenance: the
  user already partitioned their work by opening a tab, and that is a statement rather than
  an inference. So a trail is a context, membership is attributed `provenance`, and the
  explicit `context <mark>` is how the user overrides it. Embedding-based merging across
  trails is a real improvement to make later, and it rests on this floor instead of
  replacing it — `context_member.source` is what keeps the two tellable apart afterwards.
- **Phase:** 2C, done as the seeding rule.

### A shallow entity extractor earns its keep on titles, not on queries
- **Found:** 2026-08-18, building `FOSContextSignals` and then watching it run on real
  queries in a browser window.
- **What it is:** Without a model, the only entity evidence in plain text is punctuation
  and capitalisation: quoted phrases, runs of capitals, and everything else.
- **Verdict:** adopt as the floor, with the limit stated.
- **Why:** It ranks salience honestly and refuses to guess `kind`, which matters because
  the context pack is built to be read by a language model and a column of confidently
  wrong `person`/`org` labels is worse than no column. But the limit found by running it
  is sharper than the one I designed for: **queries are typed in lower case**, so the
  capitalisation signal is absent from exactly the input that carries the user's intent,
  and "vannevar bush memex" yields three plain words rather than a name. Page titles are
  capitalised and are where it currently earns its keep. This is the strongest argument
  yet for the embedding pass, and it is a specific one: the gap is query understanding,
  not page understanding.
- **Phase:** 2C for the floor; the embedding pass is the next step and now has a concrete
  target.

### A context pack is an untrusted-input surface, even with no network
- **Found:** 2026-08-18, writing the export and asking who reads it.
- **What it is:** The pack's consumer is a language model, and its content is page titles
  and page-supplied text — which the page controls.
- **Verdict:** adopt as a rule for anything the engine exports.
- **Why:** A page can call itself `[click here](http://elsewhere)` or append an
  instruction, and a brief built by pasting titles straight through would carry both into a
  model's context as though the engine had vouched for them. It costs nothing to neutralise
  markdown at the boundary and to state plainly in the footer that a page appearing in the
  brief means it was open, not that it was right. Worth recording as a general shape: this
  component has no network access at all, and it still has an injection surface, because
  the untrusted input arrived through the browser and leaves through the clipboard.
- **Phase:** 2C, done, with a test that a forged link does not render as a link.

### Nyxt's history persists but nobody solved how much of it to reopen

Searched: Nyxt global history tree persistence, restore across restarts,
unbounded growth. https://nyxt.atlas.engineer/article/global-history-tree.org
and atlas-engineer/nyxt#1007. Nyxt saves the whole global tree to a file and
restores it, and the project's own thread worries about how fast a 10,000-entry
history flattens and where it slows the browser; the suggestion floated was to
chunk history to a running 30-day window. Nothing was implemented, and the
crash-restore path is buggy enough to have its own issue (#1560, "owner with
identifier does not exist").

Verdict: **adapt, and reject the window.** The finding worth having is that the
question is unsolved rather than that Nyxt solved it — a persistent navigation
tree needs a policy for what to *reopen*, which is a different question from
what to *keep*. A 30-day window answers it badly: this project already decided
a clock is a poor judge of what a user is still working on (task boundaries top
out near 70% precision), and a fortnight away from the machine would read as
having finished. Bounding by rank instead — the K most recently updated trails,
whole or not at all — gives the same protection against unbounded reopening
without pretending to know what recency means. Nothing is deleted; an older
trail waits for a surface that asks for it. Shipped this run.

### A restart is revisitation, which is exactly where thumbnails pay

Follows from the PadPrints entry above rather than from a new search, and
recorded because restoring made it concrete. PadPrints' result was that a
thumbnail hierarchy pays at revisitation and nowhere else — no time difference
on general browsing, 61.2% on revisitation tasks. Reopening yesterday's session
is revisitation by definition, and it is the moment the Field has the least to
show: snapshots live in memory, so every restored card is a grey rectangle with
a caption (`agent/reports/restore-field.png`). So the thumbnail work that would
be a nice-to-have on a live session is load-bearing on a restored one, which
moves it to the top of the queue rather than leaving it as polish.

Verdict: **adopt as the next task.** Gecko keeps a thumbnail disk cache in the
profile and `PageThumbs.getThumbnailURL(url)` hands back a `moz-page-thumb://`
URL that chrome can use directly; the Field currently captures through
`captureTabPreviewThumbnail`, which does not populate it. Store on departure,
fall back to the stored image when a card has no live snapshot. Verify the disk
cache is enabled in this build first.

### Departure is the wrong moment for a picture, for the same reason it was wrong for scroll

Measured on this build rather than searched for, and it is the second time this
project has learned the same lesson. Run 10 found that reading the scroll offset
at departure returns nothing, because the content process has not reported yet,
and fixed it by reading session history once the *next* page settles. The
thumbnail has the same fault and cannot take the same fix: instrumenting
`captureTabPreviewThumbnail` at departure showed it called with the browser's
URI already reading `about:blank` on a cross-process navigation, and more often
returning false outright, because the browser has been swapped before the
listener runs. Pixels, unlike scroll offsets, are not recorded anywhere after
the fact, so there is nothing to backfill from.

Verdict: **capture when a page settles, and keep the departure capture as well.**
They answer different questions and both are worth having — the settle capture
is reliable and is a picture of the page as published, the departure capture is
a picture of the page as you left it, scrolled to what you were reading. So the
settle capture is the floor and the departure capture is the improvement on it
when it wins the race. The delay before the settle capture is one second, which
is what Firefox itself waits before capturing a top site, and for the reason its
own comment gives: a page that has just fired `load` is often still laying out.

The cost is one extra `drawSnapshot` per page load. Firefox already pays that on
every top-site load, and it buys the thing this browser could not otherwise
claim: a session restored tomorrow whose cards are pictures rather than grey
rectangles, without asking the network for anything.

### Refilling a missing thumbnail by re-fetching the page — rejected

`BackgroundPageThumbs.captureIfMissing(url)` is in the tree and is what newtab
uses to get a picture of a page nobody has open. It would fill in every restored
card whose page predates this work.

Verdict: **reject.** It re-fetches the page over the network, invisibly, for a
page the user is not looking at — which is a browser phoning out on its own
initiative for cosmetics, and this fork's whole premise is that it does not do
that. A card with no picture is honest about never having been seen; a card
holding a *freshly fetched* picture of a page as it looks now is a lie about
what you visited. Recorded so it is not reconsidered as an obvious win.

### SearchBar: a persistent task sidebar, and the numbers that settle its design

- **Found:** searching for prior art on "what you know so far" surfaces before
  building the context sidebar — D. Morris, M. R. Morris and G. Venolia,
  *SearchBar: A Search-Centric Web History for Task Resumption and Information
  Re-finding*, CHI 2008. https://cs.stanford.edu/~merrie/papers/searchbar.pdf
- **What it is:** a permanent browser side pane that passively captures queries
  and the pages visited after them, grouped into user-named topics, with a
  per-topic summary page, a "thumbs up" to promote a page, and free-text notes.
  Deployed in a 16-participant two-session study with a week between sessions.
- **Verdict:** **adopt**, as the evidence base for pillar C's second surface —
  and it settles four design questions I would otherwise have guessed at.
- **Phase:** 2C, built this run as `FOSContextSidebar`.

This is the closest thing to the context sidebar anyone has actually evaluated,
and almost every number in it is directly usable.

**A third of re-navigation went through the pane, so its rows must be live.**
Participants used SearchBar for 31.7% of re-querying actions and 31.5% of
re-navigation actions, rising to 42.2% of re-navigations in week two. That is
the same argument the rail already won on its own terms — a tree you can only
look at is a curiosity — but with a measurement behind it. Every row in the
sidebar re-enters its node.

**Its value appears at resumption, not in the session.** Rated only moderately
useful in week one (median 3.5) and then 5 in week two (z = -1.91, p = .05):
"highly valued for resuming longer-term suspended tasks where it was not
possible to maintain context via unchanging browser state." The consequence for
this project is a testing discipline, not a feature — the sidebar will look
thin when driven for ten minutes on a fresh profile, and that is exactly what
the paper predicts. Judge it across a restart, which this build now survives.

**Persistent context replaced tabs, measurably.** In week one all sixteen
participants opened a new tab to hold the state of an interrupted task. In week
two that behaviour was six of eight in the control group and *one* of eight
with SearchBar (z = -2.44, p < .02). The authors read it as the pane's
persistent state making the extra tabs unnecessary. This is the strongest
external evidence this project has that tabs are a workaround for context the
browser fails to keep, rather than a thing users want — see "Tabs are unfinished
work, not bookmarks". It is from 2008, and no shipping browser acted on it.

**Manual topics were its one real failure, and we already avoid it.** "It was
difficult to remember to create a new topic" scored a median 4.0 both weeks;
three of eight participants created no topics at all, and the mean was 2.0
topics against a larger number of tasks. The paper's own future work: "Automatic
creation of new topics based on lexical, semantic, or temporal relationships
among queries remains as future work." Contexts here are seeded by provenance
and never asked for, which is that future work answered — and answered without
the clock, which the search-log literature says would be wrong most of the time
it mattered. Retrospective support for a decision already made, so nothing
changes; it is recorded because it is the strongest reason not to revisit it.

**Notes are the feature to leave out.** Note-taking was the lowest-rated part of
the tool, 3.0 in both weeks, against 4.0/4.5 for topic organisation and 4.0 for
the per-topic summaries. A context sidebar is under constant temptation to grow
a notes field; the one study that shipped one found it was the part nobody
wanted. Not building it, and this is the reason.

**Screen real estate was not resented**, median 2.0 ("took up too much space")
in both weeks, even in the week it was barely used. So a sidebar meant to be
stayed in can be persistent, and does not have to apologise for its width.

Two further numbers worth keeping for the README's motivation section: Obendorf
et al. found browser history initiated **0.2% of all actions** despite revisits
being 44% of page views, and in SearchBar's own survey (n = 170) only 7.6% of
people named browser history as a resumption strategy against 36% who named
*memory* and 14% who named leaving the browser open. In the study itself five
participants used history and three could not find it — two resorted to the
help facility. That is the surface this fork is replacing, quantified.

### A sidebar's live rows are its own re-navigation, not a second Field

- **Found:** falls out of the SearchBar adoption above, plus this tree's own
  rule that marks are a budget of 26 shared by every pillar.
- **What it is:** the temptation, once the sidebar lists pages, to give those
  rows marks of their own so `enter <mark>` reaches them.
- **Verdict:** **reject.**
- **Why:** a page already has exactly one letter, claimed by its card or its
  rail row, and a sidebar row is a third presence of the same page. Giving it
  its own letter spends the alphabet on duplicates — the same argument that
  stopped `enter` taking a separate "card" kind. The sidebar's rows are
  clickable and arrow-navigable, and a row for a page that *does* hold a mark
  shows the letter it already has. Recorded so the "make it addressable"
  instinct does not spend the budget in three runs' time.

### Frecency is a well-optimised answer to a question this fork is not asking

- **Found:** looking for what the command bar should rank by before building
  the first of `SCHEMA.md`'s three surfaces. Hartmann et al., *Federated
  Learning for Ranking Browser History Suggestions*, and Mozilla's own write-up
  of the shipped experiment. https://arxiv.org/abs/1911.11807 and
  https://florian.github.io/federated-learning-firefox/
- **What it is:** Mozilla replacing the awesomebar's handcrafted frecency
  weights with weights learned on-device, across 723,581 users — 360,518
  training, 306,200 in the evaluation.
- **Verdict:** **adopt** as the motivation for context ranking; **reject** any
  attempt to learn weights here.
- **Phase:** 2C, the next task.

Two numbers matter. First, Mozilla says plainly that "the weights in the
algorithm were not decided on in a data-driven way. Essentially, they are
similar to magic numbers in software engineering" — twenty-two of them, over
time buckets and visit types, in the ranking every Firefox user has depended on
for fifteen years. Second, optimising all twenty-two at that scale moved the
characters typed before selection from 4.26 to 3.67. Just over half a
character.

That is the strongest possible argument for changing the *signal* rather than
the weights. Half a character is what a decade of global frecency has left on
the table; the gap this fork is aiming at is the suggestion list being about
your whole life rather than about the thing you are doing, and no reweighting
of a global counter closes it. It also sets the honest bar for judging the
result: if ranking by active context is worth building, it must beat frecency
by more than the entire remaining headroom of frecency itself, which means the
test is "the page I want is offered at all", not "it moved up two places".

The rejection is as important. This build has one profile, no telemetry, no
cloud, and no population to learn from — federated learning needs 360,000
users. A local model fitted to one person's clicks would be a magic-number
generator with worse provenance than Mozilla's.

### Cross-session resumption is the case the command bar exists for

- **Found:** Kotov, Bennett, White, Dumais and Teevan, *Modeling and Analysis
  of Cross-Session Search Tasks*, SIGIR 2011.
  https://dl.acm.org/doi/10.1145/2009916.2009922
- **What it is:** log analysis of search tasks that span more than one session,
  with models for predicting whether a task will continue and whether a query
  belongs to a task seen before.
- **Verdict:** **adopt** the framing. Reported figure, taken from the paper's
  abstract rather than from the full text (the PDF host refused three fetches):
  close to **60% of complex information-gathering tasks continue across
  sessions**.
- **Phase:** 2C.

This is the same finding as SearchBar's week-two effect from the other side —
one measured on sixteen people's behaviour, one on a query log — and together
they say the surface is judged on resumption. The consequence for the ranking
is concrete and it is not a weighting: candidates must come from the **store**,
across sessions and across trails, not from the window's in-memory tree. A bar
that can only rank what this session has already loaded is a bar that works
exactly when you did not need it.

### Ranking is tiers of provenance, not a score

- **Found:** falls out of the two entries above, plus this tree's existing rule
  that the store's rows are provenance.
- **Verdict:** **adopt** as the design for the command bar's ranking.
- **Phase:** 2C, next run.

One score mixing context membership, recency, outcome and frecency would be
twenty-two magic numbers again, invented by one person in an afternoon instead
of by Mozilla over fifteen years. Tiers instead, each one a fact rather than a
coefficient, ordered by how strong a claim it makes that this is the thing you
meant:

1. a **mark** typed as a mark — an address, not a guess;
2. pages **in the active context**, best outcome first — `contextContents`
   already returns them in that order and the bar must not re-sort;
3. pages on the **active trail** that the context has not claimed;
4. **crossings** — pages this context reached from another trail;
5. everything else, by **Places frecency**, which stays as the floor because a
   browser that cannot find a page you visited once last year is worse than
   Firefox and this fork's claim is not that history should be lost.

A tier is explainable in one line to the user, which frecency has never been,
and a tier boundary is falsifiable: either the page is in the context or it is
not. Only the last tier holds a score, and it is one this project did not
invent.

### A late suggestion list must not renumber under the selection

- **Found:** in this tree, not on the web — `UrlbarView.mjs` and
  `UrlbarChildController.mjs`. Two rules, both shipped for fifteen years and
  neither written down anywhere as advice.
- **Verdict:** **adopt** both, in the bar's own terms.
- **Phase:** 2C, this run.

The first: results are only auto-selected when nothing is selected already
(`if (!this.#selectedElement …)`), and typing resets the selection to none.
The second: rows from the previous query are held on screen while the next one
runs and are only dropped once it returns something —
`browser.urlbar.removeStaleRowsTimeout`, 400ms. The first is a correctness
rule and the second is a legibility one, and together they are the whole answer
to "the read lands after the keystroke that asked for it".

The bar re-renders wholesale rather than diffing rows, so "do not move the
selection" had to become "re-anchor it by row identity": the id of the selected
row is read out of the DOM before the rebuild and looked up again after, and a
row that has gone takes the selection back to the typed line rather than
passing it to whatever took its place. Stale rows are kept for the in-flight
read and dropped the moment the line stops being a query at all, which is the
one case where holding them would answer a question nobody is asking.

### Zero-prefix suggestions are a recency cache, so they stay rejected

- **Found:** searching for evaluations of zero-prefix (empty-query) suggestion
  lists turns up implementation and patent material rather than any usability
  result — Yim and Cha, "On-device Query Caching For Enhancing Zero-Prefix Query
  Suggestions" (TDCommons 3697), plus e-commerce query-suggestion patents.
  https://www.tdcommons.org/dpubs_series/3697/
- **Verdict:** **reject**, and record it so the question is not reopened.
- **Phase:** n/a.

The consistent description across all of it is that zero-prefix lists are
ranked from a cache of *recent and recurring queries*. That is precisely the
signal this project rejected for deciding what belongs to a context, and
adopting it at the one surface with no query to rank against would be adopting
it in its weakest form. The empty bar keeps showing the twelve verbs: it is the
only surface that can teach the vocabulary, and there are no menus behind it.

### A store row with no Places record is invisible to the bar

- **Found:** by a test of the ranking that failed for a good reason — a
  synthetic trail row, in no context and on no active trail, was offered by
  nothing.
- **Verdict:** **accept** as the floor doing its job; note the one real case.
- **Phase:** 2C, and it strengthens the case for the deferred trail-finding
  surface.

Tiers 2 to 4 are provenance and each has a precondition; tier 5 is Places. So a
page reachable by none of them is a page that is on some old trail, is not in
the active context, and has no Places record — which happens when history has
been cleared but the fork's own store has not. That is a narrow case and the
honest answer is not a sixth tier: it is that an old trail should be findable
*as a trail*, which is the surface already deferred in `STATE.md`. Adding
"every page you have ever recorded" as a tier would rank the whole database by
nothing in particular, which is the bookmark graveyard argument again.

### Hiding the origin is the failure mode of every chrome-minimising fork

- **Searched:** browsers without an address bar, origin spoofing, kiosk chrome;
  then eye-tracking studies on whether users look at the address bar at all.
- **Found:** Zen — a Firefox fork with the same ambitions as this one — shipped
  GHSA-vjfv-85qf-v25c, an origin-spoofing advisory whose root cause was chrome
  that hid where the user actually was.
  https://github.com/zen-browser/desktop/security/advisories/GHSA-vjfv-85qf-v25c
  On the other side, a 2008 lab study of 63 participants found subjects spent
  minimal time inspecting the address bar, and an eye-tracking study of phishing
  judgements found 23% of participants never looked at browser cues at all —
  those participants then chose wrong 40% of the time.
  https://arxiv.org/pdf/1911.00953
- **Verdict:** **adopt**, as the constraint that decided the shape of the
  change — the address bar's *entry* half is replaceable and its *display* half
  is not.
- **Phase:** 2, shipped as `FOSLocationDisplay.sys.mjs`.

The two findings look contradictory and are not. They are about different
halves of the same widget. The evidence that users ignore the address bar is
evidence about it as a *security indicator*: as a thing you are supposed to
read before typing a password, it underperforms badly. The evidence from the
Zen advisory is about what happens when the origin is not displayed *at all* —
which is not "users ignore it slightly more" but a new attack surface, because
an attacker can then render an origin of their choosing inside content and
nothing contradicts it. An indicator that is often ignored still constrains
what a page can claim; an absent one does not.

So the seam to cut along was already there. Entry moves to the command bar,
which is the half the fork has a better answer for. Display stays exactly where
it is, in the element that already holds the eTLD+1 emphasis, punycode handling
for lookalike domains, mixed-content and certificate state, and the site's
granted permissions. The decisive practical point is that re-implementing that
inside a command bar would mean re-earning fifteen years of adversarial work in
an afternoon, and the advisory above is what that looks like when it goes
wrong.

`readOnly` turned out to be the supported way to do it rather than an invention:
popup windows and taskbar tabs have shipped an address bar that shows an origin
and refuses typing for years, so every anchor, panel and identity surface keeps
working with no code of ours. This is the fourth time this project has found
the mechanism it wanted already in the tree — see also the tab strip below.

**Rejected along the way:** a hand-built origin strip of our own, showing
origin plus the page's mark. Attractive, because the mark would give the strip
a reason to be looked at that is not security theatre, and the whole problem
with the address bar as an indicator is that nobody has a daily reason to read
it. Rejected for this run on the grounds above — the strip would have to
re-derive punycode and certificate state to be safe — but the *mark* half is
worth revisiting as an addition to the kept element rather than a replacement
for it.

### The tab strip hides on grounds the tree already accepts

- **Searched:** how Firefox forks remove the tab strip; then, in-tree,
  `TabBarVisibility`.
- **Found:** `browser/components/tabbrowser/content/tab-bar-visibility.js`
  hides the strip when "only a single tab is visible **or tabs are displayed
  elsewhere**", and vertical tabs is the existing case of the second clause.
- **Verdict:** **adopt** — add one condition to that rule rather than build a
  second way to collapse a toolbar.
- **Phase:** 2A, shipped.

Zen's answer to the same problem is a vertical tab sidebar that compact mode
can hide, which is a different tab strip rather than no tab strip, so there was
nothing to take from it. The tree's own answer was better: the rule already
distinguishes "hidden and the tabs are gone" from "hidden because they are
drawn somewhere else", and the Field is exactly the second. The tabs themselves
stay — a tab is still where a document lives — so nothing is lost, and the
comment warning that hiding the strip must not lose tabs is satisfied by
construction rather than by argument.

The cost showed up immediately and is worth writing down: upstream's tab tests
measure, click and drag the strip, and one of them hung and aborted the whole
directory. They now run with `browser.fos.field.replacesTabStrip=false`. That
is not a way of hiding a regression — it is that those files are the coverage
keeping the strip working for the pref that restores it, and the window with no
strip has its own tests. Any surface this fork replaces will want the same
treatment, and the manifest pref is the pattern.

---

## Run 16 — ambient notification, and what the demo flow settled

**Searched:** peripheral awareness displays, ambient display heuristics and
their evaluation (Mankoff et al., *Heuristic evaluation of ambient displays*,
CHI 2003, and the peripheral-display evaluation literature that followed).
<https://dl.acm.org/doi/abs/10.1145/642611.642642> — paywalled; read the
surrounding literature rather than the paper itself.

**Verdict: adapt, for the background-tab signal.** The finding that matters is
the definition the field settled on: an ambient display succeeds when it
changes awareness of, or behaviour towards, some information *without requiring
an attention shift*. That is a sharper bar than "show a badge", and it rules
out most of what a browser would reach for first. The Field already knows which
card is new; the signal belongs on the Field's own affordance rather than in a
new surface, and it must be legible without the Field being opened. Explicitly
**reject** a notification system, a toast, and a count badge on a toolbar
button: each demands the attention shift the literature says disqualifies it,
and the second and third rebuild the tab strip's worst property — a number that
grows and shames.

Left open deliberately: *what* the peripheral channel is here. The candidates
are the Field's own edge, the command bar's resting state, and motion at the
window margin. That wants a design pass, not a guess, and it is now item 5 on
the Phase 3 list rather than something to bolt on.

**Not researched again:** zero-prefix suggestion lists (run 15 found only
ranking-from-recent-queries material, which this project rejected for context
membership). Do not re-search it.

## Run 16 — settled by building, not by searching

- **A query belongs to the context of the page it opened, not to the context
  that happened to be active while it was typed.** The second is a guess and is
  usually *nothing at all*, because a search into a fresh tab is recorded
  before the page that would create the context exists. Both memberships are
  kept — a question asked while working on one topic that opens another really
  was asked in both.
- **A pinned context needs a release, and the release is the bare verb.**
  "A context switched into deliberately must not be taken away by the next
  navigation" is right and was implemented as "cannot be taken away by
  anything", which is a different claim. `context` with no target follows
  provenance again, exactly as bare `back` applies to where you already are. No
  new word: the grammar stays at twelve.

### Opacity is the wrong way to de-emphasise text, and the reason is not taste

Searched for the accessibility position on `opacity` versus a colour for
secondary text, because the fork had both and needed one. Two findings settle
it. TPGI's argument against CSS opacity is that transparency consistently
fools automated contrast tooling: checkers read the declared colour rather
than the composited result, so a dimmed label can fail WCAG 1.4.3 while every
tool reports a pass — and where they do flag it, the colour values they report
are unreliable. The commonly cited case is placeholder text at 40–50% opacity,
which almost always fails and whose fix is a concrete colour, never an opacity.

The second reason is CSS rather than accessibility and is the one that bit
this tree: opacity applies to the whole subtree. A row quieted that way takes
its own mark's accent and its current-node rule down with it, which is exactly
what `.fos-rail-row[data-dismissed]` was doing — a dismissed node you were
standing on lost both the letter it answers to and the marker saying you were
there. The sidebar's equivalent rule quieted only the label, while carrying a
comment claiming it matched the rail.

Checked whether forced colours distinguishes them, expecting it would: it does
not. `--opacity-deemphasized-strong` collapses to 1 and
`--text-color-deemphasized` collapses to `inherit`, both in the
`tokens-prefers-contrast` layer, so both stop de-emphasising. That argument is
not available and should not be repeated.

**Adopt** — colour for text, opacity only for de-emphasising a whole object
where dimming the subtree is the point. `design/SYSTEM.md` §3; the one
surviving opacity rule is the Field dimming cards outside the focused
lineage, which dims their thumbnails deliberately.

Source: https://www.tpgi.com/an-argument-against-css-opacity/

## Run 17 — what to measure before touching the Field's pan and zoom

**Searched:** jank measurement for a large DOM under continuous transform —
`will-change`, CSS containment, compositor-only properties.
<https://www.corewebvitals.io/pagespeed/html-reflow-and-core-web-vitals>,
<https://simonhearne.com/2015/jank-meter/>,
<https://www.algolia.com/blog/engineering/60-fps-performant-web-animations-for-optimal-ux>

**Verdict: mostly reject as already known, one thing to adopt.** The bulk of
what is written on this is "animate `transform` and `opacity`, never `top` and
`width`", which the Field already does — `#applyPositions` writes transforms.
Advice to reach for `will-change` is explicitly *not* adopted: the sources that
are any good say the same thing, that it is a diagnosis rather than a fix, and
a promotion hint sprayed over forty cards buys forty layers and the memory to
match.

The one finding worth having is **CSS containment as a blast-radius bound
rather than as a speed-up**. `contain` tells the engine a subtree's internals
cannot affect anything outside it, so a change inside one card cannot cost a
reflow proportional to how many cards are open. That is the shape of the Field's
actual risk: a card is a thumbnail plus a title, its content changes on capture,
and the number of them is unbounded by design. It is a per-card property and
costs nothing when nothing changes, which is why it is worth trying even though
the Field's cost is presumed to be in the transform writes.

**It does not change the order of work.** Next task 2 stands as written: profile
the Field with 40+ cards *first*. Both of these are hypotheses about where the
time goes, and this project has now spent three runs on a bug that every
plausible story explained equally well. The measurement is the point; these are
just the two candidates to check against it.

One correction to how it gets measured: the sources all reach for Chrome
DevTools, and this tree has the Gecko profiler and a `profiler-analysis` path
already available. Use those — a chrome-privileged canvas in a XUL window is not
a page, and Chrome's numbers would not describe it even if they could be taken.

## Run 18 — the Field measured, and what that did to run 17's two candidates

**Not a search.** Run 17 ended by saying the measurement was the point and that
its two candidates — the transform writes and per-card CSS containment — were
hypotheses to check a profile against, not work to do. This is that check, and
it is recorded here because a rejected hypothesis is worth as much as an
adopted one and this is where the project keeps them.

The harness is `browser/components/fos/tests/browser/browser_zzfieldperf.js`.
It measures a drag one move per animation frame, which is the rate Gecko
coalesces pointer input to anyway, and splits each move into three numbers:
the script the handler runs, the style and layout that the handler's writes
then cost, and the interval the refresh driver actually delivered.

**Reject: the transform writes.** The premise was wrong twice over. The Field
does not write transforms — `#applyPositions` writes `left` and `top` — and it
does not matter that it does. At 40 cards carrying thumbnails a pointer move
costs **1.5ms of script and 0.01ms of layout**, and 60 consecutive frames were
delivered at 17.08ms, the display's own cadence, with none dropped. The reason
the layout is free is worth keeping: the loop writes every card's position but
only the dragged card's value actually changes, and a CSS declaration rewritten
to the value it already had dirties nothing.

**Reject: CSS containment.** It was proposed as a blast-radius bound rather
than a speed-up — a guarantee that a change inside one card cannot cost a
reflow proportional to how many cards are open. The measurement says the blast
radius is already ~10µs at 56 cards, so the guarantee is one the engine is
giving for free and the property would buy nothing. Adopting it anyway would be
optimising from a guess with a number in front of us saying not to.

**Adopt, and it is what the measurement was actually for: one render per
frame.** The cost is not in the drag at all. It is in `render`, which rebuilds
the stage from nothing, and in the fact that the resize listener called it
unthrottled. On the worst case the design permits — twelve trails, 480 cards,
480 miniatures, which is the overview past the nine-slot limit and into the
nest — one rebuild is 17.6ms (9.9ms of script building elements, 7.7ms of
layout) and ten resize events arriving in one tick cost 53ms of them. Frame
intervals during a real window drag: p95 **65ms** with the Field open against
**23ms** with it closed. Coalescing to one render per animation frame takes the
burst to 7.6ms. Nothing about the rebuild got faster; it stopped happening
several times for one frame.

**Left standing, with a number on it.** One crowded-overview rebuild still does
not fit in a frame, so a continuous resize now spends a whole frame's budget on
one legitimate render instead of several redundant ones. The principled fix is
a reposition-only path — the code's own comment already says a resize means
"nothing moves, the same arrangement drawn at a different scale", and the
region level already has `#applyPositions` for exactly this — but it is a
structural change to the overview's render and it wants its own run. It is not
urgent: a level switch is a keystroke, once, and 17.6ms is one dropped frame.

**The method is the transferable part.** Every number here has a control beside
it. The layout figure is believable only because a second flush measured
immediately after reads 0.00ms against the first's 0.01ms, which is what proves
the first one was measuring a real reflow rather than nothing. The resize
figure is believable only because the same loop was run with the Field closed.
The first version of this harness reported a confident set of numbers for a
drag that was being refused on every move and never moved a card at all —
caught by counting committed moves, which cost two lines.


## Run 19 — the polish pass, and two things a stylesheet cannot tell you

**Not a search.** This is the design-system pass Phase 3 asks for, and it is
recorded here because both of its findings are about *method* rather than about
an idea, and the method is the part that transfers.

**The screenshots are the instrument.** `SYSTEM.md` was written by reading five
stylesheets against each other, and it caught what that can catch: five
treatments of a mark, two mechanisms for "secondary", a type scale with its
lower half missing. It could not catch either of this run's two defects,
because both are about *proportion between* things that are individually
correct. The rail's rows were 17.6px and the sidebar's 21px, and each looked
deliberate on its own page. The entity list at zero block padding had a comment
explaining itself. What settled both was opening `shot-context.png` and
`shot-trails.png` at 3× and looking. Reading the picture is now the second half
of the design-system loop, not an afterthought to it — the same conclusion run
17 reached from the other direction when a screenshot found the blank content
rectangle.

**A CSS rule that removes something is invisible to a reader.**
`.fos-rail-list:focus-visible { outline: var(--focus-outline) }` reads as "this
surface draws a focus ring". It was not: it was *overriding* the `outline: auto`
that Gecko's UA stylesheet already draws on every focused element. Deleting it
therefore did not remove the ring, it restored a 1px grey one — and the
screenshot afterwards looked, at a glance, exactly like the screenshot before.
The live test said `rgb(60, 60, 60) auto 1px` in one line.

The general shape: **a declaration is only ever the delta against what the
platform already does, and a stylesheet does not show you what that is.** Any
change that consists of deleting a declaration needs a computed-style
assertion, not a re-read. This project has now paid for that lesson twice —
once with `--font-size-small` resolving to nothing, once here — and both times
the cost was the same, a rule that read correctly and meant something else.

**Adopt: the container-plus-descendant focus model.** The ring belongs on the
row the keyboard will act on, not around the panel holding it, and the
container keeps it only for the case where nothing is selected. This is the
ordinary listbox pattern rather than an invention, and the reason it is worth
writing down is the branch: a surface that opens with nothing selected reaches
the ugly case *by default*, so the sidebar now opens on the page you are on,
the way the rail already did. The design rule and the seeding decision are one
decision, and separating them would have shipped the rule with its worst case
as its normal case.

**Reject: an inactive-selection colour.** The first sketch had
`--fos-selected-background-inactive`, a `color-mix` for a row that is selected
in a panel that does not hold the keyboard — the full listbox model. Dropped.
The selected background is already `color-mix(currentColor 20%, transparent)`,
so a weakened version is 8% of the text colour, which is not a colour anybody
can see; under forced colours it would have to collapse back to `SelectedItem`
anyway; and the state it distinguishes cannot arise in a surface that closes on
Escape and returns focus to the page. A token the design cannot demonstrate a
use for is a token the next surface will use for something else.

**Reject: `:has()`, on the tree's own evidence.** `:not(:has(.row[aria-selected]))`
is the selector that says what is meant, and it worked. `stylelint-plugin-mozilla`
refuses it: it scales with the subtree and needs the harder invalidation path,
and a rail holding a real trail's worth of rows would run that on every arrow
key. The replacement is `[aria-activedescendant]` on the container — not a
proxy for the selection but the same fact, already written there for assistive
technology, and free to match. Worth remembering as a general move: **the ARIA
attribute a surface already maintains is usually the state a `:has()` was
about to go looking for.**

---

## Run 20 — the search-mode switcher, and what a dead selector hides

The standing list's top item, and the only known contradiction of a claim the
README makes: "one entry surface". `STATE.md` recorded the sighting — a Google
logo and a chevron at the left of the address bar — and explicitly deferred the
verdict: *check what pressing it actually does before deciding.* That was the
right instruction, because four probes in a driven browser produced four facts,
and three of them contradicted the note that raised the issue.

**It is upstream's unified search button**, `moz-button.searchmode-switcher`.
It hides itself with an `offscreen` attribute — `position: fixed; top: -999px`
— and `setUnifiedSearchButtonAvailability` puts it on-screen whenever
`pageproxystate` is `invalid`. That is every blank tab, so it is not a corner:
it is the state a fresh window opens on. `BrowserTestUtils.isHidden` says false
either way, which is how it stayed unnoticed; the tell is a bounding rect at
`y = -994`.

**The passthrough entry naming it matched nothing.** The list said
`#urlbar-searchmode-switcher`; the element has no id at all. So the mouse press
had been reaching the command bar all along, and the single-entry-surface claim
was already true of the mouse — *by accident, through a bug*. The natural fix,
correcting the selector to `.searchmode-switcher`, would have read like tidying
and would have built the second entry surface the module exists to prevent.
`.urlbar-go-button` was dead the same way. The cause is one upstream change:
the address bar became a custom element shared with the search bar, so what
were ids on a singleton became classes on a reusable one.

**The keyboard went straight past the mouse handler.** The button sets its own
`tabIndex` to 0 on `focusin` and opens its panel on ArrowDown, and the panel
listed twelve destinations — Google, Amazon, Bing, DuckDuckGo, eBay, Perplexity,
Wikipedia, Bookmarks, Tabs, History, Actions, Settings. A `mousedown` handler
is not a policy about entry; it is a policy about mice.

**And the control was dead anyway.** Picking Google set the search mode, painted
"Google" as a chiclet and focused the input — which is read-only, so the next
keystroke left the value empty. The hypothesis in `STATE.md` was that it is
"likely a control that does nothing a user can act on". Confirmed, by doing it.

**Adopt: hide it, with `display: none`, scoped to the attribute.** The three
alternatives all fail. Passing the press through restores a second entry
surface. Copying the `offscreen` technique moves a third party's logo out of
sight and leaves the whole engine list one Tab away — hiding that is designed to
stay focusable is the opposite of what is wanted. Deleting the element is the
mistake this module was written to avoid making twice. Only leaving the box tree
takes it out of the tab order and the accessibility tree at once, and scoping to
`[fos-location-display]` means the pref that gives the address bar back gives
the engine picker back in the same breath.

What is genuinely lost is engine choice, and it is worth naming rather than
glossing: the command bar searches with the default engine, because §5 of
`GRAMMAR.md` deliberately refused keyword prefixes on Chrome's evidence. But it
was lost before this change — an engine you cannot type to is not a choice, it
is a chiclet. The honest statement is that this fork does not offer per-query
engine selection yet, not that it just stopped.

**The method worth keeping: a selector list is a claim about a document, and
claims about documents are checked against documents.** Two of seven entries
were dead and both failed in the direction that looks like success — the control
silently loses its press, which is indistinguishable from working until someone
presses that control. Nothing in reading the list could have found it; one
`querySelector` loop in a real window finds all of it, and now does, every run.
This is the same lesson as the UA-stylesheet ring in run 19 and
`--font-size-small` before it, arriving a third time from a third direction:
**the tree does not tell you what it does, and the running browser does.**

## Run 22 — the background-tab signal, settled against itself

**Searched:** attentional capture by motion onset (Franconeri & Simons and the
Springer/APP literature that followed, <https://link.springer.com/article/10.3758/s13414-018-1548-1>
and <https://link.springer.com/article/10.3758/BF03205298>); slow change
blindness (<https://pmc.ncbi.nlm.nih.gov/articles/PMC11401121/>, and NN/g's
version of it for interfaces, <https://www.nngroup.com/videos/change-blindness/>);
animation in peripheral displays.

Run 16 left the *channel* open with three candidates — the Field's own edge,
the command bar's resting state, motion at the window margin — and said it
wanted a design pass rather than a guess. This is the pass, and the two
literatures settle it by ruling out both ends of the obvious range.

**Reject: motion at the window margin.** Motion onset captures attention in a
stimulus-driven way, whether or not the moving thing is task-relevant, and the
periphery is where it works best. That is not a weak version of a notification;
it is the strongest one available, and it is disqualified by the exact bar run
16 adopted — an ambient display succeeds when it changes awareness *without
requiring an attention shift*. Motion is the mechanism that forces the shift.
A tab arriving in the background is by definition not what the user is doing,
so a signal that seizes the eye is a worse interruption than the toast run 16
already rejected, not a gentler one.

**Reject the other end too, and this is the part that is not obvious: a slow
fade.** The natural repair for "too attention-grabbing" is to make the change
gradual, and gradual change is the one kind reliably not seen at all. Slow
change blindness survives the change being large, in full view, centrally
located, and about something the observer cares about. So a signal that eases
in over a second is not a quieter signal; it is often no signal.

**Adopt: a step change that persists, and is read on the next voluntary
glance.** What is left when both an event and a drift are ruled out is a
*state*. The arrival is not announced at all — it is recorded, discretely, and
the record sits there until the Field is opened. The user is never interrupted,
because nothing about the transition is designed to be caught; the question it
answers is "has anything arrived since I last looked?", and it is answered at
the moment they choose to ask.

Two consequences fall out of that framing rather than out of taste:

- **Binary, not a count.** The state is "something unseen", not "seven
  unseen". Run 16 rejected a count badge for rebuilding the tab strip's worst
  property — a number that grows and shames — and the glance framing rejects it
  a second way: a count is only worth rendering if it is worth reading
  precisely, and nobody reads a peripheral number precisely.
- **Cleared by looking, not by dismissing.** Opening the Field is what the
  state is for, so it is also what ends it. A signal with its own dismissal is
  a second thing to do about a page you have not read yet.

**Still open, and now a smaller question:** which persistent surface carries
the state. Two candidates survive — the Field's own affordance and the command
bar's resting state — and the choice turns on which one is actually on screen
in the fork's ordinary window, which is a thing to check in a running browser
rather than reason about. This is the same lesson as run 21's selector list.

### The reposition path, measured, and what it leaves

`resize-burst-of-10` — ten resize events in one tick, which is the gesture with
the compositor's share taken out — goes **7.6ms → p50 0.99ms, p95 1.86ms**.
Against the 53ms it cost before run 18's coalescing, that is the whole of the
synthetic burst gone.

The real gesture improved by much less: `crowded-overview-resizing-frame` p50
50.4ms against a `closed-field-resizing-frame` control of 18.8ms, where run 18
measured p95 65ms against 23ms. So the gap a real window drag opens is ~31ms
per frame and was ~42ms. The two numbers disagree because they measure
different things and both are honest: the burst coalesces ten events into one
pass, and a real resize delivers one pass per frame, so what is left is the
cost of *one* reposition of 489 elements — 480 miniatures and nine tiles.

**The next rung, and it is a different idea rather than more of this one.** A
reposition still writes four declarations per miniature, so it is O(cards) in
style and in layout. Scaling is what a transform is for: if a tile's body
carried `transform: scale(s)` with `transform-origin` at its top left and its
miniatures were positioned in unscaled field units, a resize would be **one
write per tile** — nine — instead of one per card, and the scaling itself would
be the compositor's rather than layout's. The nest needs a wrapper per region
to carry its own translate, which is the structural part and why this is its
own task.

Worth noting what makes this legitimate here and not everywhere: a miniature is
a plain box with a background image and nothing about it should stay a fixed
size as the tile shrinks — which is exactly the case where a transform is
faithful rather than a shortcut. The region level is the opposite case, and is
why it keeps its rebuild: its cards carry captions and marks whose size must
*not* follow the scale.

## Run 23 — the signal's surface, answered by the window itself

**Not searched.** Run 22 left one question — which persistent surface carries
the unseen state — and said explicitly that it turns on which surface is
actually on screen, which is a thing to look at rather than to reason about.
So this was answered by reading the chrome and by looking at a window this
project has already photographed (`agent/reports/one-surface-rest.png`), not by
another literature.

Two candidates were live and exactly one of them exists:

- **The Field's own affordance is not there.** Nothing in
  `browser/components/fos/` touches `CustomizableUI` or creates a
  `toolbarbutton`; the Field is reached by `F2` and by the `field` verb. There
  is no persistent edge, no button, no strip. A surface with no pixels cannot
  carry an ambient state.
- **The command bar has no resting state either** — `FOSChrome`'s whole design
  note is that every FOS surface builds its DOM on first open, so a window that
  never opens one pays nothing for it. At rest the command bar is not hidden;
  it does not exist.

What *is* permanently on screen in an ordinary window is the retired address
bar, and that is the command bar at rest in every sense that matters: it is
what a mouse presses to open the command bar, and its placeholder already
describes that press. So it takes the mark. **Adopt**, and it is a stronger
answer than the one that was being looked for, because the surface that carries
"something arrived" is one press away from the surface that acts on it.

Drawn as a flex item in the input container rather than a dot positioned over
it: the container ends with the page actions, and an absolutely positioned dot
would sit on the bookmark star at some widths and not at others. As an item it
makes its own room, and it takes none when the state is false — which is where
a window spends nearly all of its life. The screen-reader half is
`aria-description` and deliberately not a live region: a live region announces
on arrival, which is the interruption the whole design is avoiding.

### The voice path's budget, and the backend that decides whether it fits

**Searched:** browser-side Whisper via Transformers.js and ONNX
(<https://huggingface.co/onnx-community/whisper-tiny>,
<https://senoritadeveloper.medium.com/whisper-webgpu-2b1cadfab897>,
<https://offlinetts.com/blog/browser-speech-recognition-whisper-comparison/>);
voice-interface latency thresholds
(<https://www.gnani.ai/resources/blogs/latency-targets-for-feels-human-voice-budgets-measures-enforcement>,
<https://hamming.ai/resources/voice-ai-latency/>, and the turn-taking numbers
they rest on); push-to-talk against wake words
(<https://picovoice.ai/blog/complete-guide-to-wake-word/>,
<https://thehomesmarthome.com/home-assistant-push-to-talk-for-local-voice-commands/>).

Run 15 settled that ASR is *available* — Whisper is vendored, and the engine's
task check is a character pattern rather than an allowlist — and said the
remaining unknowns were size and latency, to be measured rather than argued.
This is the part that can be settled before the measurement: what the numbers
have to beat, and which knob decides whether they can.

**The budget.** A voice command is a turn, and the turn-taking literature the
industry numbers rest on puts a natural response inside ~1s of the end of the
utterance, tolerable to 2s, poor past 3s. The mitigation that buys the 1–2s
band is specific and this fork already owns it: a **live transcript echo**.
The command bar is a text surface with the parse in front of the user, so
speech can be shown as it is recognised in the same field the keyboard writes
into — the same grammar, the same feedback, no second surface. That is the
"no separate accessibility mode" property falling out of the design rather
than being bolted on.

**The knob.** Published in-browser Whisper numbers are usually WASM: one
commonly cited figure is 5.5s for 23.2s of audio (~4x real time) on
`whisper-tiny` (~75MB), and WebGPU is repeatedly reported at roughly an order
of magnitude faster. The tree already ships both — `ort.webgpu.mjs` is in
`toolkit/components/ml/jar.mn`, `ONNXPipeline` takes `config.device`, and
`ensurePipelineIsReady` calls `checkGPUSupport()` and falls back to CPU with a
warning rather than failing. So the pipeline is asked for `device: "gpu"` and
the fallback is upstream's, not ours. **Adopt.**

A command utterance is 1–3s, not 23, so even the WASM path is plausibly inside
the tolerable band — but "plausibly" is why the transcript echo is not
optional. Measure `whisper-tiny` q8 on this hardware both ways before choosing
a default, and measure from *end of utterance*, since that is the moment the
user starts counting.

**Push-to-talk first, wake word second, and not as a compromise.** A press
eliminates false wakes outright and makes the microphone's on/off state a thing
the user did rather than a thing they trust. The genuinely handless case needs
a wake word and that is a second layer with its own always-on cost — but it
sits on the same path, because in both cases what comes out is a transcript
handed to `FOSCommandParser`. Building PTT first therefore costs the wake-word
layer nothing, and it is the version that can be honestly shipped without
promising an always-listening microphone this fork has not measured.

---

## Run 24 — silence is not a transcript, and the tree's own speech path is a cloud service

**Searched:** Whisper's behaviour on silence and non-speech audio
(<https://github.com/openai/whisper/discussions/1606>,
<https://github.com/openai/whisper/discussions/679>,
<https://arxiv.org/pdf/2501.11378> "Investigation of Whisper ASR Hallucinations
Induced by Non-Speech Audio", <https://arxiv.org/html/2505.12969v1>
"Calm-Whisper"); ASR transcript normalisation and how voice systems handle a
misheard word (NVIDIA Riva's ASR customisation docs, Talon's community grammar
and its homophones mechanism —
<https://github.com/talonhub/community>,
<https://github.com/seananderson/talon-config/blob/master/homophones.py>,
<https://blakewatson.com/journal/speaking-in-code-hands-free-input-with-talon/>).
Run 23 settled the budget and the backend; this is the run that built the
adapter, and all three findings came out of building it.

### Whisper answers silence with a confident sentence

**What it is:** Given silence, room tone or a door slamming, Whisper does not
return an empty string. It returns "thank you", "thanks for watching", or the
Korean and Japanese equivalents — training-data artifacts of captioned video.
The literature is unambiguous that its own defence is not enough: the model
exposes `no_speech_prob` and `avg_logprob` for exactly this, and the
hallucinations come out with *high* confidence and low no-speech probability,
so the thresholds that would catch them also catch real speech.

**Verdict: adopt, as two defences in a fixed order.** A recording that is too
short, too quiet or too steady is never sent to the model at all
(`audioIsSpeech`), and a transcript that is exactly a known artifact is refused
after (`normaliseTranscript`). The second is not belt and braces. A short loud
noise in a quiet room clears every audio gate a JS caller can apply and is
precisely the input that gets answered with a sentence.

**Why this fork should care more than most.** Everyone building on Whisper hits
this and treats it as a wrong-output problem. Here it is a *storage* problem: a
phantom utterance is not only a command that runs, it is a query the Context
Engine records as one the user asked, and it will go on ranking that user's
suggestions afterwards. A search that ran and looked odd is visible and
forgettable; a context quietly poisoned by enquiries nobody made is neither.
That asymmetry is what justifies refusing a marginal utterance rather than
attempting it — the failure of refusing is one repeated press.

**Phase:** built this run. `FOSVoiceTranscript.sys.mjs`, `GRAMMAR.md` §8.

### The tree already has speech recognition, and it is disqualified twice over

**What it is:** `dom/media/webspeech/recognition/` implements the Web Speech
API, and `media.webspeech.recognition.enable` turns it on. It would have been
the cheapest possible voice path.

**Verdict: reject, and it is not close.** `OnlineSpeechRecognitionService.cpp`
POSTs the audio to `https://speaktome-2.services.mozilla.com/`. That is a cloud
service, which the Context Engine's "no cloud, ever" rule forbids on its own,
and it is a Mozilla endpoint, which Phase 1 spent a run removing every other
instance of. A browser that rebrands away from Firefox and then ships the
user's voice to Mozilla would be the single worst thing in this tree. Whisper
on the in-tree ML runtime stays the path.

**Worth keeping from it anyway:** the directory also contains
`energy_endpointer.cc` — an energy-based endpointer, upstream's answer to
"where does the utterance end", sitting in the tree since the Chromium import.
It cannot be called from JS without a binding, so it is not reusable, but it is
independent evidence that gating on energy is the right shape for the problem
rather than a heuristic invented here. Adopt the shape, not the code.

### A misheard word is offered, not repaired — and the reason is structural

**What it is:** Every voice system faces near-misses: `cab` for `cap`. The
tempting fix is to snap a token onto the closest word in the grammar's
vocabulary, which here is small and closed — twelve verbs and twenty-six
alphabet words — so the usual objection that normalisation needs a model does
not apply. It would be cheap.

**Verdict: reject the repair; adopt Talon's answer instead.** Two reasons, and
the second is the one that settles it.

The weaker reason is precedent: Talon has more standing on this than anyone and
*does not* snap. It pops a menu of homophones and lets the user pick, because a
system that silently corrects is a system that silently corrupts, and a voice
user has no cheap way to notice.

The stronger reason is that a repair pass cannot be built here without breaking
§5. `GRAMMAR.md` §6 makes free text terminal — `name` and `search` take the
rest of the utterance verbatim — so repairing tokens requires knowing where
free text begins, which is to say knowing the grammar. The input adapter is the
one place the repair could live, and §5 forbids the adapter to know the
grammar. The alternative, putting it in the parser, would give the parser a
modality it is defined not to have.

So the answer to a misheard word is the surface that already exists: §7's
candidate list narrows live from the same parse, so a wrong word shows a wrong
list, and the user says the word again. Normalisation stays what it can be
safely — case, sentence punctuation, whitespace, all of which are harmless over
free text — and stops there.

**Phase:** decided this run and recorded in `GRAMMAR.md` §8 so it is not
reconsidered in three runs' time.

## Run 25

### The microphone this fork can open is invisible, and that is a Gecko fact

**Searched:** whether a chrome-privileged `getUserMedia` prompts and whether it
lights the sharing indicator — first on the web
(<https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia>,
<https://blog.addpipe.com/getusermedia-getting-started/>), then in the tree,
which is where the answer actually is.

**What the web says:** that the spec requires an indicator whenever a camera or
microphone is in use, that Firefox shows a pulsing icon in the address bar for
it, and — the one useful qualifier — that a `getUserMedia` call needs the page
to have focus *so that the capture indicators will be visible*. Also that
"privileged or built-in apps may bypass a number of permission concerns", which
is the right shape and no use as evidence. None of this answers what this fork
does, because this fork is the privileged caller.

**What the tree says, which is the answer.** Two independent reads, both
verifiable in one grep:

1. `dom/media/MediaManager.cpp`: `bool privileged = isChrome || pref`, where
   `isChrome = (aCallerType == CallerType::System)`, and then
   `askPermission = (!privileged || …permission.force) && …`. A chrome window's
   call is System, so `askPermission` is false and the request goes straight to
   `getUserMedia:privileged:allow`. **It never prompts.**
2. The indicator is driven by `recording-device-events`
   (`MediaManager::NotifyRecordingStatusChange`). The only observer of it is
   `BrowserProcessChild`, registered in `DesktopActorRegistry.sys.mjs` as a
   JSProcessActor **without `includeParent`** — the one actor in that file that
   sets it is `MozCachedOHTTP`. So the actor is never instantiated in the parent
   process, and the parent process is the one whose chrome window holds the
   microphone. **Nothing is listening when the recorder is the parent.**

No prompt, no indicator, no row in the permissions UI, and nothing in the tree
that a user could consult after the fact.

**Verdict: adopt as a constraint, not as a convenience — and it is the strongest
argument push-to-talk has.** The earlier case for a press over a wake word
(run 23) was that it makes the microphone's state something the user did rather
than something they trust. That was a preference. This makes it structural: on
this path there is no platform mechanism that would tell the user the microphone
is open, so "the user is physically holding a key" is not merely the honest
design, it is the *only* remaining signal — and the fork has to supply the rest
itself.

Two things follow, both built this run.

*The state machine may never be left holding an open microphone*, because it is
the only thing that can close one. Every active stage now carries a deadline it
hands to the shell, and `blurred()` ends a turn outright, because holding a key
and switching away is the ordinary way a key-up goes missing — the release is
delivered to whatever took the focus. That failure is not hypothetical: the
push-to-talk stuck-open bug is the single best-attested complaint about the
gesture across Discord, TeamSpeak, Mumble and FiveM
(<https://support.discord.com/hc/en-us/articles/211376518-Voice-Input-Modes-101-Push-to-Talk-Voice-Activated>,
<https://github.com/citizenfx/fivem/issues/3663>,
<https://github.com/FrazzIe/mumble-voip-fivem/issues/158>), and in every one of
those the user can at least see a hot-mic indicator. Here they cannot.

*The deadline is chosen where it costs nothing.* `listening` gets Whisper's own
30-second window, past which the model discards the audio anyway — so the cap
can only ever end a turn whose tail was going to be thrown away, which is what
makes a hard bound on an open microphone safe to set low enough to matter. The
same trick is not available for `arming` and `transcribing`, and those two are
honestly just generous hang-catchers.

**The bit worth remembering beyond voice:** the fork is going to keep reaching
for privileged APIs, and the privilege silently removes the *user-facing* half
of an API as well as the permission check. The thing to ask of the next one is
not "am I allowed to call this" but "who was going to tell the user I did, and
are they still there".

**Phase:** built this run — `FOSVoiceSession.sys.mjs`, `GRAMMAR.md` §8's
seventh rule, and the property test that every abandoning event from every
stage closes the microphone.

### The local ASR path is not local yet, and the tree hides that behind a loader

**What happened:** the measurement finally ran and answered a question nobody
asked it. Both backends failed identically and instantly:

```
##### ASR gpu UNAVAILABLE Error: Unable to get the ML engine from Remote Settings.
##### ASR cpu UNAVAILABLE Error: Unable to get the ML engine from Remote Settings.
```

**What it means.** `MLEngineParent.#getWasmArrayRecord` fetches the ONNX runtime
from the Remote Settings `ml-onnx-runtime` collection and throws when the record
list comes back empty, which is also what Remote Settings returns on error. So
the ML engine cannot start without a successful fetch from a Mozilla service.

Run 23's note that "the tree ships both — `ort.webgpu.mjs` is packaged" was
half right, and the half it got wrong is the important half:

| what | where it comes from |
| --- | --- |
| `ort.webgpu.mjs`, `ort-wasm-simd-threaded.jsep.mjs` | `toolkit/components/ml/vendor/`, packaged into the build — confirmed in `dist/bin/chrome/toolkit/content/global/ml/` |
| `ort-wasm-simd-threaded.jsep.wasm` — the actual runtime | Remote Settings attachment, **not in the tree** |
| the model weights | a model hub, over the network |

And `services/settings/dumps/` has **no dump for the ML collection** — several
other collections ship one, so this is a choice rather than an omission. There
is therefore no offline path at all: a fresh profile with no network cannot run
a local model, and fails with an error about Remote Settings rather than about
what is missing.

**Verdict: this is not the Web Speech API problem, but it is not nothing, and
the fork has to choose.** The distinction worth being precise about, because it
decides whether the voice pillar survives: the Web Speech API was disqualified
because it POSTs *the user's audio* to a Mozilla endpoint on every utterance —
a per-use, per-utterance disclosure of content. This is a one-time fetch of a
binary, discloses nothing about the user beyond the request itself, and once it
has happened everything really does run on the device. Those are different
things and the fork should not pretend otherwise.

But "local, no cloud, ever" cannot be built on a component that silently needs
Mozilla's CDN to exist, especially in a fork that disabled the surrounding
services in Phase 1. Two options, and the next run should decide between them
rather than retry the measurement:

1. **Vendor the runtime.** ONNX Runtime is MIT, so the licence permits it and
   the fork already vendors the loader beside where the wasm would go. The cost
   is package size and a binary artifact in a public tree, and the benefit is
   that the claim becomes true — first run works offline, and nothing about the
   voice path touches a Mozilla service.
2. **Accept a one-time fetch and say so.** Cheaper, honest only if it is
   surfaced: the voice path would need a visible "download the speech model"
   step rather than a microphone that quietly fails on a machine with no
   network. That is a worse first-run experience but a much smaller change.

The recommendation is 1 for the runtime and 2 for the *model weights*, because
they differ in size by an order of magnitude and only the runtime is small
enough to package without argument. That also matches how the rest of the tree
treats the two.

**The general lesson, and the second one this run:** a packaged loader is not a
packaged dependency. `find dist/bin -name 'ort*'` looked like proof the runtime
shipped, and it was proof that the *file that fetches* the runtime shipped. When
checking whether the fork can do something offline, look for the artifact that
does the work, not the module named after it.

**Phase:** decided next run. The measurement cannot run until it is decided,
which makes this the blocker on the voice path rather than a note beside it.

---

## Run 27 — the ONNX runtime is already in the build, and run 25 asked the wrong question

**Searched:** nothing on the web. This was a tree-reading exercise, and it should
have been run 25's.

**The decision item 1 asked for is "neither option".** Run 25 framed a choice
between vendoring the ONNX runtime and accepting a one-time fetch. Both were
answers to a question that turned out to be malformed, because the tree already
ships an ONNX runtime that needs no fetch and no vendoring:

| | wasm backend (`onnx`) | native backend (`onnx-native`) |
| --- | --- | --- |
| runtime artifact | `ort-wasm-simd-threaded.jsep.wasm` | `libonnxruntime.so` |
| where it comes from | Remote Settings attachment | `./mach bootstrap` toolchain |
| in this build? | **no** | **yes** — `dist/bin/libonnxruntime.so`, 10.5MB |
| needs a Mozilla service? | yes, at first use | **no** |
| devices | cpu, gpu (WebGPU) | **cpu only** |

Verified rather than assumed, which is the whole lesson of run 25:
`ldd` resolves every dependency of the packaged `libonnxruntime.so` and it
exports `OrtGetApiBase@@VERS_1.22.0`, so it is a real, loadable ONNX Runtime
1.22. `WASM_BACKENDS = [BACKENDS.onnx]` excludes the native backend, and the
wasm fetch at `MLEngineChild.sys.mjs:443` is gated on that list, so the native
path never reaches `getWasmArrayBuffer`. `dom/onnx/` is a full native
`InferenceSession`/`Tensor` WebIDL implementation gated on
`INFERENCE_REMOTE_TYPE`, a first-class Gecko process type. `Pipeline.mjs`
already defaults to `onnx-native`.

**Why run 26 failed, precisely.** Not the hardware, not the fork's prefs, and
not "there is no offline path". The measurement passed `device` and never
passed `backend`, and `MLEngineChild` reads `opts.backend || BACKENDS.onnx` —
so an unnamed backend *is* the wasm backend. Both arms therefore asked for the
one runtime this build does not contain, and failed identically before the
device axis ever came into it.

Two further corrections to run 25's write-up, both from checking rather than
inferring:

- **The `ml-onnx-runtime` collection is not empty.** It carries 13 records
  including `ort-wasm-simd-threaded.jsep.wasm` at version 5.0.0, which is
  exactly the major version `WASM_MAJOR_VERSION[onnx] = 5` demands. Fetched
  over HTTPS from this machine, which also has working network to
  `huggingface.co` and `model-hub.mozilla.org`.
- **The failure was local, and the log says so**: `EmptyDatabaseError` from
  `services-settings/Database.sys.mjs`. The mochitest harness starts with an
  unpopulated Remote Settings database and does not sync one, and there is no
  packaged dump for that collection to fall back on. So the wasm backend is
  untestable under mochitest by construction — a fact about the harness, which
  run 25 generalised into a fact about the browser.

Run 25's "a packaged loader is not a packaged dependency" was a good lesson
drawn one step too narrowly. The sharper version: **`find` told us which files
matched a name, and the question was which files do the work.** Searching for
`ort*` found the wasm loader and missed `libonnxruntime.so` entirely, because
the artifact that actually runs the models is not named after the module that
loads it.

**Verdict: adopt `onnx-native` as the fork's ASR runtime.** It clears the bar
that mattered — the runtime is a build dependency, so a machine with no network
has a working inference stack on first launch, and nothing about the runtime
touches a Mozilla service. Nothing is vendored into the public tree and no
10.5MB blob joins git, because bootstrap already places it.

**What this does not solve, and the recommendation stands.** The *model weights*
are still a network fetch, and run 25's option 2 is still the right answer for
them: a surfaced, one-time "download the speech model" step, never a microphone
that quietly fails. The runtime and the weights were always separate problems
and only the runtime is now closed.

**The cost of the native path is the GPU arm.** `ONNXPipeline` hands
Transformers.js `supportedDevices: ["cpu"]` for `onnx-native`, so the offline
runtime is CPU-only. If CPU Whisper misses run 23's ~1s/2s budget, the choice
becomes a real one — offline and slow against fast and dependent on a Mozilla
CDN — and that is precisely what `run27` is measuring. `EmbeddingsGenerator`
carries a comment deferring native "until onnx-native has wider Linux
adoption", which is a caution worth holding until the numbers land.

**Phase:** the runtime half of the voice pillar's blocker is closed. The
measurement it was blocking is running as `run27`.

### The numbers, and the decision holds

`run29` measured it. The native arm loaded from the local hub and ran:

| arm | load | 1.5s utterance | 3s utterance |
| --- | --- | --- | --- |
| `onnx-native/cpu` | 1315ms | **median 324ms** (316–346) | **median 520ms** (502–584) |
| `onnx/gpu` | — | unavailable, Remote Settings | — |
| `onnx/cpu` | — | unavailable, Remote Settings | — |

Run 23's budget was ~1s to feel natural and 2s to be tolerable. A command-length
utterance transcribes in **a third of the natural budget** and the longest thing
the grammar permits in one utterance takes half of it. The GPU arm was worth
measuring and turns out not to have been worth wanting: the trade this decision
looked like it was making — offline runtime *or* fast — is not a trade at all at
whisper-tiny's size. `EmbeddingsGenerator`'s caution about native on Linux is
noted and did not bite here.

Load is 1.3s, paid once, and belongs at arm time rather than in the turn — which
is where `VoiceSession` already puts it.

**The three-strikes ledger, since this took five attempts.** run25 `Cu.now`,
run26 unnamed backend, run27 non-local fetch is fatal under mochitest, run28
`--hooks` is a perftest flag, run29 green. That is not one failure retried five
times: every attempt died of a different cause and each got strictly further
than the last, which is the distinction the rule is actually about. The one that
mattered was run26→27, where the fix was to stop believing the error message —
"Unable to get the ML engine from Remote Settings" is emitted for a backend the
caller never chose and had no reason to want.

**The lesson worth keeping:** a default that is wrong for you is more expensive
than a missing value, because it produces a confident error about the path it
chose rather than a complaint about the one you left out. `opts.backend ||
BACKENDS.onnx` cost four runs. When a component fails on a resource you did not
know it wanted, check what it thinks you asked for before concluding the
resource is unavailable.

---

## Run 30 — the voice path in a real browser, and the gesture it excludes

**Phase:** post-plan. The shell `FOSVoiceSession` was designed against is
written and wired, so the voice pillar is end to end for the first time.

### Driven, not asserted: what the real stack does

`agent/jobs/run30.sh` runs `browser_zzvoiceturn.js`, which replaces nothing —
real key, real device, real recorder, real runtime, real bar:

| stage | measured |
| --- | --- |
| first press with no weights | download announced, fetched and loaded from a hub in 1.5s |
| arm — device open, engine resident | **106ms** |
| 2s of audio, key-up to turn over | **513ms** |
| what the model said | `" (whistling)"` |
| what the user saw | "Nothing heard." |

Three things fall out of that last pair, and none of them could have come from a
test double.

**The annotation rule earns its place.** Handed a tone, Whisper did not answer
with nothing and did not answer with "thank you" — it answered with a bracketed
annotation, which is the case `FOSVoiceTranscript`'s `ANNOTATION` regex was
written for on the strength of reading rather than of evidence. It is now the
observed behaviour of this model on this machine, and the phantom query it kept
out of the Context Engine is a real one rather than a hypothetical.

**513ms for the whole tail of a turn**, against run 29's 520ms for inference
alone on a 3s clip, means `MediaRecorder` + `decodeAudioData` + resample cost
almost nothing measurable. The decision to record rather than drain an
`AudioWorklet` cost the budget nothing and cost the chrome process's main thread
nothing while the user was speaking.

**106ms to arm** is the number that decides whether the press feels like a
button or like a wait, and it is well under the ~200ms at which a delay stops
reading as instantaneous.

### Adopt: a latched turn, because holding a key excludes people

*Searched: push-to-talk and sustained keypress under motor impairment; what
accessibility dictation tools do instead.* Sources converge, and the finding is
uncomfortable for §8's first rule: sustained pressure is exactly what carpal
tunnel, arthritis, tremor and fatigue conditions make expensive, and dictation
tools written for those users offer tap-to-start/tap-to-stop rather than a held
key. Push-to-talk is still right as *the* default — it eliminates false wakes
and makes the microphone's state something the user did — but a voice path whose
only gesture is a held key has quietly excluded part of the audience §5's "no
separate accessibility mode" was written for.

**Adopt**, as a second gesture rather than a second mode. It clears the bar:
it is not a feature another browser has, it makes a turn possible for users for
whom it currently is not, it needs nothing but the state machine already here,
and it strengthens the same pillar rather than adding one. Two candidates, and
the choice is the next run's:

1. **Shift+F4 latches.** One press starts, the next ends, Escape cancels, the
   30-second `LISTENING` deadline bounds it. A modifier is reachable one-fingered
   through the platform's own sticky keys, which is a mechanism these users
   already have turned on.
2. **A tap latches.** Elegant — the state machine already tells a tap from a
   hold, since a release during `ARMING` is today's "too short to hear" — and
   dangerous for exactly that reason: a mis-press would open the microphone for
   thirty seconds rather than being forgiven.

(1) is the safer half of the pair and (2) is the one that needs no key at all.
The deciding question is whether a mis-press is common enough to matter, which
is a question about use rather than about design, so (1) ships first.

*Rejected while here: VOX / voice-activated switching.* It removes the gesture
entirely, and removes with it the property that makes push-to-talk honest — that
the microphone is open because the user did something. `IDEAS.md` run 24 already
priced what an always-listening microphone costs in phantom queries.

Sources: [FluidVox voice typing for accessibility](https://www.fluidvox.com/voice-typing-for-accessibility),
[Superwhisper for accessibility](https://superwhisper.com/for-accessibility),
[Voice-operated switch](https://en.wikipedia.org/wiki/Voice-operated_switch)

## Run 31 — the latch, and a bound that was defined in terms of a gesture

**Phase:** post-plan. Run 30's adopted idea, built: **shift+F4 latches a voice
turn**, one press starts it and the next ends it. Candidate (1) of the pair, as
run 30 said it would be.

### What it cost, which is the argument for it being a gesture and not a mode

One flag in `FOSVoiceSession`, one modifier arm in `FOSVoiceInput`, and one
element on the indicator. The turn arms, listens, transcribes and executes down
exactly the path a held key takes — same device, same recorder, same runtime,
same line handed to the same parser. That is the test §5's "no separate
accessibility mode" was always going to be judged by: if the second gesture had
needed a second path, it would have been a second mode wearing a gesture's name.

### The find: a safety bound written in terms of an ordinary event

`LISTENING_DEADLINE_MS` is the only thing standing between a mis-latched
microphone and thirty seconds of open device — this build draws no platform
indicator for a privileged `getUserMedia` (run 25), so nothing else would notice.
It was implemented as *"a listen that runs out is a key that came up"*, literally,
by calling `release`. A latched turn ignores `release`, because not holding the
key is the entire point.

So the deadline would have bounded every turn in the design **except the only one
that needed bounding**, and it would have done it silently: every existing test
passes, because every existing test is a held turn. Both endings now go through
one private step and `release` is a thin caller of it.

**Generalise it:** when a safety bound is expressed as "this is the same as that
ordinary event", any later mode that suppresses the ordinary event removes the
bound without touching the bound. The three defences worth having are to define
the bound on its own terms, to run the safety property over every mode rather
than every path (`test_voice.mjs` now runs "every way out of every stage closes
the microphone" over both gestures), and to be suspicious of a rule whose
statement contains a gesture.

### Driven, not asserted: both gestures on one resident engine

`agent/jobs/run30.sh`, extended. Nothing replaced — real key, real device, real
recorder, real `onnx-native` runtime, real bar:

| | held | latched |
| --- | --- | --- |
| armed | 106ms | **106ms, with no key held** |
| 2s of audio, stop to turn over | 521ms | **504ms** |
| what the model said | `" (whistling)"` | `" (whistling)"` |

The middle row of the latched column is the only one that could not have been
faked: a real `MediaRecorder` stayed open across the key-up that follows the
latching press, for a whole utterance, and a real one closed on the press that
ended it. Both are `getUserMedia` behaviour rather than the state machine's, and
the state machine is already covered in node.

### Two decisions the build forced, both about the microphone being unattended

**Any press ends a latched turn, not only a latching one.** The presses are
asymmetric on purpose: starting one needs the modifier, stopping one does not.
A user who latched with shift and reached back for the bare key has asked to
stop, ending early costs one utterance, and failing to end leaves a device open
that nothing will draw an indicator for. Those are not the same size of mistake.

**The indicator has to say how to stop.** For a held turn the user's own finger
is the answer to "how do I stop this"; for a latched turn nothing is, and this
element is already the only signal in the browser that the microphone is open.
It is hidden with `visibility` rather than `display` once the model is working —
a press would do nothing by then — so the box does not resize under the eye
reading it, which is the same reason the recording dot is quieted rather than
removed.

*Searched: hands-free dictation stop affordances; sticky keys and one-handed
modifier reach.* Both confirmed rather than changed the design. Latched
dictation surfaces put the stop control on the same indicator that reports
listening, which is what was built; and sticky keys "latches a modifier key
after it is pressed and released", which is what makes shift a one-fingered arm
rather than a second thing to hold — the objection that would otherwise have
sunk candidate (1) for exactly the users it is for.

Sources: [Sticky keys](https://en.wikipedia.org/wiki/Sticky_keys),
[Wispr Flow hands-free](https://docs.wisprflow.ai/articles/6391241694-use-flow-hands-free),
[Accessibility dictation on Mac](https://www.getvoibe.com/resources/accessibility-dictation/)

### Still open, and deliberately

The bare tap — run 30's candidate (2) — needs no modifier and so is what a user
with one reliable finger would actually want. It stays unbuilt because a mis-tap
would open the microphone for the whole thirty-second deadline, and how often a
mis-tap happens is a question about use rather than about design. `GRAMMAR.md`
§9 carries it.

## Run 32 — what a picture found that six hundred assertions could not

The run's task was the oldest item on the list: two changes made in run 23 that
"still owe eyes rather than assertions". Both were shipped, both were green, and
neither had ever been looked at. Looking at them found three defects, none of
which any test in the suite could have caught, because every assertion in it
measures a thing and none of them asks what that thing is on top of.

### The rails covered the browser

`.fos-rail` and `.fos-sidebar` are `position: fixed; inset-block: 0`, above the
toolbox on purpose — it carries `z-index: 0` and would otherwise paint over
them. So they ran the full height of the window: with the rail open there was no
back, forward or reload button, and with the sidebar open there was no app menu,
no extensions button, no window controls, no page actions and **no unseen mark**
— the fork's one permanent signal, covered by the surface that answers it.

Overlaying the *page* is a staged trade-off this project recorded and accepted.
Overlaying the browser was never chosen; it came along with the same
declaration, and nothing distinguished the two until a screenshot did.

**Generalise it:** a test can assert the geometry of a surface without ever
asserting what that geometry costs the surfaces around it. Occlusion is a
relation, and a suite built one component at a time has no natural place to put
a relation. The cheap defence is to photograph the window and look at it; the
durable one is a test that names the *other* thing — here, "a panel starts below
the toolbox", which is now in `browser_designsystem.js` because that is where
this fork keeps claims about the window rather than about a component.

### A background arrival was quietly becoming "where you are"

`onLocationChange` fires for every browser in the window, not just the one in
front, and `#setCurrent` took the trail of whichever browser it was handed. A
page finishing in a background tab therefore moved the active trail — and with
it `#syncMarks`, so the letters re-lettered to that trail; and with the letters
went the context sidebar, `what`, what `name` names, and the tiers the command
bar ranks by.

Found in the same picture: the sidebar in the unseen-mark shot was describing an
"Unnamed context, 1 page" while `what`'s own sentence, still on screen a few
hundred pixels below it, described "memex research, 3 pages". Two surfaces
disagreeing about which enquiry was in play, in one window, at one moment.

**The generalisation is about which object a notification is *about*.**
`currentNodeId` was written correctly — it reads the selected browser and cannot
drift. `activeTrailId` was written as a field updated by whatever event arrived,
and the events arrive for tabs the user is not looking at. Derived state was
right and pushed state was wrong, in the same class, three lines apart. Where a
window-scoped fact can be derived from what is selected, derive it.

### The reset step in the screenshot run reset nothing

The step between the context shot and the unseen shot ran the verb `dismiss` to
put the window back to rest. `dismiss` is a Field verb with a *required target*,
so with no target it parsed as an error and closed nothing. The picture meant to
show "an ordinary window doing nothing" was taken with a sidebar open over the
toolbar and a stale notice floating over the page — which is why it could not
answer the question it was taken for, and is a small lesson about using the
product's own grammar as test setup: a verb that fails safely fails silently.

### Item 1's actual question, answered

*Does the 8px accent dot read at a glance without shouting?* **Yes** — adopt as
built. With the toolbar no longer covered it sits at the end of the address bar,
after the bookmark star, quieter than the star and found without hunting. See
`agent/reports/shot-unseen.png`, which is now the picture it was supposed to be.

### The resize numbers, and the claim they do not support

| | p50 | p95 |
| --- | --- | --- |
| `crowded-overview-resizing-frame` | 41.20ms | 53.90ms |
| `closed-field-resizing-frame` (control) | 20.08ms | 24.90ms |
| `resize-burst-of-10` | 1.19ms | 1.90ms |

The burst is fixed and comprehensively so: ten resize events in one tick cost
1.19ms where they cost 53ms before coalescing. **Sustained** resizing of the
worst case the design permits — twelve trails, 480 cards, 480 miniatures — still
costs ~21ms a frame over the control, and the reason is visible in the other
row: one `crowded-overview-render` is 18.27ms p50, which is longer than a frame
on its own. Coalescing bounded the number of rebuilds per frame at one; it could
not make one rebuild cheap.

Recorded rather than chased. It is the deliberate worst case, dragging a window
edge while the overview is up is rare, and the fix — extending the reposition
fast path to cover the rebuild — is real work rather than a tweak. What matters
is not to record it as solved: run 18's note reads as though coalescing closed
the gap, and it closed the burst.

### The research: where a background arrival should send you, and how

*Searched: calm technology and the centre/periphery distinction; task
interruption, resumption cost and recovery in real workplaces.*

Weiser and Seely Brown's 1995 definition is the frame the unseen mark was
already built to — "that which informs but doesn't demand our focus or
attention", technology that moves between periphery and centre and increases
peripheral reach "without increasing information overload". The dot is the
periphery half and it is right. What the design had no evidence about was the
*centre* half: what happens after the user chooses to look.

Iqbal and Horvitz's CHI 2007 field study is the evidence, and it is unusually
direct. Logging information workers' real days, they measured:

- **27% of alert-driven suspensions left the previously active window unvisited
  for more than two hours** into the resumption phase.
- Users who responded to an alert immediately **tabbed through 7.5 applications
  on average** in pursuit of the one that had alerted them.
- ~10 minutes spent on the diversion itself, then **another 10–15 minutes**
  before returning to focused work on the disrupted task.
- A task worked on for less than 5 minutes before suspension had a **10% chance
  of not being resumed within two hours**.

Their design guideline drawn from that data: *"provide easy access to suspended
task context… in the form of thumbnails with views of the suspended states."*
That is the Field, described in 2007 by people who had measured why it was
needed and did not build it. **Verdict: adopt, as the missing pointer.** The
finding that changed the build is the 7.5 applications — the expensive half of
coming back is not switching, it is *searching*, and a boolean signal that opens
a canvas of identical cards hands the user exactly that search.

So the Field now says which card arrived: `data-arrived` on the card and its
miniature, and on the tile of the trail it landed in, drawn as the same dot in
the same colour and size the address bar wears. Two levels, one question — which
trail, then which card. It clears on **close**, not on open, because opening the
Field is the question and closing it is the answer; the boolean's own rule
(cleared by opening) would have made the per-card state clear itself before it
could be read, which is the sort of thing that looks correct because it matches
the rule beside it.

**Rejected while here:** a count rather than a state (the existing note already
settles it — nobody reads a peripheral number precisely, and a growing number is
the tab strip's worst property); a notification or toast (an event demands the
attention calm technology is defined by not demanding); and a new verb to jump
to the arrival, which would add a thirteenth action to reach a card that already
has a letter — `enter <mark>` is the jump, and the dot's job is to tell you a
mark is worth asking about.

Sources: [Designing Calm Technology, Weiser & Seely Brown](https://people.csail.mit.edu/rudolph/Teaching/weiser.pdf),
[Calm technology](https://en.wikipedia.org/wiki/Calm_technology),
[Disruption and Recovery of Computing Tasks, Iqbal & Horvitz, CHI 2007](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/11/CHI_2007_Iqbal_Horvitz-1.pdf)

---

## Run 36 — the embedding pass, measured before it was built

Searched: `model2vec potion-retrieval-32M static embeddings quality short
queries benchmark`; `search session task boundary detection query embeddings
same-task clustering precision study`.

The published claim for the model the tree already prefers:
`potion-retrieval-32M` is the best-performing static retrieval model, reaching
**81.7–86.7% of `all-MiniLM-L6-v2`** on retrieval while being orders of
magnitude faster. That is a number about retrieval benchmarks, whose queries are
sentences. This fork's input is four lower-case words, which is shorter than
anything in that evaluation, so the claim does not transfer and the measurement
had to be ours. `browser_zzembedquality.js` is it, and `agent/jobs/run36.sh`
runs it: eight enquiries, 32 queries written the way they are typed and 24
capitalised page titles, two of the eight pairs deliberately adjacent
(memex/spatial hypertext, sqlite/onnx) so the score is not carried by easy
separations.

**The control is the point.** The Context Engine already stores
`normaliseIntent` for every query, so the thing a 30MB download has to beat is
Jaccard overlap on those tokens. It is not a straw man — it is what shipped.

| arm | query→query p@1 | query→title p@1 | best merge threshold | precision / recall |
| --- | --- | --- | --- | --- |
| lexical (Jaccard) | 0.625\* | 0.750\* | 0.111 | 0.941 / **0.333** |
| static/d256 | **0.844** | 0.906 | 0.201 | 0.778 / 0.583 |
| static/d512 | **0.844** | **0.938** | 0.169 | 0.756 / 0.646 |

\* **The asterisk is the finding.** For **11 of 32** queries the lexical arm
returns the same similarity — zero — for every candidate in the corpus, and for
8 of 32 against titles. Those rows are credited to it above because sort order
had to break the tie, so its true p@1 is somewhere at or below 0.66 and 0.75 is
generous. A third of the input this fork's users type has *no lexical signal at
all* against their own history, which is a sharper statement of the gap than
"queries are lower case": the shallow path is not weak on those queries, it is
silent on them. The static arm answers all 32.

**Verdict: adopt, at d256.** The two dimensions are indistinguishable on this
corpus — identical query→query p@1, one query's difference on titles, both
inside the noise of 32 rows — and the fetch is 30MB against 60MB. The download
is something this fork asks a user for, so where the evidence is a tie the
smaller one wins. Re-run `run36.sh` if that is ever doubted.

**Cost is not a consideration, which is the other reason to adopt.** Load is
~0.4–0.7s once, and an embedding is **1.27ms** for one query and 3.1ms for all
32 — because the model is a lookup table and an embedding is a sum of rows.
There is no encoder, so there is no budget conversation of the kind the ASR
path needed.

**What the numbers refuse.** The best separating threshold for "same enquiry"
is 0.169 at precision 0.756 — so roughly **one in four pairs above the
threshold are from different enquiries**, and pushing precision up costs recall
immediately. That kills silent cross-trail context merging, which is what I
would have built: a rule that quietly folds two research topics together and is
wrong a quarter of the time is worse than no rule, because the user cannot see
what it did. It does not kill *offering* the merge, and that is the shape it
should take — consistent with the line this project already holds, that
provenance is a statement and inference is a suggestion. The threshold is now a
measured number rather than a guess, which is what makes the offer buildable.

**Where it is weak, recorded so it is not rediscovered.** Error-message queries
were the worst enquiry in both arms — `rust` scored 2/4 nearest neighbours
in-task, because "why does my closure move the value" and "lifetime annotation
error struct" share their vocabulary with nothing except the thing they are
about. A bag-of-tokens model has no word order to fall back on. The best arm
was query→title at 0.938, which is the direction the command bar actually
needs.

Sources: [potion-retrieval-32M](https://huggingface.co/minishlab/potion-retrieval-32M),
[Model2Vec results](https://github.com/MinishLab/model2vec/blob/main/results/README.md),
[Identifying Task-based Sessions in Search Engine Query Logs, Lucchese et al., WSDM 2011](https://dl.acm.org/doi/pdf/10.1145/1935826.1935875)

## Run 37 — the threshold was measured over the wrong pairs

Not a search: a correction, found by driving the thing that was built on run
36's numbers.

`RELATED_FLOOR` was 0.169, taken from the **query→query** distribution. The
tier it guards only ever compares a **query to a title**. Those are different
distributions out of the same model, and nothing in the code said which one it
was standing on. The tier refused a page at 0.159 that it existed to offer,
and the refusal was correct — the constant was not.

Measured properly, at the dimension this fork ships:

| comparison | best threshold | precision | recall |
| --- | --- | --- | --- |
| query→query | 0.201 | 0.778 | 0.583 |
| **query→title** | **0.173** | 0.708 | 0.656 |

The lesson is not "check your constants" — it is that **a threshold is only
measured if you can say what it was measured over**. 0.169 and 0.173 are close
enough that the mistake could not be seen in the number; it could only be seen
in the pairs. The comment on the constant now names the comparison, and
`pairs()` in the measurement takes an explicit second set so a within-type and
a cross-type sweep cannot be confused again.

**The fixture had to be measured too.** A bag-of-tokens model's similarity
between two texts with *no* overlapping words is not something a person can
estimate by reading them, which is exactly why the first attempt at a test
fixture failed. Eight candidate pairs, all with zero shared terms, at d256:

| query | title | cosine |
| --- | --- | --- |
| cheap airfare to portugal | Lisbon Travel Guide: Where to Stay | **0.36** |
| storing hierarchies in a database | SQLite: Write-Ahead Logging | 0.355 |
| clicky switches for typing | The Best Mechanical Keyboards of the Year | 0.257 |
| run a language model on my own machine | ONNX Runtime Performance Tuning | 0.217 |
| my loaf came out flat and gummy | Troubleshooting Your Sourdough Starter | 0.183 |
| hypertext research trails linking | As We May Think: The Memex… | 0.159 |
| what did vannevar bush propose | As We May Think: The Memex… | 0.091 |
| cheap airfare to portugal | Baking Sourdough Bread in a Dutch Oven | 0.014 |

The bottom two are the same finding as run 36's `rust` result, and it is worth
stating as a limit of the model rather than as a curiosity: **proper nouns and
abstractions are where it is weakest**. "vannevar bush" scores 0.091 against a
page that is literally about Vannevar Bush, because a static table has no row
that connects a name to the thing the name is known for. Common-noun topical
language — flights and travel, switches and keyboards — is where it is strong.
For this fork that is the right way round, since the shallow extractor already
handles capitalised names well and it is lower-case topical queries that were
silent.

**A scope this run tried to widen and could not.** The `related` tier draws
candidates from the context, the trail and its crossings, and *not* from the
Places floor. The floor's rows arrive from `frecencyMatches(text)`, which is
itself a lexical query — so a page sharing no word with what was typed is not
in that array to be recovered, and the tier cannot reach it however good the
model is. Reaching it means embedding all of Places, which at 1.27ms a page is
a vector store with persistence and staleness rules: the thing Firefox's own
semantic history search built, and a different feature from this one. Recorded
as the honest boundary rather than left as an implied capability.


## Run 38 — consent for a model download, and what the search found in it

**The question.** The `related` tier shipped in run 37 and no ordinary profile
could turn it on. What was missing was the step that makes the download the
user's decision. The voice path had already settled the shape (run 25's option
2, run 30's ordering), so this looked like execution rather than research. The
search is what changed the design twice.

### Chrome's 4GB Gemini Nano download, May 2026 — **adopt, as a constraint**

Chrome was found writing a ~4GB on-device model to disk with no prompt, no
notification and no setting. The reporting is unanimous on the first complaint
and it is the obvious one. The complaint that matters here is the *second* one,
which recurs in every write-up and which I had not thought of:

> If the user deletes it, Chrome re-downloads it.

Sources: [Tom's Hardware](https://www.tomshardware.com/tech-industry/cyber-security/google-chrome-silently-downloads-4gb-ai-model-to-your-device-without-permission-report-claims-researcher-says-practice-may-violate-eu-law-waste-thousands-of-kilowatts-of-energy),
[Malwarebytes](https://www.malwarebytes.com/blog/news/2026/05/google-chrome-silent-4gb-ai-download-problem),
[Cybernews](https://cybernews.com/security/google-chrome-ai-model-device-no-consent/),
[Tom's Guide](https://www.tomsguide.com/ai/check-your-storage-chrome-may-be-downloading-a-4gb-ai-model-heres-what-we-know).

**This fork had built exactly that, and the search is the only reason it did
not ship.** As first written, `FOSEmbeddings.ensure` called `createEngine` on a
keystroke whenever the pref was on, and `createEngine` fetches what it does not
have. A user who ran `model` in March, then cleared the model cache in August
to get the 30MB back, would have had it silently fetched again by the next
keystroke into the command bar — with the pref still on from March standing in
for consent to a transfer happening now.

The fix is one line of policy and it is worth stating as a rule, because it
generalises past this feature: **a stored yes is consent to a state, never to
an action.** `ensure` now checks the cache and never fetches; `download` is the
only method in the module that may put bytes on the wire; deleting the weights
degrades the bar to five tiers until the user asks again. Verdict: adopt, and
it is now the first thing said in that method's comment.

### Firefox Translations' own download UI — **adapt, partially; reject the pane**

In-tree prior art, found by reading rather than searching:
`settings-translations-subpage-download-language-option = { $language }
({ $size }MB)`. Firefox discloses the size per language and offers a **delete**
(`settings-translations-subpage-download-delete-confirm`).

Size disclosure: adopted, and gone further — the line names the host too, which
Firefox's does not, because for this fork *who is contacted* is the whole
promise and Mozilla is who it is.

Deletion: **rejected as a verb, and the reason is the grammar rather than the
feature.** Firefox can afford a delete because it has a preferences pane to put
it in; this browser deliberately has none, and every capability costs a word
out of a table `GRAMMAR.md` §4 says must stay small enough to teach entire.
A second word to un-download 30MB — one-fifteenth of the browser's own install
— does not clear that bar. What makes the rejection safe is the rule adopted
above: because nothing re-fetches, deleting the cache by hand is a *supported*
way to get the space back rather than a fight with the browser, which is
precisely the property Chrome lacks. Revisit if a second, larger model lands.

### The weights are not on Hugging Face — **finding, forced a decision**

Run 25 decided the speech model comes from Hugging Face rather than Mozilla's
mirror, on the argument that this fork should not lean on Firefox's
infrastructure for a file it can get from the model's own home. That argument
does not survive here. `Mozilla/static-embeddings` on Hugging Face is the build
repository — scripts, four READMEs, no weights — and the `.npy.zst` tables the
static-embeddings backend loads exist only on `model-hub.mozilla.org`. Checked
against the HF tree API at `v1.0.0`: 29 files, not one a weight.

So this fork does contact Mozilla, once, for this one file, and the answer is
to say so on screen rather than to drop the feature or hide the host.

### The size is measured, and so is the progress field

29,836,775 bytes of `fp16.d256.npy.zst` plus 478,156 of `tokenizer.json.zst` —
the only two files `StaticEmbeddingsPipeline` requests at d256. Hence "about
30MB", not a number copied off a model card.

Driving the real download found the second measurement. The runtime's progress
report carries `progress` as a percentage **of the file in flight**, and this
model is two files: the observed sequence was 0% → 100% → 0% → done. A
percentage that restarts is worse than no percentage. `totalLoaded` is
documented as the sum across every callback, so it is the one field that only
grows, and the line now counts megabytes rather than percent.

### Two traps in `ModelHub.listFiles`, and one in our own test double

Both make a presence check that compiles, runs, and answers "no weights" on a
machine holding the weights.

1. It resolves to `{files, metadata}`. Its JSDoc promises an array.
2. The cache keys a model by `hostname/organization/name`. The `model`
   parameter is documented as `organization/name` in one block and as
   `hostname/organization/name` in another, thirty lines apart in the same
   file. Under the local hub the stored key is
   `localhost/mozilla/static-embeddings`; in a shipped build it is
   `model-hub.mozilla.org/mozilla/static-embeddings`.

The voice path has carried trap 1 since run 25 — thirteen runs of a spurious
"Downloading the speech model" on the first press of every session, followed by
a `createEngine` that read the cache and worked, which is exactly why nobody
noticed. It was found by making the same mistake somewhere it mattered more.

The third trap is ours. `browser_voice.js` doubles `listFiles` and returned an
array, so the double asserted the wrong contract and the production code
matching it looked correct. **A double is a claim about somebody else's API,
and it goes stale in the direction of whatever was convenient to write.** The
double now returns the real shape.

## Run 39 — the offer's shape, and a threshold measured at the wrong context size

**The question.** Run 36 refused silent cross-trail merging on its own numbers
and said *offering* it was what survived. This is that offer. The search was
for the shape, and the measurement was for the number — and the number turned
out to be a different one from the one run 36 left behind.

### Horvitz, *Principles of Mixed-Initiative User Interfaces*, CHI '99 — **adopt, as the shape**

Searched: `Horvitz principles of mixed-initiative user interfaces uncertainty
threshold expected utility when to offer versus act`.

The canonical treatment of exactly this problem, and it supplies the thing this
project had been reasoning about one case at a time. An agent uncertain about a
user's goal has **three** options rather than two, and the middle one is to ask.
Dialogue has its own expected-utility line, above inaction when a guess is
decent and below action when a guess is near-certain, so it owns a band of
probabilities that neither of the others should take — two thresholds, not one:
`p*¬A,D` between silence and asking, `p*D,A` between asking and acting.

Two of the twelve principles did real work here beyond the framing:

- **(3) Considering the status of a user's attention in the timing of
  services.** The timing of an offer is part of its cost, not a detail of its
  delivery. This is why `mergeOffer` is computed when the context sidebar opens
  and never on the navigation path: opening that panel is a voluntary glance at
  "what do I know", and "are these two the same enquiry" is the same question.
  The same argument that put run 22's background-arrival signal on a surface
  the user chooses to look at, arrived at again from the literature.
- **(7) Minimising the cost of poor guesses about action and timing**, which
  names "natural gestures for rejecting attempts at service". A rejection that
  does not stick is not a rejection. Hence `context_merge_declined` and a
  decline button that says "and stop asking about these two" rather than "not
  now" — there is no later, by design.

Also **(8) scoping precision of service to match uncertainty**: "a preference
for doing less but doing it correctly". That is the argument for offering *one*
candidate rather than a ranked list. Three offers at once is a dialog box
asking the user to do the browser's filing.

**Where this fork departs, deliberately.** Horvitz's band is open at both ends
and this one is not. There is no confidence at which a merge happens by itself,
because provenance-before-inference is the line pillar C is built on. So `p*D,A`
is unreachable by construction and the only threshold that had to be measured is
the bottom one. That is a smaller measurement problem than the paper's, and it
is the whole of it.

Source: [Principles of Mixed-Initiative User Interfaces, Horvitz, CHI '99](https://erichorvitz.com/chi99horvitz.pdf)

### The number run 36 left behind was for the wrong thing — **finding**

Run 36 reported a "best merge threshold" of 0.201 at precision 0.778, and run 37
corrected which *pairing* it described. Both numbers are for **one query against
one query**. A context is a set of queries, so a merge score is an aggregate
over many pairs, and an aggregate has its own distribution. Neither number
transfers.

`agent/jobs/run39.sh` measures the aggregate over aggregates. Each of the eight
enquiries is cut in half, so two halves of one enquiry are a pair that should
merge and the other 112 pairs are pairs that should not — 8 positives, 112
negatives. Splitting is what makes positives exist at all: no two enquiries in
that corpus are the same topic, and the case the feature is *for* is one topic
researched on two trails.

**Precision, not F1.** F1 treats a missed merge and a wrong merge as equally
bad and this feature does not. A merge never offered costs the user nothing they
had; a merge offered wrongly spends their attention and, if accepted, puts two
unrelated enquiries in one sidebar. So every rule is read at the lowest
threshold reaching precision 1.0. At d256:

| rule | best-F1 threshold | F1 precision/recall | threshold at precision 1.0 | recall there |
| --- | --- | --- | --- | --- |
| max | 0.267 | 0.700 / 0.875 | 0.439 | **0.625 (5/8)** |
| **mean** | 0.134 | 0.727 / 1.000 | **0.244** | 0.500 (4/8) |
| top3 | 0.172 | 0.727 / 1.000 | 0.281 | 0.500 (4/8) |
| centroid | 0.204 | 0.727 / 1.000 | 0.408 | 0.500 (4/8) |

Note the reversal, which is the reason to report both columns: at the F1
optimum `max` is the **worst** rule, and at precision 1.0 it is the **best**.
The ranking of these rules is not a property of the rules, it is a property of
the operating point, and a table with one column would have picked whichever
rule the objective happened to flatter.

### `max` wins the table and is rejected — **the run's real finding**

`max` asks whether two contexts share *any* one question, so it is an order
statistic over the pairs compared and must climb as the number of pairs grows,
whether or not the contexts are any more alike. The corpus scored contexts of
**two** queries — 4 pairs — where a real context holds many more. A threshold
read off it is a threshold read off the wrong context size.

That is run 37's mistake with a different variable in it, so it was measured
rather than argued: the same rules over whole enquiries (4 queries, 16 pairs)
against halves, reading only the different-enquiry side, which is the side a
precision-first threshold holds back.

| rule | diff-task median, k=2 → k=4 | p95 | worst |
| --- | --- | --- | --- |
| max | 0.095 → 0.147 (+55%) | 0.196 → 0.340 (**+73%**) | 0.361 → 0.361 |
| top3 | 0.061 → 0.117 (+92%) | 0.136 → 0.197 (+45%) | 0.249 → 0.305 |
| **mean** | 0.041 → 0.040 | 0.115 → **0.094** | 0.207 → **0.127** |
| centroid | 0.065 → 0.088 (+35%) | 0.172 → 0.223 (+30%) | 0.335 → 0.294 |

`max` and `top3` are out on portability. Of the two whose thresholds hold still,
`mean` and `centroid` tie on recall and `mean` is the steadier — doubling the
context size moved its false-positive tail *down*, and its worst
different-enquiry score at the larger size is 0.127 against a floor of 0.244, a
margin of nearly two to one. **Adopted: the mean of every cross pair, floor
0.244, at d256.**

**A small verdict on the schema, too.** `context.centroid` is documented as the
mean of member embeddings and is written by nothing. This is the measurement
that would have justified filling it in, and it does not: centroid is the rule
`mean` beat. Recorded in `SCHEMA.md` beside the column so it is not proposed
again.

### d512 is better at *this* question, and the fork keeps d256 — **decision**

Run 36 adopted d256 because the two dimensions were indistinguishable on
retrieval and the download is half the size. On the merge question they are not
indistinguishable: at d512, `mean` reaches precision 1.0 at recall **0.75**
against d256's 0.5, and does it at the F1 optimum rather than needing a raised
threshold.

Kept at d256 anyway. The weights are a 30MB download this fork asks the user
for by name, run 38 settled the consent around that number, and doubling it to
60MB to raise the recall of an offer — from about half of mergeable pairs to
about three quarters — is not a trade a user would recognise as theirs. The
honest framing is that the merge offer is a **second consumer of weights
already on the machine** and is priced accordingly. Revisit only if something
else independently justifies d512.

**What the numbers do not say.** Precision 1.0 means no false positive was
observed among 112 different-enquiry pairs — a real statement about the
negatives, not a guarantee. Recall 0.5 rests on **eight** positives and is a
noisy estimate; read it as "about half". And the size probe doubled a context
from two queries to four, which is evidence the floor travels, not proof it
travels to forty.

### Driving it: three things the measurement could not say

`browser_zzmergeoffer.js` runs the real `mergeOffer` against a real engine on
contexts built by *browsing*, because the ordinary suite covers the surface with
the offer doubled and that is the arrangement that hid a broken presence check
for thirteen runs. It found three things, none of them visible in a table.

**The floor behaves as measured, in both directions.** Two halves of the Lisbon
enquiry score **0.812** — far above the floor rather than near it — and a
sourdough context against two keyboard contexts is offered nothing at all. The
gap between those is much wider than the corpus's best-threshold arithmetic
suggested, which is the reassuring version of a precision-first floor.

**Recall 0.5 is not a statistic, it is specific enquiries.** The corpus's
`memex` and `sqlite` halves fall *under* the floor and are never offered. Those
are exactly the two enquiries run 36 identified as the model's weak spots —
proper nouns and adjacent technical vocabulary — so the misses are not spread
evenly across topics, they are concentrated on a kind of topic. Worth stating
plainly: **this feature works on what you were shopping for and not on what you
were reading about.** Not asserted in a test, because freezing a limitation into
a requirement means the test fails when the model gets better.

**A fixture is a measurement, not a piece of writing — again.** Run 37 recorded
this after the `related` tier's first fixture scored 0.159 against a floor of
0.173, and the same trap caught the same project a second time. Needing an
enquiry that clears the floor, I wrote two fresh ones in the corpus's style —
cycling and coffee — on the reasoning that common-noun consumer topics are where
the model is strong. Driven: neither matched its own other half, and **coffee
matched cycling at 0.267**, over the floor, a false positive between two
enquiries no person would confuse. Invented text has no measured similarity, and
a bag-of-tokens model's opinion of it cannot be estimated by reading it. The
fixtures are now drawn only from the scored corpus.

That last one also puts a number on the floor's real-world precision that the
sweep could not: 0.267 is a false positive at a floor of 0.244, from a pair the
corpus never contained. Precision 1.0 over 112 negatives remains what was
measured; it is not what should be expected of arbitrary enquiries, and the
margin between them is thinner than the sweep implies.

## Run 40 — the bare tap, and an objection that was never about the tap

Item 1 on the standing list, open since run 30 and explicitly deferred twice
since. The research went looking for how often a mis-tap happens in use, which
is what `GRAMMAR.md` §9 said the answer depended on, and came back with
something better: the question had been asked about the wrong object.

### `SpeechRecognizerTimeouts`, Windows — **adopt, both halves**

Windows' speech API has carried three timeouts since the UWP days, and two of
them are exactly the missing bounds: `InitialSilenceTimeout` ("detects silence
before any recognition results have been generated and assumes speech input is
not forthcoming") and `EndSilenceTimeout` ("detects silence after recognition
results have been generated and assumes speech input has ended"). The docs'
worked example sets them to 6s and 1.2s. Azure, Deepgram and the Web Speech
API's `no-speech` error are the same idea under other names — this is settled
practice, not an experiment, and the fork had neither.

Adopted at 6000ms and 1500ms. End silence is nudged up from Microsoft's 1.2s
because a command bar line is composed more deliberately than dictation and a
mid-line pause must not end the turn.

Sources:
[Set speech recognition timeouts](https://learn.microsoft.com/en-us/windows/apps/design/input/set-speech-recognition-timeouts),
[SpeechRecognizerTimeouts.EndSilenceTimeout](https://learn.microsoft.com/en-us/uwp/api/windows.media.speechrecognition.speechrecognizertimeouts.endsilencetimeout),
[Deepgram, end-of-speech detection](https://developers.deepgram.com/docs/understanding-end-of-speech-detection)

### The objection was mis-scoped, and that is the run's finding

§9 refused the bare tap because "a mis-tap would open the microphone for the
whole thirty-second deadline". That sentence is true and it is not about the
tap. **Shift+F4 has the identical exposure** — a mis-pressed latch is a mis-tap
with a modifier on it — so the thirty seconds was a property of *a latched
microphone bounded only by a clock*, which every latched turn already was.

The consequence is that the thing blocking the feature was not a question about
use at all. It was a missing bound, and a missing bound is a design question
with a well-known answer. Three runs of "it stays open until the latch has been
used by somebody" bought nothing, because no amount of use would have changed
what the right fix was.

**Generalises:** when a feature is blocked on a risk, check whether the shipped
alternative carries the same risk. If it does, the risk is not an argument
against the feature — it is an unbuilt safeguard, and the feature is only
waiting on it by accident.

### End silence is a feature, not a safeguard — **the reason to build it now**

Initial silence makes the tap *safe*. End silence is what makes it *good*: a
latched turn ends itself when the utterance does, so the second press stops
being the only way out and becomes a way to stop early. That turns the tap into
a genuinely one-gesture turn — tap, speak, done — which is the thing a user with
one reliable finger was being denied. A bare tap shipped with only the safety
half would have been a gesture that still needed a second press, which is what
the shift latch already was.

### Rejected: an `AudioWorklet`, again, and for the same reason

Knowing whether anybody is speaking needs a live signal, and the recorder was
deliberately built without one (§9: `MediaRecorder`, decoded once, so the chrome
process does nothing per-frame while the user is talking). The worklet is still
the wrong tool. An `AnalyserNode` polled at 10Hz keeps its ring buffer in C++
whether or not anybody reads it, so the cost is one 2048-sample copy and a sum
every 100ms rather than JS on the audio path for the whole utterance. 2048
samples is ~43ms at 48kHz — longer than a glottal pulse, shorter than a syllable
— so the RMS measures the voice rather than where in the waveform the poll
landed.

The floor is `FOSVoiceTranscript`'s own exported `MIN_RMS` rather than a second
number. That is not tidiness: the gate averages over the whole recording,
pauses included, so any *window* loud enough to be speech on its own is louder
than the average it will later be judged by — which is what guarantees the live
bound cannot end a turn the gate would have accepted.

### Driving it: three things the tests could not say until they ran

**Every hold in the browser suite was a tap.** The helpers synthesise both
halves of the gesture faster than any hand can, so the first turn latched by
accident and left a microphone open — and the *next* test's press then closed
that turn instead of starting its own. Six failures, one cause, and the cascade
is what made it look like the module was broken rather than the fixture. A
threshold expressed in real time changes the meaning of every existing test that
never had to think about time.

**Measure the gesture from the events, not from the handlers.** Two `Date.now()`
reads inside a keydown and a keyup handler measure handler-to-handler, not
key-down-to-key-up, and under load those differ by exactly the sort of margin
that sits on a 400ms boundary. `event.timeStamp` on both halves is the interval
that was actually performed. The first draft read a clock inside the session and
would have turned a deliberate hold on a busy machine into a tap.

**Getting the threshold wrong stopped being expensive, and only because of the
other half.** 400ms sits inside the band where a one-word utterance lives
(`MIN_UTTERANCE_MS` is 250ms), so the tap/hold call is genuinely ambiguous
there. With end silence in place a hold misread as a tap simply latches, the
user keeps talking, and the turn ends 1.5s after they stop. Two bounds that
looked like separate features turned out to be what makes each other safe to
tune.

### Still open

Nothing about the gesture. The one number with no measurement behind it is the
6000ms initial-silence bound: it is Microsoft's example value, not this fork's,
and the thing that would set it is how long a deliberate latch-then-think pause
actually runs. That is a real question about use, unlike the one this section
closed, and it costs a user six seconds rather than thirty to get wrong.

### The bound had no signal under it on this machine — **the run's second finding**

Written after the section above, because testing the mechanism rather than the
logic is what found it.

Every browser test in the voice file replaces the microphone, so none of them
touch the code that listens to one. A test against a *real* captured stream —
Gecko's own fake device, `media.navigator.streams.fake` — showed the
`AudioContext` stuck in `suspended`, reading a flat zero, with `resume()` never
settling.

Autoplay was the obvious suspect and is not the cause. `IsAllowedToPlay` returns
early here (`media.autoplay.default` is 0, `block-webaudio` false), and the
context stays suspended with an active capture *and* user activation both in
place — so neither `IsActivelyCapturingOrHasAPermission` nor
`IsWindowAllowedToPlayByUserGesture` is what is missing. The actual cause is
`destination.maxChannelCount === 0`: **this box has no audio output device**, no
`/dev/snd` and no sound cards, and Web Audio will not run a graph without one.
Needing an output device in order to measure an input one is a Web Audio fact,
not a fault.

**The failure was pointed the wrong way, and that is the part worth keeping.** A
suspended context reads exactly what a silent room reads, so the initial-silence
bound would have fired at six seconds *into an utterance* and reported "nothing
heard". A safety bound that cuts off the person it is protecting is worse than
no bound. The turn now asks whether anything is reporting the level at all
before it treats silence as meaning anything, and both failure routes — no
monitor, or a graph that never starts — land it back on the key and the model's
window, which is the design that shipped before the bounds existed.

**Generalises, and it is a sharper version of run 39's lesson.** That run learned
that a capture reporting success is not a capture of the right thing. This one:
**a sensor that cannot read returns the same value as a sensor reading nothing,
so any bound driven by a sensor needs to know the sensor is alive** — and the
degradation has to be chosen deliberately, because the default is whichever
direction the arithmetic happens to fall.

Two smaller things it cost:

- **`AudioContext.state` at construction is meaningless.** It reaches `running`
  asynchronously, so the first draft's synchronous check would have reported "no
  monitor" on a *healthy* machine and quietly disabled the feature everywhere.
  The poll decides instead, after a grace well inside the bound it protects.
- **The positive half is untestable on this box** and the test says so out loud
  rather than passing quietly. It asserts the degradation here and the real
  behaviour on any machine with audio hardware.

## Run 41 — the column that had a filter and no writer

The standing list was thin and its own item 1 was marked bounded value, so this
run went looking rather than working down it. What it found was not an idea to
add but a feature already half-present: `archived_at` has been in `trail` since
`001-initial.sql`, `restorable()` has always filtered on it, and **nothing in
the product ever set it**. The only writer in the tree was a test, reaching past
the store's API with raw SQL to manufacture a state no user could reach.

That is a specific and unusual kind of gap. It is not a missing feature — the
schema, the query and the test were all written by someone who knew what the
state was for. It is a missing *word*.

### The retrieval numbers, and what they are and are not evidence for

- **Found:** 2026-08-19. Surveys of bookmark and read-later behaviour: under 10%
  of saved bookmarks are ever accessed; ~70% of saved links are never revisited;
  read-later apps report open rates below 5%. The one with a number worth
  keeping: **retrieval drops sharply once a collection exceeds what can be
  scanned in about 60 seconds.**
- **Verdict: adopt the constraint, reject the diagnosis.** The usual explanation
  is the collector's fallacy — saving is cheap and feels like progress, reading
  is expensive, so the pile grows. That diagnosis does not apply to this fork at
  all, and it is important to say why rather than to borrow the conclusion: a
  trail is not saved, it is *captured*. There is no act of intent to be mistaken
  for progress, because there is no act.
- **Which makes the fork's version of the problem the inverse one.** A bookmark
  pile is everything the user *chose* and did not read. A trail pile is
  everything that *happened*, chosen or not. The 60-second bound still binds —
  `restorable()` is a list a person scans rather than queries — but the pressure
  on it does not come from over-saving, and no amount of discouraging saves will
  relieve it. The only lever is telling the finished from the merely old.

### `updated_at` cannot express "finished", and that is the whole argument

A trail finished an hour ago and a trail paused an hour ago carry the same
`updated_at`. Recency can therefore *order* the resumption list but can never
*shorten* it, and the list is the one surface in the schema that is scanned
rather than queried. Every candidate signal the system could compute — dwell,
node count, time since last visit — is a proxy for the same missing fact, and
the person who has it is sitting right there. `done` asks them.

This is also the honest reason the column existed with no writer: the filter is
obvious once you have the state, and where the state comes from is the actual
design problem.

### Arc's auto-archive — **adapt the goal, reject all three mechanics**

- **Found:** 2026-08-19, Arc's help pages and the round-ups of what people
  missed after it was discontinued.
- **What it is:** idle unpinned tabs archive on a cadence, 12 hours by default.
  Widely liked — repeatedly described as the single feature that made tab
  anxiety go away.
- **Verdict: adopt that a browser should have an answer here at all; reject the
  clock, the compulsion and the disposal.** Three specific mechanics, three
  specific reasons:
  1. **It fires on a clock**, which is a fact about elapsed time and not about
     the work. It is the same guess `FIELD.md` §3 makes with least-recent-touch
     and §10 already flags as possibly wrong — a trail parked deliberately is
     not a trail abandoned.
  2. **It cannot be switched off.** A rule the user cannot decline is one they
     have to work around.
  3. **The archived tab leaves every surface**, so recovering one means
     retyping its URL. This is the failure that matters, and it is the one this
     fork is best placed to avoid: the Context Engine already knows what those
     pages were *about*, so the return path is typing the subject into the bar
     rather than reconstructing an address. An archive you can only get back
     into by knowing where you put it is a graveyard with extra steps.

### What it cost to build, and the one shape that had to be got right

Small, because every seam had a precedent: `name`'s bare form already means "the
trail you are on", so `done` needed no mark; reconciliation already mirrors
`name` to the database, so it mirrors `done` the same way.

The one real decision was **not** implementing it as `dismiss` applied to every
node. Writing `dismissed_at` across a trail would have reused a working path and
been wrong twice over — it misreports what the user did (they said one thing
about a thread, not nine things about pages), and it would come back looking
discarded rather than filed if the trail were ever resumed. `archived_at` on the
trail already said it. Nothing is written to a node.

### The freed slot had to actually free something — **the run's finding**

`FIELD.md` §3 caps the overview at nine regions and nests the overflow; the nest
costs a slot of its own. The first draft of `retireTrail` removed the region and
left the slot empty, which passes every test you would think to write and
delivers none of the point: the user says `done` precisely because the overview
is crowded, and the crowding is *in the nest*. So a freed slot goes to the most
recently touched nested region — the same metric `#collapseCandidates` uses,
read the other way, so a region cannot be collapsed by one rule and promoted by
another — and a nest that empties gives its own slot back rather than sitting
there as a permanent tax on a crowding that has gone.

**Generalises:** a removal is not finished when the thing is gone. Anything that
was displaced to make room for it has to be given the chance to come back, or
the removal frees an accounting entry rather than the resource. Worth checking
wherever eviction and admission are separate code paths.

### It partly answers §10, from the other end

§10's open question is whether least-recent-touch is the right collapse metric,
and it was to be settled with dwell data. `done` does not settle it, but it
changes the population: finished trails leave the Field entirely instead of
being nested, so the metric no longer has to guess about the case it was worst
at. What remains open is genuinely narrower — what to do with trails nobody has
said anything about.

### A guard that could not be made to fail — **the run's second finding**

Written after the section above, because the mutation pass is what found it.

Seven mutations of the node-level logic were each caught by the test that should
have caught them. One was not: deleting `|| this.store.isArchived(trailId)` from
`finishTrail`'s guard changed no result. The reflex is to write a test that
reaches the branch. The right question turned out to be *why* nothing reached
it, and the answer was a bug.

`#activeTrailId` could name an archived trail by exactly one route: the context
sidebar and the bar's rows re-enter a page by calling `session.enter(nodeId)`,
and an archived trail's nodes are **still in the session's tree**. So picking a
page off a list put the user back on a finished trail — the rail showed it, the
marks synced to it, the next navigation extended it, and it stayed archived, so
none of that work would ever be offered back. Silent, and it loses exactly the
material the verb promised to keep.

The fix is that re-entry resumes the trail, which is also the undo the design had
been arguing it did not need. It is better than a verb would have been: it costs
no word out of `GRAMMAR.md` §4's table, and it is the gesture a user reaches for
anyway. With it in place the guard is genuinely unreachable, so it was deleted
rather than tested.

**Generalises, and it is the useful half:** *an unreachable guard is sometimes
evidence of a missing behaviour rather than of over-caution.* The branch was
written because the author could picture the state; the state was reachable when
they pictured it; something else was supposed to prevent it and did not. Before
deleting a defensive branch as dead — or writing a contrived test to keep it —
ask what would have had to be true for it to fire, and check that the thing
preventing it is a design decision rather than an accident. Both answers are
useful; only one of them is a deletion.

It also sharpens run 39's rule about mutation testing. A mutation that *survives*
is not merely a gap in coverage. It is a claim that a line does nothing, and that
claim is worth taking literally before it is worth patching over.

### Still open

- **A finished trail is not offered at the next start, and there is no surface
  that lists finished trails.** Getting back into one within the session is
  re-entry; across a restart it is finding a page by subject in the bar, which
  starts a fresh trail rather than rebuilding the old tree. That is arguably
  correct — returning to a subject weeks later *is* new work — and it is
  deliberately not decided here, because deciding it needs use rather than
  argument. What would change the answer is someone wanting the *tree* back
  rather than the pages.
- **The undo is only as good as the re-entry paths.** It hangs off `enter`, so
  any future way of reaching a node that does not go through `enter` would
  reintroduce exactly the bug above. Worth a check if a new re-entry surface is
  ever added.

## Run 42 — the schema audit, and a table with neither a reader nor a writer

### Every column in the schema, checked for a reader and a writer

Not a search — a mechanical pass, which run 41 put on the list after `archived_at`
turned out to be a column with a filter and no verb. The method: every column in
`001-initial.sql` and `002-merged-contexts.sql` against the product code, with
tests excluded, because a column whose only writer is a test is exactly the thing
being looked for.

Five hits, in descending order of how much they matter.

**1. `field_placement` has neither a reader nor a writer.** The whole table. The
store's `placeCard` is called by nothing but its own unit test; no SQL anywhere
reads the table back. This is the run's work and it is written up below.

**2. `query.source_node_id` is written and never read.** Recorded on every query
— "where it was issued from" — and nothing has ever asked. It is the provenance
edge between a page and the question that was typed *while looking at it*, which
is not the same edge as `trail_node_id` (the page the question opened). Worth
keeping, because the writer is free and the datum is unrecoverable after the
fact; worth noting, because "queries asked from this page" is a sidebar row
nobody has built.

**3. `visit.started_at` is written and never read.** Dwell is computed and stored
as `dwell_ms`, so the raw start time is only ever an input to a subtraction that
has already happened. Harmless, and it is the one hit here that is genuinely
just a record.

**4. `context.centroid` is defined and never touched — and was already known.**
`SCHEMA.md` says so in as many words and gives the reason: run 39 measured `mean`
against `centroid` for merge detection and `mean` won on stability. A false
positive for the audit, and a useful one — it is the control that shows the
method finds *undocumented* gaps rather than merely unusual-looking columns. The
two real hits above have no such note anywhere.

**5. The `embedding` table, likewise, is deliberately dead** — but only
`FOSEmbeddings` said so, in a module a schema reader has no reason to open:
nothing is persisted, because embedding a candidate on demand (1.27ms) is
cheaper than the read that would avoid it, and the table predates that
measurement. Unlike `centroid` this was *not* written down where the schema
could be read, so `SCHEMA.md` now marks it vestigial and says a later migration
will drop it if a heavier model ever makes persistence pay.

**The method is worth keeping.** Two runs, two real findings, and both were the
same shape: a schema that had been designed by someone who knew what the feature
was for, and product code that never caught up. The audit costs one `grep` per
column and it is now run to completion, so the next one only has to cover columns
added since.

### The Field's layout does not survive a restart, and the design says twice that it must

Not a research finding — a defect the audit turned up, and the reason it survived
this long is worth as much as the fix. Everything needed was present and nothing
was joined: the schema has `field_placement` with `moved_by_user_at` documented
as "the whole point of the table", the store has `placeCard` with a COALESCE that
protects a human timestamp from an automatic one, and `FieldModel` has a `pinned`
flag and an invariant built around it. Three parties each did their half.

What the design promises, in two places and in the strongest terms it uses
anywhere:

  > Not to make room, not to rebalance a region, **not on restart**, not when the
  > window resizes. A pinned card holds its position relative to its region for
  > as long as it exists. (`FIELD.md` §4)

  > 2. The system never moves a pinned card. Resize the window, **restart the**
  > browser, ... (`FIELD.md` §9, the acceptance properties)

And §9 is the list the module header says is testable without a build. The
restart half was never tested, because the model is in-memory and the test that
would have caught it would have had to reach through the store — which is exactly
the reach the `archived_at` test made, and the tell run 41 already named.

**What persists is only what a human chose.** Auto-placed cards are not written
and do not need to be: `#seed` is deterministic and its own comment says so —
"the same input always seeds the same layout, which is what lets a restored
session look like the one that was saved". A restored session re-seeds to the
identical arrangement for free. Persisting auto placements would write a row per
page for no recoverable information, and worse, would freeze an arrangement the
system is still allowed to revise. So `moved_by_user_at IS NOT NULL` is both the
filter and the meaning, which is what the schema comment said in the first place.

**Order of restoration follows from the invariant rather than from taste.** Pinned
positions are applied first, at their saved coordinates, and unpinned cards seed
around them afterwards. Seeding never displaces, so this cannot move a pinned
card; the reverse order could. The one case the literature does not answer —
searched, and spatial hypertext systems persist layouts without saying what
happens when the world changes underneath one (spatialBrowser writes a dotfile
per directory; VIKI and Aquanet do not address it) — is a pinned card whose saved
position is outside the region it comes back into, because region height is a
ratchet that grows during a drag and is not itself persisted. Growing the region
to fit is the answer consistent with §6's capacity ladder, which already ends in
growth; refusing and re-seeding would silently destroy a chosen position, which
§4 calls the thing never to do.

**Sources:** spatialBrowser (Toronto DGP) for per-directory layout persistence;
`dl.acm.org/doi/10.1145/1995966.1995983` for the spatial-hypertext survey that
frames arrangement as user-authored structure.

## Run 43 — the backlink whose other end is a question

### Bi-directional links: the memex's one idea the web threw away, and why a browser can have it back

- **Found:** looking for prior art on "questions asked from this page" before
  building a reader for `query.source_node_id`. Maggie Appleton, *A Short
  History of Bi-Directional Links*, https://maggieappleton.com/bidirectionals;
  Nelson on HTML being "precisely what we were trying to PREVENT — ever-breaking
  links, links going outward only"; Lanier on two-way links preserving context.
- **What it is:** the property that if A links to B, B knows about it. Bush's
  associative indexing, Xanadu's second pillar, and the single most celebrated
  feature of Roam and Obsidian, where it is called the linked reference.
- **Verdict:** **adopt**, in the one form a browser can actually deliver.
- **Phase:** built this run as the sidebar's "This page made you ask".

The history has a specific and useful failure in it. Bi-directional links did
not lose on merit; they lost on **moderation**. Appleton puts it plainly: if
every site that linked to yours appeared on your page and you had no say in who
could link to you, "it is not hard to imagine the Trollish implications". They
work today exactly where that risk is zero — a single author's own notes — and
the open-web version is still unsolved thirty years on, WebMentions being an
opt-in compromise rather than an answer.

**A browser's own record is that closed system.** The fork holds both ends of
the edge, nobody else can write to it, and it never leaves the machine. So the
condition that killed the idea on the web is absent here by construction, and
what is left is the useful half.

**The other end is not a document, which is why this is not just backlinks.**
Roam's linked reference answers "who else mentioned this note". A page's
outgoing links are the *author's* associations — they were there before you
arrived and they are the same for everyone. `source_node_id` records an
association that is yours and exists nowhere else: the question you typed while
reading that page. Nothing in a browser has ever kept it. Bush's "associative
indexing" is usually read as linking two documents; the record of *what a
document made you want to know* is closer to what a trail actually was, and it
is cheaper, because one end is already a row in the query table.

**It clears all four criteria.** Novel — no browser records which page a search
was issued from, and no notes tool has a question as a link endpoint. Useful —
it answers "why am I here again" on return to a hub page, and it names the task
it replaces: re-deriving, from a page you have read before, what you wanted from
it. Implementable — one JOIN on a column written since `001-initial.sql`.
Coherent — it is pillar C reading pillar B's edges, on the surface pillar C
already owns, and it strengthens the same claim `crossings` makes.

**Keyed by URL, not by node, and that follows from SearchBar.** The pane rated
3.5 in week one and 5.0 a week later: the value is at resumption. A question
asked during the visit you are in the middle of is one you still remember, so
node-keying would show only the worthless half. The valuable rows are months old
and sit on other nodes for the same document — which is the same reason
`crossings` is keyed by URL, and the two are now the two directions of one edge.

**Nothing is excluded for appearing elsewhere — and that was the run's one real
mistake, caught by running it.** The first build left out any question already
listed under "Questions asked" below, reasoning by analogy with the crossings
dropping the current trail. It was wrong, and the full suite said so: with a
context pinned the section was empty, because every question in the session
belonged to the active context. The ordinary case is worse than the test case —
one tab is one trail is one enquiry, so a user who never opens a second tab
would have seen this section literally never.

The analogy fails on what the excluded row *carries*. "This page is on the trail
you are looking at" is true of every page by construction and so carries nothing;
"this question came from this page" is a fact about the page that the enquiry's
own list does not state. The two sections index one set of facts twice, along
the enquiry and along the page — and indexing something twice is the whole point
of a backlink, not a redundancy to be optimised away. The instinct to dedupe a
surface is a good one and it was applied to the wrong axis.

Worth generalising: **an exclusion rule copied from a neighbouring section needs
its own argument.** The test that distinguishes them is whether the excluded row
could ever have been false. The crossings' could not; this one's could.

### A written-and-never-read column is a feature nobody has noticed yet

- **Found:** run 42's schema audit listed `query.source_node_id` as hit 2 and
  filed it as a note rather than as work. It was the run's work this time.
- **Verdict:** adopt as a reading of the audit, not as a new method.

Run 42 concluded that the audit's finding was "the gap is where two correct
halves were never joined". This run says something narrower and more useful
about the *shape* of the gap. `field_placement` was a **defect** — the design
promised the behaviour in two places and it was false. `source_node_id` is not
a defect: nothing ever promised it, everything about it is correct, and the
browser is not lying to anyone. It is a **feature the schema already paid for**.

The two want opposite handling. A defect is found by checking claims against
behaviour and is urgent. A feature latent in the schema is found by asking what
a column would be *for*, and its value is that the data is already accumulating
— `source_node_id` has been recorded on every query since the first migration,
so this run shipped a feature with months of backfill that could never have been
recovered had the column not been written. That is the argument for writing a
column before its reader exists, and it is the only such argument: an unread
column is worth its storage exactly when the datum is unrecoverable after the
fact.

The remaining hit, `visit.started_at`, fails that test — `dwell_ms` is derived
from it as it goes and nothing is lost — so it stays a record. `SCHEMA.md` now
says so, which is what stops the next audit re-finding it.

**Sources:** https://maggieappleton.com/bidirectionals;
https://en.wikipedia.org/wiki/Project_Xanadu;
SearchBar (Morris, Morris & Venolia, CHI 2008), already logged above.

## Run 44 — the record that could not be removed

### Local is half of a privacy claim, and Recall is where the other half was argued in public

- **Found:** looking for a lens the schema audit had not already spent. The
  question was not "what does a column do" but "what does the fork *claim*, and
  is the claim true at a surface the user can reach". `README.md` and
  `SCHEMA.md` both open with the same one: everything is local, no sync, no
  account, no upload. It is true. Then: what happens when the user wants it
  gone? `grep` for `DELETE` in `FOSContextStore.sys.mjs` returned nothing at
  all, and `nsIClearDataService` had never heard of the database.
- **What it is:** Microsoft Recall's defence was that snapshots never leave the
  device and Microsoft cannot read them, which was accurate and did not settle
  it. The criticism that stuck was that a local record is still a record: it sat
  behind a PIN, remote-access tooling reached it, and the sensitive-content
  filter provably missed card numbers and passwords in independent testing. What
  Microsoft shipped in answer was three verbs — stop recording, delete a range,
  delete everything for a site or app.
- **Verdict:** **adopt** the three verbs. **Reject** the fourth thing Recall
  reached for, a filter that decides on the user's behalf what is sensitive.
- **Phase:** the store's forget and the cleaner registration, built this run.

The three verbs are the useful finding and the reason this was cheap: Firefox
has shipped all three for twenty years. Clear Recent History is the range,
Forget About This Site is the site, private browsing is stop-recording. So the
work was never to design a forgetting surface — it was to be *reachable from the
ones that exist*. A fork that invents its own "clear my context engine" panel
would have built a second thing to remember to use, which is how a privacy
control ends up unused.

Rejecting the filter is the sharper half. Recall's filter is the feature that
was tested and found wanting, and the failure is structural rather than a bug to
be fixed in the next release: a classifier deciding what is too sensitive to
record is wrong in both directions at once, and the direction that matters is
silent. This fork records only URLs, titles, typed queries and timings, so there
is no equivalent of a screenshot of a password field — and the honest answer to
"do not record this" is the one Firefox already has, which is a window that does
not record.

**The four criteria do not apply, and saying why matters.** They are the bar for
adopting an *idea*, and this is not one; it is a defect, of the same kind run 42
found in `field_placement` and explicitly not the kind run 43 found in
`source_node_id`. The test that separates them is whether anything promised the
behaviour. Nothing promised `source_node_id` a reader, so it was a latent
feature and could wait. Two documents and a shipped menu item promised that
clearing history clears your history, and it did not, so this could not.

### A claim is only as true as the surface that acts on it

- **Found:** by the audit above, and stated here because it is the transferable
  part.
- **Verdict:** adopt as a lens, to be re-run whenever a doc makes a promise.

Run 42 checked the schema against the code. Run 43 checked a column against what
it was for. This run checked a *sentence* against a menu item, and that is a
different reach: the gap was not inside the component at all, it was between the
component and a part of Firefox the fork had never thought about. `grep DELETE`
over one file found it in a second.

The fork's own boundary is what hid it. `ARCHITECTURE.md` §7 lists every file
touched outside `browser/components/fos/` and treats the shortness of that list
as a virtue — which it is, for build times. But the same discipline means the
fork mostly asks "what does my component do" and rarely "what does Firefox
already do *to* my component's data", and every integration point Gecko exposes
is a claim the fork is silently making by not implementing it. Worth re-running
against the others: session restore, profile migration, `about:preferences`'
data panel, and the sanitize-on-shutdown path, none of which know the Context
Engine exists either.

### Deletion is a graph operation, and the memex's edges are what make it one

- **Found:** designing the delete, once it was clear one was needed.
- **Verdict:** adopt the four rules; recorded in `context-engine/SCHEMA.md`.

The naive delete — remove the rows matching a host — is wrong in this schema in
four separate places, and three of the four are consequences of the fork's own
inventions rather than of SQL. A trail is a tree, so a node has children that a
list would not have. A query knows the page it was typed from, which run 43 made
a visible backlink, so forgetting a page has a *second* edge to sever and the
sidebar would otherwise still address it. A context is derived, so its label can
name what was just forgotten while holding no evidence for it. And a merged
context keeps its own membership rows, so emptiness has to be judged over a
family rather than a row.

That is worth stating as a general property rather than four fixes: **the more
associative a store is, the more of it a delete has to reason about.** Bush's
associative indexing is the whole point of this project, and the cost lands
exactly here — a flat history has one row to remove and no question to answer.
It is also why "never prune a node a context still references" in `SCHEMA.md`
had to be explicitly overridden rather than quietly worked around: automatic
pruning and user-requested forgetting look like the same operation and want
opposite defaults.

**Rejected: automatic forgetting.** The managed-forgetting literature is real
and long-running — ForgetIT, and the current agent-memory work classifying
forgetting as time-based, frequency-based or importance-driven — and the case
for it is that unbounded memory adds noise and retrieval cost. It fails criterion
2 here and fails it badly. This browser's stated promise is not losing things,
and the pages worth keeping are the long tail by construction: an importance
score that evicts them is the bookmark graveyard arriving by a new route. The
useful distinction the same literature draws is between the *right to forget* and
the *right to delete*, and only the second is a feature. The first is a policy
about what a system may do on its own, and the answer here is nothing.

**Sources:** https://support.microsoft.com/en-us/windows/privacy-and-control-over-your-recall-experience-d404f672-7647-41e5-886c-a3c59680af15;
https://proton.me/business/blog/disable-windows-recall;
https://windows.gadgethacks.com/news/windows-recall-privacy-concerns-the-real-risk-is-local-access/;
*Memory in the Age of AI Agents*, https://arxiv.org/pdf/2512.13564;
*Digital Forgetting in Large Language Models: A Survey of Unlearning Methods*,
https://arxiv.org/pdf/2404.02062

## Run 45

### What happens to the tab you are looking at when you forget the site it is on

- **Found:** the question run 44 left open, answered from Gecko's own source
  rather than from first principles.
- **Verdict:** **adopt** Firefox's existing answer verbatim — the tab stays, the
  record goes.
- **Phase:** built this run.

`SessionStore.onPurgeDomainData` is the precedent and it is unambiguous:
purging a domain removes every *closed* tab and every tab of a *closed* window
whose history mentions it, and does not touch an open tab in an open window.
`onPurgeSessionHistory` behaves the same way at the whole-profile scale — it
wipes the session file, the closed-tab lists and the closed windows, and leaves
the documents that are on screen alone. So the browser this is a fork of already
has a settled position: **a delete of browsing data is not a close of the
things you are using.**

Worth recording that the answer came from `grep` rather than from a search
engine. The web results for "does Forget About This Site close open tabs" are
support-forum guesswork; the source is forty lines and definitive. For any
question of the form "what does Firefox already do here", the tree is the
primary source and reading it is faster than reading about it.

What the fork adds is the *unrecorded* state that Firefox has no need for,
because Firefox has nothing per-tab to un-wire: the browser loses its trail
node, so nothing further is written for a page still on screen, and the next
navigation starts recording again. That last part is deliberate and follows from
the same authority — Forget About This Site is not a blocklist, and a user who
wants a session that records nothing already has a private window. Building
forgetting into a per-site "never record this" toggle would be a fourth verb
nobody asked for, and would quietly become a second thing to remember to use.

### Undo versus confirmation for a delete, and why this delete gets neither

- **Found:** searching for whether forgetting should be reversible, before
  building the live half.
- **Verdict:** **reject** an undo window. **Adopt, later**, the
  explicit-consequence rung of the same ladder.

The UX literature is consistent and states the rule as a ladder of friction — no
confirmation, simple confirmation, explicit-consequence confirmation,
type-to-confirm — with the choice between *undo* and *confirm* turning on one
question: is the action actually reversible? Undo is right whenever it is,
because it keeps the common intended case fast and charges only the rare
accident; a confirmation dialog is for what cannot be taken back, and its power
is spent by frequency, so a browser that confirms everything has confirmed
nothing.

Forgetting is on the irreversible side by construction and deliberately so.
`SCHEMA.md` already rules out a tombstone table — a record of the thing the user
asked to have no record of — and an undo window is that same object with a timer
on it. So the existing upstream confirmation is the right rung and the fork
should add no friction of its own.

The nuance worth keeping is that **the blast radius of this delete is not
guessable, and in Firefox it is.** Forgetting one host in a flat history removes
the rows for that host. Forgetting one host here removes pages from the middle of
several trails, can strand questions asked from them, and can delete a whole
context whose label named an afternoon's work. The counts are already computed —
`ForgetSummary` reports them — so a dry run that reports what *would* go, shown
in the dialog that already exists, is a small piece of work that puts this on the
explicit-consequence rung where it belongs. Not novel as an interaction; useful
here specifically because the store is associative. Candidate task, not built.

**Sources:** `browser/components/sessionstore/SessionStore.sys.mjs`
(`onPurgeDomainData`, `onPurgeSessionHistory`);
https://www.nngroup.com/articles/confirmation-dialog/;
https://www.saasui.design/blog/saas-destructive-actions-confirmation-ux-patterns

---

## Run 46 — private browsing, and what a memory-only store has to get right

### The lens that found it

Run 44's question was "what does Firefox already do *to* this component's
data", and it found that `nsIClearDataService` had never heard of the database.
The same question asked one notch earlier — what does Firefox already *decide*
about a window before this component gets it — finds private browsing, and finds
something worse. The first defect was a record the user could not delete. This
one was a record that should never have been written: `browser-init.js` wires the
Context Engine into every window, and nothing anywhere in
`browser/components/fos/` had ever asked whether its window was private. The
only mention of private browsing in the whole component was in `FOSActions`,
suppressing *Places* keyword logging — the fork was careful about upstream's
recording and not its own.

Worth keeping as a method note: both defects were invisible from inside the
component, where every test passed throughout, and both were found by asking
about the boundary rather than about the feature.

### Record nothing, or record to memory?

- **Found:** deciding what a private window should do, before building anything.
- **Verdict:** **adopt** record-to-memory. **Reject** recording nothing.

The tree settles it faster than the literature does. Firefox in a private window
keeps full session history, working downloads, a working address bar with
history suggestions — it declines to *persist*, never to *have*. Private
downloads are the closest analogue in JS: a separate in-memory `DownloadList`,
dropped at `last-pb-context-exited` via `nsIPBMCleanupCollector.addPendingCleanup`
so the teardown is awaited rather than merely started. Cookies do the same thing
in C++ with a separate in-memory storage.

Recording nothing would have been much less code and is the wrong answer for a
browser whose *entire interface* is the record: a private window with an empty
rail, a Field with no cards and a sidebar that cannot answer `what` is not a
private browser, it is a broken one — and the user would open a normal window to
get their work done, which is precisely the behaviour the mode exists to
prevent. The argument that a private session should not accumulate a context it
could then export as a pack is real but points the other way: the user is in
control of that export, exactly as they are in control of saving a file from a
private window.

**Sources:** `toolkit/components/downloads/DownloadIntegration.sys.mjs`
(`last-pb-context-exited`); `browser/components/sessionstore/SessionStore.sys.mjs`.

### What the forensics literature actually says to build

- **Found:** searching the private-browsing threat model before choosing where
  the private store lives.
- **Verdict:** **adopt** memory-only; **reject** a temp file deleted at exit.

The threat model is a local attacker who gets the machine *after* the session,
which makes every artifact on the disk the whole game. The recurring findings
across a decade of forensic papers are not rows a browser meant to keep: they
are a bookmark row with an empty title that reveals a private session happened,
a `visit_count` of 0, and — the one that decides this design — **journal files
left behind when the browser did not exit cleanly**. A private store written to
a temp file and deleted at the end is defeated by a crash; a memory database
cannot be, because there is no file to recover a free list from.

Gecko's own answer where it *must* touch the disk in private mode is instructive
and consistent: IndexedDB in a private window is encrypted with a key held only
in memory. Make the artifact useless, or do not make one.

That is also why the test searches the profile database's bytes for the private
URL rather than querying it. SQL can only see rows that exist; a `SELECT`
returning nothing is satisfied by a delete, and a delete is not what is being
claimed.

**Sources:** https://www.usenix.org/legacy/event/sec10/tech/full_papers/Aggarwal.pdf;
https://www.dcs.warwick.ac.uk/~fenghao/files/DPM13.pdf;
https://arxiv.org/pdf/1802.10523;
https://dfrws.org/wp-content/uploads/2024/07/Decrypting-IndexedDB-in-private-mode-o_2024_Forensic-Science-International-.pdf

### Two things a memory store gets wrong by default

Both were found by execution rather than by reading, and both would have shipped
looking correct.

- **`Sqlite.sys.mjs` cannot wrap a memory connection**, because
  `wrapStorageConnection` reads a name off `connection.databaseFile`, which is
  null for one. Two lines fix it upstream — a `?.` and a fallback name — and
  every other option was worse: a hand-written adapter over
  `mozIStorageAsyncConnection` would be a second implementation of the store's
  connection semantics, which is exactly the drift the memory store is designed
  to avoid.
- **Closing the wrapper does not close the database.** `Sqlite.sys.mjs`
  deliberately treats a wrapped connection as somebody else's to shut down, and
  drops its shutdown blocker instead of closing it. A store that closed only its
  own handle would leave a private session's pages in the process for as long as
  the browser ran: deleted from the browser's point of view, present in a memory
  dump. The mutation that removed the second close survived the first test pass,
  which is what surfaced it.

### `last-pb-context-exited` is a trigger, not an event

- **Found:** while the browser test failed with "Connection is not open."
- **Verdict:** **adopt** a guard; never drop while a private window is open.

The topic fires after the last private window has gone, and if the user has
opened a new private window by then — closing one and starting another is
ordinary — the notification lands on a live session. Observed directly: the
test's second private window was on screen when the topic fired for the first,
and the store was dropped out from under it. Every consumer in the tree whose
private state is per-item (a download, a login) is indifferent to this; a
per-session store is not.

The general shape is worth remembering: **a notification named for an ending is
not proof that the thing has ended.** Check the condition, do not trust the
topic. The test waits on the store being gone rather than on the topic firing,
for the same reason.

### Sanitize-on-shutdown: already correct, now observed

- **Found:** it was the nastiest of the four unchecked integration points named
  in run 44.
- **Verdict:** no work needed, and a test anyway.

`Sanitizer.onStartup` registers `sanitizeOnShutdown` as a blocker on Places'
clients-shutdown client, which blocks `profile-change-teardown`; the history
item calls `deleteData` with `CLEAR_HISTORY`; the Context Engine's cleaner is
registered under that flag. The ordering also holds: the clear runs at
`profile-change-teardown`, and `Sqlite.sys.mjs` closes connections at
`profile-before-change`, which is later, so the delete cannot race the database
closing. `browser_zzzshutdown.js` runs it rather than trusting the paragraph.

## Run 47 — the repair action that destroys the record

### Where the lens pointed this time

Runs 44 and 46 both asked "what does Firefox already do *to* this component's
data", and both found a defect. The standing list said to finish the question
against the three integration points still unchecked: session restore, profile
migration, and `about:preferences`' data panel. Two of the three needed no
code. The third was the worst one found so far.

- **Found:** `FirefoxProfileMigrator` is what "Refresh" runs, and it copies an
  explicit list of files.
- **Verdict:** **defect**, fixed. The Context Engine's database was not on it.

The list is `places.sqlite`, `favicons.sqlite`, cookies, passwords, form data,
the personal dictionary, bookmark backups, the session, sync state, times and
telemetry. Everything else is dropped *on purpose* — the point of a refresh is
to lose whatever configuration might be causing the trouble. So a refresh
returned a browser with its history and bookmarks intact and its rail, Field and
sidebar empty, having discarded every query typed, every trail walked, every
dwell time and every named context, silently.

What makes this worse than run 44's defect rather than merely equal to it: a
refresh is what a user does when the browser is *already* misbehaving. The
action taken to repair the browser is the action that destroys the thing the
browser exists to keep. And unlike a clear, nobody who runs a refresh has asked
to lose anything — Mozilla's own support page describes it as restoring
defaults "while saving your essential information".

### Is this store "essential information" or configuration?

- **Found:** the migrator's list is not arbitrary; it has a shape.
- **Verdict:** **adopt** `types.HISTORY`, beside `places.sqlite`.

Everything on the list is irreplaceable user content or identity. Everything
off it is derived, cached, or a setting: `permissions.sqlite`,
`content-prefs.sqlite`, `protections.sqlite`, extensions, themes, toolbars. The
test is not "is it important" but "can it be reconstructed" — and Places can be
rebuilt by browsing, while a question you typed and the name you gave an
afternoon's work cannot be reconstructed from anything.

The rollback journal goes too. `places` copies its `-wal` for the same reason
and the reason is not tidiness: a source profile that crashed has a hot journal,
a journal is matched to its database by *filename*, and a database copied
without it is a recoverable crash turned into an unreadable file.

### The change that the change forced

- **Found:** carrying a file forward through the repair action is only safe if
  the browser can recover from that file being bad.
- **Verdict:** **adopt** move-aside-and-replace. Otherwise refresh, the repair
  action, stops repairing — it would now faithfully copy the corruption.

`FOSContextStore.open` had no recovery at all, and the tree has two precedents
that disagree with each other in an instructive way.
`PlacesSemanticHistoryDatabase` **deletes** its corrupt files;`FormHistory`
**keeps** its own under `.corrupt`. Neither is wrong — the difference is
whether the data exists anywhere else. A semantic index can be recomputed from
Places. What you typed into a form cannot. This store is further into the
second class than either, so the file is kept.

**And the keeping immediately collided with run 44.** A `.corrupt` file is a
record of browsing that the user cannot see, did not ask for, and that "clear
everything" does not reach — which is, exactly and unarguably, the defect
`FOSForget` was written to remove. Two ways out: delete the file (lose the only
copy) or make the sweep reach it. The second, and only from `deleteAll`: a
moved-aside database cannot be queried, so a clear of one host or one range has
no way to know whether it holds anything relevant, and guessing would throw away
far more than was asked for.

Worth keeping as a general property: **this fork's earlier decisions now
constrain its later ones in a way a flat history's would not.** "Everything here
can be deleted" was a promise made in run 44 about rows in a database; it turned
out to be a promise about files in a directory too.

### The two that needed no code, and why the tree said so faster than the web

- **Found:** session restore and the preferences data panel.
- **Verdict:** no work needed, both.

Session restore was settled in run 45 — `onPurgeDomainData` and
`onPurgeSessionHistory` remove closed tabs and leave open ones alone, and
`SCHEMA.md` §Forgetting already adopts that rule verbatim. The data panel offers
two things for this data: Clear Data, which is `CLEAR_HISTORY` and therefore the
cleaner registered in run 44; and "Never remember history", which sets
`browser.privatebrowsing.autostart` and so makes every window private under run
46's rule. Its third control, Manage Data, is site data in the quota sense —
cookies and cache per origin — and this store is neither.

Permanent private browsing got a test rather than a paragraph, and the test
found the one thing reading would have got wrong: **there is no last private
window**, so `last-pb-context-exited` never fires and the memory store lives
until the process does. Nothing reaches a file either way, but §Private
browsing described a per-session lifetime that does not exist in this mode.

### Method notes

**A mutation caught a test that was passing for the wrong reason.** The guard
that decides what counts as corruption was tested with a *directory* in the
database's place — and a directory makes `open` throw whichever way the guard is
written, because moving it aside fails too. Making `isUnopenable` always return
true survived. The replacement fixture is a healthy database that a migration
cannot be applied to, where recovery *would* succeed if it were attempted, so
the assertion can only hold if the guard is what stopped it. Generalise: **a
negative test needs a fixture on which the wrong behaviour would visibly
succeed**, or it is testing the failure of something else.

**And a mutation refused a claim the test's own comment made.** A second fixture
— a real database with its data pages scribbled over — was written believing it
exercised the recovery wrapped around the *migration*. Moving the migration
outside the recovered region left it passing: `openConnection` rejects that file
before any migration statement runs. The guard stays, because `FormHistory` and
`PlacesSemanticHistoryDatabase` both wrap their schema step separately, and
"no fixture found" is not "shown unreachable" — but it is recorded as
unexercised rather than counted as covered.

**Running it beat reading it, twice more.** `Sqlite.openConnection` attempts
hot-journal recovery and *deletes* the journal before reporting a file
unreadable, so the journal-preservation half of `moveAside` almost never fires —
discovered by asserting it and watching the assertion fail.  And
`IOUtils.createUniqueFile` uniquifies by inserting before the last extension
(`x.sqlite.corrupt` → `x.sqlite-1.corrupt`), which the shipped sweep survives
because it matches on prefix and suffix — while the *test helper*, which
reconstructed the name, silently missed every second recovery. The production
predicate was right for a reason the test then demonstrated by getting it wrong.
