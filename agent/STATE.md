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

Run 57 built task 2, which run 56 found and deliberately did not fix: **`enter`
resolves when its page lands, not when it is asked for.**

The verb returned once it had *asked* for a node. The word read as "was entered"
and meant "was requested", and the gap between the two was a race every caller
had to know about and handle for itself — a navigation started on top of a
traversal that has not committed arrives first and is then overwritten by the
restore landing behind it, putting the window back on the page it was told to
leave. Six tests hit it in a single run and every one reported as a timeout
somewhere else in the file.

**The landing is the commit, not the load.** `onSettled` already means "finished
loading" and this is narrower on purpose: a traversal stops being pending the
moment the location changes, and waiting for the stop event too would make every
`back` cost a whole page load before the next thing could run, preventing no
defect. Checked against prior art rather than shipped on reasoning alone —
Playwright's `waitUntil` has exactly this rung and calls it `commit`, documented
as "response headers parsed and session history updated", and it is the rung
recommended where a load event is never coming. `IDEAS.md` (run 57) has why it
is not made a parameter the way Playwright's is: this fork knows all six of its
callers and none of them wants the assets.

**Keyed on the browser and not on the restored URL.** A URL match is more precise
and hangs on a redirect — a server-side 3xx commits only the destination, so a
re-entry to a redirecting page would never see its own URL and would always pay
the bound. The first top-level location change on the browser we asked ends the
flight whatever it says.

**The wait is bounded** (`LANDING_MS`, six seconds), so a page that never arrives
cannot leave the verb pending — the failure that would have been worse than the
race it replaced. A re-entry superseded by another, a closed tab and a detached
session all settle rather than hang. The bound never changes the answer: `enter`
reports whether the node was *entered*, and a node whose page is slow was still
entered. A `back` that reported failure while the page it asked for was visibly
loading would be lying about the one thing the user can see.

Green: **1365 FOS browser-chrome checks across 30 files, 0 failures** — the new
file `browser_zzlanding.js` contributes 13. Node: 345. xpcshell: 2. **Four
mutations, four caught.** Lint clean on every changed file.

`main` is at `phase-3`. `agent/dev` has this run's commits.

## Next task

1. **The chain is the one caller the landing did not fix, because `runAll` never
   awaits.** Found this run by reading the claim at `FOSActions.sys.mjs` §`runAll`
   — *"`enter cap branch` branches from the card `enter` just made active"* — and
   checking it. It is false, and was false before this run's change too.
   `FOSActionDispatcher.runAll` is synchronous and drops each handler's result on
   the floor, so `branch` runs while `enter` is still suspended on its first
   `await` and `#requireCurrent()` returns **the node being left**. The chain
   records a branch under the wrong parent. Nothing in the suite covers
   `enter <mark> branch` as one line, which is why fifty-seven runs did not see
   it. Note `up` has the same shape and is fine — it reads the current node
   *before* calling `enter`.

   Sized, so next run can go straight at it: making `run`/`runAll` async touches
   45 call sites in the tests, of which only 3 read the return value, plus
   `FOSVoiceInput`'s `this.#bar.run(effect.run)`. **Rejected the narrow fix** of
   moving `#setCurrent` above the departure `await` inside `enter`: it also moves
   `#arrived`, and therefore the back-stack cursor that run 56 spent a whole run
   getting right. Do it as the contract change, with a test for the chain first.

2. **Watch whether twenty-six links is actually the bound in use.** Unchanged
   from runs 55 and 56. Shipped answer is document order, truncate, say the
   count. `IDEAS.md` (run 55) has the two candidates — two-word marks, and
   narrowing by typed text — and deliberately does not choose. The second is
   cheaper and composes with `cmd_find`, the cheapest entry left on the §5.1.1
   debt list for the same reason: it takes terminal free text exactly like
   `search` and `name`. Decide from use rather than from the document.

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

- **A verb that resolves on the network needs a bound before it needs anything
  else.** The whole design of the landing is downstream of one question — what
  happens when the page never comes — and the answer had to be decided before
  the mechanism, because it is what says the bound must not change the return
  value. Generalises: **when a synchronous contract is made asynchronous, name
  the failure mode you are creating before you name the one you are removing.**

- **`build faster` fails in a fresh shell** with `ERROR: Cannot find ccache`. The
  mozconfig points `--with-ccache` at `$MOZBUILD_STATE_PATH/sccache/sccache` and
  nothing exports `MOZBUILD_STATE_PATH` for `mach`, so it expands to
  `/sccache/sccache`. `source agent/env.sh` first, every time — the shell does
  not persist between commands. Costs one failed build per run until either the
  mozconfig defaults the path or `env.sh` is sourced from the mozconfig itself;
  the second is probably right and is a five-line change.

- **The `about:newtab` content-process crashes are the container, not the fork.**
  Three `exited on signal 11` per file, alongside
  `Sandbox: CanCreateUserNamespace() unshare(CLONE_NEWPID): EPERM`. Checked
  rather than assumed: `browser_zzbackstack.js`, untouched this run, produces
  exactly the same three and passes 34/34. Worth knowing before spending a run
  chasing it — but also worth *not* filing as harmless forever, since a real
  crash would look identical.

- **`key_gotoHistory` is still worth one probe.** Carried from runs 54–56,
  untouched. Upstream dispatches it by id from the `mainKeyset` listener, and
  this fork gave the same element a `command="FOS:TrailRail"`. Both paths still
  exist. If the id-keyed listener still sees the event, accel+H opens the trail
  rail *and* the history sidebar. `browser_fosrestore.js` covers the pref-off
  direction; the pref-on one is not obviously covered.

## Background jobs

**Check `./agent/bg-status.sh` first thing.** `fossuite57` finished green — 1365
browser-chrome checks across 30 files, 0 failures, plus the two xpcshell files —
and `fossuite57b` is the second consecutive confirming run of the same suite.
Node (345) and the four mutation runs were foreground and are done. Everything
earlier in the log directory is superseded.
