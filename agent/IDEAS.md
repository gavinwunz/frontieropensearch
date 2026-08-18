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

