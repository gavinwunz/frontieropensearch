/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Pillar A. The four headline tests are FIELD.md §9's acceptance properties
 * stated as assertions rather than as prose, so that a regression in any of
 * them fails a test instead of quietly degrading the Field into a tab strip.
 */

/* These tests run under `node --test`, not in Gecko, so a static import of a
 * system module is correct here. */
/* eslint-disable mozilla/reject-import-system-module-from-non-system */
import { test } from "node:test";
import assert from "node:assert/strict";

import { FieldModel, REFUSED } from "../../FOSField.sys.mjs";
import { TrailStore } from "../../FOSTrailTree.sys.mjs";
import { MarkRegistry } from "../../FOSMarks.sys.mjs";

/**
 * A monotonic clock, so "least recently touched" is deterministic in tests.
 */
function clock() {
  let t = 1000;
  return () => ++t;
}

/**
 * A trail store and an empty Field sharing one clock.
 *
 * @returns {{trails: object, field: object}}
 */
function setup() {
  const now = clock();
  const trails = new TrailStore({ now });
  const field = new FieldModel({ trails, now });
  return { trails, field };
}

/**
 * A trail with `count` pages hung off one root, all placed on the Field.
 *
 * @param {object} trails A `TrailStore`.
 * @param {object} field A `FieldModel`.
 * @param {number} count How many pages to place.
 */
function trailWith(trails, field, count) {
  const trailId = trails.createTrail();
  const root = trails.addNode({ trailId, url: "https://example.invalid/0" });
  const cards = [field.place(root)];
  let prev = root;
  for (let i = 1; i < count; i++) {
    prev = trails.visit(prev, { url: `https://example.invalid/${i}` });
    cards.push(field.place(prev));
  }
  return { trailId, cards };
}

// ------------------------------------------------------- placement is provenance

test("a card lands in the region of the trail it came from", () => {
  const { trails, field } = setup();
  const a = trails.createTrail();
  const b = trails.createTrail();
  const na = trails.addNode({ trailId: a, url: "https://a.invalid/" });
  const nb = trails.addNode({ trailId: b, url: "https://b.invalid/" });

  assert.equal(field.place(na).region_id, a);
  assert.equal(field.place(nb).region_id, b);
});

test("a region is the trail: same id, created on demand", () => {
  const { trails, field } = setup();
  const trailId = trails.createTrail({ name: "memex" });
  const node = trails.addNode({ trailId, url: "https://a.invalid/" });
  field.place(node);

  const region = field.regionFor(trailId);
  assert.equal(region.id, trailId);
  assert.equal(trails.getTrail(trailId).name, "memex");
});

test("placing the same node twice returns the same card", () => {
  const { trails, field } = setup();
  const trailId = trails.createTrail();
  const node = trails.addNode({ trailId, url: "https://a.invalid/" });
  assert.equal(field.place(node).id, field.place(node).id);
  assert.equal(field.cards().length, 1);
});

test("a child seeds next to its parent, not at the far end of the region", () => {
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 2);
  const [parentCard, child] = cards;
  const { cardWidth, minGap } = field.geometry;

  const dx = Math.abs(child.x - parentCard.x);
  const dy = Math.abs(child.y - parentCard.y);
  // Adjacent means one lattice step away on one axis: as close as the
  // non-occlusion invariant permits anything to be.
  assert.ok(
    Math.max(dx, dy) <= cardWidth + minGap + 1e-9,
    `child seeded ${dx},${dy} from its parent`
  );
});

test("the model assigns no marks: a page has one, and it is its node's", () => {
  // Cards used to take a letter of their own, which spent two of the
  // twenty-six on every page and was caught by the trail rail silently losing
  // its marks in a session of ordinary size. A card is a page's presence on
  // the Field, not a second object to address.
  const marks = new MarkRegistry();
  const { trails, field } = setup();
  const trailId = trails.createTrail();
  const node = trails.addNode({
    trailId,
    url: "https://a.invalid/",
    title: "Memex",
  });
  const card = field.place(node);

  assert.equal(card.mark, undefined, "the card carries no letter of its own");
  assert.equal(marks.size, 0, "and the model touched no registry");
});

// ------------------------------- §9.3 — cards never overlap, under any operation

test("§9.3 seeding never produces an overlap, at any size", () => {
  const { trails, field } = setup();
  trailWith(trails, field, 40);
  assert.deepEqual(field.overlaps(), []);
});

test("§9.3 a drag displaces neighbours transitively and still never overlaps", () => {
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 3);
  const [c1, c2, c3] = cards;
  const step = field.geometry.cardWidth + field.geometry.minGap;

  // Lay the three out in a known row without pinning them, so the push front
  // has somewhere to propagate to.
  for (const [i, c] of [c1, c2, c3].entries()) {
    assert.ok(field.moveCard(c.id, i * step, 0, { pin: false }).ok);
  }

  const result = field.moveCard(c1.id, 20, 0, { pin: false });
  assert.ok(result.ok);
  assert.equal(c1.x, 20);
  assert.equal(c2.x, 20 + step, "c2 was pushed clear of c1");
  assert.equal(c3.x, 20 + 2 * step, "the push propagated transitively to c3");
  assert.deepEqual(field.overlaps(), []);
});

test("§9.3 a hundred moves leave the invariant intact", () => {
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 20);
  const { regionWidth, regionHeight } = field.geometry;

  let seed = 7;
  const rand = () =>
    (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 100; i++) {
    const card = cards[i % cards.length];
    if (!field.getCard(card.id)) {
      continue;
    }
    field.moveCard(card.id, rand() * regionWidth, rand() * regionHeight);
    assert.deepEqual(field.overlaps(), [], `overlap after move ${i}`);
  }
});

// ---------------------------------- §9.2 — the system never moves a pinned card

test("§9.2 moving a card pins it; seeding others never disturbs it", () => {
  const { trails, field } = setup();
  const { trailId, cards } = trailWith(trails, field, 3);
  const pinned = cards[0];

  assert.equal(pinned.pinned, false, "a seeded card is not pinned");
  assert.ok(field.moveCard(pinned.id, 300, 200).ok);
  assert.equal(pinned.pinned, true, "moving a card pins it");

  // Fill the region well past the point where it has to evict and grow.
  let prev = trails.nodes(trailId).at(-1).id;
  for (let i = 0; i < 80; i++) {
    prev = trails.visit(prev, { url: `https://example.invalid/fill/${i}` });
    field.place(prev);
  }

  assert.equal(pinned.x, 300);
  assert.equal(pinned.y, 200);
  assert.ok(field.getCard(pinned.id), "a pinned card is never the eviction");
  assert.deepEqual(field.overlaps(), []);
});

test("§9.2 a drop that would displace a pinned card is refused, and nothing moves", () => {
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 3);
  const [c1, c2, c3] = cards;
  const step = field.geometry.cardWidth + field.geometry.minGap;

  for (const [i, c] of [c1, c2, c3].entries()) {
    field.moveCard(c.id, i * step, 0, { pin: false });
  }
  field.moveCard(c3.id, 2 * step, 0); // pins c3 where it already sits

  const before = [c1, c2, c3].map(c => ({ x: c.x, y: c.y }));
  const result = field.moveCard(c1.id, 20, 0, { pin: false });

  assert.equal(result.ok, false);
  assert.equal(result.reason, REFUSED.PINNED);
  assert.deepEqual(
    [c1, c2, c3].map(c => ({ x: c.x, y: c.y })),
    before,
    "a refused drop is atomic: the whole chain is left alone"
  );
});

test("§9.2 positions are region-relative units, so a restart moves nothing", () => {
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 5);
  field.moveCard(cards[0].id, 300, 200);

  const saved = field.toJSON();
  assert.deepEqual(
    saved.cards.find(c => c.id === cards[0].id),
    {
      id: cards[0].id,
      node_id: cards[0].node_id,
      region_id: cards[0].region_id,
      x: 300,
      y: 200,
      pinned: true,
    }
  );
  // No pixel, viewport or display dimension appears anywhere in the saved form.
  assert.deepEqual(Object.keys(saved).sort(), [
    "cards",
    "geometry",
    "nest",
    "regions",
  ]);
});

test("a drop outside the region is refused", () => {
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 1);
  const result = field.moveCard(cards[0].id, field.geometry.regionWidth, 0);
  assert.equal(result.ok, false);
  assert.equal(result.reason, REFUSED.BOUNDS);
});

test("a preview does not pin and a real move does", () => {
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 1);
  field.moveCard(cards[0].id, 300, 200, { pin: false });
  assert.equal(cards[0].pinned, false);
  assert.equal(cards[0].x, 300, "a preview still moves the card");
  field.moveCard(cards[0].id, 300, 200);
  assert.equal(cards[0].pinned, true);
});

// ----------------------------------------- §9.4 — dismissal is free and lossless

test("§9.4 dismissal keeps the page on its trail with its scroll and form state", () => {
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 1);
  const card = cards[0];
  trails.setViewState(card.node_id, {
    scrollY: 1840,
    formState: '{"q":"memex"}',
  });

  field.dismiss(card.id);

  assert.equal(field.getCard(card.id), null, "the card left the Field");
  const node = trails.getNode(card.node_id);
  assert.ok(node, "the page did not leave its trail");
  assert.ok(node.dismissed_at, "it is marked dismissed, not deleted");
  assert.equal(node.scroll_y, 1840);
  assert.equal(node.form_state, '{"q":"memex"}');
});

test("§9.4 restore brings the page back in one command, losslessly", () => {
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 1);
  const nodeId = cards[0].node_id;
  trails.setViewState(nodeId, { scrollY: 1840 });
  field.dismiss(cards[0].id);

  const restored = field.restore(nodeId);

  assert.equal(restored.node_id, nodeId);
  assert.equal(trails.getNode(nodeId).dismissed_at, null);
  assert.equal(trails.getNode(nodeId).scroll_y, 1840);
  assert.equal(field.cardForNode(nodeId).id, restored.id);
});

test("a full region evicts the oldest unpinned card rather than refusing to place", () => {
  const { trails, field } = setup();
  const { trailId } = trailWith(trails, field, 1);

  // A deliberately tiny region, so the capacity path is reached in four cards.
  const small = new FieldModel({
    trails,
    now: clock(),
    geometry: { regionWidth: 224, regionHeight: 174 },
  });
  let prev = trails.nodes(trailId).at(-1).id;
  const placed = [];
  for (let i = 0; i < 4; i++) {
    prev = trails.visit(prev, { url: `https://example.invalid/small/${i}` });
    placed.push(small.place(prev));
  }

  assert.deepEqual(small.overlaps(), []);
  assert.ok(
    small.cards().length <= 4,
    "the region did not silently exceed its capacity"
  );
  for (const card of placed) {
    // Every page is still on its trail whether or not its card survived.
    assert.ok(trails.getNode(card.node_id));
  }
});

// -------------------------------------- §9.1 — no reachable view is empty

test("§9.1 the overview shows every region, and nests past nine trails", () => {
  const { trails, field } = setup();
  const ids = [];
  for (let i = 0; i < 12; i++) {
    const trailId = trails.createTrail();
    ids.push(trailId);
    field.place(trails.addNode({ trailId, url: `https://t${i}.invalid/` }));
  }

  const overview = field.overview();
  assert.equal(overview.length, field.geometry.overviewSlots);
  assert.equal(
    overview.filter(s => s.kind === "empty").length,
    0,
    "no slot is empty, so no reachable view is empty"
  );

  const shown = new Set();
  for (const slot of overview) {
    if (slot.kind === "region") {
      shown.add(slot.region.id);
    } else {
      slot.regions.forEach(r => shown.add(r.id));
    }
  }
  assert.deepEqual(
    [...shown].sort((a, b) => a - b),
    ids,
    "the overview is the whole world: every trail appears exactly once"
  );
});

test("§9.1 a region keeps its slot for life: a landmark that moves is not one", () => {
  const { trails, field } = setup();
  const first = trails.createTrail();
  field.place(trails.addNode({ trailId: first, url: "https://a.invalid/" }));
  const slot = field.regionFor(first).slot;

  // Enough traffic to force several collapses.
  for (let i = 0; i < 11; i++) {
    const trailId = trails.createTrail();
    field.place(trails.addNode({ trailId, url: `https://t${i}.invalid/` }));
    field.regionFor(first).touched_at = Number.MAX_SAFE_INTEGER;
  }

  assert.equal(
    field.regionFor(first).slot,
    slot,
    "a region that stays in use never changes slot"
  );
});

test("the overview never loses a region to collapse: it moves into the nest", () => {
  const { trails, field } = setup();
  for (let i = 0; i < 10; i++) {
    const trailId = trails.createTrail();
    field.place(trails.addNode({ trailId, url: `https://t${i}.invalid/` }));
  }
  const nest = field.overview().find(s => s.kind === "nest");
  assert.ok(nest, "the tenth trail forces a region-of-regions");
  assert.ok(nest.regions.length >= 2);
  assert.ok(nest.regions.every(r => r.nested && r.slot === null));
});

test("placement never fails once cards sit off the seeding lattice", () => {
  // The regression a real session found and the earlier tests did not: a card
  // dragged off the lattice covers seats that no lattice position can reach, so
  // freeing a seat by eviction is not enough and the region has to grow.
  const { trails, field } = setup();
  const { trailId, cards } = trailWith(trails, field, 40);
  assert.ok(field.moveCard(cards[3].id, 400, 300).ok);

  let prev = trails.nodes(trailId).at(-1).id;
  for (let i = 0; i < 30; i++) {
    prev = trails.visit(prev, { url: `https://example.invalid/more/${i}` });
    assert.doesNotThrow(() => field.place(prev), `placement ${i} threw`);
  }

  assert.deepEqual(field.overlaps(), []);
  assert.equal(cards[3].x, 400, "the pinned card is still where it was put");
  assert.equal(cards[3].y, 300);
});

test("a busy region still accepts an ordinary drag rather than refusing it", () => {
  // Refusal is reserved for pinned conflicts. A chain reaching the region edge
  // must re-seat the unclaimed card it was pushing, not veto the drag.
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 45);
  let refusals = 0;
  for (const card of cards.slice(0, 20)) {
    if (!field.getCard(card.id)) {
      continue;
    }
    const result = field.moveCard(card.id, 300, 200);
    if (!result.ok) {
      refusals++;
    }
    assert.deepEqual(field.overlaps(), []);
  }
  assert.ok(refusals < 20, `every drag into a busy region was refused`);
});

test("a region at exactly its lattice capacity still accepts a drag", () => {
  // The case the busy-region test above misses, and the perf harness found by
  // counting committed moves and noticing it was measuring refusals. At 45
  // cards there is a free seat, so the chain that reaches an edge re-seats
  // into it; at 56 there is none, and every pointer move was refused —
  // including a move of less than one seat-step, because the dragged card had
  // not yet cleared the minimum distance from the seat it vacated, so its own
  // seat was not free either.
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 56);
  const region = field.regionFor(field.getCard(cards[0].id).region_id);
  assert.equal(field.cards().length, 56, "the lattice is exactly full");

  const card = field.getCard(cards[0].id);
  const from = { x: card.x, y: card.y };
  const to = { x: region.width / 2, y: region.height / 2 };
  const refused = [];
  for (let step = 1; step <= 60; step++) {
    const result = field.moveCard(
      card.id,
      from.x + (to.x - from.x) * (step / 60),
      from.y + (to.y - from.y) * (step / 60),
      { pin: false }
    );
    if (!result.ok) {
      refused.push(`${step}:${result.reason}`);
    }
    assert.deepEqual(field.overlaps(), [], `overlap at step ${step}`);
  }
  assert.deepEqual(refused, [], "no pointer move in the drag was refused");
});

test("a drag out of room grows the region by a row, not by a pointer move", () => {
  // §6: a drag climbs the capacity ladder to growth, and skips eviction —
  // eviction bounds the card count against a page arriving, and a drag brings
  // nothing. So the count is unchanged and the height went up once.
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 56);
  const region = field.regionFor(field.getCard(cards[0].id).region_id);
  const before = region.height;
  const row = field.geometry.cardHeight + field.geometry.minGap;

  const card = field.getCard(cards[0].id);
  const from = { x: card.x, y: card.y };
  for (let step = 1; step <= 60; step++) {
    field.moveCard(
      card.id,
      from.x,
      from.y + (region.height / 2 - from.y) * (step / 60),
      { pin: false }
    );
  }
  assert.equal(field.cards().length, 56, "no card was dismissed to make room");
  assert.equal(
    region.height,
    before + row,
    "one drag cost exactly one lattice row"
  );
});

test("a refused drag leaves the region the height it was", () => {
  // Growth is part of the arrangement, so it has to be as atomic as the
  // positions are: a drag refused for a pinned conflict must not leave a
  // taller region behind as the only trace of it.
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 56);
  const region = field.regionFor(field.getCard(cards[0].id).region_id);
  // Pin everything but the first card, so any push at all is refused.
  for (const card of cards.slice(1)) {
    const live = field.getCard(card.id);
    field.moveCard(live.id, live.x, live.y);
  }
  const before = region.height;

  const card = field.getCard(cards[0].id);
  const neighbour = field.getCard(cards[1].id);
  const result = field.moveCard(card.id, neighbour.x, neighbour.y);
  assert.equal(result.ok, false);
  assert.equal(result.reason, REFUSED.PINNED);
  assert.equal(region.height, before, "the region did not grow on a refusal");
});

// -------------------------------------------------------------- `done`

test("retiring a trail takes its region and its cards off the Field", () => {
  const { trails, field } = setup();
  const { trailId, cards } = trailWith(trails, field, 3);
  const other = trailWith(trails, field, 2);

  assert.equal(field.retireTrail(trailId), true);

  assert.equal(
    field.regions().find(r => r.id === trailId),
    undefined,
    "the region is gone, because a region is the trail"
  );
  for (const card of cards) {
    assert.equal(field.getCard(card.id), null);
  }
  assert.equal(
    field.cards().length,
    other.cards.length,
    "and no other trail's cards went with it"
  );
});

test("retiring writes nothing to the nodes: the tree is untouched", () => {
  const { trails, field } = setup();
  const { trailId } = trailWith(trails, field, 3);
  const nodes = trails.nodes(trailId);

  field.retireTrail(trailId);

  assert.equal(trails.nodes(trailId).length, nodes.length);
  assert.deepEqual(
    trails.nodes(trailId).map(n => n.dismissed_at),
    nodes.map(() => null),
    "the pages were not dismissed one by one; the trail was finished"
  );
});

test("retiring an unknown or already-retired trail is false, not an error", () => {
  const { trails, field } = setup();
  const { trailId } = trailWith(trails, field, 1);

  assert.equal(field.retireTrail(trailId), true);
  assert.equal(field.retireTrail(trailId), false);
  assert.equal(field.retireTrail(9999), false);
});

test("a slot freed by `done` is given to the most recent nested trail", () => {
  const { trails, field } = setup();
  const ids = [];
  for (let i = 0; i < 12; i++) {
    const trailId = trails.createTrail();
    ids.push(trailId);
    field.place(trails.addNode({ trailId, url: `https://t${i}.invalid/` }));
  }

  const nested = field.regions().filter(r => r.nested);
  assert.ok(nested.length, "the fixture is only meaningful once nesting bites");
  const newest = nested.sort((a, b) => b.touched_at - a.touched_at)[0].id;

  const slotted = ids.find(id => !field.regionFor(id).nested);
  const slot = field.regionFor(slotted).slot;
  field.retireTrail(slotted);

  assert.equal(
    field.regionFor(newest).slot,
    slot,
    "finishing a trail buys a slot back, rather than leaving a hole"
  );
  assert.equal(field.regionFor(newest).nested, false);
});

test("a nest emptied by `done` gives its own slot back", () => {
  const { trails, field } = setup();
  const ids = [];
  for (let i = 0; i < 11; i++) {
    const trailId = trails.createTrail();
    ids.push(trailId);
    field.place(trails.addNode({ trailId, url: `https://t${i}.invalid/` }));
  }
  assert.ok(
    field.overview().some(s => s.kind === "nest"),
    "the fixture is only meaningful once a nest exists"
  );

  // Finish everything that is nested, plus enough of the rest that the nest
  // cannot refill from the promotions.
  for (const id of ids) {
    if (field.regions().find(r => r.id === id)?.nested) {
      field.retireTrail(id);
    }
  }

  assert.equal(
    field.overview().some(s => s.kind === "nest"),
    false,
    "an empty nest is a slot spent on a box with nothing in it"
  );
  assert.equal(
    field.overview().filter(s => s.kind === "region").length,
    field.regions().length,
    "and every surviving trail is on the plane rather than in the nest"
  );
});

test("the region a retired trail had can be built again by navigating to it", () => {
  const { trails, field } = setup();
  const { trailId } = trailWith(trails, field, 2);
  field.retireTrail(trailId);

  // Nothing in the model forbids it: `done` is a statement the session acts
  // on, and the Field's job is only to stop showing what the session archived.
  const revived = trails.visit(trails.nodes(trailId)[0].id, {
    url: "https://example.invalid/again",
  });
  assert.equal(field.place(revived).region_id, trailId);
});

// ------------------------------------------------- a restart is not a rearrangement

/*
 * FIELD.md §9's second acceptance property is that the system never moves a
 * pinned card — "resize the window, restart the browser". The resize half has
 * been tested since the model existed. The restart half could not be, because
 * the model is in-memory and nothing persisted a position, so these cover the
 * seam the audit in IDEAS.md run 42 found: `pinAt` is what a restore does to
 * the model, and everything above it is plumbing.
 */

test("a restored position is the position, not an approximation of it", () => {
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 3);
  const node = cards[1].node_id;

  const at = { x: 300, y: 200 };
  assert.equal(field.pinAt(node, at).ok, true);

  const card = field.cardForNode(node);
  assert.deepEqual(
    { x: card.x, y: card.y },
    at,
    "a card comes back exactly where it was left"
  );
  assert.equal(
    card.pinned,
    true,
    "and comes back owned, not merely positioned"
  );
});

test("a restored card displaces a seeded one rather than yielding to it", () => {
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 4);

  // Aim the restored card at a seat the seeding already took. The occupant is
  // unpinned, so §4 leaves the system free to move it — the position nobody
  // chose is the one that gives way.
  const occupant = cards[2];
  const seat = { x: occupant.x, y: occupant.y };
  const node = cards[0].node_id;

  assert.equal(field.pinAt(node, seat).ok, true);
  assert.deepEqual(
    { x: field.cardForNode(node).x, y: field.cardForNode(node).y },
    seat
  );
  assert.equal(field.overlaps().length, 0, "and nothing ends up on top of it");
});

test("a position saved in a grown region comes back into a grown region", () => {
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 2);
  const node = cards[0].node_id;

  // A region's height is a ratchet — §6's ladder ends in growth — and the
  // height is not persisted. Without growing to fit, every position a user
  // made in the lower part of a grown region would be refused on restart and
  // silently re-seeded, which is §4's one forbidden outcome.
  const region = field.regions()[0];
  const below = region.height + 40;
  assert.equal(field.pinAt(node, { x: 20, y: below }).ok, true);
  assert.equal(field.cardForNode(node).y, below);
  assert.ok(field.regions()[0].height >= below + field.geometry.cardHeight);
});

test("a placement for a card that is not on the Field is refused, not thrown", () => {
  const { field } = setup();
  assert.equal(field.pinAt(9999, { x: 0, y: 0 }).ok, false);
});

test("restoring two saved positions cannot make them fight", () => {
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 3);

  // Saved positions did not overlap when they were saved, so replaying them
  // in any order lands both. This is the property that lets the restore apply
  // them one at a time without a resolver.
  const a = { x: 100, y: 100 };
  const b = {
    x: 100 + field.geometry.cardWidth + field.geometry.minGap,
    y: 100,
  };
  assert.equal(field.pinAt(cards[0].node_id, a).ok, true);
  assert.equal(field.pinAt(cards[1].node_id, b).ok, true);
  assert.deepEqual(
    {
      x: field.cardForNode(cards[0].node_id).x,
      y: field.cardForNode(cards[0].node_id).y,
    },
    a,
    "the first is still where it was put after the second arrives"
  );
  assert.equal(field.overlaps().length, 0);
});

// -------------------------------------------------- a page whose record is gone

test("a forgotten page's card is dropped without being dismissed", () => {
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 2);
  const doomed = cards[0];
  const kept = cards[1];
  trails.forget([doomed.node_id]);

  assert.equal(field.drop(doomed.id), doomed.node_id);

  assert.equal(field.getCard(doomed.id), null, "the card left the Field");
  assert.equal(field.cardForNode(doomed.node_id), null, "and its node index");
  assert.equal(
    field.getCard(kept.id).id,
    kept.id,
    "and took nothing else with it"
  );
});

test("dropping a card writes nothing to the tree, because there is nothing to write to", () => {
  const { trails, field } = setup();
  const { cards } = trailWith(trails, field, 2);
  const nodeId = cards[0].node_id;
  trails.forget([nodeId]);

  field.drop(cards[0].id);

  assert.equal(
    trails.getNode(nodeId),
    null,
    "the page is gone rather than dismissed: `restore` has nothing to find, " +
      "which is what makes this not a dismissal"
  );
  assert.throws(() => field.drop(cards[0].id), /no such card/);
});
