/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * Link marks in a real window, over a real page, in a content process.
 *
 * Which links deserve a letter and which letter they get is decided by pure
 * code and tested in node (`tests/node/test_linkmarks.mjs`); none of that is
 * repeated here. What this file covers is everything node cannot see: that the
 * actor is registered and reachable, that the page's links are actually found
 * across a process boundary, that the letters are actually drawn, that saying
 * one navigates, and that the marks die with the page they described.
 *
 * The last of those is the one worth the most. A stale mark is not a mark that
 * does nothing — it is a letter still on screen that would follow a link on a
 * page the user has left, which for a hands-free user is the worst failure this
 * feature can have.
 */

const { FOSCommandBar } = ChromeUtils.importESModule(
  "resource:///modules/FOSCommandBar.sys.mjs"
);
const { FOSLinkSurface, linkKey } = ChromeUtils.importESModule(
  "resource:///modules/FOSLinkSurface.sys.mjs"
);

const { markWord } = ChromeUtils.importESModule(
  "resource:///modules/FOSMarks.sys.mjs"
);
const { parse } = ChromeUtils.importESModule(
  "resource:///modules/FOSCommandParser.sys.mjs"
);

const FIXTURES =
  "https://example.com/browser/browser/components/fos/tests/browser/fixtures/";
const FIXTURE = `${FIXTURES}links.html`;

function bar() {
  return FOSCommandBar.forWindow(window);
}

function links() {
  return FOSLinkSurface.forWindow(window);
}

/** The marks currently on the page, letter → label. */
function marked() {
  return Object.fromEntries(
    links()
      .marks.candidates(["link"])
      .map(row => [row.letter, row.label])
  );
}

registerCleanupFunction(() => {
  links().clear();
  bar().close();
  bar().dismissNotice();
});

add_task(async function test_the_page_is_addressable_at_all() {
  await BrowserTestUtils.withNewTab(FIXTURE, async () => {
    const surface = links();
    Assert.ok(!surface.isMarked, "nothing is marked before it is asked for");

    const outcome = await surface.mark();

    Assert.ok(surface.isMarked, "the page carries marks");
    Assert.greater(outcome.assigned.length, 0, "letters were assigned");
    // The only evidence available in this process that anything reached the
    // page: anonymous content is invisible to the chrome and to the page alike,
    // so the count the child reports back is the whole of what can be asserted.
    Assert.greaterOrEqual(
      outcome.painted,
      outcome.assigned.length,
      "at least one badge drawn per letter"
    );

    const byLetter = marked();
    const labels = Object.values(byLetter);
    Assert.ok(
      labels.includes("the memex essay"),
      `a link is named by its own text — got ${JSON.stringify(labels)}`
    );
    // The two links with no text at all. These are the ones that would be
    // unaddressable-in-practice if the label fell back to nothing, because a
    // letter assigned from an empty string is a letter nobody can guess.
    Assert.ok(labels.includes("Demonstration"), "an aria-label names an icon");
    Assert.ok(labels.includes("Baking notes"), "a title names an icon");
    Assert.ok(labels.includes("Gravity"), 'role="link" is addressable');

    // Mnemonic, which is the property that makes a mark worth learning. It is
    // asserted on a label whose first letter cannot have been taken, because
    // assignment order is document order and this is the first "G" on the page.
    Assert.equal(byLetter.g, "Gravity", "the letter comes from the label");
  });
});

add_task(async function test_a_mark_goes_only_to_what_is_on_screen() {
  await BrowserTestUtils.withNewTab(FIXTURE, async browser => {
    await links().mark();
    const labels = Object.values(marked());

    // `GRAMMAR.md` §2 draws this line and the child enforces it. All three of
    // these are links; none of them is something the user can see, and a letter
    // spent on one is a letter taken from a link they can.
    Assert.ok(!labels.includes("Lisbon"), "display:none is not marked");
    Assert.ok(
      !labels.includes("Lisbon again"),
      "visibility:hidden is not marked"
    );
    Assert.ok(
      !labels.includes("Four screens down"),
      "a link below the fold is not marked"
    );

    // And it becomes markable by being brought on screen, which is what makes
    // re-running the verb the answer to a long page rather than a workaround.
    await SpecialPowers.spawn(browser, [], () => {
      content.document.getElementById("below").scrollIntoView();
    });
    await links().mark();
    Assert.ok(
      Object.values(marked()).includes("Four screens down"),
      "scrolled into view, it is marked"
    );
  });
});

add_task(async function test_one_destination_gets_one_letter_and_two_badges() {
  await BrowserTestUtils.withNewTab(FIXTURE, async () => {
    const outcome = await links().mark();
    const byLetter = marked();

    const xanadu = Object.entries(byLetter).filter(([, label]) =>
      ["Xanadu, illustrated", "Project Xanadu"].includes(label)
    );
    Assert.equal(
      xanadu.length,
      1,
      `the thumbnail and its headline share one letter — got ${JSON.stringify(
        xanadu
      )}`
    );
    // But both are still drawn on. A visibly clickable thing with no badge
    // beside it reads as "this one is not reachable", which would be a lie.
    Assert.greater(
      outcome.painted,
      outcome.assigned.length,
      "the alias carries a badge of its own"
    );
  });
});

add_task(async function test_saying_a_letter_follows_the_link() {
  await BrowserTestUtils.withNewTab(FIXTURE, async browser => {
    await links().mark();
    const letter = Object.entries(marked()).find(
      ([, label]) => label === "the memex essay"
    )?.[0];
    Assert.ok(letter, "the essay is marked");

    const loaded = BrowserTestUtils.browserLoaded(browser, false, url =>
      url.endsWith("memex.html")
    );
    Assert.ok(await links().follow(letter), "the link was activated");
    await loaded;

    Assert.ok(
      browser.currentURI.spec.endsWith("memex.html"),
      "the page the letter named is the page we are on"
    );
  });
});

add_task(async function test_the_whole_line_runs_through_the_command_bar() {
  // The same thing again through the one entry surface, because that is the
  // path a user has and the path a transcript has. `FOSVoiceInput` writes a
  // line into this input and runs it; nothing below `run` knows which modality
  // produced it, so a line that works here works spoken.
  await BrowserTestUtils.withNewTab(FIXTURE, async browser => {
    bar().open();
    bar().run("follow");
    // The verb is asynchronous — the links are in another process — so the bar
    // has closed before the marks land.
    await TestUtils.waitForCondition(
      () => links().isMarked,
      "the marks arrive after the line has run"
    );

    const letter = Object.entries(marked()).find(
      ([, label]) => label === "the memex essay"
    )?.[0];
    const word = markWord(letter);

    const loaded = BrowserTestUtils.browserLoaded(browser, false, url =>
      url.endsWith("memex.html")
    );
    // Said, not typed: the spoken word for the letter, into the same input.
    bar().open();
    bar().run(`follow ${word}`);
    await loaded;

    Assert.ok(
      browser.currentURI.spec.endsWith("memex.html"),
      "the spoken form of the mark reaches the same link"
    );
    Assert.ok(!links().isMarked, "and the letters came down with it");
  });
});

add_task(async function test_the_marks_die_with_the_page_they_described() {
  await BrowserTestUtils.withNewTab(FIXTURE, async browser => {
    await links().mark();
    Assert.ok(links().isMarked, "marked");

    // A navigation the marks had nothing to do with. Every element handle the
    // child is holding dies with the document, so a letter that survived would
    // name nothing — or, worse, would name whatever took its index on the new
    // page.
    BrowserTestUtils.startLoadingURIString(browser, `${FIXTURES}lisbon.html`);
    await BrowserTestUtils.browserLoaded(browser);

    Assert.ok(!links().isMarked, "the marks went with the page");
    Assert.equal(
      links().marks.candidates(["link"]).length,
      0,
      "and the alphabet is free again"
    );
    Assert.equal(
      await links().follow("a"),
      false,
      "following a dead letter does nothing"
    );
  });
});

add_task(async function test_a_fragment_is_not_a_new_page() {
  await BrowserTestUtils.withNewTab(FIXTURE, async browser => {
    await links().mark();
    const before = marked();

    await SpecialPowers.spawn(browser, [], () => {
      content.location.hash = "#somewhere";
    });
    await TestUtils.waitForTick();

    // The links did not move. Taking the letters down here would mean an
    // in-page anchor — the navigation most likely to be followed by another
    // `follow` — cost the user their marks every time.
    Assert.ok(links().isMarked, "a same-document navigation keeps the marks");
    Assert.deepEqual(marked(), before, "and keeps the same letters");
  });
});

add_task(async function test_re_marking_does_not_walk_the_alphabet() {
  await BrowserTestUtils.withNewTab(FIXTURE, async () => {
    const first = await links().mark();
    const letters = marked();
    const second = await links().mark();

    // Stickiness cannot hold across a re-mark — the links are collected afresh
    // and their ids are indices into that pass — but the *letters* must, or
    // marking twice would drift down the alphabet and nothing would ever be
    // learnable. Emptying the registry before reassigning is what makes the
    // second pass identical to the first.
    Assert.deepEqual(marked(), letters, "the same page marks the same way");
    Assert.equal(
      second.assigned.length,
      first.assigned.length,
      "and no letters were lost to the previous set"
    );
  });
});

add_task(async function test_a_re_mark_leaves_nothing_of_the_last_one() {
  // The case the assertion above cannot see, and a mutation found: re-marking
  // an *unchanged* page is idempotent whether or not the registry is emptied
  // first, because the same links get the same ids and `assign` is sticky. It
  // is only when the page has moved that skipping the clear does damage.
  //
  // The damage is not that the letters look untidy. A letter held from the
  // previous pass is live in the registry and absent from the child's map, so
  // the parser accepts it and the page ignores it — `follow` on a mark the user
  // can see, that silently does nothing. Every letter the registry holds must
  // be one the page will act on.
  await BrowserTestUtils.withNewTab(FIXTURE, async browser => {
    await links().mark();

    await SpecialPowers.spawn(browser, [], () => {
      content.document.getElementById("below").scrollIntoView();
    });
    const second = await links().mark();

    Assert.equal(
      links().marks.candidates(["link"]).length,
      second.assigned.length,
      "the alphabet holds this pass's letters and no others"
    );

    // And every one of them reaches the page rather than being accepted and
    // dropped. Checked by following one, which is the only way to ask.
    const letter = Object.keys(marked())[0];
    const loaded = BrowserTestUtils.browserLoaded(browser, false, () => true);
    Assert.ok(
      await links().follow(letter),
      "a letter from the second pass still names a link"
    );
    await loaded;
  });
});

add_task(async function test_the_page_has_its_own_alphabet() {
  // The claim `ScopedMarks` exists for, tested where both scopes are real: the
  // window's registry is full of trail nodes by now, and the page's letters are
  // assigned independently of them. A shared alphabet would have made this
  // impossible rather than merely wrong.
  await BrowserTestUtils.withNewTab(FIXTURE, async () => {
    await links().mark();
    const letter = Object.keys(marked())[0];
    Assert.ok(letter, "the page marked something");

    const windowMarks = bar().marks;
    windowMarks.clear();
    // Force a collision: give a node the letter a link already holds.
    windowMarks.assign("node:999", {
      label: letter,
      type: "node",
    });
    Assert.equal(
      windowMarks.markOf("node:999"),
      letter,
      "the node took the same letter, which a shared alphabet would forbid"
    );

    const word = markWord(letter);

    // One letter, two objects, and the verb is what decides. Neither line is
    // ambiguous to the parser and neither is ambiguous to a speaker.
    const bag = bar();
    const asLink = parse(`follow ${word}`, { marks: bag.markLookup });
    const asNode = parse(`enter ${word}`, { marks: bag.markLookup });
    Assert.equal(asLink.type, "commands", "follow resolves it as a link");
    Assert.equal(asLink.commands[0].target, letter);
    Assert.equal(asNode.type, "commands", "enter resolves it as a node");
    Assert.equal(asNode.commands[0].target, letter);

    // Two scopes, one letter, two objects — which is the whole of the claim.
    Assert.notEqual(
      links().marks.objectAt(letter),
      windowMarks.objectAt(letter),
      "the two scopes hold different objects under one letter"
    );
    Assert.equal(windowMarks.objectAt(letter), "node:999");
    Assert.equal(
      links().marks.objectAt(letter),
      linkKey(links().marks.entryAt(letter).id.replace("link:", "")),
      "and the page's is a link key"
    );

    windowMarks.clear();
  });
});
