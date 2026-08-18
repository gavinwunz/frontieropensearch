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
