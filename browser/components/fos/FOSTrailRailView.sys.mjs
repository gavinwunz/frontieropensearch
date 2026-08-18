/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The trail rail's view model: a tree flattened into rows.
 *
 * Pure, and free of Gecko APIs, for the same reason `FOSCommandBarView` is —
 * the interesting behaviour here is which rows appear at which depth under a
 * given collapse and hoist state, and that is worth testing in a second rather
 * than in a browser-chrome run. `FOSTrailRail.sys.mjs` renders what this
 * returns; `FOSTrailSession.sys.mjs` owns the state it is given.
 *
 * Three rules are implemented here rather than left to the renderer, because
 * each of them is a decision and not a detail:
 *
 * 1. **The rail may not hide where you are.** Collapsing is honoured everywhere
 *    except on the ancestors of the current node, which are always rendered
 *    open. A rail whose collapse state can conceal the page you are looking at
 *    is a rail that lies about the session, and the user would have to hunt for
 *    themselves. The stored collapse state is left untouched, so it takes
 *    effect again the moment the user moves elsewhere.
 *
 * 2. **Depth is bounded by hoisting, not by truncation.** A trail that runs
 *    twenty deep does not fit a rail at any sane indent. Outliners solved this
 *    decades ago — MORE called it hoisting, Workflowy calls it zoom — by
 *    changing the root rather than squeezing the indent: the subtree becomes
 *    the whole view and its ancestors become a breadcrumb. That is what
 *    `hoistRoot` does, and it is deliberately the same gesture as the Field's
 *    zoom into a region, so the two pillars share one way of saying "this part,
 *    larger" instead of inventing a second.
 *
 * 3. **A dismissed node is still a row.** `dismiss` drops a card from the Field
 *    and explicitly does not delete anything, so the rail is where a dismissed
 *    page remains visible and restorable. Hiding it here would quietly turn a
 *    reversible gesture into a destructive one.
 */

import { markWord } from "./FOSMarks.sys.mjs";

/** What a row stands for. Only nodes for now; a trail header may follow. */
export const ROW_NODE = "node";

/**
 * The label to show for a node.
 *
 * A title is what the user recognises, but it is not known until the page
 * commits one, so the host is the fallback rather than the raw URL — a rail
 * column is far too narrow for a query string, and the host is what the user
 * would have said the page was anyway.
 *
 * @param {object} node A node from `TrailStore`.
 * @returns {string} A human label, never empty.
 */
export function labelFor(node) {
  if (node.title) {
    return node.title;
  }
  try {
    const { host, pathname } = new URL(node.url);
    return host ? `${host}${pathname === "/" ? "" : pathname}` : node.url;
  } catch (e) {
    // Not every recorded URL parses — about: pages and the initial blank do
    // not always. The raw string is a better label than throwing.
    return node.url;
  }
}

/**
 * Flatten a trail into the rows the rail renders.
 *
 * @param {object} store A `TrailStore`.
 * @param {object} options
 * @param {number} options.trailId Which trail to render.
 * @param {?number} [options.currentId] The node the window is on.
 * @param {Set<number>} [options.collapsed] Node ids the user collapsed.
 * @param {?number} [options.hoistRoot] Render only this subtree.
 * @param {?object} [options.marks] A `MarkRegistry`, read only.
 * @returns {object} `{rows, breadcrumb, hoistRoot, trail}`.
 */
export function railFor(
  store,
  {
    trailId,
    currentId = null,
    collapsed = new Set(),
    hoistRoot = null,
    marks = null,
  } = {}
) {
  const trail = store.getTrail(trailId);
  if (!trail) {
    throw new Error(`no such trail: ${trailId}`);
  }

  // Rule 1: the ancestors of the current node are force-opened. The current
  // node itself is not — collapsing the node you are on hides its forward
  // branches, which is a reasonable thing to want and hides nothing you need.
  const spine = currentId === null ? [] : store.path(currentId);
  const spineIds = new Set(spine.map(n => n.id));
  const forcedOpen = new Set(spine.slice(0, -1).map(n => n.id));

  let roots;
  let breadcrumb = [];
  if (hoistRoot === null) {
    roots = store.roots(trailId);
  } else {
    const node = store.getNode(hoistRoot);
    if (!node || node.trail_id !== trailId) {
      throw new Error(`cannot hoist to node ${hoistRoot} of trail ${trailId}`);
    }
    roots = [node];
    breadcrumb = store.path(hoistRoot).slice(0, -1).map(ancestorRow);
  }

  const rows = [];
  const walk = (node, depth) => {
    const children = store.children(node.id);
    const isCollapsed =
      collapsed.has(node.id) && !forcedOpen.has(node.id) && !!children.length;

    rows.push({
      kind: ROW_NODE,
      id: node.id,
      depth,
      label: labelFor(node),
      url: node.url,
      mark: marks?.markOf(node.id) ?? null,
      spoken: markWord(marks?.markOf(node.id)) ?? null,
      isCurrent: node.id === currentId,
      onSpine: spineIds.has(node.id),
      hasChildren: !!children.length,
      childCount: children.length,
      collapsed: isCollapsed,
      dismissed: node.dismissed_at !== null,
      isHoistRoot: node.id === hoistRoot,
    });

    if (!isCollapsed) {
      for (const child of children) {
        walk(child, depth + 1);
      }
    }
  };

  for (const root of roots) {
    walk(root, 0);
  }

  return { rows, breadcrumb, hoistRoot, trail };
}

/**
 * @param {object} node A node from `TrailStore`.
 * @returns {object} A breadcrumb entry.
 */
function ancestorRow(node) {
  return { id: node.id, label: labelFor(node) };
}

/**
 * The node id `delta` rows away from `fromId` among the visible rows.
 *
 * Movement is over what is rendered, not over the tree, so a collapsed subtree
 * is stepped past in one keypress rather than walked through invisibly. Ends
 * clamp instead of wrapping: the rail is a map of where the user has been, and
 * arrowing off the bottom onto the first root would misrepresent the shape of
 * it.
 *
 * @param {object[]} rows Rows from `railFor`.
 * @param {?number} fromId The currently selected node id.
 * @param {number} delta Rows to move, signed.
 * @returns {?number} The node id to select, or null when there are no rows.
 */
export function moveSelection(rows, fromId, delta) {
  if (!rows.length) {
    return null;
  }
  const at = rows.findIndex(row => row.id === fromId);
  if (at === -1) {
    return delta >= 0 ? rows[0].id : rows[rows.length - 1].id;
  }
  const next = Math.min(Math.max(at + delta, 0), rows.length - 1);
  return rows[next].id;
}

/**
 * The node a "collapse" keypress should act on.
 *
 * Pressing collapse on a leaf, or on something already collapsed, is not a
 * no-op the user has to notice and correct — it moves to the parent, which is
 * what every file tree does and what the user meant. Returns the id to
 * collapse and whether the selection should follow.
 *
 * @param {object} store A `TrailStore`.
 * @param {object[]} rows Rows from `railFor`.
 * @param {number} nodeId The selected node.
 * @param {Set<number>} collapsed The current collapse state.
 * @returns {?object} `{collapse, select}`, or null when there is nowhere to go.
 */
export function collapseTarget(store, rows, nodeId, collapsed) {
  const row = rows.find(r => r.id === nodeId);
  if (!row) {
    return null;
  }
  if (row.hasChildren && !collapsed.has(nodeId)) {
    return { collapse: nodeId, select: nodeId };
  }
  const parent = store.getNode(nodeId)?.parent_id ?? null;
  if (parent === null || !rows.some(r => r.id === parent)) {
    return null;
  }
  return { collapse: parent, select: parent };
}
