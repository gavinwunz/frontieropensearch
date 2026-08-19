/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Unit tests for marks and the command parser.
 *
 * These run under plain `node --test` because the modules under test touch no
 * Gecko API, which keeps the inner loop on the grammar at a second rather than
 * a build. They are a supplement to the browser-chrome tests that will cover
 * execution, not a replacement for them.
 *
 *   node --test browser/components/fos/tests/node/
 */

/* These tests run under `node --test`, not in Gecko, so a static import of a
 * system module is correct here. */
/* eslint-disable mozilla/reject-import-system-module-from-non-system */
import test from "node:test";
import assert from "node:assert/strict";

import {
  MARK_WORDS,
  MARK_LETTERS,
  MarkRegistry,
  resolveMarkToken,
  markWord,
} from "../../FOSMarks.sys.mjs";
import { ACTIONS, ACTION_WORDS, isActionWord } from "../../FOSGrammar.sys.mjs";
import {
  parse,
  candidatesFor,
  EMPTY,
  QUERY,
  COMMANDS,
  ERROR,
  E_DEAD_MARK,
  E_WRONG_TYPE,
} from "../../FOSCommandParser.sys.mjs";

test("the alphabet covers a-z with distinct speakable words", () => {
  assert.equal(MARK_LETTERS.length, 26);
  assert.deepEqual(
    [...MARK_LETTERS].sort(),
    "abcdefghijklmnopqrstuvwxyz".split("")
  );
  const words = Object.values(MARK_WORDS);
  assert.equal(new Set(words).size, 26, "no two letters share a word");
  for (const word of words) {
    assert.match(word, /^[a-z]+$/, `${word} must be one plain lowercase word`);
  }
});

test("no action word collides with the mark alphabet", () => {
  // The grammar's regularity rests on being able to tell an action from a mark
  // by the token alone. This guards the addition of a future verb like "sun"
  // or "each", which would silently make chained commands ambiguous.
  const markTokens = new Set([...MARK_LETTERS, ...Object.values(MARK_WORDS)]);
  for (const action of ACTION_WORDS) {
    assert.ok(
      !markTokens.has(action),
      `action "${action}" collides with a mark`
    );
  }
});

test("every action is reachable in both modalities", () => {
  // GRAMMAR.md §5: an action with no spoken form is a bug, not an omission.
  // One word per action, typed and spoken, is what makes that true by
  // construction — so the test is that the word is always sayable.
  for (const [word, spec] of Object.entries(ACTIONS)) {
    assert.match(
      word,
      /^[a-z]+$/,
      `"${word}" must be one plain lowercase word`
    );
    assert.ok(isActionWord(word));
    assert.ok(["none", "optional", "required"].includes(spec.target));
    assert.ok(Array.isArray(spec.accepts));
    if (spec.target === "none") {
      assert.equal(spec.accepts.length, 0, `"${word}" takes no target`);
    } else {
      assert.ok(spec.accepts.length, `"${word}" must say what it applies to`);
    }
    assert.ok(spec.summary, `"${word}" needs a summary for the help surface`);
  }
});

test("marks resolve from either modality to the same letter", () => {
  assert.equal(resolveMarkToken("c"), "c");
  assert.equal(resolveMarkToken("cap"), "c");
  assert.equal(resolveMarkToken("CAP"), "c");
  assert.equal(markWord("c"), "cap");
  assert.equal(resolveMarkToken("gecko"), null);
  assert.equal(resolveMarkToken(""), null);
  assert.equal(resolveMarkToken(undefined), null);
});

test("marks are mnemonic where they can be", () => {
  const marks = new MarkRegistry();
  assert.equal(marks.assign("n1", { label: "gecko" }), "g");
  assert.equal(marks.assign("n2", { label: "trails" }), "t");
  // "gecko" again: g is taken, so the next distinct letter of the label wins.
  assert.equal(marks.assign("n3", { label: "gecko" }), "e");
});

test("marks are sticky across re-registration", () => {
  // The rule the whole feature rests on. A card that is re-rendered,
  // re-clustered or retitled keeps its name, or nothing can ever be learned.
  const marks = new MarkRegistry();
  const letter = marks.assign("card1", { label: "gecko", type: "node" });
  for (let i = 0; i < 5; i++) {
    assert.equal(
      marks.assign("card1", { label: `gecko ${i}`, type: "node" }),
      letter
    );
  }
  assert.equal(marks.markOf("card1"), letter);
  assert.equal(marks.objectAt(letter), "card1");
});

test("a freed letter is reused only once no live object holds it", () => {
  const marks = new MarkRegistry();
  assert.equal(marks.assign("a1", { label: "gecko" }), "g");
  assert.equal(marks.assign("a2", { label: "grid" }), "r");
  assert.ok(marks.isLive("g"));
  assert.ok(marks.release("a1"));
  assert.ok(!marks.isLive("g"));
  assert.equal(marks.objectAt("g"), null);
  assert.equal(marks.assign("a3", { label: "gust" }), "g");
  assert.equal(marks.release("nope"), false);
});

test("the 27th object is registered but unmarked", () => {
  // GRAMMAR.md §2: marks go to what is on screen, and the rest are reached by
  // search. Exhaustion must not throw and must not steal a live mark.
  const marks = new MarkRegistry();
  for (let i = 0; i < 26; i++) {
    assert.ok(marks.assign(`o${i}`, { label: "" }));
  }
  assert.equal(marks.assign("overflow", { label: "gecko" }), null);
  assert.equal(marks.markOf("overflow"), null);
  assert.equal(marks.size, 27);
  assert.equal(marks.candidates().length, 26);
});

test("candidates are filtered to what the action accepts", () => {
  const marks = new MarkRegistry();
  marks.assign("c1", { label: "gecko", type: "node" });
  marks.assign("x1", { label: "spidermonkey", type: "context" });
  marks.assign("t1", { label: "memex", type: "trail" });

  const pages = marks.candidates(["node"]);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].id, "c1");
  assert.equal(pages[0].word, markWord(pages[0].letter));
  assert.equal(marks.candidates().length, 3);

  const pending = parse("enter ", { marks }).pending;
  assert.deepEqual(
    candidatesFor(pending, marks).map(c => c.id),
    ["c1"],
    "a pending 'enter' offers only pages"
  );
});

test("empty input is empty, not an error", () => {
  assert.equal(parse("").type, EMPTY);
  assert.equal(parse("   ").type, EMPTY);
  assert.equal(parse(null).type, EMPTY);
});

test("search is the unmarked default", () => {
  // The most important rule in the grammar: prose is the default and commands
  // are the marked case, so the user never declares a mode.
  const r = parse("gecko session history");
  assert.equal(r.type, QUERY);
  assert.equal(r.query, "gecko session history");
  assert.equal(parse("  spaced out  ").query, "spaced out");
  assert.equal(
    parse("capybara").type,
    QUERY,
    "a word merely starting like a mark"
  );
});

test("a query beginning with an action word can be escaped in both modalities", () => {
  const typed = parse("?enter the dragon");
  const spoken = parse("search enter the dragon");
  assert.deepEqual(typed, spoken, "the ? prefix is sugar for the same command");
  assert.equal(typed.type, COMMANDS);
  assert.deepEqual(typed.commands, [
    { action: "search", target: null, text: "enter the dragon" },
  ]);
  assert.equal(parse("?").pending.action, "search");
});

test("keyboard and voice token streams produce identical commands", () => {
  // GRAMMAR.md §5. The requirement is not that both modalities work, but that
  // they are the same mechanism — so the typed letter and the spoken word must
  // be indistinguishable downstream of the tokenizer.
  const pairs = [
    ["enter c", "enter cap"],
    ["dismiss g branch", "dismiss gust branch"],
    ["graft t back a", "graft trap back air"],
    ["context s pack", "context sun pack"],
  ];
  for (const [typed, spoken] of pairs) {
    assert.deepEqual(parse(typed), parse(spoken), `${typed} vs ${spoken}`);
  }
});

test("commands chain in one utterance", () => {
  const r = parse("enter cap branch name gecko");
  assert.equal(r.type, COMMANDS);
  assert.deepEqual(r.commands, [
    { action: "enter", target: "c", text: null },
    { action: "branch", target: null, text: null },
    { action: "name", target: null, text: "gecko" },
  ]);
});

test("free text is terminal and is not re-segmented", () => {
  // A name may contain action words. Resolving this syntactically rather than
  // by a silence timeout is what keeps typing and speaking on one grammar.
  const r = parse("name cap enter the field and branch");
  assert.deepEqual(r.commands, [
    { action: "name", target: "c", text: "enter the field and branch" },
  ]);
  assert.equal(r.pending, null);
});

test("a mark token fills the optional target slot, anything else starts the text", () => {
  assert.deepEqual(parse("name cap cap").commands, [
    { action: "name", target: "c", text: "cap" },
  ]);
  assert.deepEqual(parse("name gecko session").commands, [
    { action: "name", target: null, text: "gecko session" },
  ]);
});

test("a half-typed command reports the slot being filled", () => {
  // The parser runs on every keystroke, so this is the common case, not an
  // edge case.
  const target = parse("enter ");
  assert.equal(target.type, COMMANDS);
  assert.deepEqual(target.pending, {
    action: "enter",
    expect: "target",
    accepts: ["node"],
  });
  assert.deepEqual(target.commands, []);

  const text = parse("name cap");
  assert.deepEqual(text.pending, {
    action: "name",
    expect: "text",
    accepts: [],
  });

  const chained = parse("branch enter");
  assert.deepEqual(chained.commands, [
    { action: "branch", target: null, text: null },
  ]);
  assert.equal(chained.pending.action, "enter");
});

test("an optional target may simply be absent", () => {
  assert.deepEqual(parse("back").commands, [
    { action: "back", target: null, text: null },
  ]);
  assert.deepEqual(
    parse("up field pack what").commands.map(c => c.action),
    ["up", "field", "pack", "what"]
  );
});

test("a required target that is not a mark makes the line prose", () => {
  const r = parse("enter gecko");
  assert.equal(r.type, QUERY);
  assert.equal(r.query, "enter gecko");
});

test("a token that cannot continue the parse makes the line prose", () => {
  const r = parse("field gecko");
  assert.equal(r.type, QUERY);
  assert.equal(r.query, "field gecko");
});

// The rule above is not a corner case. Most action words are ordinary English,
// so the queries that collide with them are the most obvious things a user
// could type. Every one of these used to come back as a syntax error.
test("ordinary queries that open with an action word still search", () => {
  for (const q of [
    "what is a memex",
    "back pain",
    "field of view",
    "branch prediction",
    "up arrow unicode",
    "context switching in linux",
    "pack rat",
    "model railway",
    "enter the dragon",
  ]) {
    const r = parse(q);
    assert.equal(r.type, QUERY, `${q} should be a query`);
    assert.equal(r.query, q);
  }
});

test("falling back to prose never invents a partial command", () => {
  const r = parse("field gecko");
  assert.deepEqual(r.commands, [], "a query carries no commands");
  assert.equal(r.error, null);
});

// The line is syntax, not semantics: a well-formed command naming a mark that
// is dead or wrong-typed is what the user meant, and must not quietly become a
// web search.
test("a semantic mark failure stays an error rather than becoming a query", () => {
  const marks = new MarkRegistry();
  marks.assign("g1", { label: "gecko", type: "node" });
  const r = parse("enter cap", { marks });
  assert.equal(r.type, ERROR);
  assert.equal(r.error.code, E_DEAD_MARK);
});

test("marks are checked against the live registry when one is supplied", () => {
  const marks = new MarkRegistry();
  marks.assign("c1", { label: "gecko", type: "node" });

  assert.equal(parse("enter gust", { marks }).commands[0].target, "g");

  const dead = parse("enter cap", { marks });
  assert.equal(dead.type, ERROR);
  assert.equal(dead.error.code, E_DEAD_MARK);
  assert.equal(dead.error.letter, "c");

  // Without a registry the same input is syntactically fine. Liveness is not
  // the parser's business.
  assert.equal(parse("enter cap").type, COMMANDS);
});

test("an action refuses a mark of the wrong type", () => {
  const marks = new MarkRegistry();
  marks.assign("x1", { label: "spidermonkey", type: "context" });
  const r = parse("enter sun", { marks });
  assert.equal(r.type, ERROR);
  assert.equal(r.error.code, E_WRONG_TYPE);
  assert.equal(r.error.got, "context");
  assert.deepEqual(r.error.accepts, ["node"]);
  // The same mark is fine for the verb that does accept a context.
  assert.equal(parse("context sun", { marks }).type, COMMANDS);
});

test("every action parses from a bare utterance", () => {
  // A cheap guard that the table and the parser cannot drift apart: nothing in
  // ACTIONS may be unreachable from the grammar.
  for (const [word, spec] of Object.entries(ACTIONS)) {
    const line =
      word +
      (spec.target === "required" ? " cap" : "") +
      (spec.text ? " some text" : "");
    const r = parse(line);
    assert.equal(r.type, COMMANDS, `"${line}" should parse`);
    assert.equal(r.pending, null, `"${line}" should be complete`);
    assert.equal(r.commands[0].action, word);
  }
});

test("forward is temporal, so it takes no target and back keeps the marks", () => {
  // The decision run 56 made, in the one place it is checkable cheaply. Nyxt —
  // the only shipped browser with a history tree — needs three commands to say
  // forward, because its backwards goes to the *parent* and structure branches.
  // Here `up` owns the parent, which frees back and forward to be steps along
  // the walk the user made, and a walk has one future however many children a
  // node has. So `forward` is bare, and the plural form is `back <mark>`.
  assert.equal(ACTIONS.forward.target, "none");
  assert.deepEqual(ACTIONS.forward.accepts, []);
  assert.equal(ACTIONS.up.target, "none", "the structural move is still `up`");
  assert.deepEqual(
    ACTIONS.back.accepts,
    ["node"],
    "and naming a node to move to is still `back`, in either direction"
  );

  const bare = parse("forward");
  assert.equal(bare.type, COMMANDS);
  assert.equal(bare.commands[0].action, "forward");
  assert.equal(bare.commands[0].target, null);

  // Not an error: an unknown trailing word makes the whole line a search, which
  // is how every other targetless verb behaves and is what stops the bar from
  // refusing a sentence that merely starts with a verb.
  assert.equal(parse("forward cap").type, QUERY);
});
