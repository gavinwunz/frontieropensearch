/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Pillar A — the Field: the card and region model that replaces the tab strip.
 *
 * `design/FIELD.md` is the specification; this file is the geometry and
 * bookkeeping that follows from it, kept free of Gecko APIs so the four
 * acceptance properties in FIELD.md §9 can be tested without a build. Thumbnail
 * capture, rendering and hit-testing sit above this, not inside it.
 *
 * Four things here are load-bearing rather than incidental, because each one is
 * a decision the design argues for at length:
 *
 * 1. **Positions are region-relative and in abstract units**, never pixels. §4
 *    promises a pinned card holds its position *relative to its region* across
 *    a resize and a restart, which is only true if the model never learns what
 *    a pixel is. The renderer scales; the model does not.
 *
 * 2. **The system seeds, the user owns.** A new card is auto-placed by
 *    provenance — the trail it came from, never topic or recency — and the
 *    instant the user moves it, it is pinned and the system may never move it
 *    again. Data Mountain's result only holds for layouts the user made, so
 *    this invariant is the feature and not a nicety.
 *
 * 3. **Cards never overlap, at any moment, including mid-drag.** Occlusion was
 *    the dominant failure mode in the study this design rests on. `moveCard`
 *    resolves against a scratch copy and commits atomically, so the arrangement
 *    a drag shows at any instant is exactly the one a drop produces. There is
 *    no settle animation because there is nothing left to settle.
 *
 * 4. **Refusal is a legitimate outcome.** When a drop cannot be resolved
 *    without moving a card the user placed, it is refused and nothing changes.
 *    The alternative is silently destroying a position somebody chose.
 */

/**
 * Geometry, in field units. A card is 4:3 because it carries a page thumbnail;
 * everything else is expressed in terms of the card so that retuning the card
 * size does not silently change the capacity of a region.
 *
 * The region is eight lattice columns by seven rows — 56 seats, which is the
 * "tens" §3 asks for. It is deliberately not a round number of units: capacity
 * is a consequence of the card size and the minimum gap, and pretending
 * otherwise would let the two drift apart.
 */
export const FIELD_GEOMETRY = Object.freeze({
  cardWidth: 100,
  cardHeight: 75,
  /** Data Mountain's minimum distance, maintained at all times. */
  minGap: 12,
  regionWidth: 896,
  regionHeight: 609,
  /** Overview slots, from the 6-7 item working-memory limit in IDEAS.md. */
  overviewSlots: 9,
});

/**
 * A push chain that has not settled by here is a configuration we do not
 * understand, and the safe response to that is to refuse the drop rather than
 * to keep pushing. Far above any chain a full region can produce.
 */
const MAX_PUSH_STEPS = 4096;

/**
 * A card pushed to exactly the minimum distance has to read as clear. Without a
 * tolerance the separation lands a unit in the last place short, the pair still
 * collides, and the push front grinds through ever smaller shifts until it hits
 * `MAX_PUSH_STEPS` and refuses a drop that was perfectly legal.
 */
const EPSILON = 1e-9;

/**
 * A bound on how far a region will grow to seat one card. Growth adds an empty
 * lattice row each time, so a seat appears within a step or two; this exists
 * only so that a bug cannot turn into an unbounded loop.
 */
const MAX_REGION_GROWTH = 64;

/** Refusal reasons. Surfaced to the UI so a refused drag can say why. */
export const REFUSED = Object.freeze({
  PINNED: "would-displace-pinned",
  BOUNDS: "would-leave-region",
  NO_ROOM: "no-room",
  UNRESOLVED: "unresolvable",
});

/**
 * The Field.
 *
 * Owns cards and regions. Reads the trail store for provenance and delegates
 * dismissal to it, because a dismissed page leaves the Field but never leaves
 * its trail — that is the whole of §8.
 */
export class FieldModel {
  #trails;
  #now;
  #geom;

  #cards = new Map();
  #regions = new Map();
  #cardsByNode = new Map();
  /**
   * Overview slots, indexed by position. Null is empty. A region's slot is
   * permanent while it is top-level: a landmark that moves is not a landmark.
   */
  #slots;
  /** The region-of-regions, created only on overflow. */
  #nest = null;
  #nextCardId = 1;

  /**
   * NOTE ON MARKS: the model deliberately assigns none. A page is one object
   * with one mark, and that mark belongs to its trail node — the card is the
   * page's presence on the Field, not a second thing to address. Giving cards
   * their own letters cost every page two of the twenty-six and was caught by
   * the rail losing its marks in a session of ordinary size.
   *
   * @param {object} options
   * @param {object} options.trails A `TrailStore`.
   * @param {function(): number} [options.now] Clock, injectable for tests.
   * @param {object} [options.geometry] Overrides for `FIELD_GEOMETRY`.
   */
  constructor({ trails, now = () => Date.now(), geometry = {} }) {
    if (!trails) {
      throw new Error("the Field needs a trail store: a region is a trail");
    }
    this.#trails = trails;
    this.#now = now;
    this.#geom = Object.freeze({ ...FIELD_GEOMETRY, ...geometry });
    this.#slots = new Array(this.#geom.overviewSlots).fill(null);
  }

  get geometry() {
    return this.#geom;
  }

  // ---------------------------------------------------------------- regions

  /**
   * The region for a trail, created on first use.
   *
   * A region *is* the trail — same id, same name, same lifetime. There is no
   * second organising structure to keep in sync, which is what makes every
   * region reachable by name from the command bar without touching the canvas.
   *
   * @param {number} trailId
   */
  regionFor(trailId) {
    const existing = this.#regions.get(trailId);
    if (existing) {
      return existing;
    }
    if (!this.#trails.getTrail(trailId)) {
      throw new Error(`no such trail: ${trailId}`);
    }
    const region = {
      id: trailId,
      width: this.#geom.regionWidth,
      height: this.#geom.regionHeight,
      slot: null,
      /** Set when the region has been collapsed into the region-of-regions. */
      nested: false,
      touched_at: this.#now(),
    };
    this.#regions.set(trailId, region);
    this.#assignSlot(region);
    return region;
  }

  /**
   * Give a region a permanent overview slot, collapsing the least recently
   * touched regions into the nest when there is no room.
   *
   * §3: when trails exceed nine the overview nests rather than the plane
   * growing or the cards shrinking. Both alternatives break something measured
   * — an unbounded plane is desert fog, and shrinking cards destroys the
   * thumbnail cue that made the spatial layout win in the first place.
   *
   * @param {object} region
   */
  #assignSlot(region) {
    let free = this.#slots.indexOf(null);
    if (free === -1) {
      free = this.#collapseLeastRecent();
    }
    this.#slots[free] = region.id;
    region.slot = free;
    region.nested = false;
  }

  /**
   * Collapse regions into the region-of-regions and return the freed slot.
   *
   * Creating the nest costs a slot of its own, so the first collapse has to
   * move two regions to free one. Afterwards the nest already has a slot and
   * one region per overflow is enough.
   *
   * The metric is an open question in FIELD.md §10 — a trail parked
   * deliberately is not a trail abandoned, and the Context Engine will have the
   * dwell data to tell those apart. It is isolated in `#collapseCandidates` so
   * that revisiting it is a change to one function.
   */
  #collapseLeastRecent() {
    const needed = this.#nest ? 1 : 2;
    const victims = this.#collapseCandidates(needed);
    if (victims.length < needed) {
      throw new Error("the overview cannot collapse far enough to fit");
    }
    const slots = victims.map(r => r.slot);
    for (const victim of victims) {
      this.#slots[victim.slot] = null;
      victim.slot = null;
      victim.nested = true;
    }
    if (!this.#nest) {
      this.#nest = { id: null, regionIds: [], slot: slots[0] };
      this.#slots[slots[0]] = this.#nest;
    }
    this.#nest.regionIds.push(...victims.map(r => r.id));
    return slots[slots.length - 1];
  }

  /**
   * Which regions to collapse. Least recently touched first, per §3.
   *
   * @param {number} count
   */
  #collapseCandidates(count) {
    return [...this.#regions.values()]
      .filter(r => r.slot !== null)
      .sort((a, b) => a.touched_at - b.touched_at || a.id - b.id)
      .slice(0, count);
  }

  /**
   * The overview: every region, always, scaled to fit by the renderer.
   *
   * Returns one entry per slot so the caller never has to reason about which
   * slots are empty — and, by construction, the overview shows the whole world.
   * That is acceptance property 1: there is no pan here and nothing to pan to.
   */
  overview() {
    return this.#slots.map((occupant, slot) => {
      if (occupant === null) {
        return { slot, kind: "empty" };
      }
      if (occupant === this.#nest) {
        return {
          slot,
          kind: "nest",
          regions: this.#nest.regionIds.map(id => this.#regions.get(id)),
        };
      }
      return { slot, kind: "region", region: this.#regions.get(occupant) };
    });
  }

  regions() {
    return [...this.#regions.values()];
  }

  /**
   * `done`: take a finished trail's region off the Field.
   *
   * A region *is* the trail, so ending the trail ends the region, and the cards
   * go with it. This is not `dismiss` applied nine times: dismissal is a
   * statement about one page, written on the node so the page can come back
   * with `enter`, and writing it across a whole trail would leave every page
   * looking individually discarded by a user who said something about the
   * thread. Nothing is written to the nodes here — the trail's own
   * `archived_at` already records what happened, and the tree is untouched.
   *
   * §3 caps the overview at nine regions and nests the overflow by least-recent
   * touch. That is the system guessing which trails are done, and §10 leaves
   * open that a trail parked deliberately is not a trail abandoned. This is the
   * user answering the question directly, so a freed slot must actually be
   * freed: the most recently touched nested region takes it, and a nest that
   * empties gives its own slot back rather than sitting there as a permanent
   * tax paid for a crowding that has since gone away.
   *
   * @param {number} trailId
   * @returns {boolean} Whether there was a region to retire.
   */
  retireTrail(trailId) {
    const region = this.#regions.get(trailId);
    if (!region) {
      return false;
    }

    for (const card of this.#cardsIn(trailId)) {
      this.#cards.delete(card.id);
      this.#cardsByNode.delete(card.node_id);
    }

    this.#regions.delete(trailId);
    if (region.nested) {
      this.#unnest(trailId);
    } else if (region.slot !== null) {
      this.#slots[region.slot] = null;
      this.#promoteIntoSlot(region.slot);
    }
    this.#dissolveEmptyNest();
    return true;
  }

  /**
   * Drop a region from the nest's membership without giving it a slot.
   *
   * @param {number} regionId
   */
  #unnest(regionId) {
    if (!this.#nest) {
      return;
    }
    const at = this.#nest.regionIds.indexOf(regionId);
    if (at !== -1) {
      this.#nest.regionIds.splice(at, 1);
    }
  }

  /**
   * Give a freed slot to the nested region most recently touched — the inverse
   * of `#collapseCandidates`, and the same metric read the other way, so a
   * region cannot be collapsed and promoted by two different rules.
   *
   * @param {number} slot
   */
  #promoteIntoSlot(slot) {
    if (!this.#nest?.regionIds.length) {
      return;
    }
    const candidates = this.#nest.regionIds
      .map(id => this.#regions.get(id))
      .filter(Boolean)
      .sort((a, b) => b.touched_at - a.touched_at || b.id - a.id);
    const promoted = candidates[0];
    if (!promoted) {
      return;
    }
    this.#unnest(promoted.id);
    this.#slots[slot] = promoted.id;
    promoted.slot = slot;
    promoted.nested = false;
  }

  /** A nest holding nothing is a slot spent on an empty box. */
  #dissolveEmptyNest() {
    if (this.#nest && !this.#nest.regionIds.length) {
      this.#slots[this.#nest.slot] = null;
      this.#nest = null;
    }
  }

  // ------------------------------------------------------------------ cards

  /**
   * Put a trail node on the Field.
   *
   * Placement means exactly one thing: provenance. The card lands in the region
   * of the trail the page came from, seeded outward from its parent's card so
   * that a page is visibly next to the page it came from. It is *not* placed by
   * topic — the base browser already groups tabs by topic with local
   * embeddings, and where a page came from is information no topic model has.
   *
   * @param {number} nodeId A node in the captured tree.
   * @returns {object} The card.
   */
  place(nodeId) {
    const existing = this.#cardsByNode.get(nodeId);
    if (existing) {
      return this.#cards.get(existing);
    }
    const node = this.#trails.getNode(nodeId);
    if (!node) {
      throw new Error(`no such node: ${nodeId}`);
    }
    const region = this.regionFor(node.trail_id);
    const anchor = this.#anchorFor(node, region);
    const seat = this.#seed(region, anchor);

    const card = {
      id: this.#nextCardId++,
      node_id: nodeId,
      region_id: region.id,
      x: seat.x,
      y: seat.y,
      /** False until the user moves it. See §4: the system seeds, the user owns. */
      pinned: false,
      created_at: this.#now(),
    };
    this.#cards.set(card.id, card);
    this.#cardsByNode.set(nodeId, card.id);
    region.touched_at = this.#now();
    return card;
  }

  /**
   * Where to start looking for a seat: the parent's card if it is on the Field,
   * otherwise the centre of the region.
   *
   * This is what makes zoom show provenance. A card grows out of the region it
   * belongs to at the overview level, and out of its parent at the region
   * level.
   *
   * @param {object} node
   * @param {object} region
   */
  #anchorFor(node, region) {
    if (node.parent_id !== null) {
      const parentCardId = this.#cardsByNode.get(node.parent_id);
      if (parentCardId) {
        const parent = this.#cards.get(parentCardId);
        return { x: parent.x, y: parent.y };
      }
    }
    return {
      x: (region.width - this.#geom.cardWidth) / 2,
      y: (region.height - this.#geom.cardHeight) / 2,
    };
  }

  /**
   * Find a free seat, without moving anything.
   *
   * Seeding never displaces: the system is allowed to choose where a new card
   * goes, and never allowed to revise where an old one went. Seats are a
   * lattice at the minimum spacing, taken in order of distance from the anchor,
   * so the result is deterministic and the same input always seeds the same
   * layout — which is what lets a restored session look like the one that was
   * saved.
   *
   * @param {object} region
   * @param {{x: number, y: number}} anchor
   */
  #seed(region, anchor) {
    const occupied = () => this.#cardsIn(region.id);
    let seat = this.#firstFreeSeat(region, anchor, occupied());
    if (seat) {
      return seat;
    }

    // The region is full. Trade the least recently used unclaimed card out for
    // the one coming in — which is §8 in one line: the Field holds what is in
    // play, dismissal is lossless, and a pinned card is never a candidate
    // because the user put it there. Exactly one, so that arriving at a full
    // region costs one dismissal rather than a cleared board.
    if (this.#evictOne(region.id)) {
      seat = this.#firstFreeSeat(region, anchor, occupied());
      if (seat) {
        return seat;
      }
    }

    // Still nothing. Either every card in the region is pinned, or — the case
    // that only showed up against a real session — the freed seat was still
    // covered by a card the user had dragged off the seeding lattice, so the
    // region has room that no lattice seat can reach.
    //
    // Grow, and keep growing until there is a seat. Placement must not fail:
    // it is driven by navigation, and a browser that refuses to open a page
    // because a canvas is untidy is not a browser. Growth is safe here because
    // the region level is scaled to fit and cannot be panned, so a taller
    // region still has no empty reachable view.
    for (let i = 0; i < MAX_REGION_GROWTH && !seat; i++) {
      region.height += this.#geom.cardHeight + this.#geom.minGap;
      seat = this.#firstFreeSeat(region, anchor, occupied());
    }
    if (!seat) {
      throw new Error("could not seat a card after growing the region");
    }
    return seat;
  }

  /**
   * @param {object} region
   * @param {{x: number, y: number}} anchor
   * @param {object[]} occupied Positions to avoid.
   */
  #firstFreeSeat(region, anchor, occupied) {
    const stepX = this.#geom.cardWidth + this.#geom.minGap;
    const stepY = this.#geom.cardHeight + this.#geom.minGap;
    const cols = Math.floor(region.width / stepX);
    const rows = Math.floor(region.height / stepY);

    const seats = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * stepX;
        const y = row * stepY;
        if (occupied.some(c => this.#collides({ x, y }, c))) {
          continue;
        }
        const dx = x - anchor.x;
        const dy = y - anchor.y;
        seats.push({ x, y, d: dx * dx + dy * dy });
      }
    }
    if (!seats.length) {
      return null;
    }
    // Distance first, then row-major, so ties resolve the same way every time.
    seats.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    return seats[0];
  }

  /**
   * Dismiss the least recently placed unpinned card to make room.
   *
   * This is §8 doing exactly what it promises rather than an eviction policy
   * bolted on: the Field holds what is in play, dismissal is free and lossless,
   * and a page dismissed here keeps its place on its trail with its scroll and
   * form state. A pinned card is never a candidate — the user put it there.
   *
   * @param {number} regionId
   * @returns {boolean} False when every card in the region is pinned.
   */
  #evictOne(regionId) {
    const candidates = this.#cardsIn(regionId)
      .filter(c => !c.pinned)
      .sort((a, b) => this.#lastUsed(a) - this.#lastUsed(b) || a.id - b.id);
    if (!candidates.length) {
      return false;
    }
    this.dismiss(candidates[0].id);
    return true;
  }

  /**
   * When the page behind a card was last visited. The trail node is the record
   * of what is in play, so eviction reads it rather than the card's own age —
   * a card placed early and read all morning is not the stale one.
   *
   * @param {object} card
   */
  #lastUsed(card) {
    return (
      this.#trails.getNode(card.node_id)?.last_visited_at ?? card.created_at
    );
  }

  getCard(cardId) {
    return this.#cards.get(cardId) ?? null;
  }

  cardForNode(nodeId) {
    const id = this.#cardsByNode.get(nodeId);
    return id ? this.#cards.get(id) : null;
  }

  /**
   * The region level: the cards of one trail.
   *
   * @param {number} regionId
   */
  cardsIn(regionId) {
    return this.#cardsIn(regionId);
  }

  #cardsIn(regionId) {
    return [...this.#cards.values()].filter(c => c.region_id === regionId);
  }

  cards() {
    return [...this.#cards.values()];
  }

  // ------------------------------------------------------------------ moving

  /**
   * Move a card, resolving occlusion, and pin it.
   *
   * Call this on every pointer move during a drag as well as on the drop: it is
   * pure with respect to a refusal and atomic with respect to a success, so the
   * arrangement it reports mid-drag is exactly the arrangement a drop commits.
   * That is what removes the settle animation, and with it the class of bug
   * where a card ends up somewhere the user did not aim.
   *
   * The resolution is a push front spreading from the moved card: whatever it
   * overlaps is pushed clear along its axis of least penetration, and whatever
   * *that* overlaps is pushed in turn. Displacement propagates transitively,
   * which is the fix the study credits with most of its improvement — but only
   * ever through unpinned cards, so the unrest is confined to seats nobody has
   * claimed.
   *
   * @param {number} cardId
   * @param {number} x Region-relative, in field units.
   * @param {number} y
   * @param {object} [options]
   * @param {boolean} [options.pin] False to preview without pinning.
   * @returns {{ok: true, moved: object[]} | {ok: false, reason: string}}
   */
  moveCard(cardId, x, y, { pin = true } = {}) {
    const card = this.#cards.get(cardId);
    if (!card) {
      throw new Error(`no such card: ${cardId}`);
    }
    const region = this.#regions.get(card.region_id);
    if (!this.#inBounds({ x, y }, region)) {
      return { ok: false, reason: REFUSED.BOUNDS };
    }

    // Resolve on a scratch copy. Nothing below mutates a real card until the
    // whole arrangement is known to be legal.
    const scratch = new Map();
    for (const c of this.#cardsIn(card.region_id)) {
      scratch.set(c.id, { x: c.x, y: c.y, pinned: c.pinned });
    }
    scratch.get(cardId).x = x;
    scratch.get(cardId).y = y;

    // The extent the arrangement is resolved against is provisional: §6's
    // capacity ladder ends in growth, and the push front is allowed to reach
    // for it. Nothing is committed until the whole arrangement is legal, so a
    // refused drag leaves the region exactly the height it was.
    const extent = { width: region.width, height: region.height };
    const result = this.#push(scratch, cardId, extent);
    if (!result.ok) {
      return result;
    }
    region.height = extent.height;

    const moved = [];
    for (const id of result.displaced) {
      const target = this.#cards.get(id);
      const next = scratch.get(id);
      target.x = next.x;
      target.y = next.y;
      moved.push(target);
    }
    if (pin) {
      card.pinned = true;
    }
    region.touched_at = this.#now();
    return { ok: true, moved };
  }

  /**
   * Spread the push front. Mutates `scratch` and `extent` only.
   *
   * @param {Map<number, object>} scratch
   * @param {number} sourceId
   * @param {{width: number, height: number}} extent The region's extent, which
   *   this may grow. The caller commits it only if the whole push settles.
   */
  #push(scratch, sourceId, extent) {
    const queue = [sourceId];
    const displaced = new Set([sourceId]);
    let steps = 0;

    while (queue.length) {
      if (++steps > MAX_PUSH_STEPS) {
        return { ok: false, reason: REFUSED.UNRESOLVED };
      }
      const pusherId = queue.shift();
      const pusher = scratch.get(pusherId);

      for (const [otherId, other] of scratch) {
        if (otherId === pusherId || !this.#collides(pusher, other)) {
          continue;
        }
        if (otherId === sourceId) {
          // The chain came back around to the card being dragged. There is no
          // arrangement here, so refuse rather than shove the drag off its own
          // target.
          return { ok: false, reason: REFUSED.NO_ROOM };
        }
        if (other.pinned) {
          return { ok: false, reason: REFUSED.PINNED };
        }
        const shift = this.#separation(pusher, other);
        other.x += shift.dx;
        other.y += shift.dy;
        if (!this.#inBounds(other, extent)) {
          // The push front reached the edge of the region. Refusing here would
          // be wrong: in a region that is merely busy, every chain eventually
          // reaches an edge, and the user would find that most drags simply do
          // not work — while the seat the dragged card vacated sits empty.
          //
          // An unpinned card has no position anybody chose, so the system is
          // free to re-seat it exactly as it was free to seed it. Refusal is
          // reserved for the case it was written for: a position the user owns.
          const seat = this.#reseat(extent, other, scratch, otherId);
          if (!seat) {
            return { ok: false, reason: REFUSED.BOUNDS };
          }
          other.x = seat.x;
          other.y = seat.y;
        }
        displaced.add(otherId);
        queue.push(otherId);
      }
    }
    return { ok: true, displaced };
  }

  /**
   * Find somewhere for a card the push front has driven out of the region,
   * growing the region if there is nowhere.
   *
   * The re-seat above answers "the chain reached an edge"; this answers the
   * case underneath it, which the perf harness found by counting committed
   * moves and noticing it was measuring refusals: **when the lattice is
   * exactly full, there is no free seat at all, and every drag is refused.**
   * Not only a drag across the region — 56 cards on 56 seats and a drag of
   * less than one seat-step still refuses, because the dragged card has not
   * yet cleared the minimum distance from the seat it vacated, so its own
   * seat is not free either. "You may not move anything" was the whole of the
   * behaviour, on the surface the pillar rests on.
   *
   * §6 already answers this for placement: seed, then evict, then grow. The
   * drag path implemented the first rung and stopped, and the fix is to let it
   * reach the third. Not the second — eviction exists to bound the card count
   * against a page *arriving*, and a drag brings nothing, so dismissing
   * somebody's page because they tidied would be a surprise the ladder never
   * promised. A drag therefore seeds or grows, and never trades.
   *
   * Growth is bounded in practice as well as by `MAX_REGION_GROWTH`: one added
   * row is a whole row of free seats, so the next pointer move of the same
   * drag finds one and grows nothing. A drag costs at most a row.
   *
   * @param {{width: number, height: number}} extent Grown in place.
   * @param {{x: number, y: number}} card The card that left the region.
   * @param {Map<number, object>} scratch
   * @param {number} cardId `card`'s id, so it does not block its own seat.
   * @returns {{x: number, y: number} | null}
   */
  #reseat(extent, card, scratch, cardId) {
    const occupied = [...scratch.entries()]
      .filter(([id]) => id !== cardId)
      .map(([, c]) => c);
    const anchor = { x: card.x, y: card.y };
    let seat = this.#firstFreeSeat(extent, anchor, occupied);
    for (let i = 0; i < MAX_REGION_GROWTH && !seat; i++) {
      extent.height += this.#geom.cardHeight + this.#geom.minGap;
      seat = this.#firstFreeSeat(extent, anchor, occupied);
    }
    return seat;
  }

  /**
   * Do two cards sit closer than the minimum distance on both axes?
   *
   * Note this is separation, not intersection: cards that merely touch are
   * already too close, because the invariant is a minimum *distance* and not
   * merely an absence of overlap.
   *
   * @param {{x: number, y: number}} a
   * @param {{x: number, y: number}} b
   */
  #collides(a, b) {
    const spanX = this.#geom.cardWidth + this.#geom.minGap;
    const spanY = this.#geom.cardHeight + this.#geom.minGap;
    const penX = spanX - Math.abs(a.x - b.x);
    const penY = spanY - Math.abs(a.y - b.y);
    return penX > EPSILON && penY > EPSILON;
  }

  /**
   * The smallest shift that clears `other` of `pusher`.
   *
   * Least penetration, so a card steps aside rather than leaping across the
   * region — the minimum visual disturbance consistent with the invariant.
   *
   * @param {{x: number, y: number}} pusher
   * @param {{x: number, y: number}} other
   */
  #separation(pusher, other) {
    const spanX = this.#geom.cardWidth + this.#geom.minGap;
    const spanY = this.#geom.cardHeight + this.#geom.minGap;
    const dx = other.x - pusher.x;
    const dy = other.y - pusher.y;
    const penX = spanX - Math.abs(dx);
    const penY = spanY - Math.abs(dy);

    if (penX <= penY) {
      // Exactly coincident cards have no direction to be pushed in, so pick one
      // and pick it the same way every time.
      const dir = dx === 0 ? 1 : Math.sign(dx);
      return { dx: dir * penX, dy: 0 };
    }
    const dir = dy === 0 ? 1 : Math.sign(dy);
    return { dx: 0, dy: dir * penY };
  }

  /**
   * @param {{x: number, y: number}} pos
   * @param {object} region
   */
  #inBounds(pos, region) {
    return (
      pos.x >= -EPSILON &&
      pos.y >= -EPSILON &&
      pos.x + this.#geom.cardWidth <= region.width + EPSILON &&
      pos.y + this.#geom.cardHeight <= region.height + EPSILON
    );
  }

  // -------------------------------------------------------------- dismissal

  /**
   * Take a card off the Field. The page stays on its trail, restorable in one
   * command with its scroll offset and form state — see §8, which is the one
   * decision in the whole pillar that is not negotiable. If dismissal were
   * lossy nobody would dismiss, and the Field would become one more surface to
   * hoard on.
   *
   * @param {number} cardId
   * @returns {number} The node the card was showing.
   */
  dismiss(cardId) {
    const card = this.#cards.get(cardId);
    if (!card) {
      throw new Error(`no such card: ${cardId}`);
    }
    this.#trails.dismiss(card.node_id);
    this.#cards.delete(cardId);
    this.#cardsByNode.delete(card.node_id);
    const region = this.#regions.get(card.region_id);
    if (region) {
      region.touched_at = this.#now();
    }
    return card.node_id;
  }

  /**
   * Bring a dismissed page back. A new card, seeded like any other — the
   * position is not restored, because the old one was one the *system* chose
   * and there is nothing to be faithful to. A card the user pinned was theirs
   * to dismiss, and if they want it back where it was they will put it there.
   *
   * @param {number} nodeId
   */
  restore(nodeId) {
    this.#trails.restore(nodeId);
    return this.place(nodeId);
  }

  /**
   * Put a card back where the user put it, in a previous session.
   *
   * §4 says the system never moves a pinned card — "not to make room, not to
   * rebalance a region, not on restart". This is the "not on restart" half, and
   * it is the only path that writes a position the model did not choose.
   *
   * Only user placements come back. An auto-placed card is not persisted and
   * does not need to be: `#seed` is deterministic, so re-seeding reproduces the
   * arrangement it produced last time. Persisting one would also freeze a
   * position the system is still entitled to revise, which is the opposite of
   * what the flag means.
   *
   * The card is expected to be seeded already. Restoring is therefore a move,
   * and it is allowed to displace: whatever the seed put in this seat is
   * unpinned by construction, and an unpinned card has no position anybody
   * chose. Two restored positions cannot fight, because they did not overlap
   * when they were saved.
   *
   * A region's height is a ratchet — §6's capacity ladder ends in growth — and
   * the height itself is not persisted, so a position saved in a grown region
   * would come back out of bounds and be refused. Growing to fit first is the
   * answer §6 already gives; the alternative is discarding a position somebody
   * chose, which §4 calls the one thing never to do.
   *
   * @param {number} nodeId
   * @param {{x: number, y: number}} at Region-relative, in field units.
   * @returns {{ok: boolean, reason?: string}}
   */
  pinAt(nodeId, { x, y }) {
    const cardId = this.#cardsByNode.get(nodeId);
    if (!cardId) {
      return { ok: false, reason: REFUSED.NO_ROOM };
    }
    const card = this.#cards.get(cardId);
    const region = this.#regions.get(card.region_id);
    const needed = y + this.#geom.cardHeight;
    if (needed > region.height) {
      // Bounded by the same ceiling a drag is. A row that claims a position
      // far outside anything the geometry can produce is not a position the
      // user chose; it is a corrupt or stale row, and it is refused below.
      region.height = Math.min(
        needed,
        this.#geom.regionHeight * MAX_REGION_GROWTH
      );
    }
    return this.moveCard(cardId, x, y);
  }

  // -------------------------------------------------------------- invariants

  /**
   * Every pair of cards sitting closer than the minimum distance.
   *
   * Empty at all times if the model is correct — this is acceptance property 3
   * expressed as code, so the tests can assert the invariant itself rather than
   * a proxy for it.
   */
  overlaps() {
    const found = [];
    const all = [...this.#cards.values()];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (
          all[i].region_id === all[j].region_id &&
          this.#collides(all[i], all[j])
        ) {
          found.push([all[i].id, all[j].id]);
        }
      }
    }
    return found;
  }

  /**
   * Serialise the Field. Positions are region-relative units, so this survives
   * a restart onto a different display without any card moving — property 2.
   */
  toJSON() {
    return {
      geometry: this.#geom,
      regions: this.regions().map(r => ({
        id: r.id,
        width: r.width,
        height: r.height,
        slot: r.slot,
        nested: r.nested,
      })),
      nest: this.#nest ? { regionIds: [...this.#nest.regionIds] } : null,
      cards: this.cards().map(c => ({
        id: c.id,
        node_id: c.node_id,
        region_id: c.region_id,
        x: c.x,
        y: c.y,
        pinned: c.pinned,
      })),
    };
  }
}
