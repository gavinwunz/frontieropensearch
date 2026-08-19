# Command grammar

The specification for the single entry surface: one command bar handling search,
URL entry, commands, trail-jump and context-switch, driven identically by
keyboard or by voice.

Data-layer decisions live in `context-engine/SCHEMA.md`. The research and the
verdicts behind everything here are in `agent/IDEAS.md` — this file is the
design that follows from them, not the argument for it.

---

## 1. The problem this solves

The brief asks that every action reachable by keyboard also be reachable
hands-free, with no separate accessibility mode. Nearly all of the difficulty in
that sentence is in one place, and it is not the verbs.

A keyboard user names a target by pointing at it or by typing part of its title.
Neither is available hands-free. So the binding constraint is **how the user
names the thing they mean** — and if that is solved separately for voice, we
have built the separate mode the brief forbids.

Marks solve it once, for both.

## 2. Marks

**Every addressable object carries a mark: one letter, displayed, spoken as a
word.**

Addressable objects are Field cards, trail nodes, contexts, and in-page links
when link mode is active.

The letter and the word are the same mark in two modalities:

| | keyboard | voice |
|---|---|---|
| target the card marked `c` | type `c` | say "cap" |

The word list is Talon's monosyllabic alphabet, which exists because its author
optimised it for recognition accuracy and speed under exactly this load, and
which maps one word to each letter a–z:

```
a air    b bat    c cap    d drum   e each   f fine   g gust
h harp   i sit    j jury   k crunch l look   m made   n near
o odd    p pit    q quench r red    s sun    t trap   u urge
v vest   w whale  x plex   y yank   z zip
```

Twenty-six marks is not a limitation to apologise for. The Field's overview is
already bounded to a handful of clusters by the 6–7 item limit recorded in
`IDEAS.md`, and a rail of visible trail nodes is smaller still. If more than 26
objects are addressable at once, marks are assigned to what is on screen and the
rest are reached by search — which is the correct fallback, because a user who
cannot see an object cannot have learned its mark either.

### Marks are sticky

This is the rule that makes marks worth having, and the one that is easy to get
wrong.

A mark is assigned when an object first becomes addressable and **held until
that object goes away**. It is never recomputed on render, never reassigned
because the layout moved, and never reordered to stay alphabetical.

The reason is the whole point of the feature. macOS Voice Control and Windows
Voice Access already number on-screen items on demand, and both renumber by
position every time — so "click 36" means something different each invocation
and nothing can ever be learned. A mark that stays on the same card for the
session becomes memorable, and a name you remember is one you can use without
looking at the screen. Positional labels are a lookup; sticky marks are a name.

Freed letters are reused only once no live object holds them.

### The page has its own alphabet

Twenty-six letters is enough for cards, nodes and contexts. It is not close to
enough once the *page* becomes addressable, and the two cannot share.

A session past its first few minutes has trail nodes holding most of the
alphabet. A single page has tens or hundreds of links, and they all turn over on
every navigation. Put them in one registry and either the links get nothing, or
they evict the marks the user spent the session learning — and the second is
worse than the first, because it breaks stickiness, which is the rule the whole
feature rests on.

So **links are marked in a separate scope**, and a letter means one thing among
the window's objects and another among the current page's links. That is not the
ambiguity it looks like. A mark is only ever *consumed* in a slot whose accepted
types the grammar already knows — `enter` accepts a node, `follow` accepts a
link — so neither the parser nor the speaker is ever choosing between them.
`ScopedMarks` is where that resolution happens, and `FOSCommandParser` hands it
the verb's accepted types rather than asking what holds the letter and comparing
afterwards. Comparing afterwards has the registry choose first and the grammar
object second, which rejects `follow cap` as wrong-typed on any page whose `c` is
a link while some node also holds `c` — a command that was well-formed, and that
the user could see was well-formed, because the letter was drawn on the link in
front of them.

Stickiness survives intact rather than being excepted: a mark is held until its
object goes away, and a link's object goes away when the page view does.

### Link mode

Links are addressable **when the marks are up**, and they are put up by a whole
command rather than by a mode.

`follow` takes an optional target. `follow` alone marks the links on the current
page; `follow cap` follows the one marked `c`. Both are complete lines, and that
is not a stylistic choice — it is what §8's "voice writes the whole line" forces.
The tempting alternative is a required target, so that the *pending slot* raises
the marks: the keyboard user types `follow ` and the letters appear. The keyboard
can sit in a pending slot and a voice turn cannot, so a spoken "follow" would
leave a half-finished line in the bar that the next utterance would replace
rather than complete. Two whole commands is the only shape that is identical in
both modalities.

**For links, the page is the candidate list.** Every other verb shows its
candidates in the command bar, because its objects are not on screen as
themselves. Links are: the letter is drawn *on* the link it addresses, which
carries strictly more than a row reading "cap — Downloads", and is why every tool
that has solved this — Vimium, Rango, Cursorless's hats — draws hints rather than
listing them.

Four rules decide what gets a letter. The last is a bound rather than a
decision, and the third is a decision whose cost is paid out loud:

- **What is on screen**, as §2 requires: a link scrolled out of the viewport, or
  hidden by CSS, gets nothing. Scrolling does not reassign — `follow` again does.
- **One mark per destination.** The thumbnail and the headline above it are one
  thing to a reader and were two hints in every tool that has drawn hints. Both
  still carry a badge; they share the letter.
- **The first twenty-six in document order**, and *the rest are counted out
  loud*. A page can have eighty links on screen and something still has to
  choose; a long navigation menu can spend the whole alphabet before the article
  starts. That is a real cost and the notice names it, because a silent
  truncation reads as "these are the links" and a user who cannot see the page
  has no way to find out otherwise. The two candidate answers — two-word marks,
  and narrowing by typed text — are in `IDEAS.md` and neither is built.
- **The top document only.** A page of iframes would have each frame collecting
  its own links with its own indices and no way to merge them into twenty-six
  letters, so the actor is registered without `allFrames`. This is a bound, not a
  design; it is written down here rather than left to be discovered.

The letters are drawn in **anonymous content** (`insertAnonymousContent`), the
mechanism the find bar's highlighter uses. The page cannot see them, cannot style
them, and cannot be reflowed by them — the three failures every hint overlay
injected into the page DOM has had, of which the second is the one that silently
turns a link back into something only a mouse can reach.

## 3. The grammar

```
utterance := command+ | query
command   := action [target] [argument]
target    := mark
```

**Action first.** The action narrows what may legally follow, so the bar filters
the candidate marks to those the verb can actually apply to — which also gives
keyboard users a live-narrowing list for free, from the same filter.

**Chaining.** Several commands may be issued in one utterance or one line with
no separator, because an action word is unambiguous enough to segment on:

```
enter cap branch name gecko
```

Chaining is what separates a voice demo from a voice workflow; it costs nothing
at parse time as long as the grammar stays regular, so it is in from the start
rather than retrofitted.

### Search is the unmarked default

**Any input that does not begin with a known action word is a query.**

This is the most important rule in the file, and it is a direct response to the
friction that Talon's heaviest users report: switching between dictation and
command mode is the thing that spoils daily hands-free use. Our command bar has
precisely that hazard, because it must accept both commands and search queries,
and search queries *are* dictation.

So the user never declares a mode. Commands are the marked case and prose is the
default, in both modalities. `gecko session history` is a search. `enter cap` is
a command.

The cost is that a query which happens to begin with an action word needs an
escape, which is a far smaller tax than a mode. The escape is the ordinary
action `search <text>` — not a new mechanism, so it is reachable hands-free like
everything else — with `?` as typed sugar for the same thing. `search enter the
dragon` and `?enter the dragon` produce one identical command.

### A line is a command only if the whole line parses as one

The rule above left a hole that only showed up once the parser ran against real
sentences: it says prose is anything not *beginning* with an action word, so
`what is a memex` began with `what`, parsed as the zero-argument context verb,
hit `is`, and came back a syntax error. The user asked the most natural question
they could and got nothing.

This is not a corner case, because eleven of the seventeen action words are
ordinary English. `back pain`, `forward guidance`, `field of view`, `branch
prediction`, `up arrow unicode`, `context switching in linux`, `pack rat`,
`name generator`, `model railway`, `enter the dragon`, `stop motion animation` —
all of them collided.

So the test is the whole line, not the first word:

> **A line is a command only if every token parses as one. The moment a token
> cannot continue the parse, the line was never a command, and it is a query.**

Chrome is the evidence that this is the right way round. Before 88.0.4324 a
custom-search keyword followed by a space invoked that keyword's engine;
Google changed it so that triggering takes a deliberate <kbd>Tab</kbd>, and
`g foo` now searches for the literal string "g foo". A bare prefix does not get
to steal the line. Keyword users complained, which is the real cost and worth
naming — but Google had the usage data and still chose search as the safe
default, because the failure it prevents (a query silently hijacked) is worse
than the one it causes (a command needing one more keystroke).

Our rule is that judgement with more room. A complete, unambiguous command still
wins outright with no confirming gesture at all, because unlike a bare keyword
it cannot be mistaken for prose. Only the ambiguous remainder falls back.

**The line is drawn at syntax, not semantics.** `enter cap` where `cap` is dead
or names a context rather than a card is a well-formed command that the user
plainly meant; it stays an error and must never quietly become a web search.
Only `E_DEAD_MARK` and `E_WRONG_TYPE` survive as errors — the two syntactic
codes are gone, because no input can reach them any more.

The free-text verbs stay greedy and no syntax can fix that: `name generator`
names the current trail "generator". `?name generator` is the escape, and the
cost is the same one keystroke Chrome settled on.

## 4. Actions

Marks and the grammar are shared; the verbs are where each pillar shows up. The
list is deliberately small — every action must be worth a word.

**Field (2A)**
- `enter <mark>` — zoom the card to fill the window and make it active
- `field` — return to the overview
- `dismiss <mark>` — drop the card from the Field

  Non-destructive, and this is load-bearing. The page survives on its trail with
  scroll and form state intact, so dismissal costs nothing and the Field does not
  become one more surface to hoard on. See the `nsISHEntry` entry in `IDEAS.md`.

**Trails (2B)**
- `branch` — start a sibling from the current node
- `up` / `back <mark>` — move within the tree, never destroying a forward branch
- `back` / `forward` — step along the walk you actually made
- `graft <mark>` — reattach a node elsewhere in the tree
- `name <mark> <text>` — name a node or a trail, making it a first-class object
- `done` — finish the trail you are on: it is kept, but no longer offered back

  The one verb that takes no mark by design rather than by accident. The only
  trail a user can address is the one they are on — nodes are what get marked —
  and a verb offering a slot it can never be given is a verb the bar would
  advertise and then refuse.

  **Back and forward are time; `up` is structure — and that is the whole of why
  `forward` takes no target.** In the tree the forward direction is plural, and
  for three runs the keyset manifest gave that as the reason `Browser:Forward`
  could not simply be given a word. It is the right objection to a *structural*
  forward, and this fork does not have one: `up` is the parent, which leaves
  back and forward free to be steps along the walk the user made, and a walk has
  one future however many children a node has. Nyxt, the one shipped browser
  with a history tree, is the control — its backwards *is* the parent, so it
  needs three commands to say forward and the user must know which of the three
  they meant before they can ask.

  The plural forward is `back <mark>`, which has had a word since marks landed
  and reaches any node rather than only the ones ahead. A second spelling of it
  would be a synonym the bar has to teach twice.

  A step stays on the trail it started on. A trail is this fork's unit of place
  — it is what the rail draws, what marks address, what `done` finishes — so
  leaving one is `enter`, `field` and `context`, deliberate acts with their own
  words, and never something a back gesture does by itself.

  It is the counterpart of `dismiss` one level up. `dismiss` takes a page off
  the Field and leaves it on its trail; `done` takes a trail off the Field and
  leaves it in the store. Both are cheap because both are non-destructive, and
  that is what makes them usable: nobody tidies a surface where tidying loses
  things. The Field's §3 caps the overview at nine trails and nests the overflow
  by least-recent touch, which is the system *guessing* which trails are
  finished; `done` is the user saying so, and the freed slot goes to a nested
  trail rather than sitting empty.

  **It has no undo verb, because walking back into a trail is the undo.** The
  context sidebar and the bar's rows both re-enter a page by picking it off a
  list, and an archived trail's nodes are still in the session's tree — so the
  reversal is a gesture the user already has, costs no word out of the table,
  and cannot be forgotten the way a second verb could. It also had to exist:
  without it, re-entry left the user standing on a trail that was still
  archived, extending work that would never be offered back, with nothing on
  screen saying so.

  What it does not do is delete, and the pages it holds stay in the Context
  Engine. Arc's auto-archive is the shape to avoid here: it fires on a clock
  rather than on a fact about the work, cannot be switched off, and drops the
  archived tab off every surface, so getting one back means retyping its URL.
  Here the return path is the one the fork already has — you type the subject
  and the bar finds the pages, because the engine kept what they were about.

**Context Engine (2C)**
- `context <mark>` — switch the active context, re-ranking the bar's suggestions
- `pack` — export the active context as a markdown brief
- `what` — what the engine has on the active context, spoken or shown
- `model` — download the local model that ranks suggestions by meaning

**Consent is a verb, not a setting.** `model` is the odd one out: every other
word here moves the user through their own material, and this one changes what
the browser is allowed to fetch. It earns a word anyway, and the alternative is
what makes the case. The `related` suggestion tier needs ~30MB of weights, and
this fork switches off update and telemetry precisely so that it never contacts
anyone unasked — so the tier cannot fetch them on a keystroke, and it ships
switched off. Left there, the choice would have to live somewhere with no
grammar at all: a preferences pane this browser does not have, or `about:config`,
which is not a surface and has no spoken form. Putting it in the action table
makes the disclosure discoverable — the summary is on screen in the list the bar
opens with, before the verb is ever run — and reachable by voice like everything
else, at the cost of one word out of twenty-six.

It is one-way on purpose. Running it again once the weights are here reports
that they are, and there is no verb to un-download them: the tier's absence is a
shorter suggestion list rather than a broken promise, so a user who wants it
gone is doing configuration, not navigation. The pref it sets means *the weights
are here and wanted* — never *a fetch was attempted* — which is why a download
that fails leaves it alone rather than arming the next session to retry the
request nobody would be asked about a second time.

`what` and the `pack` confirmation are the reason text-to-speech matters: it is
already supported on the in-tree ML runtime with no spike required, so the output
half of a hands-free loop is available regardless of how speech *recognition*
resolves.

**The page (no pillar)**
- `search <text>` — §3's escape, above
- `stop` — give up on the page being loaded and say where you are again
- `follow` / `follow <mark>` — mark this page's links, or follow one

These belong to the entry surface rather than to a pillar, and the bar groups
them under their own heading for that reason: one asks for a page, one gives up
on asking, and one reaches into the page that arrived. `search` sat in the
context group before `stop` existed, for want of a fourth heading rather than
because the context engine owned it.

**`follow` is the first verb that addresses something inside the page, and its
absence was the largest hole in this document.** Fifteen verbs addressed the
browser's own objects — cards, nodes, contexts, trails — and §2 had listed
in-page links among the addressable kinds since marks landed, and nothing had
ever registered one. So the fork had a complete spoken grammar for every surface
*around* a page and no hands-free way at all to click a link in one.

It was found by ordering the §5.1.1 debt list rather than by reading this
section. Rango, the most developed voice-browsing extension there is, ships no
spoken form for back, forward, reload, find, zoom, bookmark, print or save, and
is very nearly *only* content interaction — click, hover, focus, scroll, element
hints. That settles nothing about the principle: §5 has already refused the
argument that a desktop voice layer sending a keystroke discharges the rule. What
it settles is where hands-free browsing actually stops, and it is not at the
toolbar. A backlog of twenty-six unvoiced chrome commands reads as the §5 backlog
and was not; the backlog's first item was a kind of mark that had been declared
and never built.

The mechanics — the page's own alphabet, what gets a letter, and why the marks go
up by a whole command rather than by a mode — are in §2 under "Link mode", with
the rest of what marks are.

**`stop` is the verb that had to exist once the fork started saying where it was
going.** A request that has been made and not answered is held on the browser
element as `userTypedValue`; the bar shows it in place of the current URL, and
session restore reissues it after a crash. Firefox splits giving up on it in
two — Escape over the page runs `Browser:Stop`, Escape *in the address bar* runs
`handleRevert` — and this fork can reach neither by grammar and only the first
by key, because its address bar takes no focus. So the state was reachable and
the exit from it was not.

It is one verb rather than Firefox's two because the two halves were never
separately useful: stopping the load while the browser goes on naming the
destination is the same wrong answer with the spinner switched off, and
forgetting the request without stopping it means the page lands a minute later
over whatever the user did instead. So `stop` aborts the load *and* takes the
request back, and the two other routes to `Browser:Stop` this build kept — the
toolbar button and Escape — are made to leave the same state behind, because two
stops with different outcomes is a worse defect than the one this fixes, and an
invisible one.

**What it adds over Firefox is synchrony, and it is worth being exact about
that rather than overclaiming.** Firefox's own tab progress listener nulls the
pending value at a failed `STATE_STOP`, for the reason its comment gives:
*"restore the current document's location in case the request was stopped before
the location changed"*. That arrives an event round trip after the user asked,
and in the interval the bar still names a page nobody is going to and
`TabState.collect` still records the request — both asserted, and both restored
by mutation when the fork's own clearing is removed. The verb is what makes
giving up reachable at all; the synchronous clearing is what makes it true
immediately.

**Naming what was dropped is what makes stopping cheap.** The notice says which
page was abandoned, so a user who stops a load that turns out to have been
nearly finished asks for it again from what is on screen rather than from
memory. A stop with nothing to stop says so too, because silence is the one
answer this surface never gives to a verb reached for deliberately — and because
a screen-reader user has no other way to know a load was in flight at all, which
is a gap NVDA has an open request about rather than a hypothetical.

## 5. One code path

The requirement is not that voice and keyboard both work. It is that they are
the same mechanism.

```
keystrokes ─┐
            ├─→ token stream ─→ parse ─→ command object ─→ execute
transcript ─┘
```

Both front ends produce a token stream and nothing else. Everything downstream —
the parser, mark resolution, the action table, execution — is shared and has no
knowledge of which modality produced its input.

Two consequences worth stating, because they are the test of whether this has
actually been built as specified:

1. **No action may exist that only one modality can reach.** A command with no
   spoken form is a bug, not an omission.

   This rule used to end "— and it will be caught by construction, since the
   action table is the single source of both", which was false and was worth
   more than the sentence cost. The action table is the single source of both
   modalities *for the verbs in it*, and nothing whatever checked that the
   browser's actions were in it.

   What that cost, concretely: `Browser:Back` was bound to four gestures, none
   of them known to pillar B, and each press appended a node for a page the
   user was arriving at *from* — so the tree grew a spine nobody browsed. It
   was found by counting the keyset, not by using the browser, and it had been
   there since the pillar landed. See `ARCHITECTURE.md` §7.

   **Discharging it took a rebinding, not a word.** The obvious repair — say
   that `back` is the word for `Browser:Back` — is the "declaring covered" the
   manifest entry itself warned against, because they were two different
   movements: the verb steps the pages the user stood on, the gesture steps one
   tab's session history chain, and after a branch they disagree. Two movements
   under one name is worse than one movement with no name.

   So the gesture runs the verb. The rebinding is on `BrowserCommands.back` and
   `.forward` rather than on the four `<key>` elements, because the keys are not
   the only way to ask — the nav-bar buttons, the context menu, the mouse's side
   buttons, the touchpad swipe and `Backspace` under `browser.backspace_action`
   all arrive there — and rebinding the keyboard alone would have replaced one
   unvoiced movement with two that disagree depending on which hand you used.
   `browser.fos.trails.replacesLinearHistory` gives the chain's own back and
   forward back on every one of those surfaces at once.

   Two things keep that from being a removal rather than a replacement. Where
   the trail has no step — a page with no node, a forgotten one, a restored
   window, the first page of a fresh trail — the gesture falls through to the
   chain, which still knows the answer. And where the node *is* an entry of the
   tab's chain, re-entry traverses to it rather than replaying a stored blob, so
   the common case is the load Firefox would have done: the bfcache still works,
   and `history.length` stays honest for content that reads it. Trails are a
   layer over session history, not a replacement for it, and a layer that
   flattened the thing underneath it on every press would not be one.

   ### 5.1.1 The keyset manifest

   The gap is now enumerated, and stays enumerated.
   `browser/components/fos/tests/browser/keyset-manifest.js` classifies every
   command a `<key>` in the window can reach, each with a written reason, and
   `browser_zzkeymanifest.js` fails if the window binds a command the manifest
   does not name, or if the manifest names one the window no longer binds. That
   is what makes "by construction" a claim about the window rather than about
   the table: a binding this fork adds, or one that arrives with an upstream
   merge, is red until somebody has said what §5 makes of it.

   The rule that sorts the entries is the one already applied to Tab-completion
   and to rail hoisting: **§5 governs actions, and an affordance that runs no
   action needs no word.** The classes are `verb`, `affordance`, `editing`,
   `devtools`, `desktop`, `display`, `replaced`, `unbound` and `debt`; the
   manifest's own header says what claiming each one commits you to. `debt` is
   the class for the cases where the rule does not get you out of it — a real
   browsing action, reachable by hand and by nothing else — and the file is
   deliberately allowed to be green with `debt` entries in it, because a red
   suite for known debt gets the file disabled rather than the debt paid.

   The enumeration runs in a driven window, not over the source. `#ifdef` and
   platform blocks mean the file and the window disagree, and fourteen of the
   devtools keys are installed at window load and are not in the markup at all.

   The count the manifest replaces was itself wrong, which is worth keeping:
   §5.1 said "101 `<key>` elements, 49 distinct commands". The keys were right
   and the commands were not. A key with no `command` attribute still runs
   something — a listener on the keyset, or nothing at all — and thirty-six of
   them were invisible to a count that read the attribute. The window binds
   **101 keys reaching 85 commands**, of which **two** have a verb.
2. **The ASR spike is not on the critical path for any of this.** Marks, the
   grammar, the parser and every action are keyboard-testable today. Speech
   recognition on the in-tree engine is still unproven (`IDEAS.md`), and this
   design deliberately arranges that if it fails, everything above still ships
   and the failure is confined to one input adapter.

---

## 6. Parse rules

Three rules the sections above leave open. Each was forced by implementation and
each is settled the same way — syntactically, so that typing and speaking stay on
one grammar.

### Free text is terminal

An action taking free text consumes the rest of the utterance. `name` and
`search` are the only two, and neither may be chained after.

Talon's answer to "where does dictated text end" is a 0.3s silence timeout, and
its users report that the slightest pause mid-phrase ends dictation and the next
subclause is executed as a command. That failure mode is bad enough in voice
alone, but the fatal objection here is different: silence has no meaning at all
for typed input, so a timeout would give the two modalities two different
grammars — precisely what §5 forbids. A syntactic rule is identical in both.

The cost is one free-text command per utterance, always last. `name cap enter the
field` names the card "enter the field" rather than re-segmenting at `enter`.

### A mark token fills the slot; anything else begins the text

`name` takes an optional target and free text, so `name gecko session` is
ambiguous on its face. The rule: the target slot is filled only if the token is a
valid mark — a letter or an alphabet word — and otherwise the verb applies to the
current object and that token begins the text.

This is what makes §3's own chaining example, `enter cap branch name gecko`,
parse as written: the `name` there has no target because `gecko` is not a mark,
and it applies to the node `branch` just created. The tax is that naming
something literally "cap" takes `name cap cap`, which is smaller than a mode and
smaller than a punctuation escape with no spoken form.

### A half-typed command is a normal result, not an error

The parser runs on every keystroke, so incompleteness is the common case. It
reports the slot the user is filling and the object types that slot accepts,
which is what produces the live-narrowing candidate list §3 promises — from the
same filter the voice grammar uses to constrain what may be said next.

Liveness of a mark is checked only when the caller supplies the registry. The
parser's own business is syntax; whether `cap` currently names anything is the
registry's.

---

## 7. Rules the bar forced

Three more, settled while building the surface itself. All three keep the split
this file has held since §5: the grammar stays syntactic and modality-blind, and
anything that cannot be is pushed out of it rather than into it.

### URL or search is decided at execution, not in the grammar

§3 settles command versus query. It does not settle what a *query* is, and a
query covers both `gecko session history` and `example.org/docs`.

That distinction is deliberately not a grammar rule. It depends on what schemes
and hosts exist rather than on how the line is shaped, so it is not syntactic;
and answering it in the parser would make the parser depend on Gecko, which
would cost the grammar its node-speed test suite and give the transcript front
end a second thing it has to agree with.

So the parser returns a query and the executor decides, on `nsIURIFixup` — the
same component the address bar uses, which already knows the scheme typos, the
alternate-URI prefs and the keyword fallback, and which reports which of the two
it chose. The bar reads that report to say either "Go to …" or "Search for …"
before the user commits.

### The bar opens showing every action

The empty state is the whole action table, grouped by pillar.

A palette that opens to a bare input is the most reported failure of the
pattern, and it would be worse here than in an editor. The usual form of that
critique — a palette must not withhold what the menus already expose — does not
apply, because there are no menus. But that is not a reprieve: it means a user
who does not know the thirteen words has nowhere else to learn them. This is
the one surface in the product that has to teach, and thirteen is small enough
to show entire.

### A prefix is offered, never triggered

§3 makes a half-typed action word prose: `fie` is a query and Enter searches for
it. But showing nothing while the user types `fie` wastes the moment they are
most likely reaching for `field`.

So a single token lists the action words it prefixes, and <kbd>Tab</kbd>
completes one. This changes what is **shown** and never what Enter **does** —
the distinction the whole affordance rests on. Chrome reached the same gesture
from the same direction when it stopped letting a bare keyword steal the line.

Tab has no spoken form and does not need one. §5 requires that every *action* be
reachable in both modalities; Tab reaches no action, it only shortens the path to
one a voice user would say outright. A completion affordance is not a command —
worth stating plainly, because "just add a keyboard-only shortcut" is exactly how
the separate accessibility mode §5 forbids would get built by accident.

---

## 8. Rules the voice front end forced

§5 promised that a transcript and a keystroke meet as one token stream. Building
the front end that produces the transcript settled ten things the promise leaves
open. All ten hold the same line §5 and §7 hold: whatever cannot be modality-
blind is pushed *out* of the grammar rather than into it, and lives in the input
adapter where it can be replaced.

### The turn is a press, not a wake word

Push-to-talk first: a press makes the microphone's state something the user did
rather than something they trust, and eliminates false wakes outright. The
genuinely handless case needs a wake word, and gets one as a second layer on the
same path — in both cases what comes out is a transcript handed to
`FOSCommandParser`, so building the press first costs the wake word nothing.

The stages are `arming`, `listening`, `transcribing`, and they are visible
because they answer the question a voice user actually has, which is not "did it
understand" but "is it listening yet". A key that comes up before the microphone
opened is a tap, not a turn, and is refused with the same reason a recording too
short to be a word gets — to the user it is the same mistake.

### There are two gestures and one turn

> Superseded in part by §9: there are three. The bare tap this section rules out
> is built, because the objection to it turned out to be an objection to *any*
> latched microphone bounded only by a clock. Everything else below still holds.

Push-to-talk is the default, and it is the wrong *only* gesture. Sustained
pressure is precisely what tremor, arthritis, carpal tunnel and fatigue make
expensive, and the dictation tools written for those users converge on
tap-to-start, tap-to-stop — so a hands-free path reachable only by holding a key
down has excluded part of the audience §5's "no separate accessibility mode"
was written for, and excluded them from the modality that was supposed to be
their way in.

The answer is a second gesture and not a second mode, and the difference is
testable rather than rhetorical: a latched turn arms, listens, transcribes and
executes down the same path, and the whole of the difference is one flag in
`FOSVoiceSession` plus which event ends it. Shift is the arm because it is
reachable one-fingered through the platform's own sticky keys, which is a
mechanism these users already have turned on. (This section originally gave a
second reason — that a bare tap would open the microphone for the whole thirty
seconds — and that reason was wrong about which thing it was an objection to.
See §9.)

Two rules fall out of the microphone being open with nobody holding anything.
**Any press ends a latched turn**, not only a press carrying the modifier:
ending early costs one utterance, failing to end leaves a device open that this
build draws no platform indicator for, and the two are not the same size of
mistake. And **the indicator has to say how to stop**, because for a held turn
the user's own finger is that answer and for a latched turn nothing is.

### The echo is the latency budget

A voice turn feels natural inside ~1s of the end of the utterance and tolerable
to 2s. The thing that buys the second second is showing the words as they are
recognised, and this fork gets it for nothing: the command bar is already a text
surface with the parse in front of the user, so speech is echoed into the same
input the keyboard writes into. No second surface, no "voice mode" — the "no
separate accessibility mode" property of §5 falling out of the design rather than
being bolted onto it.

### Cancel works from every state, including after the transcript arrives

The failure people fear about voice is the misheard command that runs. Escape
therefore abandons a turn from any stage, and a transcript that arrives after a
cancel does nothing — the model finishing is not the user's decision.

### Typing wins

Two modalities writing one field is the single place where "the same surface"
could turn from a promise into a collision. If the user touches the keyboard
mid-utterance the turn is abandoned, nothing executes, and the input is left
exactly as the keystroke left it. Restoring anything there would delete what they
are in the middle of writing.

Voice therefore writes the whole line: the bar's text is snapshotted on press and
restored on anything but a usable transcript. **Open:** appending to a half-typed
line — type `name `, then speak the name — is the more interesting mixed-modality
behaviour and probably the right end state, but it is not guessed at before it
has been used in a browser.

### Silence is not a transcript

Whisper does not answer silence with nothing. It answers with a confident
sentence — "thank you", "thanks for watching" — because captioned video taught it
to, and its own `no_speech_prob` defence is documented as insufficient precisely
because the hallucinations come out confident. So "the model returned a string"
is not evidence that anyone spoke.

Two defences, in this order: a recording too short or too quiet or too steady is
never sent to the model at all, and a transcript that is exactly a known artifact
is refused after. The second is not belt and braces — a door slamming in a quiet
room clears every audio gate and is exactly what gets answered with a sentence.

The reason this is worth two defences rather than one is not the wrong command.
It is that a phantom utterance is also recorded by the Context Engine as a query
the user asked, and a context poisoned by enquiries nobody made is a great deal
harder to notice, and to undo, than a search that ran and looked odd.

### A misheard word is offered, not repaired

The tempting next step is to snap a near-miss onto the vocabulary — `cab` to
`cap`. It is refused, for a reason that is structural rather than cautious.
§6 makes free text terminal: `name` and `search` take the rest of the utterance
verbatim, so a repair pass would have to know where free text begins, which is to
say it would have to know the grammar. That is exactly the knowledge §5 forbids
the input adapter to have, and the adapter is where a repair would live.

Talon, which has more standing on this than anyone, does not snap either — it
offers a menu of homophones and lets the user pick. This fork already has that
surface: §7's candidate list narrows live from the same parse. So the answer to a
misheard word is the list the user is already looking at, and the adapter's job
stays what §5 says it is — produce a token stream, and stop.

### Nothing needs a confirmation step

Executing a transcript directly, with no "did you mean", is safe here by a
property of the action table rather than by optimism. Every verb in it is cheap
and reversible by construction: `dismiss` leaves the page on its trail and one
`enter` brings the card back, `back` destroys no forward branch, `graft` moves a
node rather than deleting one. The one destructive thing a browser normally
offers a voice user — closing a window with unsaved work — has no verb, because
the Field replaced it. A confirmation step would be the honest answer to a
grammar with a destructive verb in it; the better answer was not to have one.

### No stage may last forever, because nothing else will end it

The other six rules are interface judgements. This one is a fact about Gecko,
and it is the only rule here that would survive a different interface.

A chrome window's `getUserMedia` runs as `CallerType::System`. In
`dom/media/MediaManager.cpp` that sets `privileged`, and `askPermission` is
`!privileged || …permission.force` — so the call **never prompts**. The sharing
indicator does not make up for it: the indicator is driven by
`recording-device-events`, and the only thing that observes it is
`BrowserProcessChild`, a process actor registered in
`DesktopActorRegistry.sys.mjs` without `includeParent`. It is therefore never
instantiated in the parent process, which is the process the chrome window's
microphone belongs to. Nothing is listening when the recorder is the parent.

So a microphone opened on this path is opened with no prompt, no indicator and
no row in the permissions UI. This fork does not get to treat that as a
convenience. Two things follow, and the second is the load-bearing one:

*The voice surface draws its own indicator.* The stages were already visible
because a voice user's real question is "is it listening yet" — that answer now
also has to carry the weight the platform's indicator is not carrying.

*The state machine is the only thing that can close the microphone, so it may
never be left holding one open.* Every active stage carries a deadline, chosen
where it costs nothing rather than picked as a round number: `listening` gets
Whisper's own 30-second window, past which the model discards the audio anyway,
so the cap can only end turns whose tail was going to be thrown away. Losing
window focus ends a turn outright — holding a key and switching away is the
ordinary way a key-up goes missing, and it is the gesture that has left a
push-to-talk microphone open in every application that ever shipped one.

A deadline decides *when* a turn ends and never invents a way for it to end.
A listen that runs out is a key that came up: the audio is transcribed rather
than discarded, and the long-utterance case needs no telling apart from the
lost-key-up case, because a room that nobody is talking in does not clear the
audio gate that already exists.

### The runtime is the one already in the build, and it runs on the CPU

The transcript has to come from somewhere, and the choice of engine is a design
decision rather than a packaging detail, because it is what decides whether
"local, no cloud, ever" survives contact with a machine that has no network.

The tree offers two ONNX backends and they are not variations on one thing:

| | `onnx` | `onnx-native` |
| --- | --- | --- |
| runtime | `ort-wasm-simd-threaded.jsep.wasm` | `libonnxruntime.so` |
| how it arrives | Remote Settings attachment, first use | build toolchain, already in `dist/bin` |
| works with no network | no | **yes** |
| devices | cpu, WebGPU | cpu only |

**The fork uses `onnx-native`.** It is the only one of the two that can honour
the claim: the runtime is a build dependency, so a fresh profile on a machine
that has never had a network still has a working inference stack. Nothing is
vendored into the tree to achieve it — bootstrap already places the library —
and no Mozilla service is consulted at any point in a voice turn.

The obvious objection is that this gives up the GPU, since Transformers.js is
handed `supportedDevices: ["cpu"]` for the native backend. Measured on
`whisper-tiny` q8, that objection does not survive the numbers:

| utterance | median | budget |
| --- | --- | --- |
| 1.5s — a command, "enter cap, branch" at speed | **324ms** | ~1s natural |
| 3s — the longest one utterance can be, free text being terminal | **520ms** | 2s tolerable |

Both clear the natural budget with roughly threefold headroom, so the GPU was
never the knob this depended on. Model load is 1.3s and is paid once; it belongs
at arm time, before the first press, which is the same place the design already
put it.

What is *not* solved by this is the model weights, which are still a download.
They are a different problem from the runtime — an order of magnitude larger,
and the reason the two get different answers. The weights get a visible,
one-time "download the speech model" step. What the fork must never ship is the
shape run 26 had: a microphone that fails with an error about Remote Settings on
a machine whose only real problem is that nobody told it to fetch anything.

---

## 9. What building the shell settled, and what it did not

§8 was written from the state machine, before anything could open a microphone.
Building the part that can — `FOSVoiceInput.sys.mjs` — settled four things §8
left to the implementation, and opened one question worth more than the four.

### The key is F4, and it is heard on the window

Held, not tapped: the microphone is open while the key is down. F4 is unbound in
this browser, which is why F2 could take the Field, and it produces no text, so
no turn can begin by typing.

The listener is on the chrome window in the capture phase rather than on the
command bar, and that is not a preference. A key pressed while the focus is in a
page is dispatched in the content process; the parent sees it only as the reply
`BrowserParent::RecvReplyKeyEvent` re-dispatches at the `<browser>` element,
from where it reaches the window. Keydown, keypress and keyup all take that
path, so both halves of the gesture arrive — but only at the window. A listener
on the bar's input would hear the talk key exactly when the bar already had the
focus, which is the one moment a voice user has not reached yet.

### The bar opens on the press

The echo needs a surface, and the surface is the one the keyboard writes into.
Opening it on the press rather than when the transcript lands means the user can
see that this window is listening before they have finished the utterance, which
is the question §8 says they are actually asking.

### The download outranks every other notice

Driving the real path showed both orderings: the arming failure can land before
the download line, and the key-up's "too short to hear" can land after it. Both
would leave a user who has just pressed the key looking at a complaint about
their microphone while the browser quietly fetched a model. While a download is
running it is the only account of why nothing happened, so it is the only thing
said.

### Recording is a `MediaRecorder`, decoded once

Not an `AudioWorklet` drained frame by frame. The capture then costs the chrome
process nothing during the window in which jank would be visible — while the
user is speaking — and the decode lands after the key is up, where a model is
about to run anyway. Decoding into an `OfflineAudioContext` built at 16kHz
resamples the device's rate to Whisper's on the way.

### Settled: shift latches, and the deadline had to stop going through the key

The gesture this section opened as a question is built — §8's "two gestures and
one turn" is the rule it became, and `IDEAS.md` (run 31) has what shipped.

Building it moved one thing that was not obvious from the design. A latched turn
ignores the key coming up, and the `LISTENING` deadline had been implemented as
"a listen that runs out is a key that came up" — literally, by calling `release`.
So the deadline would have bounded every turn in the design *except* the only one
with nobody's finger on the key, which is the only one that needed bounding.
Both now end the recording through the same private step, and `release` is a
thin caller of it rather than the thing itself. The lesson generalises past
voice: **when a safety bound is expressed as "this is the same as that ordinary
event", adding a mode that suppresses the ordinary event silently removes the
bound.** Nothing about the deadline changed — what changed was that it stopped
being defined in terms of a gesture.

### Settled: the latch needs no modifier, because the microphone listens to the room

This section stood open for three runs asking whether the bare tap — run 30's
candidate (2), today's "too short to hear" — could be offered. It needs no
modifier and so no second key press at all, which is what a user with one
reliable finger would rather have. It was refused because a mis-tap would open
the microphone for the whole thirty-second deadline, and how often a mis-tap
happens is a question about use rather than about design.

**The question was the wrong one.** Shift+F4 has exactly the same exposure: a
mis-pressed latch is a mis-tap with a modifier on it. So the thirty seconds was
never a property of the tap, it was a property of a latched microphone bounded
only by a clock — and that is a design question after all, with an answer speech
recognisers have shipped since the 1990s. Bound the microphone by what it hears.

A latched turn now carries two bounds a held turn does not, named after the
platform APIs they come from:

- **Initial silence, six seconds.** The microphone opened and nobody ever spoke.
  Nothing is transcribed — there is no audio worth the decode — and the turn ends
  with the notice every turn that produced no speech already has. This is the
  whole of the answer to the mis-tap: it costs six seconds, not thirty.
- **End silence, one and a half seconds.** Somebody spoke and has stopped. This
  is endpointing rather than safety, and it is the half that makes the gesture
  worth having: the turn ends itself when the utterance does, so the second press
  becomes a way to stop *early* rather than the only way to stop at all.

A **held** turn gets neither, and the reason is the same one that decides
everything else here: a finger on the key is a user who is present, and cutting
their listen short because they paused to think would be the bound doing harm.
The predicate is not "which gesture started this" but "is anybody holding
anything" — §8's lesson about bounds defined in terms of gestures, applied
before it could be broken rather than after.

Two consequences worth keeping:

**The threshold and the measurement live in different places.** The shell
measures how long the key was down and how loud the room is, because it is the
only part that can observe either; `FOSVoiceSession` decides what those facts
mean. That is the same split as the transcript, and it is what keeps the whole
gesture testable with no window and no microphone.

**The hold is measured from the events, not from the handlers.** Two clock reads
inside a keydown and a keyup handler are not the interval between the key going
down and coming up — under load a handler runs some way after its event — and
the difference lands exactly on the 400ms boundary being decided, turning a
deliberate hold on a busy machine into a tap.

**A bound is only as good as the signal under it, and this one has no signal on
some machines.** The level monitor is an `AnalyserNode`, and Web Audio needs an
*output* device before it will run a graph at all — so a machine with no audio
output never leaves `suspended` and reads a flat zero, which is exactly what a
quiet room reads. A turn that trusted that would end six seconds into somebody's
sentence and tell them nothing was heard, which is worse than having no bound.
So the turn asks whether anything is reporting the level before it treats
silence as meaning anything, and a graph that has not started within half a
second reports speech once and stops looking. Both routes land the turn back on
the key and the model's window — the design that shipped before these bounds
existed. **The failure degrades to the previous behaviour rather than past it**,
which is the property to preserve if either bound is ever changed.

`IDEAS.md` (run 40) has the sources and what driving it found.
