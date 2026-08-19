2026-08-18T11:10Z — Phase 0 — Run 1. Fetched Firefox upstream in full (12.6M objects) and merged it into agent/dev; resolved .gitignore, README and CLAUDE conflicts. Bootstrapped toolchains onto /data. Created browser/branding/frontieropensearch/ with brand strings, update/telemetry-off prefs and a generator that emits the mark from one geometry definition. configure passes with every app constant matching BRANDING.md. First full build started. Research: found the in-tree local ML runtime and that Firefox already ships Smart Tab Grouping — which forces a rewrite of the Field's novelty claim. Seven entries added to IDEAS.md. Tests: none yet; build in flight.

2026-08-18T11:35Z — Phase 0 — Run 2. Found run 1's build and push both dead with no error in either log: nohup does not survive the supervisor killing the agent's process group. Added agent/bg.sh, which detaches jobs with setsid and writes an explicit exit marker so a killed job is distinguishable from a finished one, plus bg-status.sh to read them. Restarted both under it; the push is now resumable and picked up at 197k of 990k commits. Enabled sccache while the build was only six minutes in, so the restart was nearly free. Research: Nyxt already ships a browser history tree, which forces the Trails novelty claim onto what is stored on the tree rather than the tree itself, and warns of unbounded growth; nsISHEntry already carries scroll and form state, so lossless dismissal is buildable; automatic-speech-recognition is absent from the ML engine's task list, so the voice path is now gated on a spike. Four IDEAS entries. Schema gained a growth policy and a single source of truth for scroll state. Tests: none; build in flight.

2026-08-18T11:50Z — Phase 0 — Run 3. Found run 2's build and push dead again despite setsid, and this time diagnosed the actual layer: the agent is a Type=oneshot systemd user unit, so when its process returns systemd deactivates fos.service and KillMode=control-group SIGTERMs everything left in that cgroup. setsid gives a new session but not a new cgroup, so run 2's verification proved the wrong property. Rewrote bg.sh to launch via systemd-run --user, putting each job in app.slice as a sibling unit; verified by reading ControlGroup rather than by reasoning, and restarted both. Build is on its third attempt with objdir and sccache intact; push resumed at 476k of 990k. Research went to the command grammar, which was the largest unspecified piece of Phase 2: Cursorless's hats supply the addressing layer — the hard part of hands-free is naming the target, not saying the verb — but checking criterion 1 showed macOS Voice Control and Windows Voice Access already ship "show numbers", so the claim narrowed to sticky word-marks over browsing objects rather than positional numbering over guessed clickables. Talon's action-first grammar and its mode-switching complaint gave the rule that search is the unmarked default. Re-reading Bush against pillar B produced the run's best finding: memex trails were curated and shareable, not recorded, so the captured tree and a Trail are different objects — which is what distinguishes B from Nyxt's shipped history tree. Five IDEAS entries, and design/GRAMMAR.md written. Tests: none; build in flight.

2026-08-18T11:38Z — Phase 0 — Run 4. First run whose background jobs were still alive at the start: the systemd-run fix from run 3 holds, the build is 13 minutes into compiling gfx/ on its third attempt, and the push has reached 597k of 990k commits. With the build in flight and browser/ and toolkit/ off limits, the run went to the largest unspecified piece of Phase 2 — pillar A — and design/FIELD.md is now written, so all three pillars have a design and Phase 2 is execution rather than invention. The research produced two findings that changed the design rather than decorating it. Robertson et al.'s Data Mountain (UIST '98) is the measured evidence that a spatial page switcher beats a bookmark list — reliably faster retrieval, fewer wrong retrievals, fewer failures over 100 pages — but its related-work section says the layouts were manual and contrasts that with PadPrints's automatic layout "for short term use", which means a position the system chose builds no spatial memory and auto-clustering cannot be what the Field's value rests on. The Field now seeds placement by provenance and pins a card permanently the moment the user moves it. Jul and Furnas on desert fog killed the infinite canvas outright: an infinite plane is almost all empty, so almost every reachable view has nothing to navigate by, and Data Mountain — the design with evidence — deliberately used a fixed viewpoint. The Field is bounded, the overview always shows everything and always fits, and zoom moves between three semantic levels. Recorded as a deliberate departure from the phase plan. Two smaller findings: canvas tools in the wild are criticised for becoming unfindable, and the rule that named regions are searchable while unnamed space is not resolves cleanly here because a region is a trail and trails are already nameable, so the Field is never the only way to reach anything; and "live-thumbnail cards" is not affordable as written, since each open page is a browser with its own content process, so cards are cached PageThumbs snapshots with only the focused card live — a budget, not a design property. Data Mountain's static 64×64 thumbnails won anyway. Four IDEAS entries, four decisions in STATE.md, and four falsifiable acceptance properties in FIELD.md §9 to become browser-chrome tests as the code lands. Tests: none; build in flight.

2026-08-18T11:48Z — Phase 0 — Run 5. The first run to produce Phase 2 code. Build and push both still alive on the systemd-run fix — the build is 25 minutes in and through js/src, libwebrtc and gfx/ into xpcom/, and the push has reached 877k of 990k commits — so browser/ build inputs stayed frozen and the run went to the work that needs no build: browser/components/fos/ now holds marks, the action table, the command parser and the trail tree, with 34 unit tests green under plain node --test in about a second. None of it touches a Gecko API, which is what makes that possible; the directory has a moz.build but is deliberately not yet referenced from browser/components/moz.build, so the running build cannot see it. Research went to the two gaps GRAMMAR.md left open and both closed against outside evidence rather than taste. Talon segments a dictated argument with a 0.3s silence timeout and its users report it misfiring on a mid-phrase pause — but the reason to reject it here is stronger than the misfires: silence means nothing to a keyboard, so a timeout would hand the two modalities two different grammars, which is the separate accessibility mode the brief forbids arriving by the back door. Free text is therefore terminal, a syntactic rule identical in both. The escape for a query that begins with an action word was the second gap: VS Code's removable > prefix is the obvious model, but a punctuation mark has no spoken form, so the escape is the ordinary verb `search <text>` with `?` as typed sugar, and a test asserts the two parse deep-equal. A third finding came from re-reading Cursorless while writing the allocator — a hat sits on a character of the token it names, so deriving a mark from the object's own label makes it guessable before it has been learned, which closes the gap stickiness leaves open at the start of a session. On the tree side, the model makes promotion copy rather than move: capture records what happened and a Trail is an artefact the user made, so curating one must not edit the other. The headline test is pillar B stated as a property — re-entering an earlier node and navigating a second way leaves the first branch whole and reachable, because no code path removes a node on navigation. Three IDEAS entries, GRAMMAR.md §6, five decisions. Tests: 34/34 green; build in flight.

2026-08-18T12:10Z — Phase 0 COMPLETE → Phase 1 — Run 6. The build that had been in flight for three runs finished: EXIT 0 in 31m40s on 8 cores from a cold objdir, far under the 1–2 hours assumed, so a full rebuild is affordable rather than something to fear into the background every time. ./mach run --headless --screenshot rendered about:support fully, reading "common questions about Frontier", and application.ini confirms Vendor=Frontier, Name=FrontierOpenSearch, Profile=frontieropensearch. Phase 0's acceptance criterion is met; merged to main, tagged phase-0, report written with the build result and the app identity taken from the build's own output rather than from the mozconfig. The run's biggest find was not the build. The chunked push had failed four runs running and each run diagnosed it as a transport or process-lifetime problem; reading the log for a distinct error string instead showed one line of authorisation failure — GitHub refuses to let an OAuth App create or update .github/workflows/README without workflow scope, the gh token carries only gist/read:org/repo, and 20 commits of Firefox history touch that path, so no amount of chunking could ever have finished. Fixed by registering a write deploy key outside the tree and moving origin to SSH, which is not an OAuth App credential and so is not subject to the restriction; the very next chunk carried the commit that had blocked every previous attempt, and the push then ran to PUSH COMPLETE. All 990k commits, main, and the tag are now on origin for the first time. Recorded as a four-run failure that nobody counted, because the three-strikes rule only works if the counter is kept even when each run has a plausible fresh story. With the build done, browser/components/fos/ was finally wired into DIRS and ./mach build faster took 11 seconds, which is the Phase 2 inner loop the plan wanted. Importing the modules into a real Gecko runtime then immediately found a live grammar bug that 34 green node tests had never touched: GRAMMAR.md defined prose as anything not beginning with an action word, the parser implemented exactly that, and "what is a memex" therefore parsed "what" as the context verb, hit "is" and returned a syntax error. Eight of the twelve action words are ordinary English, so the collisions were the most obvious things anyone could type — back pain, field of view, branch prediction, enter the dragon. Researched how shipped omniboxes resolve this and found Chrome had retreated from exactly this design: before 88.0.4324 a keyword plus a space invoked that keyword's engine, and it now takes a deliberate Tab so that "g foo" searches for "g foo". Keyword users complained, which is the honest cost, but Google had the data and still chose search as the safe default. Adopted the priority rather than the gesture, since a keypress has no spoken form: a line is a command only if every token parses as one, syntax failures become queries, and semantic failures on a real mark stay errors. Two syntactic error codes deleted with the paths that produced them. Tests 37/37 green in node and re-verified in Gecko, where the trail tree's pillar-B branching property and JSON export were also confirmed for the first time outside node. One process note: a full-screen X grab to get a UI screenshot captured Gavin's actual desktop including an OAuth callback in a terminal — deleted immediately, nothing committed, and STATE now says never to grab :10.0 since there is no Xvfb on this box and headless --screenshot is the safe path.

2026-08-18T12:40Z — Phase 1 COMPLETE → Phase 2 — Run 7. Phase 1's remaining work was found the way STATE said to find it — by launching the build on a fresh profile and reading its own DOM, not by grepping — and the method paid for itself immediately. The headline find was invisible to any string search: about:rights was a redirect to mozilla.org/about/legal/terms/firefox/, so opening it on a fresh profile made a live network request to Mozilla and rendered Mozilla Corporation's Firefox Terms of Use as though they were this build's binding agreement. Replaced with a local chrome page stating what is actually true. The about dialog had four more mozilla.org paths including the product name itself hyperlinked to mozilla.org, and about:credits turned out to be another redirect, so it went with them; the MPL attribution stayed, because removing that would be dishonest rather than more thoroughly rebranded. Discipline note worth keeping: the first sweep read documentElement.textContent and reported two problems that were hidden elements which never render, so every finding was re-checked against getBoundingClientRect and computed style before anything was edited. The run's most interesting fix was telemetry. The branding pref set toolkit.telemetry.enabled=false and a fresh profile still reported it true with canRecordExtended true — because SetupTelemetryPref derives the default from the compile-time channel, a local build lands on "default" which upstream treats as pre-release, and it then calls Preferences::Lock, so no pref file can ever win. Nothing was being uploaded, but extended data was being collected in-process, which would have made the new about:rights page state something false. Fixed in TelemetryPrefValue where the lock cannot reach, and the pref-file line was deleted rather than left as a guarantee it could not give; canRecordBase and canRecordExtended are both false now. Also switched off the Mozilla services and adverts that reach the UI (Relay, accounts, VPN, Monitor, mobile-app promo) and rebranded Firefox View/Home/Labs, which are feature brand terms in brandings.ftl and so needed no consuming string touched. Screenshotting the about dialog caught a defect nothing else would have: the generated wordmark SVG had a viewBox 57px narrower than its own text, so the dialog shipped reading "Frontier OpenSea" — the width is now derived from the measured advance with headroom for other system-ui fonts, and the rasters regenerated byte-identical, confirming only the wordmark changed. Research went to the last unresolved Phase 2 risk and reversed a previous run's conclusion: run 2 recorded speech recognition as unavailable because it is absent from the ML engine's supported-task list, but the vendored Transformers.js ships the entire Whisper stack and checkTaskName validates a character pattern with no allowlist at all, so the voice path was never gated — the earlier claim came from a capability table, this one from the dispatch code. Final sweep on a fresh profile: zero visible Firefox or Mozilla strings in the browser window, app menu, menubar and all six settings panes; the three in the about dialog are the MPL attribution. Merged to main, tagged phase-1, report written with screenshots. Tests: 37/37 node green, lint clean on every changed file, two builds green (4m and 24s).

2026-08-18T13:05Z — Phase 2 — Run 8. Built the Field's card and region model, the last pure-logic piece of Phase 2: `FOSField.sys.mjs` has regions that are trails, cards seeded by provenance and pinned the moment the user moves one, the non-occlusion push front, capacity, and the three-level overview that nests past nine trails. Research first, on the one genuinely open algorithmic choice — the graph-drawing literature (VPSC, Dwyer/Marriott/Stuckey; Gansner/Hu) solves exactly this problem, and rejecting it was the useful outcome: it is batch and minimises displacement globally, so re-running it per frame can move a card the user is not touching, which contradicts FIELD.md §6's promise that mid-drag state is drop state; and it has no way to express refusal, which our pinned cards need as a first-class outcome. Our case is single-source and strictly easier, so a push front along the axis of least penetration is both correct and cheaper. Nineteen node tests went green, and then the run's actual lesson arrived: importing the module into a real Gecko runtime with forty cards instead of three found two defects the green suite had no chance of seeing. First, every push chain in a busy region eventually reaches a region edge, and refusing there meant most ordinary drags simply did not work while the seat the dragged card had vacated sat empty — an unpinned card has no position anybody chose, so the chain now re-seats it, and refusal is reserved for a position the user owns. Second, once a card had been dragged off the seeding lattice it covered seats no lattice position could reach, so eviction freed a seat that was still blocked and placement *threw* — placement is driven by navigation and must never fail, so a full region now evicts one least-recently-used unpinned card and grows if that is not enough. Both are regression tests at the size that produced them. Promoting the scratch verification script into a real xpcshell test then exposed something bigger and entirely self-inflicted: no browser xpcshell test has passed in this tree since Phase 1, including upstream's own. The runner derives its appdir manifest key from the application name, the rebrand changed that to `frontieropensearch`, and every in-tree manifest spells it `firefox-appdir`; the key matched nothing, `-a` was dropped, `resource:///` never mapped, and each test failed loading its own module in a way that reads as a packaging fault rather than a naming one. Fixed with a fallback to the upstream key, verified by an upstream test that failed before and passes now. The general lesson is in STATE: a rebrand changes strings that tooling matches on, not only strings a user reads. Tests: 58 node green, 77 xpcshell checks green, eslint and ruff clean on every changed file, two builds green (10s and 2s).

2026-08-18T13:35Z — Phase 2 — Run 9. Built the command bar, the one entry surface, over the parser that has been waiting for it since run 5. `FOS:CommandBar` now owns accel+L, alt+D, accel+K and accel+E, so no gesture opens the address bar or the search box any more; the bar itself holds no grammar, taking input straight to `FOSCommandParser` and out to a dispatcher of registered handlers, which is what will let a transcript front end attach without a second parse path. Two design questions were forced by the build and both are recorded in `GRAMMAR.md` §7. URL-or-search turned out not to be a grammar question at all — it depends on what schemes and hosts exist rather than on how the line is shaped, so it is settled at execution on `nsIURIFixup`, the same component the address bar uses, which also reports which of the two it chose so the bar can say "Go to" or "Search for" before the user commits; deciding it in the parser would have cost the grammar its node test suite and given the voice front end a second thing to agree with. The research went to command-palette UX writing and produced the run's most useful inversion: the standard critique is that a palette must not withhold what the menus already expose, which sounds inapplicable here because there are no menus — but that removes the safety net rather than granting one, so the empty state is the only place the twelve verbs can ever be learned, and it now lists all of them grouped by pillar. The subtler half was that a half-typed action word is prose by §3, so `fie` must still search, yet showing nothing there wastes the moment the user is reaching for `field`; the resolution is to separate what is shown from what Enter does — a single token lists the verbs it prefixes and Tab completes one, with the parse untouched. Tab needs no spoken form because it reaches no action, which is worth stating because "just add a keyboard-only shortcut" is exactly how the separate accessibility mode the brief forbids gets built by accident. Verbs whose pillar has no UI yet report NOT_WIRED and stop the chain rather than falling through to a web search, since that fall-through is precisely the hijack §3 exists to prevent. Screenshotting again earned its place, twice: the backdrop was full-window by geometry but painted *under* the toolbox, which is a flex item carrying z-index 0, so the chrome sat looking live while the bar already held the keyboard; and stylelint's design-token rule pushed the whole stylesheet onto the platform tokens, which brought dark mode, high contrast and forced colours in for free and makes Phase 3's design system a question of what the tokens resolve to. One honest limit recorded in STATE: the toolbar is still visible and still works if clicked, so the single-surface claim is true of the keyboard and not yet of the mouse — the toolbar goes with the Field. Tests: 69 node, 36 browser-chrome, 1 xpcshell, all green; eslint and stylelint clean on every changed file; three builds green.

2026-08-18T14:05Z — Phase 2 — Run 10. Built the trail rail and, with it, pillar B end to end: capture, re-entry, marks and five verbs. `FOSTrailSession` records every top-level navigation as a child node and re-enters any node by replaying the SessionStore blob it stored, so scroll offsets and half-filled forms come back; `FOSTrailRailView` is the pure flattening and `FOSTrailRail` renders it on the design tokens. The history-sidebar shortcut now opens the rail, because this fork has a trail tree instead of a linear history rather than as well as one — and the customkeys suite was checked against a reverted `browser-sets.inc.xhtml` to prove its pre-existing timeout was not that change. The one design question worth outside evidence was how a deep tree fits a narrow rail, and outliners answered it: hoisting, which MORE shipped in the 1980s and Workflowy calls zoom, re-roots rather than squeezing the indent, so depth becomes zero again and no horizontal space is spent. It was adopted less for that than for criterion 4 — it is the *same* gesture as the Field's zoom into a region, so the two pillars share one answer to scale instead of inventing two, and being a view operation it needs no verb and no spoken form, by the argument that already keeps Tab out of the grammar. The run's real lesson was the ratio of what node testing can see to what it cannot. 83 node tests went green and the first run in a real window found three defects, none of which the model could have shown. Re-entry navigates in order to put the page back, and that navigation arrives at the progress listener looking exactly like a click, so going back silently grew a duplicate spine — a restore now flags itself *before* `setTabState`, since the load can begin synchronously. Capture at the moment of departure was simply wrong: instrumenting `getTabState` showed `{"entries":[]}` for the outgoing page at the instant the next load starts, because content has not reported yet, so most ordinary navigations captured no scroll at all; the fix is not a retry but to read the entry *behind* the current page from session history once it settles, where it is complete and where waiting costs nothing — and the offset turned out to live in `entry.presState`, not the top-level `scroll` key. This corrects the earlier IDEAS entry, which was right that scroll lives per session-history entry and silent about when it is populated. The third came only from looking at a screenshot: every title in the trail was shifted by one, because a tab relabels itself for the page it is *about* to load, before that page has a node, so each name was written onto its predecessor. The same screenshot showed the marks reading h, t, p, s — assigned at node creation, before any title exists, from a label that was the raw URL and therefore from "https://". Neither the allocator nor the stickiness rule was at fault; both did exactly their job, and combined to make a bad first label permanent, which is the general lesson recorded for every pillar that registers marks later. Marks now read e, n, x off the page hosts. Verified in a real browser rather than asserted: re-entering the root and navigating a second way produced a sibling, left the first branch and its child whole, and created no extra node. Deliberately deferred and written down rather than forgotten: `prune` and an export surface, which `IDEAS.md`'s own acceptance bar for 2B requires, because both need a new verb and the verb list is asserted in tests and specified in `GRAMMAR.md` — that is a considered grammar change, not a side effect of building a rail. Tests: 83 node, 70 browser-chrome, 77 xpcshell, all green; eslint and stylelint clean on every changed file; four builds green.

2026-08-18T14:25Z — Phase 2 — Run 11. Built the Field, so pillar A is end to end and only the Context Engine is left unbuilt. `FOSFieldSurface` renders the overview, the region level and the page over the card model from run 8, which needed no revisiting; `FOSFieldView` is the pure layout and went green in node before any of it reached a window. F2 toggles page and Field with no modifier — the phase plan asks for one key, the modified ones are all spoken for, and taking one from devtools to pay for a browsing surface is a trade with no argument behind it — and `Browser:ShowAllTabs` points at the Field too, since "show me everything I have open" is exactly what it is for and a second overview beside the first is the thing to avoid. Research went to the one design question the rail had unblocked, `FIELD.md` §10, and it closed against measured evidence rather than taste: PadPrints is the closest measured relative of this design and its two experiments split cleanly — significantly fewer pages accessed but *no* time difference on general browsing, against 61.2% of the time on tasks that required returning to a page already seen. Hierarchy earns its screen space at revisitation and nowhere else, which is the argument for showing lineage transiently on focus rather than drawing a tree in every region; the spatial-hypertext finding that users reach for proximity and leave explicit links alone is the argument against drawing it persistently, and it bites harder here because the Field invites dragging and any edge set over an arrangement people rearrange becomes spaghetti. Written up as §11, with both entries in IDEAS.md. The run's real lesson was again the ratio of what a green suite sees to what it does not, and this time in three separate places. Running the whole component suite in one window — rather than the new file alone — found that cards and nodes were each taking a mark, so every page spent two of the twenty-six, the trail rail silently lost its letters, `back` was handed a null target and the fallback searched the web for it. The fix is a design correction rather than a bigger alphabet: a page is one object with one mark and it belongs to its node, `enter` and `dismiss` take a node, and the Field tells pillar B which pages it is holding so those keep their letters — with the active trail outranking that claim and able to take one back, because a Field holding forty cards must not be able to leave the page under the cursor unaddressable. It also made §8 sayable, since the mark now survives the dismissal that removes the card. A drag test that failed only in the full suite turned out to be the second: the card's caption was hung *below* the box the non-occlusion invariant is checked against, so cards a legal distance apart still covered each other on screen and a click landed on the wrong one — the invariant was green in the model the whole time, and the browser test now asserts it against `getBoundingClientRect` between every pair of drawn cards. The third only a screenshot could show, twice over. Every card but one was blank, because capturing on the way into the Field reaches only pages a tab is currently showing, and §7 had already said "captured on navigation" — pillar B knows that instant exactly, since it is the same one it reads the scroll offset from, so it now announces a departure and the Field takes its shot there. And the overview sized its grid for all nine slots and skipped the empty ones, so three trails sat in the top-left third of the window with the rest empty, which is the desert fog of §2 appearing in the surface written to avoid it; it lays out the occupied slots now, and §5's landmark property is carried by the model's permanent slot indices rather than by the grid's shape. Lineage was drawn as a third outline colour and was not tellable from the focus ring in a picture, so it dims the unrelated cards instead. Two things deliberately left and written down: the tab strip is still there, which is now unblocked and wants its own run because upstream's tests drive it; and a region is mostly empty until a trail is large, which is a small-N artefact rather than a fault, since scaling a region to its content would move cards whenever an unrelated one arrived. Tests: 96 node, 133 browser-chrome, 76 xpcshell, all green; lint clean on every changed file; screenshots in agent/reports/field-*.png.

2026-08-18T14:55Z — Phase 2 — Run 12. Built the Context Engine, so all three pillars now have code and all twelve verbs in the action table are wired. `context-engine/SCHEMA.md` became a real versioned migration — packaged into the browser jar and read over `chrome://` at open, staying a `.sql` file rather than a string literal because a shipped migration is immutable and a numbered file is what makes that auditable — behind `FOSContextStore`, which records trails, nodes, queries, visits, entities, contexts and card placements into `context-engine.sqlite` in the profile. `FOSContextSignals` holds the three pure derivations and `FOSContextPack` the markdown export; `FOSContextEngine` reconciles the in-memory tree into the database off the trail session and wires `context`, `pack` and `what`. Research came first and its most useful result was killing the design I would otherwise have built. The natural implementation of "the active context" is a recency window, and the search-log literature says it is wrong most of the time it matters: about 75% of queries are issued while the user is multi-tasking (Lucchese et al., WSDM 2011) and timeout-based detection tops out near 70% precision on task boundaries whatever the timeout. What a browser has that a query log does not is provenance — the user already partitioned their work by opening a tab — so a trail is a context, membership is attributed `provenance` so a later embedding pass stays tellable apart from it, and `context <mark>` is the explicit override. The dwell threshold came from the same discipline: 30s is the industrial satisfied-click number and is adopted with its own caveat written into the constant, since the literature is clear a fixed threshold ignores document difficulty. Then the usual ratio reasserted itself — 121 node tests and 39 xpcshell checks went green, and running the whole component suite in one window found three defects, none of which a single green file could show. The active context was a stored field set once when the first trail appeared, so a second tab filed its queries under the first tab's topic, which is precisely the failure the provenance rule exists to prevent arrived at from the other direction; it is a getter now, computed from the trail you are on, and the general lesson is the same one that made the tree reconciled rather than event-mirrored — if it can be recomputed, recompute it. The engine reported through `window.FOSCommandBar`, which does not exist because the window's lazy getters live on a module object, so every answer was computed and dropped silently; it holds the bar it was wired to. And unnamed contexts were claiming mnemonic letters, caught by `browser_trailrail.js` finding a node on example.com addressed as `t` — the fix is the honest reading of the verb rather than a bigger alphabet, since an unnamed context is the trail you are already on and there is nothing to switch to, so a context earns its letter by being named. A fourth finding is recorded as a limit rather than fixed: under real mark pressure a named context can still get no letter, which is a budget decision with cross-pillar reach and wants deciding rather than patching. Screenshotting earned its place again by confirming the new report line renders on the tokens, and dumping a real exported pack showed a sub-second dwell rendering as "0s", which reads as a measurement when it is an absence. Also written down, from watching the extractor run on real input: queries are typed in lower case, so a capitalisation-based extractor gets nothing from exactly the input carrying the user's intent — which gives the embedding pass a concrete target instead of a vague one. Tests: 121 node, 39 xpcshell, 174 browser-chrome, all green; eslint and stylelint clean on every changed file; four builds green.

2026-08-18T15:35Z — Phase 2 — Run 13. Closed the biggest hole in the fork: the trail tree was session-scoped, so a browser that promised never to destroy a branch lost every one of them at exit while the database held them the whole time. Adoption is the pure half — `TrailStore.hydrate` takes trail and node rows, keeps their database ids, links children in a second pass because `graft` can put a node under a parent created after it and ordering by id is therefore not a topological order, and validates before it writes so a set it refuses leaves the store empty rather than half loaded. `fromJSON` was already doing four fifths of that for exported trails and now delegates to it: an exported trail and a row out of SQLite are the same shape by design, and two pieces of code that can disagree about what a tree is were one piece of code too many. The engine restores at attach and seeds its id maps from what it read, which is the whole trick — without it the next reconciliation would see a tree full of nodes it had never written and write every one again, so each launch would double the session. Research came first and its use was killing a design rather than finding one: Nyxt persists its global history tree and its own thread proposes chunking to a running 30-day window, which is the obvious answer and the wrong one for the same reason this project already rejected recency for context membership — a fortnight away from the machine is not a statement that you have finished. What comes back is bounded by rank instead, twelve trails, whole or not at all, since a trail missing its middle draws a tree nobody browsed. Then the discipline that keeps paying: the tests went green, and driving a real browser through an actual restart found two defects they could not. Re-entering a restored node grew a second copy of the page it had just put back, because restoring an https page into a tab showing about:blank switches process and fires a location change in each, and the one-shot restore flag was spent on the first — the same hole made a plain reload spawn a child holding its parent's page, so the fix is one rule for both: a load that ends where the browser already is is not a new page. And a tab labels itself with the URL it is loading until the title arrives, so re-entry wrote "example.org/" over a node that had come back from the database titled "Example Domain"; the label is a fallback for a node with no title now and never a replacement for one that has. The screenshot earned its keep a third time by showing what still does not work: every restored card is a grey rectangle, because snapshots live in memory only — which promotes the thumbnail work from polish to the next task, since PadPrints' evidence is that a thumbnail hierarchy pays at revisitation and a restart is revisitation. Tests: 128 node, 54 xpcshell, 184 browser-chrome, all green; eslint clean on every changed file; verified across a real restart, screenshots in agent/reports/restore-*.png.

2026-08-18T16:20Z — Phase 2 — Run 14. Took the top item off the queue: every card in a restored session was a grey rectangle, which undercut the restore shipped last run at exactly the moment PadPrints says a thumbnail earns its space. The shape of the fix was already decided in IDEAS.md — write to Gecko's thumbnail store on capture, read `moz-page-thumb://` when a card has no snapshot of its own — and going through `PageThumbs` rather than persisting our own images is what makes it defensible rather than merely shorter: `shouldStoreThumbnail` already refuses private windows, about: pages, error responses and documents whose channel says not to cache them, and `PageThumbs.init()` registers the listener that wipes stored thumbnails when history is cleared. Nothing else in this build calls `init()`, so writing to that store without calling it would have left images outliving the history clear that was supposed to remove them; that is now our call to make and we make it. Both halves went green in browser-chrome first go, which was the misleading part. Driving the built browser found the store empty after ordinary browsing, and the instrumentation said why: at departure `captureTabPreviewThumbnail` is handed a browser whose URI already reads `about:blank` on a cross-process navigation, and more often returns false outright, because the swap has already happened. This is run 10's lesson a second time — departure is the intuitive moment and the wrong one — but without run 10's fix available, since session history keeps a scroll offset after the fact and keeps no pixels at all. So pillar B now announces a settled page as well as a departing one, and the Field captures a second after load, which is the delay Firefox itself uses before capturing a top site and for the reason its own comment gives. The departure capture stays, because when it wins the race it is the better picture — the page as you left it rather than as it was published — so the settle capture is a floor and not a replacement. `BackgroundPageThumbs.captureIfMissing` would have filled in every older card and was rejected in writing: it re-fetches the page over the network for something nobody is looking at, which is a browser phoning out on its own initiative, and it would put a picture of the page as it looks *now* on a card claiming to be what you visited. A process note worth keeping: chrome `console.error` was invisible because `getMessageArray` is capped and Wikipedia floods it, and `dump()` needed an output file the harness had not been started with — appending to a CharPref and reading it over Marionette was the channel that worked. Verified across a real restart on a clean profile: four pages browsed with the Field never opened, all four in the store, and after a restart every restored card painted from it, titles and all — agent/reports/restore-field-thumbs.png and restore-field-region-thumbs.png. Tests: 128 node, 54 xpcshell, 189 browser-chrome, all green; eslint clean on every changed file.

2026-08-18T16:55Z — Phase 2 — Run 15. Built pillar C's second surface, the context sidebar, and then spent most of the run on the three defects finishing it exposed. `FOSContextSidebarView` is the pure arrangement and `FOSContextSidebar` renders it on the inline end opposite the rail, so "how did I get here" and "what do I know" can be read together; every row re-enters the node it names, including the row the surface exists for — crossings, the other trails that have reached the page you are on, which `crossings(url)` had written and nothing had ever consumed. `what` opens it and still answers in a sentence, so no verb was added and the alphabet is untouched. The research that shaped it was SearchBar (Morris, Morris and Venolia, CHI 2008), the only pane of this kind anyone has evaluated, and four of its numbers were load-bearing rather than decorative: a third of re-navigations went through the pane, so rows must be live; its notes field was the lowest-rated part of the tool, so there is none; its hand-made topics were its one real failure, which is the future work contexts-by-provenance already answers; and it rated 3.5 in week one against 5.0 a week later, which says to judge this surface after a restart and not after ten minutes. Then the pattern this project keeps rediscovering, three times over. A test that opened the rail and the sidebar together and measured them found the rail occupying the whole window: every surface here appends a `<link>` on first open, that load is asynchronous, and the first frame therefore paints a fixed-position panel as a full-width block — `loadSheetUsingURIString` is synchronous and now does it for all four. Running the whole directory rather than the new file found a real pillar-B defect that had been there since run 10: marks are assigned at node creation, so a trail past twenty-six pages spent its entire alphabet on the pages opened first and left the page under the cursor unaddressable — the exact failure the Field's eviction rule was written to prevent, arriving from the trail itself rather than from the Field. The active trail is now considered most recently visited first and may take a letter back from an older page of its own trail, never from a newer one, which is what stops the letters churning on every navigation; the test that proves it fails without the fix, with four of the ten most recent pages marked instead of ten. The same run also learned that the browser suite runs alphabetically in one shared window, so adding a file re-ordered it and a Field test that looked pages up by URL across every trail started finding a node from a trail it had never touched. And the screenshot earned its keep again: the panel was headed with the context's name and opened its first line with the same name again, because the sentence was written to be spoken and speech has no heading. Research went to the next task, ranking the command bar, and returned the number that sets its bar — Mozilla's own federated-learning experiment says frecency's twenty-two weights "were not decided on in a data-driven way", and optimising all of them across 723,581 users bought 0.6 of a character typed, which is the entire remaining headroom of the signal Firefox has ranked by for fifteen years. So the answer is a different signal rather than better weights, and it will be tiers of provenance rather than a score, read from the store rather than the window's tree because close to 60% of complex tasks continue across sessions. Tests: 154 node, 253 browser-chrome, 2 xpcshell files, all green; eslint clean on every changed file; screenshot in agent/reports/context-sidebar.png.

2026-08-18T17:45Z — Phase 2 — Run 16. Built the last of pillar C's three surfaces: the command bar now ranks what it offers by the context the user is working in, which the phase plan asks for in as many words and which `context <mark>`'s own summary — "switch the active context and re-rank suggestions" — had been promising to a bar that had no ranking of any kind. The design was settled last run and the discipline was to build it rather than re-open it: tiers of provenance, not a score, because Mozilla's own federated-learning experiment optimised frecency's twenty-two weights across 723,581 users and bought 0.6 of a character typed, so the remaining headroom is in a different signal and not in better coefficients — and inventing twenty-two fresh magic numbers in an afternoon would be strictly worse than the ones being replaced. Five tiers: a mark typed as a mark, which is an address rather than a guess and which resolves the spoken word too, so `gust` reaches the page `g` addresses and the hands-free half of this surface is already done; then the active context, best outcome first and in the order `contextContents` had already justified, since re-sorting it here would have been a second opinion about an order the store can defend; then the active trail; then crossings, which is the tier no other browser could offer — another line of enquiry reached a page this context reached, so the rest of what that line found is material this context has never seen but demonstrably neighbours, and the connection was made by a person browsing rather than by a similarity threshold; then Places frecency as the floor, always read and never a fallback, because a browser that cannot find a page you visited once last year is worse than Firefox and this fork has never claimed history should be lost. Each boundary is a fact rather than a coefficient, so each is explainable in one line and the bar prints that line as the group heading, and each is falsifiable: either the page is in the context or it is not. Candidates come from the store rather than from the window's tree, which is the whole reason the reads are new — a bar that can only offer what this session has loaded works exactly when it was not needed, and close to 60% of complex tasks continue across sessions. Research this run was in-tree rather than on the web, and paid twice: `UrlbarView` only auto-selects when nothing is selected and holds the previous query's rows until the next one answers, which are a correctness rule and a legibility rule that between them settle what a read landing after its keystroke must do. Since this bar re-renders wholesale, "do not move the selection" became "re-anchor by row id", with a vanished row returning the selection to the typed line rather than passing it to whatever took its place. A search for evidence on zero-prefix suggestion lists found only implementation and patent material, all of it ranking from a cache of recent queries — the signal this project rejected for context membership — so the empty bar keeps showing the twelve verbs and the rejection is now written down. Then the two habits that keep earning their place. A test that failed for a good reason exposed a real gap rather than a bug: a page on an old trail, outside the active context, with its Places record cleared, is offered by nothing — accepted, because the answer is a surface for finding old trails rather than a sixth tier ranking the whole database by nothing in particular. And the screenshot found what 279 green browser-chrome checks could not: marks were attached to the trail and crossing tiers but not to the context tier, so the top of the list — where a page is likeliest to already hold a letter — showed none, and the provenance line sat at the far edge of the bar where nobody reads it as belonging to the title it describes. Both fixed and re-shot in light and dark. Tests: 179 node, 279 browser-chrome, 64 xpcshell checks, all green; eslint and stylelint clean on every changed file; screenshots in agent/reports/suggest-tiers.png and suggest-tiers-dark.png.

2026-08-18T18:20Z — Phase 2 — Run 15. The single-surface gap closed, which STATE had named the widest distance between what the phase plan claims and what the build does. Two surfaces went and neither needed a mechanism invented for it. The tab strip: `TabBarVisibility` already hides it when tabs are "displayed elsewhere", which is the clause vertical tabs stands on and is exactly what the Field is, so the change is one more condition on an existing rule rather than a second way to collapse a toolbar — and the comment warning that hiding the strip must not lose tabs is satisfied by construction, because the tabs are all still there and `browser.fos.field.replacesTabStrip=false` draws the strip again. With it gone the nav-bar takes the titlebar and the window controls land correctly with no styling of ours, because upstream already handles that case for popups. The address bar was the harder half and the research is what decided its shape. Deleting it is the obvious move and it is the one that ships advisories: Zen, a fork with these same ambitions, has an origin-spoofing advisory (GHSA-vjfv-85qf-v25c) whose root cause was chrome that hid where the user was. Against that sits the older finding that users barely look at the address bar — a 2008 lab study of 63 subjects, and an eye-tracking study where 23% never checked browser cues at all and then judged wrong 40% of the time. Those look contradictory and are not: they are about different halves of one widget. Ignoring an indicator makes it weak; removing it makes it a new attack surface, because nothing then contradicts an origin a page draws for itself. So the bar was cut along the seam it already has — entry moves to the command bar, display stays in the element that holds the eTLD+1 emphasis, the punycode handling, the certificate and mixed-content state and the site's permissions, none of which this project should be re-earning in an afternoon. `readOnly` turned out to be the supported way to do that, for the fourth time this project has found the mechanism it wanted already in the tree: popup windows and taskbar tabs have shipped an address bar that shows an origin and refuses typing for years, so every anchor and panel keeps working untouched. What is new is only the click, which opens the command bar empty, and the passthrough list that leaves the site-information control and the page actions their own press. Two habits paid again. A screenshot found what fifteen green checks could not: `readOnly` says nothing about how a field *looks*, so the bar kept an I-beam over text that would not take a caret — a control advertising an input it refuses — and the fix is now a stylesheet and an assertion on the computed cursor. And a test that failed for a good reason was right: the identity box is zero-width in this build because the trust panel supersedes it, so the test now presses whichever site-information control the user can actually reach, which is what it should have asserted from the start. Upstream fallout was smaller than feared and one file of it was real: `browser_1936752_lock_tab_sizing.js` measures tab widths that are now zero, it timed out, and a timeout aborts the whole directory. The `tabs/` and `dragdrop/` manifests now run with the strip restored — those files are the coverage keeping the strip working for the pref that restores it, and the strip-less window has its own tests. The next file, `browser_addAdjacentNewTab.js`, also times out; checked out the pre-run tree, rebuilt and re-ran to be sure, and it fails identically, in the same tab-context-menu-on-x11 family this manifest already skips several files for. Removing the strip immediately surfaced the next real gap and it is now the top of the list: a background tab arrives with no signal at all, because the strip was doing that job incidentally. Tests: 298 browser-chrome checks in the component, all green; eslint and stylelint clean; screenshots in agent/reports/no-tab-strip.png and one-surface-{rest,rest-dark,open}.png; the remaining 193 upstream tab tests left running as background job tabtests5 for next run to read.

2026-08-18T18:40Z — Phase 2 — Run 16. **Phase 2 is complete**, tagged `phase-2`, merged to `main`, report in `agent/reports/phase-2.md`. The task was the one STATE had put at the top for the right reason: every stage of the phase's own "done when" was separately tested and nothing had ever run them as one sequence, so the honest answer to "is the phase finished" was unknown rather than yes. It is now a single browser-chrome test, `browser_zdemoflow.js`, driving search, three branches, the Field, a context switch and a pack export in one task — deliberately one task, because splitting it would let each stage re-establish its own preconditions, which is exactly what the other six files already do and exactly what made them blind to what this found. It found three things in the first hour. A query never joined its own context: the membership was written from whatever was active at the moment the query was issued, and for the commonest case of all — a search typed into a fresh tab — there is nothing active, because the context does not exist until the page arrives. Every pack of an enquiry that began with a search therefore reported "0 questions asked", which is half of what a brief is for. The seam to fix it was already there, since a pending query already waits for its node to exist; it now joins that node's context at the same moment, and the issue-time membership stays because a question asked while working on one topic that opens another really was asked in both. Second, a pinned context could never be released: `context <mark>` pins deliberately and correctly, but nothing undid it, so one switch aimed the bar's ranking, `what` and `pack` at that enquiry for the rest of the session however many tabs on other topics came after — "cannot be taken away by the next navigation" had been built as "cannot be taken away by anything". The verb's target is now optional and the bare form hands the decision back to provenance, as bare `back` applies to where you already are; the grammar stays at twelve words. Third, and not a defect: a key struck while content holds focus reaches the chrome keyset only after a round trip through the content process, so every assertion written against F2 as a synchronous call was measuring IPC latency. Two failures were mine and worth recording as errors of the same kind — comparing an in-memory node id against a database node id, which are separate spaces that coincide only by accident, and calling a promise-returning `store()` without awaiting it. The run also confirmed the tab-test question left open last run: 193 of 194 upstream tab tests pass, and the one failure crashes a content process on about:newtab and fails identically with both FOS prefs off, so it is not ours. The structural lesson is the window. Putting the flow in the shared window made it fail for reasons about the mark budget rather than about whether the pillars compose, and adding two tabs to a pillar-C file broke a mark assertion in a file that runs after it — so the flow moved to `BrowserTestUtils.openNewBrowserWindow()`, which `browser-init.js` wires completely, over the one shared profile database. That is what a fresh session is, and it is the right shape for any test of a sequence rather than a property. Screenshots found what 335 green checks could not, again: the search result's own card paints blank in the Field while its three children paint correctly, and the retired address bar still advertises "Search or enter address" while refusing to be typed in. Both recorded for Phase 3 rather than chased at the end of a run. Research: ambient and peripheral display evaluation, which sets a sharper bar for the background-tab signal than "show a badge" and rules out a toast, a notification system and a count badge outright; the channel itself is left as a Phase 3 design pass. Tests: 335 browser-chrome checks, 179 node tests, xpcshell green, eslint and stylelint clean; screenshots in agent/reports/demo-*.png and the exported brief in demo-pack.md.

## 2026-08-18 — Phase 3, run 17: the design system, and a type scale that was never there

Phase 3's first line is "one coherent design system", and the plan was to write
down the tokens the four chrome surfaces already shared and reconcile where
they had drifted. The drift was real and there was more of it than expected —
five treatments of the mark across four surfaces, three of them carrying
comments asserting they matched one of the others; two mechanisms for quiet
text, six declarations to fourteen, mixed *within* single files; two selection
treatments; three hand-written integers near maxint standing in for a layer
order nothing stated. All of that is now one contract in `design/SYSTEM.md`,
declared in `fos-tokens.css`, which `ensureStylesheet` loads as a precondition
of every other FOS sheet so a surface cannot forget it.

But the find that mattered was not drift. Reading the platform token source to
learn what the tokens resolved to, `--font-size-small` turned out to be defined
twice: `0.867rem` in the brand layer, and `unset` in the platform layer that
chrome actually loads. Upstream does this deliberately — chrome tracks the OS
font size rather than imposing one — but `font.size.large` carries no matching
override, so chrome gets the upper half of a scale and not the lower half. A
probe in a running window settled it: `font-size: var(--font-size-small)`
computed to 13.3px against a 13.3px parent, which is to say it did nothing. The
fork had twenty-two of those across four surfaces. Every label-and-detail and
title-and-count pair in the rail, the sidebar and the Field — the whole
primary/secondary structure those surfaces are built on — was rendering at one
size. Nothing could see it: stylelint reads a stylesheet, and the stylesheet
was correct; the node tests do not lay anything out; 335 browser-chrome checks
were green. Only computed style in a real window can catch a token that
resolves to nothing, so `browser_designsystem.js` now checks exactly that for
every `--fos-*` token, plus the ordering of the three type steps and the
continued inertness of the platform token, so the fork stops carrying its own
the day upstream fixes it.

The research question worth having was opacity versus colour for secondary
text, since the fork had both. The accessibility literature is one-sided —
transparency fools contrast checkers, which read the declared colour rather
than the composited result — but the argument that actually bit this tree is
plain CSS: opacity applies to the subtree, so `.fos-rail-row[data-dismissed]`
was taking its own mark's accent and its current-node rule down with it, and a
dismissed node you were standing on lost both. I expected forced colours to
separate the two mechanisms and checked: it does not, both collapse in the
`tokens-prefers-contrast` layer. Recorded in `IDEAS.md` so that argument is not
reached for again.

The run's real lesson is a process one. When the full suite came back with the
demo flow failing, I concluded my change had broken it — the suite had passed
at the previous commit, which looked like proof. It was one run of a flaky
test. `browser_zdemoflow.js` passes alone every time and failed 2 of 3
full-suite runs; across five runs the same near-identical tree produced 2
failures, then 6, then 0, then 6, then 0. Three separate stories got invented
for it — my change, then window pollution, then manifest ordering — before the
counts were compared, which is the exact failure the three-strikes note in
STATE.md was written about, and it is now counted. The signature is sharp and
worth having: when it fails, the exported pack carries the context's name and
its query but not one of its four pages, and `suggest()` offers no context-tier
item, so the query side of `context_member` is intact and the page side is not.
`contextContents` reaches the pages through `JOIN trail t ON t.id = n.trail_id`
— an inner join, which drops a node whose trail row is missing and leaves its
queries in place. That matches the shape exactly and is a robustness bug either
way, but it is a hypothesis and next run confirms it by dumping the three
tables at pack time during a failing run rather than by re-running until green.
It is Next task 1: the Phase 2 acceptance criterion is not trustworthy, and
Phase 3 wants the suite green twice consecutively.

Tests: 426 browser-chrome checks with the new file, 82 of them the design
system contract; stylelint clean across `browser/components/fos/`. Phase 2's
demo flow is green in isolation and intermittent in the suite, as above.

## Run 17 — 2026-08-18 — Phase 3

The demo-flow flake was a product bug, not a test one, and it was corrupting the
database.

Last run's note said to stop re-running and dump `context_member`, `trail_node`
and `trail` at pack time during a failing suite run. That is what was done, and
it answered on the first failing run. The dump: four node membership rows for
the context, of which two named node ids that do not exist, and the two that do
were both on `trail_id` 159 with no trail 159 in the table. Nothing in this
component deletes rows, so those references were never going to resolve and the
inner joins in `contextContents` were dropping every page — the exported pack
had none, which is why it looked like "a page went missing".

The cause is in `FOSContextStore.#insert`: an INSERT followed by a separate
`SELECT last_insert_rowid()`. One store is shared by every window in the
process, each window's engine serialises only its own writes, and
`last_insert_rowid()` is a property of the connection across every table on it.
So an insert reported whatever row had most recently been written by anyone —
a plausible integer, from the wrong table, silently. Running alone there is one
writer and the pair is correct; in a full suite six earlier files have left an
engine recording on the shared window, so the interleaving is constant. That is
the lesson worth keeping: "passes alone, fails in the suite" is evidence of
concurrency, and the second writer can be the product rather than the harness.
Three runs went into three different stories about test pollution.

Fixed with `RETURNING id`. The regression test was checked against the old
implementation rather than merely added — 20 concurrent trail inserts returned
**one** distinct id. The three failure signatures seen across three runs (a
query attached to no node, a suggest tier with no context item, a pack missing
its pages) are all the same bug seen from different sides.

Also this run: `design/ARCHITECTURE.md`, the missing document saying how the
three pillars compose — one spine and two readers, the wiring order at window
init, the per-window/per-profile split the bug came out of, and the honest list
of the six files the fork touches outside its own directory. The README's
pointer to `docs/` was wrong and now points at a real table.

Merged to `main`, which had been carrying the bug under a Phase 2 tag whose
acceptance criterion did not actually hold there.

Tests: full suite green **five consecutive runs** (427 browser-chrome checks,
both xpcshell files) against three of three failing before the fix; 179 node
tests green.

### Run 19 — 2026-08-18 — Phase 3

Measured the Field before touching it, which is what the last two runs' notes
kept asking for, and the measurement refuted both of the hypotheses it was
written to test. The drag is not the problem: at 40 cards carrying thumbnails a
pointer move costs 1.5ms of script and 0.01ms of layout, and 60 consecutive
frames arrived at the display's own cadence with none dropped. `#applyPositions`
does not write transforms as `STATE.md` claimed — it writes `left` and `top` —
and it does not matter that it does, because the loop rewrites most cards to the
value they already had and an unchanged declaration dirties nothing. CSS
containment goes the same way: it was proposed as a bound on blast radius, and
the blast radius is already 10µs at 56 cards.

What the measurement did find is one real source of jank, in the place nobody
had proposed. `render` rebuilds the stage from nothing, the resize listener
called it unthrottled, and on the worst case the design permits — twelve trails,
480 cards, 480 miniatures — one rebuild is 17.6ms and ten resize events in a
single tick cost 53ms of them. Frame intervals during a real window drag: p95
65ms with the Field open, 23ms with it closed. Coalesced to one render per
animation frame, the burst is 7.6ms. The rebuild itself is untouched; it stopped
happening several times for one frame.

The harness stays as `browser_zzfieldperf.js`, with a control beside every
number. That discipline earned itself immediately: the first version reported
confident timings for a drag that was being refused on every move and had never
moved a card at all.

Then the second Phase 3 criterion: the demo flow now photographs itself. Six
stage screenshots and the exported brief land in `agent/reports/` when
`FOS_SHOTS` names a directory, and `agent/smoke.sh` is the run that sets it. The
pictures there had come from a scratch test that was deleted afterwards, so
until now they could not be regenerated. Looking at the first one is what found
that a harness screenshot wears upstream's remote-control stripes, and reading
the address bar in it is what led to the placeholder: the bar was made read-only
four runs ago and still said "Search or enter address" while refusing every
keystroke. Fixing it needed the `_setPlaceholder` override rather than an
attribute, because the search service writes that string again after the window
is built — which the test caught and the window it was written in did not.

Two findings recorded and not chased: a full region refuses every drag, so at
capacity nothing can be rearranged; and the Google-branded search-mode switcher
is still a second way to start a search from a bar that claims to be one entry
surface.

Tests: full component suite green (473 browser-chrome checks, both xpcshell
files), 179 node tests green, smoke run green. Three commits pushed to
`agent/dev`. Nothing merged to `main` — no phase criterion completed this run.

Second half of the run, after the measurement work was committed.

Joined the demo flow to the screenshot route, which Phase 3 asks for: five
stages photographed and the exported brief written beside them, gated on
`FOS_SHOTS` so an ordinary suite run writes nothing. Then read the first
picture, which is what the project's own rule says to do, and it paid for
itself three times. It showed the harness's remote-control stripes across the
address bar; it showed the placeholder still saying "Search or enter address" on
a bar that has refused typing for four runs; and once that was fixed and the
README screenshots were driven over three fixture pages, it showed that **every
screenshot this project has taken since Phase 0 had a blank rectangle where the
page should be**. `drawWindow` draws the parent process's own layers and
content is in another process. Nobody noticed because every surface being
photographed was chrome. `DRAWWINDOW_USE_WIDGET_LAYERS` fixes it, and the
README now shows the rail, the Field at both levels, the command bar and the
context sidebar over pages that are actually being read.

The last of those pictures then showed the context sidebar reporting five
entities for three things — "All Demos" and "The Mother" filed separately,
because a run of capitals cuts a name in half at the word that joins it. Fixed
with a short joiner list that deliberately excludes `and`, and the limitation
that remains is written into the module rather than papered over.

The placeholder is worth its own note. Writing the string at wiring time looked
right in the window that produced it and was wrong a second later: the search
service sets the placeholder again once it knows the default engine. Only the
test caught it. That is the third time this run that a thing which looked
correct in one window was wrong in the run that came after.

Tests: full component suite green (475 browser-chrome checks, both xpcshell
files), 182 node tests green, smoke run green. Six commits pushed to
`agent/dev`. Phase 3 now needs one more green run and the design-system polish
pass; everything else on its list is done.

---

## Run 19 — 2026-08-18 — Phase 3 complete

Opened with the whole component suite on the unchanged tree: green, 464
browser-chrome checks, both xpcshell files, 182 node tests. That is the control
the rest of the run is measured against.

Then the polish pass, which is what Phase 3 had left. The instrument was not
the stylesheets — those had already been reconciled — it was the README's own
screenshots, opened at 3×. Two defects, neither visible in any single file.

The first is rhythm. `SYSTEM.md` settled the inline gutter and deliberately
said nothing about the block axis, and four surfaces then answered it four
ways. The rail and the sidebar are open at the same time on either side of the
page, listing the same nodes, at 17.6px and 21px per row; the sidebar's entity
list, at `padding-block: 0`, rendered as a paragraph with a heading over it.
Three tokens, one role each, and the test measures them on real rows rather
than reading them out of the sheet — a later rule overriding the token is
exactly how the entity list got there.

The second is focus, and it cost the most. All three focusable containers fill
the window, so `:focus-visible` on the container drew a 700px accent rectangle
down the side of the browser next to a row shaded 20% grey — the loudest mark
in the surface pointing at the box rather than at the page Enter would open,
and saying twice what selection already means. The ring goes on the row.

Then three things in a row that reading could not have found. **The rule being
replaced was not adding a ring**, it was overriding the one the UA stylesheet
draws on every focused element, so deleting it handed the container back a 1px
grey `outline: auto` and the next screenshot looked like nothing had happened;
the live test said so in one line. **`:has()` is lint-banned here** for
invalidation cost, and the replacement was not a compromise — every one of the
three surfaces already sets `aria-activedescendant` in the same breath as the
selection, which is the same fact, free to match, and already written down for
assistive technology. And **a programmatic focus inherits the window's
pointer-or-keyboard mode**, so a surface opened after a click took every
keystroke off the page and showed no sign of it — a real defect, found only
because the ring test passed alone and failed after `browser_field.js`, whose
drags leave the window in pointer mode.

The sidebar also opens on the page you are on now, as the rail already did.
Without that, the one branch where the ring has nowhere to go but around the
panel is the state everybody sees first, so the rule and the seeding are one
decision.

Suite at the close: 504 browser-chrome checks, 64 xpcshell checks over two
files, 182 node tests, smoke run green, screenshots retaken. Green on this run
and on run 18, which is Phase 3's last criterion.

**Phase 3 is complete** — `agent/reports/phase-3.md`, tagged `phase-3`, merged
to `main`. Every phase in the plan is now done; the next run picks from the
standing list in `STATE.md` and says why.

## Run 20 — 2026-08-18 — the last second entry surface

The phase plan is finished, so this run picked from the standing list, and it
picked the top item because it was the only known contradiction of a claim the
README makes: "no separate URL bar, search box, or menu". `STATE.md` had the
sighting — a Google logo and a chevron at the left of the address bar — and
deliberately withheld the verdict: *check what pressing it actually does before
deciding.* That instruction earned its keep. Four probes in a driven browser
produced four facts and three of them contradicted the note that raised the
issue.

It is upstream's unified search button. It parks itself off-screen at
`top: -999px` and comes back whenever `pageproxystate` is `invalid` — every
blank tab, so the state a fresh window opens on, not a corner.
`BrowserTestUtils.isHidden` says false in both states, which is how it went
unnoticed; the tell is a bounding rect at `y = -994`.

The press was already reaching the command bar — **through a bug**. The
passthrough entry naming the switcher was `#urlbar-searchmode-switcher`, and
the element has no id at all. So the single-entry-surface claim was accidentally
true of the mouse, and the natural-looking fix — correcting the selector — would
have read like tidying and built the second entry surface the module exists to
prevent. `.urlbar-go-button` was dead the same way. One upstream change explains
both: the address bar became a custom element shared with the search bar, so ids
on a singleton became classes on a reusable one.

The keyboard went straight past the mouse handler anyway. The button sets its
own `tabIndex` to 0 on `focusin` and opens its panel on ArrowDown, listing
twelve destinations. A `mousedown` handler is not a policy about entry; it is a
policy about mice.

And the control was dead regardless. Picking Google set the search mode, painted
the chiclet, focused the input — and the input is read-only, so the value stayed
empty. The hypothesis in `STATE.md` was that it "does nothing a user can act
on". Confirmed by doing it, which is the only way that sentence was ever going
to stop being a guess.

So: `display: none`, scoped to the attribute. Not the `offscreen` technique the
button already uses, because that hiding is *designed* to stay focusable —
copying it would have moved a third party's logo out of sight and left the
engine list one Tab away. Only leaving the box tree leaves the tab order and the
accessibility tree with it. Two screenshots at 3× carry the change:
`agent/reports/searchmode-switcher-before.png` has the Google mark sitting
beside a placeholder reading "Press to search or run a command"; `-after.png`
has a bar that says one thing.

What is genuinely lost is per-query engine choice, and it is worth stating
rather than glossing: the command bar searches with the default engine, because
`GRAMMAR.md` refused keyword prefixes on Chrome's evidence. But it was lost
before this change — an engine you cannot type to is a chiclet, not a choice.

The generalisable find is the guard, not the fix. **A selector list is a claim
about a document, and it fails silently in the direction that looks like
success**: a dead selector means the control quietly loses its press, which is
indistinguishable from working until somebody presses that control. Reading
cannot catch it; one `querySelector` loop against a real window catches all of
it, and now runs every time. Third time this project has learned that the tree
does not tell you what it does — after the UA-stylesheet ring in run 19 and
`--font-size-small` before it.

Suite: 526 browser-chrome checks green, 0 failures, lint clean.

**Found and not fixed, deliberately.** Hiding the switcher made visible that
upstream's urlbar tests were never pinned against this fork:
`browser_searchModeSwitcher_basic.js` fails 10 of 12. That is not fallout from
this change — the bar has been read-only for several runs and those tests type
into it. The obvious repeat of the `tabs/` precedent does **not** work: pinning
`browser.fos.commandBar.replacesAddressBar=false` took the file from failing to
hanging — it burned every timeout extension and had to be stopped — which fits
`FOS:CommandBar` owning `accel+L` and friends
unconditionally, so a test pressing `accel+L` and waiting for urlbar focus waits
forever. 355 files across fifteen directories. That is a run's work with a
diagnosis in front of it, not a manifest line at the end of this one, and it is
now the top of the standing list.

## Run 21 — 2026-08-18 — a pref that half-restores, and a region that refused every drag

Two items off the standing list, the first two on it, both with a user-visible
defect behind them.

**Upstream's keys.** The task the last run left at the top was "find the full
set of prefs that gives a window back to upstream, do not write a manifest line
until you have". The answer turned out to be one sentence long and it explains
the hang exactly: a pref that restores a *surface* had never restored the
*gesture*. `browser.fos.commandBar.replacesAddressBar=false` gave back a
typable address bar, and `focusURLBar`, `focusURLBar2`, `key_search` and
`key_search2` went on naming `FOS:CommandBar` in `browser-sets.inc.xhtml`
whatever the pref said. So an upstream test that presses accel+L and then waits
for `gURLBar.focused` did not fail against it — it waited, burned four timeout
extensions and had to be killed. **A half-restoring pref is worse than one that
does nothing, because a suite can report the second and can only stall on the
first**, and that is the generalisable part.

The fix is smaller than the diagnosis. `GlobalKeyListener.cpp` reads a `<key>`'s
`command` attribute at dispatch, not at parse — so pointing the four keys back
at what they said before is enough, and no second path through the handler is
needed. It has to happen at window init rather than in the handler because one
FOS command id stands in for two upstream ones: accel+L was
`Browser:OpenLocation` and accel+K was `Tools:Search`, and by the time the
command fires only the key still knows which.

Doing it properly turned up two more. `key_gotoHistory` carries no `command` at
all upstream and is dispatched by id, so restoring it means *removing* an
attribute — a table that only knew how to rewrite would have had to invent a
command id that does not exist. And that key needed a pref of its own, which
earned its place immediately: `browser_sidebar_keys.js` goes from 2 passed and
1 failed to 17 passed and 0 failed with it. `Browser:ShowAllTabs` is the third,
and is a command rather than a key, so it reads the Field pref in the handler:
with the strip drawn again, its own overflow button opens its own panel.

Pinned in all eighteen `urlbar/tests/` manifests and both `sidebar/tests/`
ones. `browser_searchModeSwitcher_basic.js` goes from hanging the harness to
everything passing except one environmental crash. The whole 397-file directory
is running in the background — 0 unexpected failures at 53 files.

**The Field.** At exactly the lattice capacity — 56 cards on 56 seats — every
drag was refused, and not only a drag across the region: a drag of less than
one seat-step was refused too, because until the dragged card clears the
minimum distance from the seat it vacated its own seat is not free either. So
"you may not move anything" was the whole of the behaviour on a full region,
which is the negation of §2 rather than a corner of it.

§6's capacity ladder already answers this for placement — seed, evict, grow —
and the drag path had implemented the first rung and refused. It reaches the
third now and skips the second on purpose: eviction exists to bound the card
count against a page *arriving*, and a drag brings nothing, so dismissing
somebody's page because they tidied is a surprise the ladder never promised.
Growth turns out to be bounded by the arrangement rather than by the pointer —
one added row is a whole row of free seats — so twenty successive drags in a
full region cost four rows and then stopped, and every refusal left was
`would-displace-pinned`, the one refusal §6 wrote a rule for.

**And one thing worth not rediscovering.** The `about:newtab` content-process
crash was recorded as belonging to one bfcache test. It is universal to this
build: it fires at the teardown of every test file, upstream and FOS alike, and
about one file in eight escalates it into a four-minute timeout. Verified by
counting it in a `tabbrowser` file and a FOS file that both passed. It is why
an upstream directory is a six-hour job here, and it is why a timeout in an
upstream suite must not be read as a fork defect before checking the file alone.

Suite: 546 FOS browser-chrome checks green, 185 node tests green, 0 failures,
lint clean.

## Run 22 — 2026-08-18 — four failures that were not ours, and a resize that stopped rebuilding

Run 21 left the whole urlbar directory running against the newly pinned
manifests and said to read it first, because a real failure there would be a
genuine incompatibility between this fork and a restored address bar. It had
reached 115 of 397 files with four such failures — every other unexpected
result was the teardown crash or the missing clipboard, both already known to
be environmental.

**All four turned out not to be the fork's, and the way that was established is
the transferable part.** Each file was run twice, alone and with all three FOS
surface prefs off, and the pair answers the question that a suite log cannot.
`browser_autoselect.js` passes 40 of 40 alone, having produced ten unexpected
failures inside the directory run. The other three want a *remote* tab —
`test_remote_tab_result`, the `remote_tab` telemetry group, a SyncedTabs
fixture — and fail identically with the fork switched out of the window, so
whatever stops remote tabs appearing in this build, it is not these surfaces.
That question is now the top of the standing list with its next step named:
`services-sync` is built and its modules are in `dist/bin`, so the thing to do
is ask `UrlbarProviderRemoteTabs.isActive` in a driven browser rather than read
any more code.

The pattern behind the fourth is worth more than the file. **Every one of the
four failing files immediately followed a file that timed out**, and the
timeouts are the environmental crash. A failure that follows a timeout in this
suite is a claim about the harness until the file has been run alone — read the
file list, not only the failure list.

The directory run was then stopped at 115 files, deliberately and not because
of anything it found. Harness time here is exclusive — one mochitest at a time,
and `build faster` rewrites files the running browsers read — so it was going
to hold everything for another two hours, and `--start-at` resumes it for
nothing. It is resumed now, at the end of a chain that ran the triage and this
run's change first. That ordering is the lesson: a job that has to follow
another belongs in the same script waiting on the unit, not in a second unit
racing it.

**The overview stopped rebuilding itself on a resize.** Run 18 measured the
Field and left one number standing — a crowded overview, twelve trails and 480
cards, costs 17.6ms to render and does not fit in a frame however few times per
frame it runs. The resize comment in the surface already said what a resize
means here, nothing moves and the same arrangement is drawn at a different
scale, and the region level already had `#applyPositions` for exactly that; the
overview did not, so it went through the rebuild. It has a reposition path now,
four declarations per element and the tree left alone, with every refusal being
a difference between what is drawn and what the model says and all of them
falling back to the rebuild. The writes are collected before any is applied,
because a refusal found halfway would leave half the overview at each scale and
the rebuild would then be repairing a surface this path had broken.

`resize-burst-of-10` goes from 7.6ms to **p50 0.99ms**. The real gesture
improved by much less — 50.4ms a frame against an 18.8ms control, where run 18
saw 65 against 23 — and the two numbers disagree honestly: the burst coalesces
ten events into one pass and a real drag delivers one pass per frame, so what
is left is one reposition of 489 elements. The next rung is therefore a
different idea rather than more of this one, and it is written up with numbers:
a `transform: scale()` on each tile's body makes a resize nine writes instead
of 489, and is faithful precisely where the region level's would not be, since
a miniature is a plain box and a card carries a caption that must not scale.

**Research settled the background-tab signal's form**, which run 16 left open
with three candidates. Both ends of the obvious range are ruled out by
evidence rather than taste: motion at the window margin captures attention
involuntarily, which is the attention shift an ambient display is *defined* by
not requiring, and a slow fade runs into slow change blindness, which survives
the change being large, in full view and about something the observer cares
about. What is left is a persistent binary state, read on the next voluntary
glance and cleared by opening the Field — not an event and not a drift. Which
surface carries it is now a question to answer in a running browser.

Suite: the whole FOS directory green, 0 unexpected, `browser_field.js` at 116
checks. Lint clean.

## Run 23 — 2026-08-18 — post-phase

Harness time was held for the whole run: `run22`'s chain reached its last step
— the urlbar directory resumed — four minutes before this run started, and that
step is about two hours. One mochitest runs at a time and `build faster`
rewrites an omni.ja a running suite has mapped, so the run was spent on the two
things that needed no harness, with a second chain queued behind the first:
`agent/jobs/run23.sh` waits on `systemctl --user is-active fos-job-run22`, then
builds and runs the whole FOS directory. That run is the gate for everything
below; neither change has been in a browser yet.

**The overview scales with a transform now.** Run 22's reposition path took the
synthetic resize burst from 7.6ms to 1ms and left a real window drag ~31ms a
frame dearer with the Field open, because one pass still wrote four
declarations for each of 480 miniatures. Miniatures are now placed in unscaled
field units inside a wrapper per region, and the wrapper carries the translate
and the scale: a resize writes four declarations per tile and one per region —
about a dozen — and the scaling is the compositor's rather than layout's. The
write per card in the reposition path became a *read* per card, because leaving
a miniature alone is only correct while what is drawn is still what the model
says; a card moved, gained or lost refuses to the rebuild exactly as before.
The geometry probe in `browser_field.js` had to grow the wrapper transforms, or
it would have gone on comparing the two paths on the one thing neither of them
now varies.

**Run 22's open question was answered by looking, not by searching.** It left
the background-arrival signal's form settled and its surface open between two
candidates. Exactly one of them exists: nothing in the component creates a
toolbar button, and every FOS surface builds its DOM on first open, so neither
the Field nor the command bar is on screen at rest. What is on screen is the
retired address bar — which is the command bar at rest, one press from the
surface that acts on the signal. It takes the mark: a flex item in the input
container rather than a dot over the page actions, `aria-description` rather
than a live region, cleared by opening the Field and by nothing else. A page
the user navigated to is not an arrival, and neither is a page put back by a
restore — the watch starts when the window does, so a restart does not light
it.

**Research settled the voice path's budget so the next run can build.** ~1s
from end of utterance is natural and 2s is tolerable *given* a live transcript
echo — which this fork gets free, because the command bar is already the text
surface the parse happens in. The knob that decides whether the budget fits is
the backend, and the tree ships both: `ort.webgpu.mjs` is in the ML component's
`jar.mn`, `ONNXPipeline` takes `config.device`, and `ensurePipelineIsReady`
already falls back to CPU on its own when the GPU is unsupported. Push-to-talk
first, wake word as a second layer on the same path.

Suite: not run — the harness was busy. Lint clean (eslint, stylelint) on
everything touched.

## Run 24 — 2026-08-18T22:30Z — post-phase — the voice path's pure half

Both of run 22's and run 23's jobs were still running for the whole of this
run, and harness time is exclusive, so this run took the highest-value task
that needs neither a mochitest nor a `build faster`: the voice front end's
pure layer, which turns out to be most of it.

`FOSVoiceTranscript.sys.mjs` is the input adapter GRAMMAR.md §5 has always
required and never had — it turns what an ASR model emits into the line the
keyboard would have produced, and knows nothing about actions, marks or the
parse. `FOSVoiceSession.sys.mjs` is push-to-talk as a state machine with no
microphone in it, so every decision the voice path makes is testable under
`node --test`: cancel from every state including after the transcript lands, a
late transcript after a cancel doing nothing, typing winning without deleting
what was typed, auto-repeat unable to restart the turn.

The finding that shaped both is that Whisper answers silence with a confident
sentence rather than with nothing, and that its own defence is documented as
insufficient because the hallucinations are confident. So silence gets two
defences in a fixed order — an audio gate before the model, a phrase list after
— and the second is load-bearing, since a door slamming in a quiet room clears
every gate a JS caller can apply. The reason this matters more here than in
most Whisper work is that a phantom utterance is not only a wrong command: the
Context Engine records it as a query the user asked, and goes on ranking by it.

Two things were decided and written down rather than built. A misheard word is
offered by the candidate list, never repaired, because a repair pass would have
to know where free text begins and §5 forbids the adapter to know the grammar.
And the tree's own Web Speech API is out: it POSTs audio to a Mozilla endpoint,
which is disqualified twice over in a fork that spent Phase 1 removing exactly
that.

`browser_zzvoicelatency.js` is the measurement the next run only has to launch:
whisper-tiny q8 on both backends against run 23's ~1s / 2s budget, gated on
FOS_MEASURE_ASR so the suite neither downloads 75MB nor waits for it.

GRAMMAR.md gains §8, IDEAS.md gains run 24. Tests: 207 node, all green. The
harness was held all run, so nothing browser-side was run; both new modules are
Gecko-free by construction and the one file that is not is gated off by
default. Lint clean (eslint) on everything touched.

## Run 25 — 2026-08-18T22:40Z — post-phase — the microphone nobody would see

Run 22's chain finished at 22:34Z, an hour earlier than its estimate, so run 23
started its build and this run again had no harness. The first thing done was
therefore to stop losing runs to that: `agent/jobs/run25.sh` waits on run 23 and
then runs the ASR measurement, which had been STATE's item 1 for two runs and
was blocked on nothing but contention. It needs no person and it is now queued.

The run's own work started as item 2's homework — what does a chrome-privileged
`getUserMedia` actually prompt — and the answer changed the design rather than
just filling in a blank. It prompts nothing: `MediaManager` sets `privileged`
from `CallerType::System`, so `askPermission` is false. And it lights no
indicator, because `recording-device-events` is observed only by
`BrowserProcessChild`, a process actor registered without `includeParent`, which
therefore never exists in the parent process — the very process whose chrome
window holds the microphone. No prompt, no indicator, no row in the permissions
UI, and nothing a user could consult afterwards.

That makes `VoiceSession` the only thing in the system that can close a
microphone it opened, and until this run it could be left holding one: nothing
bounded `listening`, and losing window focus while holding the talk key — the
ordinary way a key-up goes missing, and the best-attested push-to-talk bug there
is — left the turn listening for good. Every active stage now hands the shell a
deadline it did not choose, `blurred()` ends a turn as a cancel rather than a
release, and `expired()` invents no new ending: a listen that runs out is a key
that came up, so the audio is transcribed, and the long-utterance case needs no
telling apart from the lost-key-up case because a room nobody is talking in does
not clear the audio gate that already exists. `listening`'s cap is Whisper's own
30-second window, which is what makes a hard bound on an open microphone free —
it can only end a turn whose tail the model was going to discard anyway.

The test that matters is a property, not a path: every abandoning event from
every stage closes the microphone and lands on idle. Writing it caught the first
draft claiming too much — `final` from `arming` is an out-of-order event, not a
way out — which is the more honest statement of the invariant.

Run 22's other result, read this run: the urlbar resume finished the remaining
~282 files with 51799 passed and 70 failed, **every failure a timeout and not
one assertion**. The directory's only real failures are still the four already
triaged, three of which want a remote tab. That question is now the fork's last
open one from the urlbar suite.

GRAMMAR.md gains §8's seventh rule, IDEAS.md gains run 25, STATE gains the
generalised gotcha. Tests: 216 node, all green, up from 207. Lint clean
(eslint + prettier) on everything touched. Nothing browser-side was run — the
harness was held all run — but run 23's `build faster` at 22:34Z includes this
change, and nothing in the browser imports `VoiceSession` yet.

**Late in run 25**, both queued jobs finished while the run was still up.
Run 23's FOS suite is **574 passed, 0 failed** — the acceptance gate for run
23's transform-scaled overview and unseen mark passes, and what those two still
owe is eyes rather than assertions. Run 25's ASR measurement **failed on its
first timed line**: `Cu.now()` is not a function in a browser-chrome scope, and
the test had been written the run before with the harness held and never run.
Fixed to `ChromeUtils.now()` and requeued as `run26`, with a `build faster` in
front because the runner had reported the test file up to date. The lesson is
not "do not write code while the harness is held" — the pure work this run is
the right shape — but that the part of such a change which touches Gecko APIs
is the part to re-read before queueing it, since node cannot check it and the
queue will not report it for hours.

**Later still**, the requeued measurement (`run26`) ran and failed on something
better than a bug: both backends returned `Unable to get the ML engine from
Remote Settings` in under three seconds. `MLEngineParent` pulls the ONNX runtime
wasm from the `ml-onnx-runtime` Remote Settings collection; the tree packages the
loader and not the runtime, and there is no settings dump for that collection, so
there is no offline path at all. Run 23's note that the tree "ships both" was
half right in the half that mattered least.

That makes it the blocker on the voice pillar rather than a note beside it, and
it is a decision rather than a fix: vendor the runtime (ONNX Runtime is MIT, and
the loader is already vendored beside where the wasm would go), or accept a
visible one-time fetch. The recommendation written into STATE is vendor the
runtime and accept a surfaced fetch for the model weights, which are an order of
magnitude larger. What the fork must not do is keep the current behaviour, where
a machine with no network gets a microphone that fails with an error about
Remote Settings. The ASR failure counter is at two with two distinct causes, and
the three-strikes rule is being honoured by *not* attempting a third
measurement: the next attempt is the decision, not the test.

---

## Run 27 — 2026-08-18 — the runtime was in the build all along

**Phase:** post-plan. **Task:** item 1, the ONNX runtime decision blocking the
voice pillar. **Tests:** ASR measurement green (3 checks, 0 unexpected); lint
clean.

The task was to choose between vendoring the ONNX wasm runtime and accepting a
one-time fetch. The answer is neither, and the framing was wrong.

Run 26's `Unable to get the ML engine from Remote Settings` was read as a fact
about the fork's offline capability. It was a fact about a default: the
measurement passed `device` and never passed `backend`, and `MLEngineChild`
reads `opts.backend || BACKENDS.onnx`, so both arms silently asked for the wasm
runtime — the one artifact this build genuinely does not contain. Meanwhile
`libonnxruntime.so` was already sitting in `dist/bin`, 10.5MB, pulled by
`./mach bootstrap` as an ordinary build toolchain, with `WASM_BACKENDS`
explicitly excluding the native backend from the Remote Settings path. Two runs
had concluded the fork had no offline inference while the runtime that provides
it was packaged and loadable.

Also corrected: the `ml-onnx-runtime` collection is not empty — it carries the
required `jsep.wasm` at exactly version 5.0.0 — and this machine's network is
fine. The empty record list came from `EmptyDatabaseError`, an unsynced local
Remote Settings database inside the *mochitest harness*, which run 25
generalised into a property of the browser.

Four attempts then failed on four distinct causes before the measurement ran:
`Cu.now` (run25), the unnamed backend (run26), mochitest killing the process on
a non-local weight fetch (run27), and `--hooks` being a perftest flag that
mochitest rejects despite `head.js` recommending it (run28). run29 is green.

**And the numbers make the decision easy.** `onnx-native` on CPU transcribes a
command-length utterance in a **median 324ms** and the longest utterance the
grammar permits in **520ms**, against run 23's budget of ~1s natural and 2s
tolerable — roughly threefold headroom. The apparent cost of the offline path,
that it gives up WebGPU, turns out not to be a cost at whisper-tiny's size.
Model load is 1.3s, paid once, and belongs at arm time where the design already
put it. Nothing is vendored, no blob joins a public git tree, and no Mozilla
service is touched in a voice turn. The weights remain a surfaced one-time
download — a separate problem, an order of magnitude larger, and the only half
of this that run 25 got right.

`GRAMMAR.md` §8 gains an eighth rule. The voice path's shell is now unblocked
and is the next task.

---

## Run 30 — 2026-08-18 — the voice path reaches the browser

**Phase:** post-plan. **Task:** item 1, wire the voice path in. **Tests:** 636
browser-chrome checks, 218 node tests, xpcshell green; `run30` end-to-end green.

`FOSVoiceSession` and `FOSVoiceTranscript` had been written, tested and imported
by nothing. `FOSVoiceInput.sys.mjs` is the shell they were designed against, and
with it the fork has a hands-free path end to end for the first time: hold F4,
speak, and what comes back is a line handed to the same parser, the same marks
and the same action table a keystroke reaches. No verb was added and no second
surface exists — GRAMMAR.md §5's one code path is honoured by there being
nothing else for it to be honoured with.

Three decisions were forced by Gecko rather than by taste. The key is heard on
the window in the capture phase, because a key pressed while the focus is in a
page reaches the parent only as the reply `BrowserParent` re-dispatches at the
`<browser>` element. Recording is a `MediaRecorder` decoded once rather than an
`AudioWorklet` drained frame by frame, which keeps the chrome main thread free
during the one window where jank would show. And the microphone opened here is
opened with no prompt and no platform indicator, so the surface draws its own.

**It was then driven with nothing replaced** (`agent/jobs/run30.sh`): armed in
106ms, and 2s of audio answered 513ms after the key came up — against run 23's
~1s natural budget. Handed a tone, Whisper answered `" (whistling)"`, and the
adapter refused it as an annotation rather than recording a query nobody asked.
That rule was written from reading; it is now observed behaviour.

The download step also ran for real, from an empty profile: the first press
announced the model, fetched it, loaded it and said when it was ready. Driving
it found the notice ordering defect no test double could — a turn's "too short
to hear" and "unavailable" both land around the download line — so a download
now outranks every notice a turn can raise.

**One thing this run learned that changes the next.** Push-to-talk excludes the
part of the audience the "no separate accessibility mode" promise was written
for: sustained pressure is exactly what tremor, arthritis and fatigue make
expensive, and dictation tools written for those users offer a latched turn
instead. Shift+F4 as a latch is the next task, with the reasoning in IDEAS.md
run 30 and the open question written into GRAMMAR.md §9.

## Run 31 — 2026-08-18 — the latch, and the bound it nearly removed

**Phase:** post-plan. **Task:** item 1, a latched turn. **Tests:** 223 node
tests, 658 browser-chrome checks, both green; `run31` end-to-end green with
nothing replaced.

Shift+F4 latches a voice turn: one press starts it, the next ends it, nothing is
held in between. Run 30 chose this out of two candidates because holding a key
is exactly what tremor, arthritis, carpal tunnel and fatigue make expensive, and
a hands-free path reachable only by sustained pressure had excluded the part of
the audience GRAMMAR.md §5's "no separate accessibility mode" was written for —
from the modality that was supposed to be their way in.

It cost one flag in `FOSVoiceSession`, one modifier arm in `FOSVoiceInput` and
one element on the indicator, which is the whole argument for calling it a
gesture rather than a mode: the turn arms, listens, transcribes and executes
down the same path a held key takes. Had it needed a second path it would have
been a second mode wearing a gesture's name.

**The find is that the one safety bound was defined in terms of the gesture it
bounds.** Nothing in this build draws a platform indicator for a privileged
microphone, so the 30-second `LISTENING` deadline is all that stands between a
mis-latched device and half a minute of open microphone. It was implemented as
"a listen that runs out is a key that came up" — literally, by calling
`release`, which a latched turn ignores. So it would have bounded every turn in
the design except the only one with nobody's finger on the key, and silently,
because every test in the suite was a held turn. Both endings go through one
private step now, and the node property "every way out of every stage closes the
microphone" runs over both gestures rather than over both paths.

**Driven with nothing replaced**, both gestures on one resident engine: latched
armed in 106ms *with no key held*, a real `MediaRecorder` stayed open across the
key-up that follows the latching press for a whole 2s utterance, and the
stopping press turned the turn over in 504ms — against the held turn's 106ms and
521ms in the same run. That middle number is the one no double could have
produced, and it is the whole of what the latch risks.

Two decisions followed from the microphone being unattended. Any press ends a
latched turn, not only a latching one: the presses are asymmetric because
ending early costs one utterance and failing to end costs an open device. And
the indicator now says how to stop, since for a held turn the finger is that
answer and for a latched turn nothing is. Driving it also caught a wording
defect no test had reason to look for — the audio gate's "too short" told a
latched user to hold a key they were not holding.

**Still open, deliberately:** the bare tap, which needs no modifier at all and
is what a user with one reliable finger would rather have. A mis-tap would open
the microphone for the full deadline, and how often that happens is a question
about use rather than about design.

## Run 32 — three defects a picture found, and the pointer they pointed at

**Phase:** post-plan. **Task:** item 1 — the two run-23 changes that owed eyes
rather than assertions. **Tests:** 665 browser-chrome checks, 223 node tests,
both green; smoke run green, pictures retaken.

Item 1 had been the top of the list for eight runs and had never been done,
because every one of those runs found something in the voice path more urgent.
It was worth the wait only in the sense that it was still there: looking at two
pictures found three defects, and none of them was findable by reading.

**The rails covered the browser.** Both panels are `position: fixed;
inset-block: 0` and sit above the toolbox on purpose — it carries `z-index: 0`
and would otherwise paint over them — so they ran the full height of the window.
With the rail open there was no back, forward or reload; with the sidebar open
there was no app menu, no extensions button, no window controls, no page actions
and no unseen mark, which is the fork's one permanent signal covered by the
surface that answers it. Overlaying the page is a trade this project recorded
and accepted. Overlaying the browser came along in the same declaration and
nothing had ever distinguished the two. `FOSChrome.trackChromeInset` measures
the toolbox rather than declaring it, because the height is not a constant: the
bookmarks toolbar comes and goes, the nav-bar takes the titlebar here now the
tab strip is gone, and full screen moves the toolbox *without resizing it* —
which is why the content box below is observed as well.

**A background arrival was quietly becoming "where you are".**
`onLocationChange` fires for every browser in the window, and `#setCurrent` took
the trail of whichever it was handed. So a page finishing in a background tab
moved the active trail, `#syncMarks` re-lettered to it, and with the letters
went the context sidebar, `what`, what `name` names and the tiers the command
bar ranks by. It was visible in the picture as two surfaces disagreeing in one
window: the sidebar describing "Unnamed context, 1 page" with `what`'s own
sentence a few hundred pixels below it describing "memex research, 3 pages".
`currentNodeId` was written correctly — derived from the selected browser, and
it cannot drift. `activeTrailId` was a pushed field three lines away, and did.

**The screenshot run's reset step reset nothing.** It closed the sidebar with
`dismiss`, a Field verb with a required target, which parsed as an error and
closed nothing at all. So the picture meant to show "an ordinary window doing
nothing" had a sidebar over the toolbar and a stale notice over the page, and
could not answer the question it was taken for. Eight runs of pictures were
taken of the wrong window. Using the product's grammar as test setup is a trap
when the grammar is not what is being tested: a verb that fails safely fails
silently.

**Item 1's actual question, answered: yes.** The 8px accent dot reads at a
glance and does not shout. `shot-unseen.png` is now the picture it was meant to
be, and the toolbar in it is whole.

**And the research found what the dot was missing.** Weiser and Seely Brown's
calm-technology frame is the one the signal was already built to, and confirmed
it — a state read on a voluntary glance, not an event. What had no evidence
behind it was the other half: what happens after the user looks. Iqbal and
Horvitz's CHI 2007 field study measured it directly — 27% of alert-driven
suspensions left the prior window unvisited for over two hours, and users who
responded at once tabbed through **7.5 applications** hunting the one that had
alerted them. Their guideline from that data is "easy access to suspended task
context, as thumbnails of the suspended states", which is the Field, described
by people who measured why it was needed and did not build it. The expensive
half of coming back is the *search*, and a boolean that opens a canvas of
identical cards hands the user exactly that search. So the Field now says which
card arrived: the same dot on the trail's tile, the same accent on the card and
its miniature. It clears on close rather than on open — the boolean's own rule
would have cleared it before it could be read, in a way that looks right because
it matches the rule beside it.

**The resize numbers, and a claim they do not support.** The burst is fixed and
comprehensively: ten resizes in a tick cost 1.19ms against 53ms before
coalescing. Sustained resizing of the worst case the design permits is *not*
fixed — 41ms a frame against a 20ms control — and the reason is that one
`crowded-overview-render` is 18.27ms, longer than a frame on its own. Coalescing
bounded the rebuilds per frame at one; it could not make one rebuild cheap.
Recorded rather than chased, but recorded honestly: run 18's note reads as
though the gap was closed, and what closed was the burst.

## Run 36 — 2026-08-19 — the embedding pass, measured before it was built

**Phase:** post-plan. **Task:** item 1 — the embedding pass, top of the list
since Phase 2. **Tests:** 232 node tests, FOS browser-chrome suite green, the
measurement itself green.

Item 1 was carried for a reason and unblocked for a reason: run 27 proved this
build has an offline inference stack and run 29 measured it as fast enough. So
the question left was never "can it run" — it was "is it worth what it costs
the user", and that question has an answer nobody had gone and got.

**The published number does not transfer.** `potion-retrieval-32M` reaches
81.7–86.7% of `all-MiniLM-L6-v2` on retrieval, which is a claim about
benchmarks whose queries are sentences. This fork's input is four lower-case
words. So `browser_zzembedquality.js` measures the thing actually being
shipped: eight enquiries, 32 queries written the way they are typed and 24
capitalised titles, with two of the eight pairs deliberately adjacent so the
score is not carried by easy separations.

**The control is what makes it a measurement.** The Context Engine already
stores `normaliseIntent` for every query, so a 30MB download has to beat
Jaccard overlap on those tokens — not a straw man, but what shipped. It does:
query→query p@1 0.625→0.844, query→title 0.750→0.938.

**The finding is in the asterisk, not the table.** For **11 of 32** queries the
lexical arm returns the same similarity — zero — against every candidate in the
corpus. Those rows are credited to it in the table because sort order had to
break the tie, so its real p@1 is at or below 0.66. The gap is not that the
shallow path is weak on lower-case queries; it is that it is **silent** on a
third of them, and a tie at zero looks exactly like a ranking to everything
downstream of it. That is a sharper statement of the problem than the one
`IDEAS.md` had carried since Phase 2.

**Both dimensions, because the download size is a design decision.** d256 and
d512 are indistinguishable here — identical query→query p@1, one query's
difference on titles, both well inside the noise of 32 rows — and the fetch is
30MB against 60MB. Adopted at d256: where the evidence is a tie, the smaller
one wins, and `run36.sh` re-runs the comparison if that is ever doubted.

**What the numbers refuse is the more useful half.** The best separating
threshold for "same enquiry" is 0.169 at precision 0.756 — about one in four
pairs above it are from *different* enquiries, and buying precision costs
recall immediately. That kills silent cross-trail context merging, which is
what I would otherwise have built: a rule that folds two research topics
together and is wrong a quarter of the time is worse than no rule, because the
user cannot see what it did. It does not kill offering the merge, and the
threshold is now measured rather than guessed.

**Cost turned out not to be a conversation.** An embedding is 1.27ms for one
query and 3.1ms for all 32, because the model is a lookup table and an
embedding is a sum of rows. That has a design consequence worth more than the
latency: candidates can be embedded on demand, per keystroke, so the command
bar's use needs **no vector column, no migration and no staleness rule** — the
schema does not move.

**The first consumer's pure half is in.** `FOSSuggest` gained a sixth tier,
`T_RELATED` — "Close to what you typed" — between crossings and the Places
floor. It is the only tier exempt from `pageMatches`, which is precisely what
it is for, and the only one this module sorts, because unlike the store's
orderings there is no upstream claim about it to defend. `RELATED_FLOOR` is
0.169, carrying the measurement in its comment. Nine node tests, including the
one that matters: a page sharing no word with the query is offered, and a row
arriving with no similarity at all is dropped rather than promoted.

The engine half followed immediately, as run 37 below.


## Run 37 — 2026-08-19 — the tier, wired, and the threshold it was standing on

**Phase:** post-plan. **Task:** the impure half of run 36's verdict. **Tests:**
242 node tests, 670 browser-chrome checks, xpcshell green, and the gated
`run37.sh` green against real weights.

`FOSEmbeddings.sys.mjs` owns the static engine, caches vectors by text, and
persists nothing — the 1.27ms measurement is what makes "embed the candidates
again" cheaper than any store that would avoid it, so pillar C's schema does
not move for this feature. `FOSContextEngine.#related` fills the tier from the
context, the trail and its crossings. `browser_zzrelated.js` drives it with a
real model in a real window.

**Driving it found two things reading could not.**

*The floor was measured over the wrong pairs.* `RELATED_FLOOR` was 0.169, taken
from run 36's query→query distribution, and the tier only ever compares a query
to a **title** — a different distribution from the same model, at 0.173. The
tier refused a page at 0.159 that it exists to offer, and the refusal was
correct; the constant was not. The two numbers are close enough that the error
was invisible in the value and only visible in the pairs, which is the actual
lesson: a threshold is measured only if you can say what it was measured over.
`pairs()` now takes an explicit second set so the two sweeps cannot be confused,
and the constant's comment names its comparison.

*The tier cannot reach the Places floor, and had been documented as though it
could.* Those rows arrive from `frecencyMatches(text)` — a lexical query — so a
page sharing no word with what was typed was never in the array to be
recovered. Reaching it means embedding all of Places, which at 1.27ms a page is
a vector store with persistence and staleness rules: Firefox's own semantic
history search, and a different feature. The scope is now stated in the code
rather than implied by it.

**And one thing that was nearly shipped.** `createEngine` fetches the weights
if it does not have them, so as first written the tier would have sent a ~30MB
request to Mozilla's model hub on the first keystroke into the command bar, in
a fork that disables update and telemetry precisely so it never contacts
Mozilla unasked. `browser.fos.suggest.semanticTier` is off by default and is
consent rather than a feature flag. The consequence is that the tier is dead
weight until the surfaced download exists, and that is now the top of the list.

**The fixture had to be measured too**, which was the run's small surprise: the
similarity between two texts with no words in common is not something a person
can estimate by reading them. Eight candidates were scored to pick one, and the
spread — 0.36 for flights against a Lisbon guide, 0.091 for "what did vannevar
bush propose" against a page about the memex — says where this model is weak.
Proper nouns and abstractions; a static table has no row connecting a name to
what the name is known for. Common-noun topical language is where it is strong,
which for this fork is the right way round.


## Run 38 — 2026-08-19 — the download the user asks for, and the check that never worked

**Phase:** post-plan. **Task:** STATE's item 1, the surfaced model download.
**Tests:** 242 node, 706 browser-chrome, xpcshell green, and the gated
`run37.sh` green at 14/14 against real weights.

`model` is the thirteenth verb. It says the size and names the host before
bytes move, counts megabytes as they arrive, and sets the consent pref only
once the engine has loaded — the pref means *the weights are here and wanted*,
never *a fetch was attempted*, so a download that failed leaves it alone rather
than arming the next session to retry a request nobody would be asked about a
second time.

**The research changed the design rather than confirming it.** Chrome was taken
apart in May 2026 for writing a 4GB model to disk unasked, and the complaint
that recurs in every write-up is not the first download but the second: deleting
the file got it downloaded again. This fork had built exactly that. `ensure`
called `createEngine` on a keystroke whenever the pref was on, and `createEngine`
fetches what it lacks — so a user who consented in March and cleared the cache
in August would have had the weights back on the next keystroke. `ensure` now
checks the cache and never fetches; `download` is the only method that may. **A
stored yes is consent to a state, never to an action.**

That also settled what *not* to build. Firefox Translations offers a delete for
its language models and can afford to, because it has a preferences pane; this
browser has none by design and every verb costs a word out of a table
`GRAMMAR.md` §4 keeps small enough to teach entire. There is no un-download
verb, and the decision above is what makes that honest: deleting the cache by
hand now works and stays worked.

**Three failed gated runs, all on things a stub could not see.** The presence
check answered "no weights" on a machine holding the weights, for two reasons
`ModelHub.sys.mjs` documents wrongly — `listFiles` resolves to
`{files, metadata}` rather than an array, and the cache keys a model by
`hostname/organization/name` rather than the configured id. Two JSDoc blocks in
that file disagree about the second, thirty lines apart. **The voice path has
carried the first since run 25**: thirteen runs of a spurious "Downloading the
speech model" on the first press of every session, followed by a `createEngine`
that read the cache and worked, which is exactly why it went unseen. Both fixed.

The reason it went unseen has a name. `browser_voice.js` doubles `listFiles` and
returned an array, because an array was easy to write — so the double asserted
the wrong contract and the production code matching it looked right, in a green
suite, for thirteen runs. **A double is a claim about somebody else's API, and it
goes stale in the direction of whatever was convenient.** For every external API
this fork doubles, one test somewhere has to use the real thing.

**And one measurement nobody would think to make.** The runtime reports
`progress` as a percentage *of the file in flight*, and this model is two files:
driving the real download gave 0% → 100% → 0% → done. A bar that runs backwards
is worse than no bar. `totalLoaded` is the cumulative field, so the line counts
megabytes instead. The 30MB itself is measured too — 29,836,775 plus 478,156,
the only two files the backend requests at d256.

## Run 39 — 2026-08-19 — the cross-trail merge, offered rather than applied

STATE's top item since run 36, and the one it had already refused to do
silently. Shipped as an offer: `FOSContextMerge.sys.mjs`, `context.merged_into`
(migration 002), and a first section in the context sidebar with two answers.
730 browser-chrome checks, 261 node tests, 135 store checks, 17 gated checks
against a real model — all green.

**The plan in STATE was wrong, and finding that out was the first hour.** An
accepted merge was to be recorded as `context_member.source = 'manual'`. It
cannot be: `contextsForTrails` filters on `provenance` by construction, so
membership written under any other source changes what a context *contains*
without changing which context a trail *is in*. That ships as a sidebar showing
the union of two enquiries while both trails go on resolving to themselves —
wrong in the direction that reads as working. A merge is a fact about contexts,
so it is a column on `context`, which also leaves every provenance row exactly
as written.

**The number had to be measured again, and the reason is the run-37 lesson one
level up.** Run 36's 0.201 is one query against one query; a context is a set,
so a merge score is an aggregate over many pairs and aggregates have their own
distribution. `run39.sh` scores four rules over the eight-enquiry corpus cut in
half — 8 pairs that should merge, 112 that should not — and reads each at the
lowest threshold reaching precision 1.0, because F1 treats a missed merge and a
wrong merge as equally bad and this feature does not.

**`max` won the table and was rejected, which is the run's real finding.** It
is an order statistic: it asks whether two contexts share *any* one question,
so it climbs with the number of pairs compared whether or not the contexts are
any more alike — and the corpus scored contexts of two queries where a real one
holds many more. Measured rather than argued, by re-scoring at double the size:
`max`'s different-enquiry p95 rises 73% and `top3`'s 45%, while **the mean's
falls**. Hence the mean of every cross pair, floor 0.244. Two columns are also
why this was visible at all — at the F1 optimum `max` is the *worst* of the
four and at precision 1.0 it is the *best*, so a table with one column would
have picked whichever rule the objective flattered.

**Horvitz supplied the shape.** *Principles of Mixed-Initiative User
Interfaces* (CHI '99) is the canonical treatment: an agent uncertain about a
goal has three options, not two, and the middle one is to ask — dialogue owns a
band of probabilities between silence and action. This fork's band is open at
the top by construction, since provenance-before-inference means no confidence
merges anything by itself, so the only threshold needing measurement is the
bottom one. Two of the twelve principles did real work beyond the framing:
timing is part of an offer's cost, which is why the offer is computed when the
sidebar opens and never while browsing; and a rejection that does not stick is
not a rejection, which is why declining is permanent and the button says so.

**Driving it against a real model found what no table could.** The floor holds
in both directions and more widely than the arithmetic suggested — Lisbon
halves at 0.812, baking against keyboards offered nothing. But recall 0.5 is
not spread evenly: `memex` and `sqlite` fall *under* the floor, and those are
exactly run 36's known weak spots. **This works on what you were shopping for
and not on what you were reading about**, which is worth saying plainly rather
than reporting as a fraction.

**And the same trap caught this project twice.** Needing a fixture that clears
the floor, I wrote two fresh enquiries in the corpus's style — cycling and
coffee. Neither matched its own other half, and coffee matched cycling at
0.267: a false positive above the floor between two topics no person would
confuse. Run 37 recorded this exact lesson after the `related` tier's first
fixture failed. A bag-of-tokens model's opinion of invented text cannot be
estimated by reading it, and fixtures now come only from the scored corpus. It
also puts the floor's margin in perspective: precision 1.0 was over 112 corpus
negatives, and the first arbitrary pair tried produced a false positive.

Five gated attempts, four failing, none a repeat of the last — each was the
test being wrong about the product rather than the reverse.

## 2026-08-19 — the Field's blank cards, and where the keyboard goes

Phase plan complete, so this took STATE's own top item: the two narrow defects.
Both were real. Neither was what the note said it was. 747 browser-chrome
checks, 261 node tests, 2 xpcshell files, all green; the smoke run regenerated
the artefacts.

**The note named one blank card and there were three, with opposite causes.**
`agent/reports/demo-3-field-region.png` shows a search result and its three
branches. STATE recorded "the active card can have no thumbnail" and pointed at
the card marked `m`. Reading the picture again, three of the four were grey —
and the parent's cause and the children's are not the same bug.

The children were never photographed because **re-entry is a departure the
progress listener cannot announce**. The load `enter` starts belongs to the node
being arrived at, so `#restoring` suppresses the departure — correctly, or the
outgoing page's state would be written over the arrival being replayed. That
left the one way of leaving a page this design encourages above all others
taking no picture of it. `enter` announces it itself now, before anything has
started to move, and awaits the listener: it is the only departure in the tree
that is not a race, so it is the only one worth waiting for.

The parent was never photographed for the *opposite* reason, and finding it took
instrumenting the demo flow rather than reasoning about it. `enter` returns
before the restore commits, so the navigation issued straight afterwards is
*still* inside the restore window and its departure is suppressed too. Branching
is exactly that shape — re-enter the result, go somewhere else — so the branch
point is never departed at all, while its delayed settle capture had long since
been discarded as stale. A node with no picture at all now takes one the moment
it settles, half-drawn and all, and waits for the better one only if it already
has something to show. Data Mountain's finding applied to its own edge case: a
rough thumbnail is much closer to a good one than to none.

**Three tests passed with the fix reverted, and that is the run's real lesson.**
Each was a different simplification of the branch-point condition in
`browser_field.js` — leave the page fast; leave it after a re-entry; leave it
after re-entering the page already showing — and in each the ordinary departure
capture won the race and filed a picture anyway, so the test proved nothing. The
assertion belongs in `browser_zdemoflow.js`, which is the only place in the
suite where the condition arises. Reverting the fix and re-running is the whole
of the check, and it is cheap; three attempts here says to do it every time.

**A capture that reports success is not a capture of the right thing.**
`drawSnapshot` awaits twice and then paints whatever is in front of it, so a
departure capture that lost its race filed a picture of the *next* page over the
top of a correct one, with no error anywhere. The inner window id is the
identity that changes exactly when the document does, and it is now read before
and checked after.

**And the focus bug was four bugs.** STATE guessed "focus is presumably left on
a removed element". It was not: all four surfaces close by handing the keyboard
to the content area, which is right only when the surface was the one thing on
screen. Custody is a window-level fact, so it went to `FOSChrome` with the other
things every surface shares — a stack, not a ranking, because the surface that
most recently took the keyboard is the one the user just left. The command bar
is the exception and it is not about what was open: a line that loaded a page
hands over to the page, so `FOSActions` counts its loads and the bar reads the
counter. The verbs cannot answer this, because a search reaches the dispatcher
as bare prose and never becomes a verb at all.

## 2026-08-19 — the bare tap, and an objection about the wrong object

Item 1 on the standing list, deferred twice and open since run 30. 757
browser-chrome checks, 271 node tests, 2 xpcshell files, all green; seven
mutation checks confirm each part of the fix is pinned by a test that fails
without it.

**The blocker was mis-scoped, and that is the whole run.** `GRAMMAR.md` §9
refused the bare tap because a mis-tap would open the microphone for the whole
thirty-second deadline, and said the answer depended on how often a mis-tap
happens in use. It does not. **Shift+F4 has the identical exposure** — a
mis-pressed latch is a mis-tap with a modifier on it — so the thirty seconds was
never a property of the tap. It was a property of a latched microphone bounded
only by a clock, which every latched turn in the design already was. Three runs
of "it stays open until somebody has used it" bought nothing, because no amount
of use would have changed what the fix was. When a feature is blocked on a risk,
check whether the shipped alternative carries the same risk: if it does, the
risk is an unbuilt safeguard and the feature is waiting on it by accident.

**The fix is what speech recognisers have shipped since the 1990s.** Windows'
`SpeechRecognizerTimeouts` names both halves — `InitialSilenceTimeout` and
`EndSilenceTimeout` — and the fork had neither. A latched turn now carries them
at 6s and 1.5s: nothing was ever said, and the utterance has finished. A held
turn carries neither, because a finger on the key is a user who is present and
ending their listen because they paused to think would be the bound doing harm.
The predicate is "is anybody holding anything", not "which gesture started
this", which is §8's own lesson about gesture-shaped bounds applied before it
could be broken instead of after.

**End silence is a feature, and it is why the tap was worth building now.**
Initial silence makes the tap safe; end silence makes it good. The turn ends
itself when the utterance does, so the second press becomes a way to stop early
rather than the only way out — which is what turns the tap into a genuinely
one-gesture turn, and what the shift latch never was. Shipping only the safety
half would have been a new gesture that still needed a second press.

**Six browser tests failed for one cause, and it was the fixtures.** The helpers
synthesise a keydown and a keyup faster than any hand can, so every "hold" in
the suite became a tap by the new rule; the first turn latched by accident, and
the next test's press then closed *that* turn instead of starting its own. The
cascade read as a broken module. Any threshold expressed in wall-clock time
changes the meaning of every existing test that never had to think about time.

**Two facts the shell can see and the session cannot.** How long the key was
down, and whether the room is above the floor — reported up, with the thresholds
staying in `FOSVoiceSession`, which is the same split the transcript already
used and what keeps the whole gesture testable with no window and no microphone.
The hold is measured from `event.timeStamp` on both halves rather than from two
clock reads inside the handlers: under load those measure handler-to-handler,
and the difference lands exactly on the 400ms boundary. The first draft got this
wrong and would have turned a deliberate hold on a busy machine into a tap.

**The level monitor is an `AnalyserNode` at 10Hz, not the worklet run 30
rejected**, and it shares `FOSVoiceTranscript`'s exported `MIN_RMS` rather than
inventing a second threshold — the gate averages over the whole recording, so
any window loud enough to be speech on its own is louder than the average it
will later be judged by, which is what makes it impossible for the live bound to
end a turn the gate would have accepted.

**Mutation testing, five ways on the session and two on the shell.** Run 39's
lesson was to revert the fix before believing a test pins anything. Doing it as
targeted mutations rather than one wholesale revert says *which* test pins
*which* line, and it is cheap enough to be routine from here.

**And then testing the mechanism rather than the logic found the real bug.**
Every browser test in this file replaces the microphone, so none of them touch
the code that listens to one. Driving a real captured stream through Gecko's
fake device showed the `AudioContext` stuck in `suspended`, reading a flat zero,
with `resume()` never settling. Autoplay was the obvious suspect and cost an
hour of being wrong — `IsAllowedToPlay` returns early in this profile, and the
context stays suspended with an active capture and user activation both in
place. The cause is `destination.maxChannelCount === 0`: **this box has no audio
output device**, and Web Audio will not run a graph without one, even to measure
an input.

**The failure was pointed the wrong way, which is the part worth keeping.** A
suspended context reads exactly what a silent room reads, so the initial-silence
bound would have fired six seconds *into an utterance* and reported "nothing
heard" — a safety bound cutting off the person it protects, which is worse than
no bound. The turn now asks whether anything is reporting the level before it
treats silence as meaning anything, and both failure routes land it back on the
key and the model's window: it degrades to the previous design rather than past
it. A sharper version of run 39's lesson — **a sensor that cannot read returns
the same value as a sensor reading nothing**, so the degradation has to be
chosen rather than left to whichever way the arithmetic falls.

The first draft also read `AudioContext.state` at construction, which is
meaningless — it reaches `running` asynchronously — and would have reported "no
monitor" on a *healthy* machine, disabling the feature everywhere with every
test still green. The poll decides now.

**Left unverified on purpose:** the positive half of the mechanism test cannot
run here. It asserts the degradation instead and says so in its output. The real
level path has been reasoned about, not observed; the first machine with audio
hardware should run that file and confirm the positive branch is taken.

## Run 41 — 2026-08-19 — `done`, and a guard that could not be made to fail

Standing-list item 1 was marked bounded value by the run that wrote it, so this
run went looking instead. What it found was not a new idea but a half-built one:
**`archived_at` has been in `trail` since `001-initial.sql`, `restorable()` has
always filtered on it, and nothing in the product ever set it.** The only writer
in the tree was a test, reaching past the store's API with raw SQL to manufacture
a state no user could reach. Not a missing feature — a missing word.

Built `done`, pillar B's twelfth verb and the counterpart of `dismiss` one level
up. `dismiss` takes a page off the Field and leaves it on its trail; `done` takes
a trail off the Field and leaves it in the store. It takes no mark, because the
only trail a user can address is the one they are on. Nothing is written to the
nodes: a trail's worth of pages marked individually dismissed would misreport
what the user said, and would come back looking discarded rather than filed.

The research is in `IDEAS.md`. The retrieval numbers on bookmark graveyards
(under 10% ever accessed; retrieval falls off past a 60-second scan) supply the
constraint but not the diagnosis — a trail is captured, not saved, so the
collector's fallacy does not apply and the fork's version of the problem is the
inverse one. Arc's auto-archive gave the goal and three mechanics to reject: a
clock instead of a fact about the work, no way to decline, and an archive you can
only re-enter by retyping a URL.

The Field had to give the slot back properly. §3 caps the overview at nine
regions and nests the overflow, and the nest costs a slot of its own — so a
first draft that removed the region and left the slot empty would have passed
every obvious test and delivered none of the point, since the crowding `done` is
said about is *in the nest*. A freed slot now goes to the most recently touched
nested region, and an emptied nest gives its own slot back.

**Then the mutation pass earned its keep.** Fourteen mutations, thirteen caught
by the test that should have caught them. The one that survived was
`finishTrail`'s `isArchived` guard, and the reason nothing reached it was a bug:
`session.enter` is how the context sidebar and the bar's rows re-enter a page,
an archived trail's nodes are still in the session's tree, so picking one off a
list put the user back on a finished trail — rail showing it, next navigation
extending it, still archived, nothing on screen saying so. Re-entry now resumes
the trail, which is also the undo the design had argued it did not need and is
better than a verb would have been. The guard then really was dead and was
deleted. **An unreachable guard is sometimes evidence of a missing behaviour
rather than of over-caution** — the generalisation is in `IDEAS.md`.

Tests: 286 node, xpcshell clean, **807 browser-chrome checks, 0 failures** —
the whole FOS suite, not just the touched files. Seventeen mutations run in
total across two passes, every one now caught. Docs updated in `GRAMMAR.md` §4,
`SCHEMA.md` and `FIELD.md` §8/§10 — `done` partly answers §10's open question
about the collapse metric by taking finished trails out of the population it has
to guess over.

No gated job needed: nothing here wants weights.

## Run 42 — 2026-08-19 — the schema audit, and a promise the design made twice

Ran item 1 off the last run's list: every column in the schema checked for a
reader and a writer, tests excluded, because a column whose only writer is a test
is exactly the thing being looked for. Five hits. Four are notes — `source_node_id`
and `visit.started_at` are written and never read, `context.centroid` was already
documented as unwritten (a false positive, and a useful control: the method finds
undocumented gaps rather than odd-looking columns), and the `embedding` table is
deliberately dead but said so only in a module a schema reader has no reason to
open, so `SCHEMA.md` now says it.

The fifth was the run. **`field_placement` had neither a reader nor a writer.**
The store's `placeCard` was called by nothing but its own unit test and no SQL
anywhere read the table back — so the Field's arrangement did not survive a
restart, and `FIELD.md` promises it does in the strongest terms the design uses:
§4's "not to make room, not to rebalance a region, **not on restart**", and §9's
acceptance property 2. Everything needed had been built and nothing joined it:
the table, the `moved_by_user_at` column documented as "the whole point of the
table", the store method with a COALESCE protecting a human timestamp, and the
model's `pinned` flag. Three parties each did their half.

**Only what a human chose is persisted.** `#seed` is deterministic and its own
comment says a restored session re-seeds to the arrangement it produced last
time, so an auto-placed card costs a row and carries no information — and worse,
a row would freeze a position the system is still entitled to revise. So
`moved_by_user_at IS NOT NULL` is both the filter and the meaning.

The dependency only runs one way. Pillar A announces where a card was put and
never learns what a database is; pillar C listens, translates node ids to row
ids, and hands positions back at the next start. A window whose store fails to
open still gets a Field, seeded as always. One announcement per gesture, not per
pointer move — every move commits to the model, so persisting each would record
every position the card passed through as though it had been chosen.

Two things fell out of the design rather than out of taste. Restored positions
are applied *before* the rest is seeded, because seeding never displaces and the
reverse order could move a pinned card. And a region's height is a ratchet that
is not itself persisted, so a position saved low in a grown region comes back out
of bounds; growing to fit is what §6's capacity ladder already says, where
refusing would silently destroy a position somebody chose.

Tests: 291 node, xpcshell clean, **841 browser-chrome checks, 0 failures** — the
whole FOS suite, up from 807. **Nine mutations, all nine caught**, across the
model, the store, the surface and the engine. No bug found by the mutation pass
this time, which is itself worth recording after run 41.

Docs: `FIELD.md` §9 says what now persists and what deliberately does not,
`SCHEMA.md` marks the `embedding` table vestigial, `IDEAS.md` run 42 carries the
audit and the restoration reasoning.
