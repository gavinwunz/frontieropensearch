/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* These tests run under `node --test`, not in Gecko, so a static import of a
 * system module is correct here. */
/* eslint-disable mozilla/reject-import-system-module-from-non-system */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  DEFAULT_LIMIT,
  R_PAGE,
  T_CONTEXT,
  T_CROSSING,
  T_HISTORY,
  T_MARK,
  T_RELATED,
  T_TRAIL,
  RELATED_FLOOR,
  TIER_LABELS,
  TIER_ORDER,
  pageMatches,
  suggestionsFor,
} from "../../FOSSuggest.sys.mjs";

const page = (url, title, extra = {}) => ({ url, title, ...extra });

describe("pageMatches", () => {
  it("matches on the title", () => {
    assert.ok(pageMatches("memex", page("https://a.test/x", "The Memex")));
  });

  it("matches on the URL when the title does not", () => {
    assert.ok(pageMatches("gecko", page("https://gecko.test/x", "Docs")));
  });

  it("matches mid-word, since a page title is a whole sentence", () => {
    assert.ok(
      pageMatches("trail", page("https://a.test/", "As We May Trails"))
    );
  });

  it("requires every term", () => {
    const p = page("https://a.test/", "Associative trails");
    assert.ok(pageMatches("associative trails", p));
    assert.ok(!pageMatches("associative xanadu", p));
  });

  it("ignores case on both sides", () => {
    assert.ok(pageMatches("MEMEX", page("https://a.test/", "memex")));
  });

  it("never matches on an empty query", () => {
    assert.ok(!pageMatches("", page("https://a.test/", "anything")));
    assert.ok(!pageMatches("   ", page("https://a.test/", "anything")));
  });

  it("survives a row with no title", () => {
    assert.ok(pageMatches("a.test", { url: "https://a.test/" }));
  });
});

describe("suggestionsFor", () => {
  it("offers nothing for an empty query — the bar teaches instead", () => {
    const rows = suggestionsFor("", {
      context: [page("https://a.test/", "Anything")],
      history: [page("https://b.test/", "Anything else")],
    });
    assert.deepEqual(rows, []);
  });

  it("orders by tier, not by anything within the rows", () => {
    const rows = suggestionsFor("memex", {
      context: [page("https://c.test/", "memex in context")],
      trail: [page("https://t.test/", "memex on trail")],
      crossings: [
        page("https://x.test/", "memex crossed", { trail_name: "R" }),
      ],
      history: [
        page("https://h.test/", "memex in history", { frecency: 9999 }),
      ],
    });
    assert.deepEqual(
      rows.map(r => r.tier),
      [T_CONTEXT, T_TRAIL, T_CROSSING, T_HISTORY]
    );
  });

  it("puts a mark above everything, and does not ask it to match", () => {
    const rows = suggestionsFor("g", {
      marked: [
        page("https://m.test/", "Nothing like the query", { mark: "g" }),
      ],
      context: [page("https://c.test/", "g in context")],
    });
    assert.equal(rows[0].tier, T_MARK);
    assert.equal(rows[0].url, "https://m.test/");
    assert.equal(rows[0].mark, "g");
    assert.equal(rows[0].spoken, "gust");
  });

  it("keeps the store's order within a tier", () => {
    // `contextContents` returns pages best-outcome-first, and that ordering is
    // the tier's own claim. Re-sorting here would be a second opinion.
    const rows = suggestionsFor("doc", {
      context: [
        page("https://a.test/", "doc three", { outcome: "saved" }),
        page("https://b.test/", "doc one", { outcome: "read" }),
        page("https://c.test/", "doc two", { outcome: "bounced" }),
      ],
    });
    assert.deepEqual(
      rows.map(r => r.url),
      ["https://a.test/", "https://b.test/", "https://c.test/"]
    );
  });

  it("shows a page once, in the highest tier that holds it", () => {
    const url = "https://same.test/";
    const rows = suggestionsFor("same", {
      context: [page(url, "same page")],
      trail: [page(url, "same page")],
      history: [page(url, "same page")],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tier, T_CONTEXT);
  });

  it("drops rows that do not answer the query, whatever tier they are in", () => {
    const rows = suggestionsFor("memex", {
      context: [
        page("https://a.test/", "Memex"),
        page("https://b.test/", "Something else"),
      ],
    });
    assert.deepEqual(
      rows.map(r => r.url),
      ["https://a.test/"]
    );
  });

  it("caps the list, taking from the top", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      page(`https://a.test/${i}`, `page ${i}`)
    );
    const rows = suggestionsFor("page", { context: many });
    assert.equal(rows.length, DEFAULT_LIMIT);
    assert.equal(rows[0].url, "https://a.test/0");

    const three = suggestionsFor("page", { context: many }, { limit: 3 });
    assert.equal(three.length, 3);
  });

  it("spends the whole budget on a lower tier when the top ones are thin", () => {
    const rows = suggestionsFor("page", {
      context: [page("https://c.test/", "page in context")],
      history: Array.from({ length: 20 }, (_, i) =>
        page(`https://h.test/${i}`, `page ${i}`)
      ),
    });
    assert.equal(rows.length, DEFAULT_LIMIT);
    assert.equal(rows[0].tier, T_CONTEXT);
    assert.equal(rows.at(-1).tier, T_HISTORY);
  });

  it("labels every row with the tier that explains it", () => {
    const rows = suggestionsFor("memex", {
      crossings: [
        page("https://x.test/", "memex", { trail_name: "Reading", id: 7 }),
      ],
    });
    assert.equal(rows[0].kind, R_PAGE);
    assert.equal(rows[0].group, TIER_LABELS[T_CROSSING]);
    assert.match(rows[0].detail, /Reading/);
    assert.equal(rows[0].nodeId, 7);
  });

  it("names the trail a crossing came from, even when it has none", () => {
    const rows = suggestionsFor("memex", {
      crossings: [page("https://x.test/", "memex", { trail_name: null })],
    });
    assert.match(rows[0].detail, /unnamed trail/);
  });

  it("says a context page's outcome, which is why it sorts where it does", () => {
    const rows = suggestionsFor("memex", {
      context: [page("https://c.test/", "memex", { outcome: "saved" })],
    });
    assert.match(rows[0].detail, /saved/);
  });

  it("says nothing about an outcome it does not have", () => {
    const rows = suggestionsFor("memex", {
      context: [page("https://c.test/", "memex", { outcome: "unvisited" })],
    });
    assert.ok(!rows[0].detail.includes("unvisited"));
  });

  it("falls back to the URL when a page has no title", () => {
    const rows = suggestionsFor("a.test", {
      history: [{ url: "https://a.test/" }],
    });
    assert.equal(rows[0].label, "https://a.test/");
  });

  it("survives a row whose URL is not parseable", () => {
    const rows = suggestionsFor("odd", {
      history: [{ url: "odd", title: "odd" }],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].detail, "odd");
  });

  it("gives each row an id that is stable for the same list", () => {
    const sources = {
      context: [page("https://a.test/", "memex one")],
      history: [page("https://b.test/", "memex two")],
    };
    const first = suggestionsFor("memex", sources).map(r => r.id);
    const again = suggestionsFor("memex", sources).map(r => r.id);
    assert.deepEqual(first, again);
    assert.equal(new Set(first).size, first.length);
  });

  it("takes the row id from either column name the store uses", () => {
    const rows = suggestionsFor("memex", {
      trail: [page("https://a.test/", "memex", { id: 3 })],
      crossings: [page("https://b.test/", "memex", { node_id: 4 })],
    });
    assert.deepEqual(
      rows.map(r => r.nodeId),
      [3, 4]
    );
  });

  it("has a label for every tier it can order", () => {
    for (const tier of TIER_ORDER) {
      assert.equal(typeof TIER_LABELS[tier], "string");
    }
    assert.deepEqual(TIER_ORDER, [
      T_MARK,
      T_CONTEXT,
      T_TRAIL,
      T_CROSSING,
      T_RELATED,
      T_HISTORY,
    ]);
  });

  it("treats missing sources as empty ones", () => {
    assert.deepEqual(suggestionsFor("memex", {}), []);
    assert.deepEqual(suggestionsFor("memex"), []);
  });
});

describe("the related tier", () => {
  const near = (url, title, similarity, extra = {}) =>
    page(url, title, { similarity, ...extra });

  it("offers a page that shares no word with the query", () => {
    // The whole point of the tier: `pageMatches` requires every term, and
    // these two strings have no term in common at all.
    const p = near("https://a.test/", "As We May Think", 0.42);
    assert.ok(!pageMatches("associative memory machine", p));
    const rows = suggestionsFor("associative memory machine", { related: [p] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tier, T_RELATED);
    assert.equal(rows[0].kind, R_PAGE);
    assert.equal(rows[0].label, "As We May Think");
  });

  it("drops anything below the measured floor", () => {
    const rows = suggestionsFor("memex", {
      related: [
        near("https://keep.test/", "Kept", RELATED_FLOOR),
        near("https://drop.test/", "Dropped", RELATED_FLOOR - 0.001),
      ],
    });
    assert.deepEqual(
      rows.map(r => r.url),
      ["https://keep.test/"]
    );
  });

  it("drops a row carrying no similarity at all", () => {
    // A caller with no engine loaded must not accidentally promote every page
    // it has into the tier by passing rows with the field missing.
    const rows = suggestionsFor("memex", {
      related: [
        page("https://a.test/", "Untitled"),
        near("https://b.test/", "B", 0.5),
      ],
    });
    assert.deepEqual(
      rows.map(r => r.url),
      ["https://b.test/"]
    );
  });

  it("orders by similarity, unlike every other tier", () => {
    const rows = suggestionsFor("memex", {
      related: [
        near("https://low.test/", "Low", 0.2),
        near("https://high.test/", "High", 0.9),
        near("https://mid.test/", "Mid", 0.5),
      ],
    });
    assert.deepEqual(
      rows.map(r => r.url),
      ["https://high.test/", "https://mid.test/", "https://low.test/"]
    );
  });

  it("does not re-order the caller's array", () => {
    const given = [
      near("https://low.test/", "Low", 0.2),
      near("https://high.test/", "High", 0.9),
    ];
    suggestionsFor("memex", { related: given });
    assert.deepEqual(
      given.map(p => p.url),
      ["https://low.test/", "https://high.test/"]
    );
  });

  it("sits below the tiers that matched the words and above the floor", () => {
    const rows = suggestionsFor("memex", {
      context: [page("https://ctx.test/", "memex in context")],
      related: [near("https://rel.test/", "As We May Think", 0.8)],
      history: [page("https://his.test/", "memex in history")],
    });
    assert.deepEqual(
      rows.map(r => r.tier),
      [T_CONTEXT, T_RELATED, T_HISTORY]
    );
  });

  it("does not offer a page an exact tier already offered", () => {
    const rows = suggestionsFor("memex", {
      trail: [page("https://a.test/", "The memex")],
      related: [near("https://a.test/", "The memex", 0.9)],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tier, T_TRAIL);
  });

  it("says where a related page came from, since the host explains nothing", () => {
    const rows = suggestionsFor("memex", {
      related: [
        near("https://a.test/x", "As We May Think", 0.4, {
          trail_name: "hypertext history",
        }),
        near("https://b.test/x", "Nameless", 0.3),
      ],
    });
    assert.equal(rows[0].detail, "hypertext history \u00b7 a.test");
    assert.equal(rows[1].detail, "b.test");
  });

  it("obeys the limit like any other tier", () => {
    const related = Array.from({ length: 12 }, (_, i) =>
      near(`https://a.test/${i}`, `Page ${i}`, 0.9 - i / 100)
    );
    assert.equal(suggestionsFor("memex", { related }).length, DEFAULT_LIMIT);
  });
});
