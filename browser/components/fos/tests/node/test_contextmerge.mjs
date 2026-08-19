/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* These tests run under `node --test`, not in Gecko, so a static import of a
 * system module is correct here. */
/* eslint-disable mozilla/reject-import-system-module-from-non-system */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  MERGE_FLOOR,
  bestMerge,
  contextSimilarity,
} from "../../FOSContextMerge.sys.mjs";

/**
 * A unit vector at `turns` of a turn around the first two axes.
 *
 * Real embeddings are not available in a node test and are not what these
 * assertions are about: the rule is that a score is the mean of every cross
 * pair and that a floor is compared against, and vectors whose angle is known
 * exactly say whether it is. `cos(theta)` between two of these is the cosine
 * the rule will see.
 *
 * @param {number} turns
 * @returns {number[]}
 */
function at(turns) {
  const angle = turns * 2 * Math.PI;
  return [Math.cos(angle), Math.sin(angle), 0];
}

describe("contextSimilarity", () => {
  it("is the mean over every cross pair, not the best of them", () => {
    // One pair identical, one orthogonal: max would say 1, the mean says 0.5.
    const score = contextSimilarity([at(0)], [at(0), at(0.25)]);
    assert.ok(Math.abs(score - 0.5) < 1e-9, `expected 0.5, got ${score}`);
  });

  it("does not climb when a context grows, which is why it is the rule", () => {
    // The finding `agent/jobs/run39.sh` measured: an order statistic rises
    // with the number of pairs compared and a mean does not. Doubling one
    // side with more of the same vector must leave the score alone.
    const small = contextSimilarity([at(0)], [at(0.1)]);
    const large = contextSimilarity([at(0), at(0)], [at(0.1), at(0.1)]);
    assert.ok(Math.abs(small - large) < 1e-9, `${small} vs ${large}`);
  });

  it("is dragged down by an unrelated member rather than ignoring it", () => {
    const tight = contextSimilarity([at(0)], [at(0)]);
    const broad = contextSimilarity([at(0)], [at(0), at(0.25)]);
    assert.ok(broad < tight);
  });

  it("scores an empty context as zero rather than dividing by nothing", () => {
    assert.equal(contextSimilarity([], [at(0)]), 0);
    assert.equal(contextSimilarity([at(0)], []), 0);
    assert.equal(contextSimilarity(undefined, undefined), 0);
  });
});

describe("bestMerge", () => {
  const active = { activeId: 1, activeVectors: [at(0)] };

  it("offers nothing when the best candidate is below the floor", () => {
    // 0.2 of a turn is 72 degrees: cosine ~0.309, above the floor, so the
    // control has to be further round than that to prove the floor is read.
    const offer = bestMerge({
      ...active,
      candidates: [{ id: 2, label: "elsewhere", vectors: [at(0.24)] }],
    });
    assert.equal(offer, null);
  });

  it("offers the candidate above the floor", () => {
    const offer = bestMerge({
      ...active,
      candidates: [{ id: 2, label: "same thing", vectors: [at(0.02)] }],
    });
    assert.ok(offer);
    assert.equal(offer.contextId, 2);
    assert.equal(offer.label, "same thing");
    assert.ok(offer.score >= MERGE_FLOOR);
  });

  it("offers one, never a list", () => {
    const offer = bestMerge({
      ...active,
      candidates: [
        { id: 2, label: "close", vectors: [at(0.05)] },
        { id: 3, label: "closer", vectors: [at(0.01)] },
      ],
    });
    assert.equal(offer.contextId, 3);
    assert.equal(typeof offer, "object");
    assert.ok(!Array.isArray(offer));
  });

  it("never offers the active context to itself", () => {
    const offer = bestMerge({
      ...active,
      candidates: [{ id: 1, label: "itself", vectors: [at(0)] }],
    });
    assert.equal(offer, null);
  });

  it("never re-offers a declined pair, whichever way round it is keyed", () => {
    const candidates = [{ id: 2, label: "refused", vectors: [at(0.01)] }];
    assert.ok(bestMerge({ ...active, candidates }));
    assert.equal(
      bestMerge({ ...active, candidates, declined: new Set(["1:2"]) }),
      null
    );
    // The same pair reached from the other side is the same statement.
    assert.equal(
      bestMerge({
        activeId: 2,
        activeVectors: [at(0.01)],
        candidates: [{ id: 1, label: "refused", vectors: [at(0)] }],
        declined: new Set(["1:2"]),
      }),
      null
    );
  });

  it("passes over a declined pair to offer the next one up", () => {
    const offer = bestMerge({
      ...active,
      candidates: [
        { id: 2, label: "best but refused", vectors: [at(0.005)] },
        { id: 3, label: "next", vectors: [at(0.02)] },
      ],
      declined: new Set(["1:2"]),
    });
    assert.equal(offer.contextId, 3);
  });

  it("breaks a tie towards the enquiry that started first", () => {
    const offer = bestMerge({
      ...active,
      candidates: [
        { id: 7, label: "later", vectors: [at(0.01)] },
        { id: 3, label: "earlier", vectors: [at(0.01)] },
      ],
    });
    assert.equal(offer.contextId, 3);
  });

  it("skips a candidate with no queries rather than scoring it zero", () => {
    const offer = bestMerge({
      ...active,
      candidates: [{ id: 2, label: "no queries", vectors: [] }],
    });
    assert.equal(offer, null);
  });

  it("reports a null label rather than inventing one", () => {
    const offer = bestMerge({
      ...active,
      candidates: [{ id: 2, label: null, vectors: [at(0)] }],
    });
    assert.equal(offer.label, null);
  });
});
