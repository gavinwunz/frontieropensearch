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

This is not a corner case, because eight of the twelve action words are ordinary
English. `back pain`, `field of view`, `branch prediction`, `up arrow unicode`,
`context switching in linux`, `pack rat`, `name generator`, `enter the dragon` —
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
- `graft <mark>` — reattach a node elsewhere in the tree
- `name <mark> <text>` — name a node or a trail, making it a first-class object

**Context Engine (2C)**
- `context <mark>` — switch the active context, re-ranking the bar's suggestions
- `pack` — export the active context as a markdown brief
- `what` — what the engine has on the active context, spoken or shown

`what` and the `pack` confirmation are the reason text-to-speech matters: it is
already supported on the in-tree ML runtime with no spike required, so the output
half of a hands-free loop is available regardless of how speech *recognition*
resolves.

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
   spoken form is a bug, not an omission — and it will be caught by construction,
   since the action table is the single source of both.
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
who does not know the twelve words has nowhere else to learn them. This is the
one surface in the product that has to teach, and twelve is small enough to show
entire.

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
the front end that produces the transcript settled seven things the promise
leaves open. All six hold the same line §5 and §7 hold: whatever cannot be modality-
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
