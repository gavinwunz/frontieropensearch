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
const { PlacesTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/PlacesTestUtils.sys.mjs"
);

requestLongerTimeout(10);

/** A page whose title answers the query without sharing a word with it. */
const ANSWER = "https://example.org/as-we-may-think";
const ANSWER_TITLE = "As We May Think: The Memex and Associative Indexing";

/** A page from another enquiry entirely, to prove the floor does something. */
const UNRELATED = "https://example.org/dutch-oven-bread";
const UNRELATED_TITLE = "Baking Sourdough Bread in a Dutch Oven";

/** Typed the way queries are typed, and sharing no term with either title. */
const QUERY = "hypertext research trails linking";

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
  await PlacesTestUtils.addVisits([
    { uri: Services.io.newURI(ANSWER), title: ANSWER_TITLE },
    { uri: Services.io.newURI(UNRELATED), title: UNRELATED_TITLE },
  ]);
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
  Assert.deepEqual([...first], [...second], "the same text embeds the same");
});
