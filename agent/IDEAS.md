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
