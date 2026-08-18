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
