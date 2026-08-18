/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Field's view model: everything about rendering the Field that does not
 * need Gecko to run.
 *
 * Split out from `FOSFieldSurface.sys.mjs` for the same reason
 * `FOSTrailRailView` is split out of the rail — the arithmetic that decides
 * where a card lands on screen is the part most likely to be wrong, and it is
 * testable in a tenth of a second under plain `node --test` instead of a
 * browser-chrome run.
 *
 * The model in `FOSField.sys.mjs` owns *field units*: positions relative to a
 * region, which is what `FIELD.md` §9 property 2 means by a pinned card staying
 * where it was left across a resize. This file is the only place those units
 * become pixels, and it is a pure function of the model plus the viewport, so
 * a resize re-derives the same arrangement at a different scale rather than
 * moving anything.
 */

/**
 * The three semantic levels of `FIELD.md` §3. Zoom moves between them; there is
 * no continuum of arbitrary scales, and no pan at any of them.
 */
export const LEVEL = Object.freeze({
  OVERVIEW: "overview",
  REGION: "region",
  PAGE: "page",
});

/**
 * Screen-space constants. Gutters and padding are in CSS pixels and are the
 * only numbers here that are taste rather than consequence — everything else
 * falls out of the region geometry the model already owns.
 */
export const VIEW_METRICS = Object.freeze({
  /** Space around the whole Field. */
  padding: 32,
  /** Space between overview tiles. */
  gutter: 24,
  /** Room at the top of a tile for its name, mark and count. */
  tileHeader: 28,
  /**
   * Room for a card's title, *inside* the card rather than under it.
   *
   * §6 says cards never overlap, and the model guarantees that for the boxes it
   * owns. A caption hung below the box would make the rendered card taller than
   * the box the model is reasoning about, so two cards a legal distance apart
   * would still overlap on screen — the invariant holding in the model and
   * failing in the only place the user can see it. The title lives in the card.
   */
  cardCaption: 16,
});

/**
 * Lay the overview out: every region, always, scaled to fit.
 *
 * The grid is square-ish and derived from the slot count rather than fixed at
 * 3x3, so changing `overviewSlots` in the geometry cannot silently produce a
 * layout that overflows the window. Tiles keep the region's aspect ratio, which
 * is what makes zooming into one a continuous magnification of the same shape
 * instead of a reflow.
 *
 * There is no pan and no viewport to move, which is acceptance property 1: the
 * whole world is on screen by construction, so no reachable view is empty.
 *
 * @param {object} options
 * @param {object[]} options.slots The model's `overview()`.
 * @param {{width: number, height: number}} options.viewport
 * @param {object} options.geometry The model's geometry.
 * @param {object} [options.metrics] Overrides for `VIEW_METRICS`.
 * @returns {object} `{cols, rows, scale, tiles}` with tile boxes in pixels.
 */
export function overviewLayout({
  slots,
  viewport,
  geometry,
  metrics = VIEW_METRICS,
}) {
  const count = Math.max(slots.length, 1);
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  const availW = Math.max(viewport.width - 2 * metrics.padding, 1);
  const availH = Math.max(viewport.height - 2 * metrics.padding, 1);
  const cellW = (availW - (cols - 1) * metrics.gutter) / cols;
  const cellH = (availH - (rows - 1) * metrics.gutter) / rows;

  // The header is a fixed strip in pixels and does not scale with the region,
  // so it cannot be folded into an aspect ratio — doing that overflows the
  // body by exactly the amount the tile was scaled down by, which is small
  // enough to look like a rounding error and is not one. Fit the *body* to the
  // region's shape and add the header on top of it.
  const shape = geometry.regionWidth / geometry.regionHeight;
  const tileW = Math.max(
    Math.min(cellW, Math.max(cellH - metrics.tileHeader, 1) * shape),
    1
  );
  const bodyH = tileW / shape;
  const tileH = bodyH + metrics.tileHeader;

  const gridW = cols * tileW + (cols - 1) * metrics.gutter;
  const gridH = rows * tileH + (rows - 1) * metrics.gutter;
  const originX = (viewport.width - gridW) / 2;
  const originY = (viewport.height - gridH) / 2;

  // The nominal scale, for a region that has not grown. Tiles are uniform
  // boxes, so a region that has grown taller (§6, capacity) has to be fitted
  // into its own tile individually — see `miniScale`.
  const scale = tileW / geometry.regionWidth;

  const tiles = slots.map((entry, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      ...entry,
      x: originX + col * (tileW + metrics.gutter),
      y: originY + row * (tileH + metrics.gutter),
      width: tileW,
      height: tileH,
      bodyHeight: bodyH,
    };
  });

  return { cols, rows, scale, tiles };
}

/**
 * The scale at which one region's cards are drawn inside an overview tile.
 *
 * Tiles are uniform, but regions are not: a region grows taller when every seat
 * is taken and every card in it is pinned (§6, capacity). A single shared scale
 * would therefore let a grown region's cards spill out of the bottom of its
 * tile — silently, and only for the user who has been working hardest in one
 * trail. Each region is fitted to its own tile instead, which costs nothing for
 * the ordinary case, where the region is its nominal size and this returns
 * exactly `layout.scale`.
 *
 * @param {object} region A region from the model.
 * @param {object} tile A tile from `overviewLayout`.
 * @param {number} [share] The fraction of the tile's width this region gets,
 *   which is less than one only inside the nest.
 * @returns {number}
 */
export function miniScale(region, tile, share = 1) {
  return Math.min(
    (tile.width * share) / region.width,
    tile.bodyHeight / region.height
  );
}

/**
 * Lay one region out: its cards, scaled to fit the window.
 *
 * A region grows downward when it runs out of seats (§6, capacity), so the
 * scale is whichever of the two axes binds. It is never greater than 1: a
 * region with three cards in it magnifies nothing, because a card blown up to
 * four times its captured resolution is a blurry rectangle and the thumbnail
 * cue is the whole reason the card exists.
 *
 * @param {object} options
 * @param {object} options.region A region from the model.
 * @param {object[]} options.cards The region's cards.
 * @param {{width: number, height: number}} options.viewport
 * @param {object} options.geometry The model's geometry.
 * @param {object} [options.metrics] Overrides for `VIEW_METRICS`.
 * @returns {object} `{scale, originX, originY, cards}` with boxes in pixels.
 */
export function regionLayout({
  region,
  cards,
  viewport,
  geometry,
  metrics = VIEW_METRICS,
}) {
  const availW = Math.max(viewport.width - 2 * metrics.padding, 1);
  const availH = Math.max(viewport.height - 2 * metrics.padding, 1);
  const scale = Math.min(availW / region.width, availH / region.height, 1);

  const originX = (viewport.width - region.width * scale) / 2;
  const originY = (viewport.height - region.height * scale) / 2;

  return {
    scale,
    originX,
    originY,
    width: region.width * scale,
    height: region.height * scale,
    cards: cards.map(card => ({
      ...card,
      left: originX + card.x * scale,
      top: originY + card.y * scale,
      width: geometry.cardWidth * scale,
      height: geometry.cardHeight * scale,
    })),
  };
}

/**
 * Turn a pointer position into the field-unit position of a card's top-left.
 *
 * Takes the grab offset — where within the card the pointer went down — so a
 * drag moves the card rather than teleporting its corner to the cursor. The
 * result is clamped into the region, because the model refuses an out-of-bounds
 * move and a drag that dies the moment the pointer crosses an edge reads as a
 * broken drag rather than as a boundary.
 *
 * @param {object} options
 * @param {number} options.clientX Pointer position, relative to the surface.
 * @param {number} options.clientY
 * @param {{x: number, y: number}} options.grab Offset within the card, in field
 *   units.
 * @param {object} options.layout A `regionLayout` result.
 * @param {object} options.region The region being dragged in.
 * @param {object} options.geometry The model's geometry.
 * @returns {{x: number, y: number}} A position in field units.
 */
export function pointerToField({
  clientX,
  clientY,
  grab,
  layout,
  region,
  geometry,
}) {
  const x = (clientX - layout.originX) / layout.scale - grab.x;
  const y = (clientY - layout.originY) / layout.scale - grab.y;
  return {
    x: clamp(x, 0, Math.max(region.width - geometry.cardWidth, 0)),
    y: clamp(y, 0, Math.max(region.height - geometry.cardHeight, 0)),
  };
}

/**
 * The cards on the ancestor chain of a node, within one region.
 *
 * This is `FIELD.md` §10's open question — what a region looks like when its
 * trail is a deep tree — answered without drawing the tree a second time.
 *
 * The evidence for showing lineage at all is PadPrints (Hypertext '98), which
 * is the closest measured relative of this design: a zoomable *hierarchy* of
 * page thumbnails, tested against Netscape's own history. Its result splits
 * exactly along the line that matters here. On general browsing it changed
 * nothing measurable — the paper reports fewer pages accessed but no time
 * difference. On tasks that required returning to a page already seen, users
 * finished in 61.2% of the time. So hierarchy earns its screen space at
 * revisitation and nowhere else.
 *
 * The evidence against drawing it persistently is the spatial-hypertext
 * literature already in `IDEAS.md`: given both, users reach for proximity and
 * leave the explicit links alone. A canvas whose cards the user is invited to
 * drag would turn a persistent node-link overlay into spaghetti within a
 * session, and the rail already renders the tree properly for anyone who wants
 * the structure itself.
 *
 * So lineage is a *transient* property of the focused card: focus one and its
 * ancestors within the region light up. It costs no persistent ink, it survives
 * dragging because it is derived rather than drawn, and it is the same trick
 * Data Mountain used to bind a title to its thumbnail — a shared highlight —
 * applied to provenance instead.
 *
 * @param {object} store A `TrailStore`.
 * @param {?number} nodeId The focused card's node.
 * @param {object[]} cards The region's cards.
 * @returns {Set<number>} Card ids on the chain, focused card excluded.
 */
export function lineageCards(store, nodeId, cards) {
  const chain = new Set();
  if (nodeId === null || nodeId === undefined) {
    return chain;
  }
  const ancestors = new Set(
    store
      .path(nodeId)
      .map(node => node.id)
      .filter(id => id !== nodeId)
  );
  for (const card of cards) {
    if (ancestors.has(card.node_id)) {
      chain.add(card.id);
    }
  }
  return chain;
}

/**
 * Move focus in a direction, spatially.
 *
 * The Field is a plane, so arrow keys have to mean "the thing that way" rather
 * than "the next thing in a list" — a list order over a 2-D arrangement is the
 * kind of thing that works for the four cards a developer tests with and falls
 * apart at forty. Candidates are those genuinely in the given direction from
 * the current item's centre; among them the nearest wins, with movement across
 * the axis counted double so that a card directly ahead beats a nearer one off
 * to the side.
 *
 * @param {object[]} items Anything with `{id, x, y, width, height}` in pixels.
 * @param {?(number|string)} currentId
 * @param {string} direction "up" | "down" | "left" | "right".
 * @returns {?(number|string)} The id to focus, or the current one if nothing
 *   lies that way.
 */
export function moveFocus(items, currentId, direction) {
  if (!items.length) {
    return null;
  }
  const current = items.find(item => item.id === currentId);
  if (!current) {
    return items[0].id;
  }

  const centre = box => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
  const from = centre(current);

  let best = null;
  let bestScore = Infinity;
  for (const item of items) {
    if (item.id === currentId) {
      continue;
    }
    const to = centre(item);
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    let along;
    let across;
    switch (direction) {
      case "left":
        along = -dx;
        across = Math.abs(dy);
        break;
      case "right":
        along = dx;
        across = Math.abs(dy);
        break;
      case "up":
        along = -dy;
        across = Math.abs(dx);
        break;
      case "down":
        along = dy;
        across = Math.abs(dx);
        break;
      default:
        return currentId;
    }
    if (along <= 0) {
      continue;
    }
    const score = along + 2 * across;
    if (score < bestScore) {
      bestScore = score;
      best = item.id;
    }
  }
  return best ?? currentId;
}

/**
 * What a card should be captioned with.
 *
 * §7 requires a title bound to the card with no hover delay, which means the
 * caption is always rendered and therefore always has to say *something* — a
 * card with no title yet is still a card the user has to be able to pick out.
 *
 * @param {?object} node A trail node, or null.
 * @returns {string}
 */
export function cardCaption(node) {
  if (!node) {
    return "Untitled";
  }
  if (node.title) {
    return node.title;
  }
  try {
    return new URL(node.url).host || node.url;
  } catch (e) {
    return node.url || "Untitled";
  }
}

/**
 * @param {number} value
 * @param {number} low
 * @param {number} high
 */
function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}
