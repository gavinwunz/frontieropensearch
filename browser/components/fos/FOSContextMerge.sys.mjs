/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Deciding whether two contexts are one enquiry — the arithmetic half.
 *
 * Pure, like `FOSSuggest`: it takes vectors it is given and returns a verdict.
 * `FOSContextEngine` owns the store and `FOSEmbeddings` owns the model, so the
 * part that can be reasoned about in a node test is kept where a node test can
 * reach it.
 *
 * WHY AN OFFER AND NEVER AN ACTION
 *
 * Run 36 measured the pairwise floor at precision 0.756 and that killed silent
 * merging outright: a rule that quietly folds two research topics together and
 * is wrong a quarter of the time is worse than no rule, because the user
 * cannot see what it did. Horvitz's mixed-initiative analysis gives the shape
 * that survives — an agent uncertain about a goal has three options rather
 * than two, and the middle one is to *ask*. Dialogue has its own expected
 * value, above inaction when the guess is decent and below action when the
 * guess is near-certain, so it owns a band of probabilities that neither of
 * the others should take.
 *
 * This fork's band is open at the top. There is no confidence at which a merge
 * happens by itself, because the whole point of `context_member.source` and of
 * provenance-before-inference is that the browser does not restructure the
 * user's material behind them. So the only threshold that has to be measured
 * is the bottom one: below it, say nothing.
 *
 * WHY THE MEAN OF PAIRS, AND WHY 0.244
 *
 * Measured, not chosen — `browser_zzembedquality.js`, run by
 * `agent/jobs/run39.sh`, over eight enquiries cut in half so that two halves of
 * one enquiry are a pair that should merge and everything else is a pair that
 * should not. Eight positives against 112 negatives.
 *
 * Four ways of turning many pairwise similarities into one score were scored
 * at the shipped dimension, each at the lowest threshold reaching precision
 * 1.0 — precision rather than F1, because F1 treats a missed merge and a wrong
 * merge as equally bad and this feature does not. A merge never offered costs
 * the user nothing they had; a merge offered wrongly spends their attention,
 * and if accepted puts two unrelated enquiries in one sidebar.
 *
 *   | rule     | threshold | recall at precision 1.0 |
 *   | -------- | --------- | ----------------------- |
 *   | max      | 0.439     | 0.625 (5/8)             |
 *   | **mean** | **0.244** | **0.500 (4/8)**         |
 *   | top3     | 0.281     | 0.500 (4/8)             |
 *   | centroid | 0.408     | 0.500 (4/8)             |
 *
 * `max` has the best recall on that table and is rejected anyway, which is the
 * finding worth keeping. It is an order statistic: it asks whether two
 * contexts share *any* one question, so it climbs with the number of pairs
 * compared whether or not the contexts are any more alike. The corpus scored
 * contexts of two queries — sixteen pairs where a real context is hundreds —
 * so a threshold read off it would be read off the wrong context size, which
 * is run 37's mistake with a different variable in it. Measured rather than
 * argued, by scoring the same rules over whole enquiries instead of halves and
 * reading the different-enquiry side, which is the side a precision-first
 * threshold holds back:
 *
 *   | rule     | diff-task p95, k=2 → k=4 | worst diff-task, k=2 → k=4 |
 *   | -------- | ------------------------ | -------------------------- |
 *   | max      | 0.196 → 0.340  (+73%)    | 0.361 → 0.361              |
 *   | top3     | 0.136 → 0.197  (+45%)    | 0.249 → 0.305              |
 *   | **mean** | **0.115 → 0.094 (−18%)** | **0.207 → 0.127**          |
 *   | centroid | 0.172 → 0.223  (+30%)    | 0.335 → 0.294              |
 *
 * So `max` and `top3` are out on portability, and between the two rules whose
 * thresholds hold still, `mean` and `centroid` tie on recall and `mean` is the
 * steadier: doubling the context size moved its false-positive tail *down*,
 * and its worst different-enquiry score at the larger size is 0.127 against a
 * floor of 0.244 — a margin of nearly two to one. `centroid`'s tail rises.
 *
 * That is also a small verdict on the schema. `context.centroid` is documented
 * as the mean of member embeddings, and this is the measurement that would
 * have justified filling it in; it does not. Nothing writes that column and
 * nothing here needs it.
 *
 * WHAT THE NUMBERS DO NOT SAY. Precision 1.0 means no false positive was
 * observed among 112 different-enquiry pairs, which is a real statement about
 * the negatives and not a guarantee. Recall 0.5 rests on eight positives and
 * is a noisy estimate; read it as "about half", not as 50%. And the size probe
 * doubled a context from two queries to four — mean was flat across that, which
 * is evidence its floor travels, not proof it travels to forty.
 */

import { cosine } from "./FOSSuggest.sys.mjs";

/**
 * The similarity at or above which two contexts are worth asking about.
 *
 * Mean of every query-to-query cosine between the two contexts, at d256 —
 * **the same comparison at the same dimension the number was measured over**,
 * which is the one thing run 37 says a threshold has to be able to state. Any
 * other pairing, any other aggregation or any other dimension needs its own
 * number and must not borrow this one.
 */
export const MERGE_FLOOR = 0.244;

/**
 * How alike two contexts are: the mean of every cross pair.
 *
 * @param {number[][]} left Query vectors for one context.
 * @param {number[][]} right Query vectors for the other.
 * @returns {number} Zero when either side has nothing to compare.
 */
export function contextSimilarity(left, right) {
  if (!left?.length || !right?.length) {
    return 0;
  }
  let total = 0;
  for (const a of left) {
    for (const b of right) {
      total += cosine(a, b);
    }
  }
  return total / (left.length * right.length);
}

/**
 * The one context worth offering to merge with the active one, or null.
 *
 * **One, never a list.** An offer is an interruption, and three at once is a
 * dialog box asking the user to do the browser's filing. Horvitz's eighth
 * principle is to scope the precision of a service to the uncertainty behind
 * it — doing less, correctly, beats doing more under a guess — and the best
 * single candidate is the most that a rule with this recall has earned.
 *
 * Declined pairs are dropped rather than ranked below: a rejection is
 * permanent, because an offer that returns after being turned down is worse
 * than one never made. The second showing is proof the first was not listened
 * to, and it teaches the user to stop reading the surface it appears on.
 *
 * @param {object} options
 * @param {number} options.activeId
 * @param {number[][]} options.activeVectors Query vectors for the active context.
 * @param {{id: number, label: ?string, vectors: number[][]}[]} options.candidates
 * @param {Set<string>} [options.declined] `"low:high"` pairs already refused.
 * @param {number} [options.floor]
 * @returns {?{contextId: number, label: ?string, score: number}}
 */
export function bestMerge({
  activeId,
  activeVectors,
  candidates,
  declined = new Set(),
  floor = MERGE_FLOOR,
}) {
  let best = null;
  for (const candidate of candidates) {
    if (candidate.id === activeId) {
      continue;
    }
    const low = Math.min(activeId, candidate.id);
    const high = Math.max(activeId, candidate.id);
    if (declined.has(`${low}:${high}`)) {
      continue;
    }
    const score = contextSimilarity(activeVectors, candidate.vectors);
    if (score < floor) {
      continue;
    }
    // Ties break towards the lower id — the enquiry that started first — so
    // that the same two contexts always produce the same offer whichever one
    // the user happens to be standing on.
    if (
      !best ||
      score > best.score ||
      (score === best.score && candidate.id < best.contextId)
    ) {
      best = {
        contextId: candidate.id,
        label: candidate.label ?? null,
        score,
      };
    }
  }
  return best;
}
