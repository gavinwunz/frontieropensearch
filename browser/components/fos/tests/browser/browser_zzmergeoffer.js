/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * The merge offer, end to end, with a real model.
 *
 * `test_contextmerge.mjs` covers the arithmetic and
 * `browser_contextsidebar.js` covers the surface — and it covers it with the
 * offer *doubled*, because no ordinary run has the weights. This file is the
 * other half of that split, and the reason it exists is a specific past
 * failure rather than symmetry: `browser_voice.js` doubled `ModelHub.listFiles`
 * as an array, the real one resolves to `{files, metadata}`, and because the
 * production code was written to match the double the presence check answered
 * "no weights" on every machine for thirteen green runs. **For every API this
 * fork doubles, one test somewhere has to use the real thing.**
 *
 * What only a real engine can say here is that two contexts built by *browsing*
 * — not by inserting rows — produce vectors the floor separates. The queries
 * are the ones the corpus was measured over, so a failure means the wiring
 * moved, not that the model changed its mind.
 *
 * Gated and off by default, like every other measurement here:
 *
 *   agent/jobs/fetch-static-embeddings.sh   # once, outside the repo
 *   agent/jobs/run39.sh                     # runs this against a local hub
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
const { MERGE_FLOOR } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextMerge.sys.mjs"
);

requestLongerTimeout(10);

const FIXTURES =
  "https://example.com/browser/browser/components/fos/tests/browser/fixtures/";

const LISBON = `${FIXTURES}lisbon.html`;
const SOURDOUGH = `${FIXTURES}sourdough.html`;

/**
 * Two questions about one enquiry, and one about another.
 *
 * Straight out of the corpus `run39.sh` scored, which is what makes a failure
 * here a statement about this fork's wiring rather than about the model.
 */
const TRAVEL = [
  "flights to lisbon in october",
  "where to stay in lisbon alfama",
];
const BAKING = ["sourdough starter not rising", "why is my crumb so dense"];

function engine() {
  return FOSContextEngine.forWindow(window);
}

function bar() {
  return ChromeUtils.importESModule(
    "resource:///modules/FOSCommandBar.sys.mjs"
  ).FOSCommandBar.forWindow(window);
}

function skipUnlessWeights() {
  if (Services.env.get("MOZ_MODELS_HUB")) {
    return false;
  }
  ok(
    true,
    "skipped: no MOZ_MODELS_HUB. Run agent/jobs/fetch-static-embeddings.sh " +
      "and then agent/jobs/run39.sh."
  );
  return true;
}

/**
 * Browse a page in its own tab, asking the questions that led there.
 *
 * A trail is a tab in this build, so a new tab is what makes a second context
 * exist at all — and the queries have to go through the command bar's own
 * recording path, because that is what puts them in the context this reads.
 *
 * @param {string} url
 * @param {string[]} queries
 * @returns {Promise<{tab: object, contextId: number}>}
 */
async function enquire(url, queries) {
  // Bare `context` releases any pin, so that the active context follows the
  // trail this opens rather than one an earlier file pinned.
  await bar().actions.run({ action: "context", target: null, text: null })
    .result;
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);
  for (const raw of queries) {
    engine().recordQuery(raw, { inputMode: "keyboard" });
  }
  await engine().settled;
  return { tab, contextId: engine().activeContextId };
}

add_setup(async function () {
  if (skipUnlessWeights()) {
    return;
  }
  // The product's own first-run path, not a shortcut around it: since run 38
  // nothing but `download` may fetch weights, so the pref alone is not enough.
  Assert.ok(
    await bar().actions.run({ action: "model", target: null, text: null })
      .result,
    "the model verb fetched the weights and switched the tier on"
  );

  registerCleanupFunction(async () => {
    await PlacesUtils.history.remove([LISBON, SOURDOUGH]);
    await FOSEmbeddings.shutdown();
    Services.prefs.clearUserPref("browser.fos.suggest.semanticTier");
  });
});

add_task(async function test_two_halves_of_one_enquiry_are_offered() {
  if (skipUnlessWeights()) {
    return;
  }

  // The same enquiry, split across two tabs — which is exactly the situation
  // provenance cannot see, because opening a tab is the user saying "separate"
  // and they were right at the time.
  const first = await enquire(LISBON, TRAVEL.slice(0, 1));
  const second = await enquire(LISBON, TRAVEL.slice(1));
  Assert.notEqual(first.contextId, second.contextId, "two contexts");

  const offer = await engine().mergeOffer();
  Assert.ok(offer, "the model found the other half of the enquiry");
  Assert.equal(offer.contextId, first.contextId, "and it is the right one");
  Assert.greaterOrEqual(
    offer.score,
    MERGE_FLOOR,
    "at or above the floor it ships"
  );

  BrowserTestUtils.removeTab(first.tab);
  BrowserTestUtils.removeTab(second.tab);
});

add_task(async function test_a_different_enquiry_is_not_offered() {
  if (skipUnlessWeights()) {
    return;
  }
  // The half of the claim that a permissive rule would also satisfy. Without
  // it, a floor of zero would pass the test above.
  const travel = await enquire(LISBON, TRAVEL);
  const baking = await enquire(SOURDOUGH, BAKING);

  const offer = await engine().mergeOffer();
  if (offer) {
    Assert.notEqual(
      offer.contextId,
      travel.contextId,
      "baking is not offered as the same enquiry as a trip to Lisbon"
    );
  } else {
    Assert.ok(true, "nothing was near enough to ask about");
  }

  BrowserTestUtils.removeTab(travel.tab);
  BrowserTestUtils.removeTab(baking.tab);
});

add_task(async function test_accepting_survives_into_the_store() {
  if (skipUnlessWeights()) {
    return;
  }
  const first = await enquire(LISBON, TRAVEL.slice(0, 1));
  const second = await enquire(LISBON, TRAVEL.slice(1));

  const offer = await engine().mergeOffer();
  Assert.ok(offer, "there is something to accept");
  Assert.ok(await engine().acceptMerge(offer.contextId), "it was accepted");

  const survivor = Math.min(first.contextId, second.contextId);
  Assert.equal(
    engine().activeContextId,
    survivor,
    "the trail now resolves to the enquiry that started first"
  );

  // And the offer does not come back, because there is nothing left to ask.
  Assert.equal(
    await engine().mergeOffer(),
    null,
    "a merged pair is never offered to itself"
  );

  const contents = await engine().contents();
  Assert.equal(
    contents.queries.length,
    TRAVEL.length,
    "and `what` answers about the whole enquiry"
  );

  BrowserTestUtils.removeTab(first.tab);
  BrowserTestUtils.removeTab(second.tab);
});

add_task(async function test_a_declined_pair_is_never_offered_again() {
  if (skipUnlessWeights()) {
    return;
  }
  const first = await enquire(LISBON, TRAVEL.slice(0, 1));
  const second = await enquire(LISBON, TRAVEL.slice(1));

  const offer = await engine().mergeOffer();
  Assert.ok(offer, "there is something to decline");
  await engine().declineMerge(offer.contextId);

  const again = await engine().mergeOffer();
  Assert.ok(
    !again || again.contextId !== offer.contextId,
    "the refusal sticks against the real chooser, not only against the store"
  );

  BrowserTestUtils.removeTab(first.tab);
  BrowserTestUtils.removeTab(second.tab);
});
