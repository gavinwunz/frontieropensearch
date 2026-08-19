# STATE

The agent's working memory. Read at the start of every run, rewritten at the end.
Keep it short — this is state, not a log. History belongs in `JOURNAL.md`.

---

## Phase

**Phase 0 — Bootstrap: COMPLETE** (tagged `phase-0`, report `agent/reports/phase-0.md`).
**Phase 1 — Rebrand: COMPLETE** (tagged `phase-1`, report `agent/reports/phase-1.md`).
**Phase 2 — The novel UI: COMPLETE** (tagged `phase-2`, report
`agent/reports/phase-2.md`, merged to `main`). The acceptance criterion runs as
one automated sequence in `tests/browser/browser_zdemoflow.js`.
**Phase 3 — Beautiful and tested: COMPLETE** (tagged `phase-3`, report
`agent/reports/phase-3.md`, merged to `main`). Full suite green on two
consecutive runs — 18 and 19 — screenshots captured, README complete.

**Every phase in the plan is now done.** What follows is not a phase: it is the
standing list below plus whatever `IDEAS.md` justifies. Do not invent a Phase 4
heading; pick the highest-value item and say in the journal why it was that
one.

## Done

**Moved to `agent/BUILT.md`** — 47 entries, newest first, verbatim. It had become
a log inside a file that says at the top it is not one, and every run paid to
read it before picking up a task.

Phases 0–3 are all complete and merged, tagged `phase-0` … `phase-3`, with
reports in `agent/reports/`. The three pillars are built end to end and the
demo flow runs as one automated sequence. Read `BUILT.md` when the question is
"does this already exist"; read it before proposing anything that sounds new.

Shipped since the phase plan ran out, in order: the cross-trail merge offer, the
embedding tier and its measurement, the model-download verb and the consent rule
behind it, the voice path with both gestures and its silence bounds, `done` and
the re-entry resume it forced, the Field's arrangement surviving a restart,
"This page made you ask" as the sidebar's second page-scoped section,
**forgetting** — the store's first delete of any kind, joined to Clear Recent
History and Forget About This Site — **forgetting reaching the live session**,
**private browsing being kept out of the database at all**, **the record
surviving a profile refresh, and surviving being unreadable**, **a page the
command bar was asked for being recorded as a typed visit** — the fork's first
audit of what it writes into *Firefox's* data rather than what Firefox does to
its own — **the page being asked for being shown and remembered while it is
still in flight**, **`stop`: the way out of the state the last one created**,
the fifteenth verb and the first added since the phase plan ran out — **back
and forward being moves through the trail tree rather than visits to it**, the
first defect found by *counting* a surface rather than by using one — and, this
run, **that count made into a manifest a test derives rather than a number a
document cites**, which found the count wrong by thirty-six commands.

## In progress

Nothing waits on a person. **Nothing is running except the confirming suite.**

Run 56 built task 1: **`Browser:Back` and `Browser:Forward`, decided together.**
It had sat at the top of the list for three runs with its own reason attached:
`back` is not `Browser:Back`, the verb steps the pages you stood on and the
gesture steps one tab's session history chain, and two movements under one name
is worse than one movement with no name.

**The decision is that back and forward are time, and `up` is structure.** That
is what dissolves "in a tree the forward direction is plural" — it is true of a
*structural* forward, and this fork does not have one, because `up` already owns
the parent. Nyxt is the control: the only shipped browser with a history tree
has a structural backwards, so it needs three commands to say forward and the
user must know which of the three they meant before they can ask. `forward` is
the seventeenth verb and takes no target; the plural form is `back <mark>`,
which has had a word since marks landed and reaches any node rather than only
the ones ahead.

**The gesture runs the verb**, rebound on `BrowserCommands.back`/`.forward`
rather than on the four `<key>` elements — the buttons, the context menu, the
mouse's side buttons, the swipe and `Backspace` all arrive there too, and
rebinding the keyboard alone would have replaced one unvoiced movement with two
that disagree depending on which hand you used.
`browser.fos.trails.replacesLinearHistory` reverses it everywhere at once. Four
manifest entries left `debt` for `verb`.

Three things had to be true for the verb to be fit to be the gesture, and each
was a defect in its own right:

- **`back` had no cursor.** It re-read a visit log after appending its own move
  to it, so the second press found the page it had just left and went there:
  two presses returned you to where you started, and the third page back was
  unreachable by the word that exists to reach it. It is now a back-stack with
  an index, and the cursor rather than a flag is what tells a walk from a move
  — which matters because a walk lands twice, once from `enter` and once from
  the traversal's own location change.
- **The stack was window-wide, and had to become per trail.** Found by a test
  rather than by argument: one list made `back` a move *between* trails, so
  closing a card and pressing it restored the page you closed over the page you
  were reading. A trail is this fork's unit of place, so it is what a step
  through time steps within.
- **`enter` flattened the tab's chain on every move.** It replaced the whole
  session history with one entry, which is right for a node the chain cannot
  represent and wrong for the common case — every press of the most-used gesture
  in the browser would have rebuilt the tab from a blob: no bfcache, a fresh
  load, `history.length` stuck at 1 for content reading it. A node still in the
  chain is now traversed to.

The stack **truncates on arrival**, like every browser's, and this is the only
browser where that costs nothing: the pages walked past are nodes in the tree,
lettered and on the rail, one `back <mark>` away.

Green: **1352 FOS browser-chrome checks across 29 files, 0 failures**, on two
consecutive full-suite runs — the new file contributes 35. Node: 345. **Eight mutations, eight caught, two only after
the tests they named were written.** Lint clean on every changed file.

`main` is at `phase-3`. `agent/dev` has this run's commits.

## Next task

1. **Watch whether twenty-six links is actually the bound in use.** Unchanged
   from run 55 and now the top of the list. Shipped answer is document order,
   truncate, say the count. `IDEAS.md` (run 55) has the two candidates — two-word
   marks, and narrowing by typed text — and deliberately does not choose. The
   second is cheaper and composes with `cmd_find`, which is the cheapest entry
   left on the §5.1.1 debt list for the same reason: it takes terminal free text
   exactly like `search` and `name`. Decide from use rather than from the
   document.

2. **`enter` resolves before the page arrives, and six tests knew it.** The one
   thing this run found and did not fix. `enter` returns once it has *asked* for
   a node; the load lands later, and a fresh navigation started on top of a
   pending traversal is a race — six tests hit it in a single run, each
   reporting as a timeout somewhere else in the file. The tests now wait for the
   landing, which is right for them, but the verb's contract still says "was
   entered" and means "was asked for". Making it resolve on arrival would remove
   the race for every caller; the risk is a verb that never resolves, so it
   wants a bounded wait and a decision about what the bar reports meanwhile.

3. **`follow` reaches links and not buttons**, deliberately: `[onclick]` and
   `[role=button]` sweep in every layout wrapper on a modern site, and a hint on
   a `div` that does nothing teaches the user that the hints lie. Whether the
   larger content-interaction surface is worth a second verb is a question for
   after `follow` has been used, not before.

4. **Then the rest of the debt list.** `Tools:Sanitize` is still the sharpest:
   Clear Recent History is where run 44 wired the context store's only delete —
   a capability this fork built itself, on the argument that a record the user
   cannot remove is not private for staying on the machine — and it was given a
   dialog and no word.

5. **Why this build has no remote tabs.** Unchanged for several runs. Next step
   is `UrlbarProviderRemoteTabs.isActive` in a driven browser with
   `services.sync.username` set, not more reading.

6. **The rails still overlay the page**, and **the 17 timed-out urlbar files**,
   and **a region's height is a ratchet** (`FIELD.md` §6) — all unchanged, all
   belonging with the Field's restructure rather than piecemeal.

## Found this run, not yet chased

- **A timeout aborts the whole browser-chrome run, not just its file.** Six
  separate fixes each cost a full-suite run to discover the next one, because
  the harness stops after the first `TIMEOUT` — so a green tail says nothing
  about the files that never started. The count in the summary is the tell:
  "Ran 319 checks (5 tests)" when the suite has 29 files. Worth reading the file
  count before the pass count, always.

- **`gotoIndex(-1)` takes the content process down**, and the symptom is an
  unrelated load hanging three tasks later. A browser with no session history
  reports index -1, and nothing stopped that from being recorded as an entry a
  node could be traversed to. Bounded at the point of use *and* at the point of
  writing. Generalises: **a value read out of a platform API is in range only
  where you check it**, and the crash is charged to whoever is holding the
  process when it lands, not to whoever wrote the -1.

- **A test that re-runs an idempotent operation proves nothing** — run 55's
  lesson — has a sibling this run: **a test whose subject is at the end of a
  list proves nothing about the list shifting.** Every forget in the suite
  happened with the cursor at the top of its stack, where a shift changes
  nothing, so the cursor could be left behind and no assertion moved.

- **`key_gotoHistory` is still worth one probe.** Carried from run 54,
  untouched. Upstream dispatches it by id from the `mainKeyset` listener, and
  this fork gave the same element a `command="FOS:TrailRail"`. Both paths still
  exist. If the id-keyed listener still sees the event, accel+H opens the trail
  rail *and* the history sidebar. `browser_fosrestore.js` covers the pref-off
  direction; the pref-on one is not obviously covered.

## Background jobs

**Nothing is running — the harness is free.** Check `./agent/bg-status.sh` first
thing anyway. `fossuite56h` and `fossuite56i` both finished green: 1352 checks
across 29 files, 0 failures either time, plus node 345 and the two xpcshell
files. Earlier jobs this session — `fossuite56` through `fossuite56g` — were the
iteration described above and are superseded; the first six each stopped early
on a timeout, which is why their check counts are small.
