/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Field's acceptance properties, exercised in Gecko rather than in node.
 *
 * This file exists because the node suite passed while two real defects sat in
 * the model: a busy region refused ordinary drags, and placement threw once a
 * card had been dragged off the seeding lattice. Both appeared the first time
 * the modules ran against a session-sized workload in a real runtime, so the
 * workload is the point here — these are not a restatement of the node tests
 * but the same invariants under enough cards to break them.
 *
 *   ./mach test browser/components/fos/tests/unit/
 */

"use strict";

const { FieldModel, REFUSED, FIELD_GEOMETRY } = ChromeUtils.importESModule(
  "resource:///modules/FOSField.sys.mjs"
);
const { TrailStore } = ChromeUtils.importESModule(
  "resource:///modules/FOSTrailTree.sys.mjs"
);
const { MarkRegistry } = ChromeUtils.importESModule(
  "resource:///modules/FOSMarks.sys.mjs"
);

/**
 * A trail of `count` pages, all placed on a Field.
 *
 * @param {number} count
 */
function session(count) {
  const trails = new TrailStore();
  const marks = new MarkRegistry();
  const field = new FieldModel({ trails, marks });
  const trailId = trails.createTrail({ name: "spatial hypertext" });

  let node = trails.addNode({
    trailId,
    url: "https://start.invalid/",
    title: "Start",
  });
  const cards = [field.place(node)];
  for (let i = 1; i < count; i++) {
    node = trails.visit(node, {
      url: `https://p.invalid/${i}`,
      title: `Page ${i}`,
    });
    cards.push(field.place(node));
  }
  return { trails, marks, field, trailId, cards, last: node };
}

add_task(async function test_no_overlap_at_session_scale() {
  const { field } = session(40);
  Assert.deepEqual(field.overlaps(), [], "40 placed pages, no occlusion");
});

add_task(async function test_pinned_card_is_never_moved_by_the_system() {
  const { trails, field, cards, last } = session(40);
  const pinned = cards[3];

  Assert.ok(field.moveCard(pinned.id, 400, 300).ok, "the move succeeds");
  Assert.ok(pinned.pinned, "moving a card pins it");

  // Enough further navigation to force eviction and region growth around it.
  let node = last;
  for (let i = 0; i < 30; i++) {
    node = trails.visit(node, { url: `https://q.invalid/${i}` });
    field.place(node);
  }

  Assert.equal(pinned.x, 400, "the pinned card kept its x");
  Assert.equal(pinned.y, 300, "the pinned card kept its y");
  Assert.ok(field.getCard(pinned.id), "a pinned card is never evicted");
  Assert.deepEqual(field.overlaps(), [], "still no occlusion");
});

add_task(async function test_a_drop_onto_a_pinned_card_is_refused_atomically() {
  const { field, cards } = session(40);
  field.moveCard(cards[3].id, 400, 300);

  const victim = field.cards().find(c => !c.pinned);
  const before = { x: victim.x, y: victim.y };
  const result = field.moveCard(victim.id, 400, 300, { pin: false });

  Assert.equal(result.ok, false, "the drop is refused");
  Assert.equal(result.reason, REFUSED.PINNED, "and it says why");
  Assert.equal(victim.x, before.x, "nothing moved");
  Assert.equal(victim.y, before.y, "nothing moved");
});

add_task(async function test_a_busy_region_still_accepts_ordinary_drags() {
  // The first defect this file was written for: refusal is for pinned
  // conflicts, not for a push chain that happened to reach a region edge.
  const { field, cards } = session(45);
  let refusals = 0;
  for (const card of cards.slice(0, 20)) {
    if (!field.getCard(card.id)) {
      continue;
    }
    if (!field.moveCard(card.id, 300, 200).ok) {
      refusals++;
    }
    Assert.deepEqual(field.overlaps(), [], "no occlusion mid-sequence");
  }
  Assert.less(refusals, 20, "a busy region did not refuse every drag");
});

add_task(async function test_placement_never_fails_off_lattice() {
  // The second defect: a card dragged off the seeding lattice covers seats no
  // lattice position can reach, and placement threw instead of growing.
  const { trails, field, cards, last } = session(40);
  field.moveCard(cards[3].id, 400, 300);

  let node = last;
  for (let i = 0; i < 30; i++) {
    node = trails.visit(node, { url: `https://r.invalid/${i}` });
    const card = field.place(node);
    Assert.ok(card, `placement ${i} succeeded`);
  }
});

add_task(async function test_dismissal_is_lossless() {
  const { trails, marks, field } = session(5);
  const card = field.cards()[0];
  trails.setViewState(card.node_id, {
    scrollY: 2400,
    formState: '{"q":"bush"}',
  });
  const mark = card.mark;

  field.dismiss(card.id);

  const node = trails.getNode(card.node_id);
  Assert.ok(node, "the page stayed on its trail");
  Assert.ok(node.dismissed_at, "dismissed, not deleted");
  Assert.equal(node.scroll_y, 2400, "scroll survived");
  Assert.equal(node.form_state, '{"q":"bush"}', "form state survived");
  Assert.equal(marks.objectAt(mark), null, "the mark was released");

  const restored = field.restore(card.node_id);
  Assert.ok(restored, "one call brings it back");
  Assert.equal(trails.getNode(card.node_id).dismissed_at, null, "undismissed");
  Assert.equal(trails.getNode(card.node_id).scroll_y, 2400, "still lossless");
});

add_task(async function test_the_overview_shows_everything() {
  const { trails, field } = session(5);
  for (let i = 0; i < 11; i++) {
    const trailId = trails.createTrail();
    field.place(trails.addNode({ trailId, url: `https://t${i}.invalid/` }));
  }

  const overview = field.overview();
  Assert.equal(
    overview.length,
    FIELD_GEOMETRY.overviewSlots,
    "the overview never exceeds the working-memory slot count"
  );
  Assert.ok(
    !overview.some(s => s.kind === "empty"),
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
  Assert.equal(
    shown.size,
    field.regions().length,
    "every region appears in the overview"
  );
});

add_task(async function test_saved_positions_are_display_independent() {
  const { field, cards } = session(5);
  field.moveCard(cards[0].id, 300, 200);

  const saved = JSON.parse(JSON.stringify(field.toJSON()));
  const card = saved.cards.find(c => c.id === cards[0].id);

  Assert.equal(card.x, 300, "position survives serialisation");
  Assert.equal(card.y, 200, "position survives serialisation");
  Assert.ok(card.pinned, "and so does the pin");
});
