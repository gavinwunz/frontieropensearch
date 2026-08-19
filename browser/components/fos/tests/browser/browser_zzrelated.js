/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * The `related` tier, end to end, with a real model.
 *
 * `browser_suggest.js` covers the five tiers that need no weights and
 * `test_suggest.mjs` covers the ordering. This file covers the one claim
 * neither can make: that a page sharing **no word at all** with what was typed
 * is offered, because a model put it there.
 *
 * That claim is the entire justification for the tier — the measurement in
 * `browser_zzembedquality.js` found that a third of real queries score every
 * candidate identically at zero under the strict predicate — so it is worth a
 * file that proves it in a browser rather than a mock that assumes it.
 *
 * Gated and off by default, like every other measurement here, because it
 * needs weights this repository does not carry:
 *
 *   agent/jobs/fetch-static-embeddings.sh   # once, outside the repo
 *   agent/jobs/run37.sh                     # runs this against a local hub
 *
 * Without `MOZ_MODELS_HUB` it skips rather than reaching for the network,
 * which under mochitest would kill the process rather than fail the test.
 */

const { FOSContextEngine } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextEngine.sys.mjs"
);
const { FOSEmbeddings } = ChromeUtils.importESModule(
  "resource:///modules/FOSEmbeddings.sys.mjs"
);
const { RELATED_FLOOR, T_RELATED, TIER_LABELS, pageMatches } =
  ChromeUtils.importESModule("resource:///modules/FOSSuggest.sys.mjs");
requestLongerTimeout(10);

/**
 * A page whose title answers the query without sharing a word with it, and one
 * from another enquiry entirely so that the floor is doing something.
 *
 * The pair is *measured*, not chosen by eye — a bag-of-tokens model's
 * similarity between two texts with no overlap is not something a person can
 * estimate from reading them, and the first attempt at this fixture scored
 * 0.159 against a floor of 0.173 and failed. `browser_zzembedquality.js`
 * scored eight candidates and these are the ends of that range: 0.36 for the
 * pair below and 0.014 for the control, both with no term in common.
 */
const FIXTURES =
  "https://example.com/browser/browser/components/fos/tests/browser/fixtures/";

const ANSWER = `${FIXTURES}lisbon.html`;
const ANSWER_TITLE = "Lisbon Travel Guide: Where to Stay";

const UNRELATED = `${FIXTURES}sourdough.html`;
const UNRELATED_TITLE = "Baking Sourdough Bread in a Dutch Oven";

/** Typed the way queries are typed, and sharing no term with either title. */
const QUERY = "cheap airfare to portugal";

function engine() {
  return FOSContextEngine.forWindow(window);
}

function skipUnlessWeights() {
  if (Services.env.get("MOZ_MODELS_HUB")) {
    return false;
  }
  ok(
    true,
    "skipped: no MOZ_MODELS_HUB. Run agent/jobs/fetch-static-embeddings.sh " +
      "and then agent/jobs/run37.sh."
  );
  return true;
}

add_setup(async function () {
  if (skipUnlessWeights()) {
    return;
  }
  // The tier is off by default because turning it on authorises a model
  // download; see `FOSEmbeddings`. A test that needs the tier has to say so,
  // which is the same statement a user's "download the search model" step will
  // make.
  await SpecialPowers.pushPrefEnv({
    set: [["browser.fos.suggest.semanticTier", true]],
  });

  // Both pages are *browsed*, not merely inserted into Places. The tier draws
  // its candidates from what this fork knows — the trail, the context and its
  // crossings — and deliberately not from the floor, whose rows have already
  // been filtered by a lexical query and so cannot contain a page that shares
  // no word with the text. See `FOSContextEngine.#related`.
  for (const url of [ANSWER, UNRELATED]) {
    BrowserTestUtils.startLoadingURIString(gBrowser.selectedBrowser, url);
    await BrowserTestUtils.browserLoaded(gBrowser.selectedBrowser, false, url);
  }
  await FOSContextEngine.forWindow(window).settled;

  registerCleanupFunction(async () => {
    await PlacesUtils.history.remove([ANSWER, UNRELATED]);
    await FOSEmbeddings.shutdown();
  });
});

add_task(async function test_a_page_sharing_no_word_is_still_offered() {
  if (skipUnlessWeights()) {
    return;
  }

  // The premise, asserted rather than assumed: every tier but this one would
  // reject both pages outright, so anything offered below came from the model.
  Assert.ok(
    !pageMatches(QUERY, { url: ANSWER, title: ANSWER_TITLE }),
    "the answering page shares no term with the query"
  );

  const rows = await engine().suggest(QUERY);
  const row = rows.find(each => each.url === ANSWER);
  Assert.ok(row, "the page that answers the query by meaning is offered");
  Assert.equal(row.tier, T_RELATED, "in the related tier");
  Assert.equal(
    row.group,
    TIER_LABELS[T_RELATED],
    "and the heading says why it is there"
  );

  const unrelated = rows.find(each => each.url === UNRELATED);
  Assert.ok(
    !unrelated,
    "and a page from another enquiry is not dragged in behind it"
  );
});

add_task(async function test_the_engine_agrees_with_the_floor_it_ships() {
  if (skipUnlessWeights()) {
    return;
  }

  // The threshold is a measured number, so a model that quietly changed under
  // us — a different revision, a different dimension — should fail here rather
  // than silently empty the tier.
  const [query, answer, unrelated] = await FOSEmbeddings.embed([
    QUERY,
    ANSWER_TITLE,
    UNRELATED_TITLE,
  ]);
  const { cosine } = ChromeUtils.importESModule(
    "resource:///modules/FOSSuggest.sys.mjs"
  );

  Assert.equal(query.length, 256, "the dimension this fork chose");
  Assert.greater(
    cosine(query, answer),
    RELATED_FLOOR,
    "the answering title clears the measured floor"
  );
  Assert.less(
    cosine(query, unrelated),
    RELATED_FLOOR,
    "and a title from another enquiry does not"
  );
});

add_task(async function test_a_second_query_reuses_the_vectors() {
  if (skipUnlessWeights()) {
    return;
  }

  // Not a performance assertion — a correctness one. The cache is keyed by
  // text, so a second read must return the same vector rather than a stale or
  // shifted one, and this is the cheapest way to notice if it ever does not.
  const [first] = await FOSEmbeddings.embed([ANSWER_TITLE]);
  const [second] = await FOSEmbeddings.embed([ANSWER_TITLE]);
  // Compared as one number rather than with deepEqual: a failing deepEqual on
  // two 256-element arrays prints both of them, which is a screenful of log
  // for a fact that fits on a line.
  Assert.ok(
    first.every((value, index) => value === second[index]),
    "the same text embeds the same"
  );
});
