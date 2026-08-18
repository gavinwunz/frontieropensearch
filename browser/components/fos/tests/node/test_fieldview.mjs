/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Unit tests for the Field's view field.
 *
 * The properties asserted here are `FIELD.md`'s, not the code's: the whole
 * world is on screen at the overview and no view can be empty (§2, §9.1); a
 * card's pixel position is a pure function of its field position and the
 * viewport, so a resize moves nothing (§4, §9.2); and a region never magnifies
 * past 1:1, because the thumbnail cue is the reason the card exists (§7).
 */

/* These tests run under `node --test`, not in Gecko, so a static import of a
 * system module is correct here. */
/* eslint-disable mozilla/reject-import-system-module-from-non-system */
import test from "node:test";
import assert from "node:assert/strict";

import { FIELD_GEOMETRY, FieldModel } from "../../FOSField.sys.mjs";
import { TrailStore } from "../../FOSTrailTree.sys.mjs";
import {
  VIEW_METRICS,
  cardCaption,
  lineageCards,
  miniScale,
  moveFocus,
  overviewLayout,
  pointerToField,
  regionLayout,
} from "../../FOSFieldView.sys.mjs";

const VIEWPORT = { width: 1600, height: 900 };

/**
 * A session with `trails` trails of `deep` pages each, the pages of each trail
 * forming a chain so lineage has something to walk.
 *
 * @param {number} trails
 * @param {number} deep
 * @returns {{store: object, field: object}}
 */
function session(trails, deep) {
  const store = new TrailStore();
  const field = new FieldModel({ trails: store });
  for (let t = 0; t < trails; t++) {
    const trailId = store.createTrail({ name: `trail ${t}` });
    let from = null;
    for (let i = 0; i < deep; i++) {
      const nodeId = store.addNode({
        trailId,
        parentId: from,
        url: `https://example.org/${t}/${i}`,
        title: `page ${t}.${i}`,
      });
      field.place(nodeId);
      from = nodeId;
    }
  }
  return { store, field };
}

test("the overview fits the window, whatever it holds", () => {
  for (const trails of [1, 4, 9, 14]) {
    const { field } = session(trails, 3);
    const layout = overviewLayout({
      slots: field.overview(),
      viewport: VIEWPORT,
      geometry: field.geometry,
    });
    for (const tile of layout.tiles) {
      assert.ok(tile.x >= -0.001, `tile off the left at ${trails} trails`);
      assert.ok(tile.y >= -0.001, `tile off the top at ${trails} trails`);
      assert.ok(
        tile.x + tile.width <= VIEWPORT.width + 0.001,
        `tile off the right at ${trails} trails`
      );
      assert.ok(
        tile.y + tile.height <= VIEWPORT.height + 0.001,
        `tile off the bottom at ${trails} trails`
      );
    }
  }
});

test("the overview never scrolls its slot count off the grid", () => {
  // §3: past nine trails the overview nests rather than the plane growing.
  // The tile count is therefore fixed however many trails exist, which is what
  // makes "the whole world, scaled to fit" a property rather than a hope.
  const { field } = session(30, 2);
  const layout = overviewLayout({
    slots: field.overview(),
    viewport: VIEWPORT,
    geometry: field.geometry,
  });
  assert.equal(layout.tiles.length, FIELD_GEOMETRY.overviewSlots);
  assert.ok(layout.tiles.some(tile => tile.kind === "nest"));
});

test("a tile's body keeps the region's shape, so zooming in magnifies", () => {
  // The *body* carries the shape, not the whole tile: the header is a fixed
  // strip of pixels that does not scale, so folding it into the aspect ratio
  // overflows the body by exactly the amount the tile was scaled down by.
  const { field } = session(3, 4);
  const layout = overviewLayout({
    slots: field.overview(),
    viewport: VIEWPORT,
    geometry: field.geometry,
  });
  const tile = layout.tiles.find(entry => entry.kind === "region");
  const want = field.geometry.regionWidth / field.geometry.regionHeight;
  assert.ok(Math.abs(tile.width / tile.bodyHeight - want) < 0.001);
  assert.ok(
    Math.abs(tile.height - (tile.bodyHeight + VIEW_METRICS.tileHeader)) < 0.001
  );
});

test("no card in a tile falls outside the tile it belongs to", () => {
  const { field } = session(4, 12);
  const layout = overviewLayout({
    slots: field.overview(),
    viewport: VIEWPORT,
    geometry: field.geometry,
  });
  for (const tile of layout.tiles) {
    if (tile.kind !== "region") {
      continue;
    }
    const scale = miniScale(tile.region, tile);
    for (const card of field.cardsIn(tile.region.id)) {
      const right = (card.x + field.geometry.cardWidth) * scale;
      const bottom = (card.y + field.geometry.cardHeight) * scale;
      assert.ok(right <= tile.width + 0.001, "card past the tile's edge");
      assert.ok(bottom <= tile.bodyHeight + 0.001, "card past the tile's body");
    }
  }
});

test("a region is scaled to fit and never magnified past 1:1", () => {
  const { field } = session(1, 3);
  const region = field.regions()[0];
  const tight = regionLayout({
    region,
    cards: field.cardsIn(region.id),
    viewport: { width: 500, height: 400 },
    geometry: field.geometry,
  });
  assert.ok(tight.scale < 1);
  assert.ok(tight.width <= 500 - 2 * VIEW_METRICS.padding + 0.001);

  const roomy = regionLayout({
    region,
    cards: field.cardsIn(region.id),
    viewport: { width: 4000, height: 3000 },
    geometry: field.geometry,
  });
  assert.equal(roomy.scale, 1);
});

test("a resize rescales the same arrangement rather than moving a card", () => {
  // Acceptance property 2 in the only form the view model can carry it: pixel
  // positions are a pure function of field position and viewport, so two
  // viewports agree on every card's position *relative to its region*.
  const { field } = session(1, 20);
  const region = field.regions()[0];
  const cards = field.cardsIn(region.id);

  const relative = size => {
    const layout = regionLayout({
      region,
      cards,
      viewport: size,
      geometry: field.geometry,
    });
    return layout.cards.map(card => ({
      id: card.id,
      x: (card.left - layout.originX) / layout.scale,
      y: (card.top - layout.originY) / layout.scale,
    }));
  };

  const wide = relative(VIEWPORT);
  const tall = relative({ width: 900, height: 1400 });
  assert.equal(wide.length, tall.length);
  wide.forEach((card, i) => {
    assert.equal(card.id, tall[i].id);
    // Within a pixel: the two viewports divide by different scales, so exact
    // equality would be asserting something about floating point rather than
    // about the Field.
    assert.ok(Math.abs(card.x - tall[i].x) < 0.001, "a card moved sideways");
    assert.ok(Math.abs(card.y - tall[i].y) < 0.001, "a card moved vertically");
  });
});

test("a drag maps the pointer back to field units, grab offset included", () => {
  const { field } = session(1, 4);
  const region = field.regions()[0];
  const cards = field.cardsIn(region.id);
  const layout = regionLayout({
    region,
    cards,
    viewport: VIEWPORT,
    geometry: field.geometry,
  });
  const card = layout.cards[0];
  const grab = { x: 10, y: 5 };

  // Put the pointer exactly where it would be if the card had not moved.
  const point = pointerToField({
    clientX: layout.originX + (cards[0].x + grab.x) * layout.scale,
    clientY: layout.originY + (cards[0].y + grab.y) * layout.scale,
    grab,
    layout,
    region,
    geometry: field.geometry,
  });
  assert.ok(Math.abs(point.x - cards[0].x) < 0.001);
  assert.ok(Math.abs(point.y - cards[0].y) < 0.001);
  assert.ok(card);
});

test("a drag past the edge clamps instead of dying", () => {
  const { field } = session(1, 2);
  const region = field.regions()[0];
  const layout = regionLayout({
    region,
    cards: field.cardsIn(region.id),
    viewport: VIEWPORT,
    geometry: field.geometry,
  });
  const point = pointerToField({
    clientX: -5000,
    clientY: 99999,
    grab: { x: 0, y: 0 },
    layout,
    region,
    geometry: field.geometry,
  });
  assert.equal(point.x, 0);
  assert.equal(point.y, region.height - field.geometry.cardHeight);
});

test("lineage is the focused card's ancestors, and excludes itself", () => {
  const { store, field } = session(1, 5);
  const region = field.regions()[0];
  const cards = field.cardsIn(region.id);
  const leaf = cards[cards.length - 1];

  const chain = lineageCards(store, leaf.node_id, cards);
  assert.equal(chain.size, cards.length - 1);
  assert.ok(!chain.has(leaf.id));

  const root = cards[0];
  assert.equal(lineageCards(store, root.node_id, cards).size, 0);
  assert.equal(lineageCards(store, null, cards).size, 0);
});

test("lineage stops at the region it is drawn in", () => {
  // A region is a trail, and a trail's nodes never have parents in another
  // trail — but the guard matters, because grafting could one day make that
  // false and a lineage that leaked into the neighbouring region would be a
  // provenance claim that is not true.
  const { store, field } = session(2, 4);
  const [first, second] = field.regions();
  const deepest = field.cardsIn(second.id).at(-1);
  const chain = lineageCards(store, deepest.node_id, field.cardsIn(first.id));
  assert.equal(chain.size, 0);
});

test("arrow keys move to the thing that way, not to the next in a list", () => {
  const items = [
    { id: "a", x: 0, y: 0, width: 100, height: 75 },
    { id: "b", x: 200, y: 0, width: 100, height: 75 },
    { id: "c", x: 0, y: 200, width: 100, height: 75 },
    { id: "d", x: 200, y: 200, width: 100, height: 75 },
  ];
  assert.equal(moveFocus(items, "a", "right"), "b");
  assert.equal(moveFocus(items, "a", "down"), "c");
  assert.equal(moveFocus(items, "d", "left"), "c");
  assert.equal(moveFocus(items, "d", "up"), "b");
  // Nothing that way leaves focus where it was, rather than wrapping — a wrap
  // across a plane is a list order in disguise.
  assert.equal(moveFocus(items, "a", "up"), "a");
  assert.equal(moveFocus([], "a", "up"), null);
  assert.equal(moveFocus(items, "nope", "up"), "a");
});

test("a card directly ahead beats a nearer one off to the side", () => {
  const items = [
    { id: "from", x: 0, y: 0, width: 100, height: 75 },
    { id: "ahead", x: 260, y: 0, width: 100, height: 75 },
    { id: "askew", x: 200, y: 400, width: 100, height: 75 },
  ];
  assert.equal(moveFocus(items, "from", "right"), "ahead");
});

test("a caption always says something, however little the node carries", () => {
  assert.equal(
    cardCaption({ title: "Memex", url: "https://x.test/" }),
    "Memex"
  );
  assert.equal(cardCaption({ title: null, url: "https://x.test/a" }), "x.test");
  assert.equal(cardCaption({ title: null, url: "not a url" }), "not a url");
  assert.equal(cardCaption(null), "Untitled");
});
