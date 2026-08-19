/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Pillar B — navigation as a tree, and trails promoted out of it.
 *
 * The in-memory model, mirroring the `trail` and `trail_node` tables in
 * `context-engine/SCHEMA.md` column for column so that persistence is a
 * translation rather than a redesign. Kept free of Gecko APIs so the tree's
 * properties can be tested without a build; the session-store and SQLite
 * bindings sit above this, not inside it.
 *
 * Two distinctions this file exists to keep straight:
 *
 * 1. **Capture is not a trail.** The captured tree is automatic and total; a
 *    Trail is a named, curated selection promoted out of it. Bush's trails were
 *    built and shared deliberately, and that is what separates this from a
 *    browser history tree, which already ships elsewhere. `promote()` is the
 *    only way a curated trail comes into being.
 *
 * 2. **A node is a visit, not a document.** One URL becomes many nodes across
 *    many trails, which is what makes trail crossings a signal the Context
 *    Engine can read off the `url` index rather than a graph problem here.
 */

/** A node the user removed from the Field. Still in its trail, still restorable. */
const DISMISSED = "dismissed_at";

/**
 *
 */
export class TrailStore {
  #trails = new Map();
  #nodes = new Map();
  #childIds = new Map();
  #nextTrailId = 1;
  #nextNodeId = 1;
  #now;

  /**
   * @param {object} [options]
   * @param {function(): number} [options.now] Clock, injectable for tests.
   */
  constructor({ now = () => Date.now() } = {}) {
    this.#now = now;
  }

  // ---------------------------------------------------------------- trails

  /**
   * @param {object} [fields]
   * @param {string} [fields.name] Null until the user names it, per the schema.
   */
  createTrail({ name = null } = {}) {
    const t = this.#now();
    const trail = {
      id: this.#nextTrailId++,
      name,
      created_at: t,
      updated_at: t,
      archived_at: null,
    };
    this.#trails.set(trail.id, trail);
    return trail.id;
  }

  getTrail(id) {
    return this.#trails.get(id) ?? null;
  }

  /**
   * `name <mark> <text>`: naming is what makes a trail a first-class object.
   *
   * @param {number} id
   * @param {string} name User-supplied name.
   */
  nameTrail(id, name) {
    const trail = this.#trails.get(id);
    if (!trail) {
      throw new Error(`no such trail: ${id}`);
    }
    trail.name = name;
    trail.updated_at = this.#now();
    return trail;
  }

  /**
   * `done`: the trail is finished, so stop offering to resume it.
   *
   * Deliberately not a delete, and deliberately narrow. Everything the trail
   * holds survives — the tree, the scroll offsets, the pages in the Context
   * Engine — and the single thing that changes is that `restorable()` stops
   * putting it in front of the user at the next start. That is what the column
   * has always meant; it simply had no writer until now.
   *
   * The distinction it records is one recency cannot: a trail finished an hour
   * ago and a trail paused an hour ago sort identically by `updated_at`, so
   * without a word for "finished" the resumption list can only be ordered, never
   * shortened. Saved collections stop being retrievable once they outgrow a
   * glance, and this is the only signal in the system that comes from the person
   * who knows.
   *
   * @param {number} id
   */
  archiveTrail(id) {
    const trail = this.#trails.get(id);
    if (!trail) {
      throw new Error(`no such trail: ${id}`);
    }
    if (trail.archived_at !== null) {
      return trail;
    }
    trail.archived_at = this.#now();
    return trail;
  }

  /**
   * Undo `done`, because going back to a trail is the plainest way of saying
   * it was not finished after all.
   *
   * Re-entry is the only caller and that is deliberate — there is no second
   * verb. A trail is finished when the user says so and open again when they
   * walk back into it, so the reversal costs no word in `GRAMMAR.md` §4 and
   * cannot be forgotten, which a verb could be. Without it, re-entering a page
   * of a finished trail from the context sidebar would leave the user standing
   * on a trail that was still archived: the rail would show it, the next
   * navigation would extend it, and none of it would ever be offered back.
   *
   * @param {number} id
   */
  resumeTrail(id) {
    const trail = this.#trails.get(id);
    if (!trail) {
      throw new Error(`no such trail: ${id}`);
    }
    if (trail.archived_at === null) {
      return trail;
    }
    trail.archived_at = null;
    trail.updated_at = this.#now();
    return trail;
  }

  isArchived(id) {
    return this.#trails.get(id)?.archived_at != null;
  }

  trails() {
    return [...this.#trails.values()];
  }

  // ----------------------------------------------------------------- nodes

  /**
   * Add a node. `parentId` null makes it a trail root.
   *
   * This is the raw insert; navigation should go through `visit()` or
   * `branch()`, which say what they mean.
   *
   * @param {object} fields
   * @param {number} fields.trailId
   * @param {?number} [fields.parentId] Null makes it a trail root.
   * @param {string} fields.url
   * @param {?string} [fields.title]
   */
  addNode({ trailId, parentId = null, url, title = null }) {
    if (!this.#trails.has(trailId)) {
      throw new Error(`no such trail: ${trailId}`);
    }
    if (parentId !== null) {
      const parent = this.#nodes.get(parentId);
      if (!parent) {
        throw new Error(`no such parent node: ${parentId}`);
      }
      if (parent.trail_id !== trailId) {
        throw new Error("a node may not be parented across trails");
      }
    }
    const t = this.#now();
    const node = {
      id: this.#nextNodeId++,
      trail_id: trailId,
      parent_id: parentId,
      url,
      title,
      scroll_x: 0,
      scroll_y: 0,
      form_state: null,
      created_at: t,
      last_visited_at: t,
      dismissed_at: null,
    };
    this.#nodes.set(node.id, node);
    this.#childIds.set(node.id, []);
    if (parentId !== null) {
      this.#childIds.get(parentId).push(node.id);
    }
    this.#touchTrail(trailId);
    return node.id;
  }

  /**
   * Navigate from a node: every click or search spawns a **child**.
   *
   * Note what is absent — there is no path by which navigating from a node
   * removes anything. That is the whole of pillar B's promise that going back
   * never destroys the forward branch: re-entering an earlier node and
   * navigating again adds a second child, and the first is still there as its
   * sibling.
   *
   * @param {number} fromNodeId
   * @param {object} page
   * @param {string} page.url
   * @param {?string} [page.title]
   */
  visit(fromNodeId, { url, title = null }) {
    const from = this.#requireNode(fromNodeId);
    return this.addNode({
      trailId: from.trail_id,
      parentId: from.id,
      url,
      title,
    });
  }

  /**
   * `branch`: start a sibling of a node rather than a child of it — a new line
   * of enquiry from the same starting point. A root's sibling is another root.
   *
   * @param {number} nodeId
   * @param {object} page
   * @param {string} page.url
   * @param {?string} [page.title]
   */
  branch(nodeId, { url, title = null }) {
    const node = this.#requireNode(nodeId);
    return this.addNode({
      trailId: node.trail_id,
      parentId: node.parent_id,
      url,
      title,
    });
  }

  getNode(id) {
    return this.#nodes.get(id) ?? null;
  }

  children(id) {
    return (this.#childIds.get(id) ?? []).map(cid => this.#nodes.get(cid));
  }

  /**
   * Sibling nodes, excluding the node itself.
   *
   * @param {number} id
   */
  siblings(id) {
    const node = this.#requireNode(id);
    return this.nodes(node.trail_id).filter(
      n => n.parent_id === node.parent_id && n.id !== node.id
    );
  }

  roots(trailId) {
    return this.nodes(trailId).filter(n => n.parent_id === null);
  }

  nodes(trailId = null) {
    const all = [...this.#nodes.values()];
    return trailId === null ? all : all.filter(n => n.trail_id === trailId);
  }

  /**
   * Root-to-node path, which is what the rail renders as the current spine.
   *
   * @param {number} id
   */
  path(id) {
    const out = [];
    let node = this.#requireNode(id);
    while (node) {
      out.unshift(node);
      node = node.parent_id === null ? null : this.#nodes.get(node.parent_id);
    }
    return out;
  }

  /**
   * The node and everything under it, depth first.
   *
   * @param {number} id
   */
  subtree(id) {
    const out = [];
    const walk = nodeId => {
      out.push(this.#nodes.get(nodeId));
      for (const childId of this.#childIds.get(nodeId) ?? []) {
        walk(childId);
      }
    };
    walk(this.#requireNode(id).id);
    return out;
  }

  /**
   * `graft`: reattach a node, and its subtree with it, elsewhere in the tree.
   *
   * Rejects any move that would put a node inside its own subtree, which is the
   * one way a tree edit here can corrupt the structure.
   *
   * @param {number} nodeId
   * @param {?number} newParentId Null makes the node a root.
   */
  graft(nodeId, newParentId) {
    const node = this.#requireNode(nodeId);
    if (newParentId === null) {
      this.#detach(node);
      node.parent_id = null;
      this.#touchTrail(node.trail_id);
      return node;
    }
    const parent = this.#requireNode(newParentId);
    if (parent.trail_id !== node.trail_id) {
      throw new Error("a node may not be grafted across trails");
    }
    if (nodeId === newParentId) {
      throw new Error("a node may not be its own parent");
    }
    if (this.subtree(nodeId).some(n => n.id === newParentId)) {
      throw new Error("a node may not be grafted into its own subtree");
    }
    this.#detach(node);
    node.parent_id = newParentId;
    this.#childIds.get(newParentId).push(nodeId);
    this.#touchTrail(node.trail_id);
    return node;
  }

  /**
   * `dismiss`: drop a card from the Field. Deliberately not a delete — the
   * page keeps its place on the trail along with its scroll and form state, so
   * dismissal costs the user nothing and the Field does not become one more
   * surface to hoard on.
   *
   * @param {number} nodeId
   */
  dismiss(nodeId) {
    const node = this.#requireNode(nodeId);
    node[DISMISSED] = this.#now();
    this.#touchTrail(node.trail_id);
    return node;
  }

  restore(nodeId) {
    const node = this.#requireNode(nodeId);
    node[DISMISSED] = null;
    node.last_visited_at = this.#now();
    this.#touchTrail(node.trail_id);
    return node;
  }

  /**
   * `forget`: take pages out of the tree because their record has gone.
   *
   * The one path here that removes anything, and it exists only because the
   * user asked for it somewhere else — Clear Recent History or Forget About
   * This Site, arriving through `FOSForget`. Navigation never reaches this;
   * pillar B's promise that going back cannot destroy a branch is unaffected,
   * because the branch is destroyed by the user's own instruction to destroy
   * it and by nothing else.
   *
   * The rules are `FOSContextStore`'s, deliberately and to the letter, because
   * two trees that disagree are worse than either: a surviving child is
   * reparented onto its nearest surviving ancestor rather than deleted with
   * its parent, and a trail with nothing left on it goes too. See SCHEMA.md
   * §Forgetting for why each of those is the right trade — this is the same
   * decision, applied to the copy of the tree that is on screen.
   *
   * @param {Iterable<number>} nodeIds Ids to remove. Unknown ids are ignored
   *   rather than thrown on: the caller is naming rows deleted from a database
   *   this window may never have seen every one of.
   * @returns {{nodes: number[], trails: number[]}} What actually went.
   */
  forget(nodeIds) {
    const doomed = new Set();
    for (const id of nodeIds ?? []) {
      if (this.#nodes.has(id)) {
        doomed.add(id);
      }
    }
    if (!doomed.size) {
      return { nodes: [], trails: [] };
    }

    // Reparent first, while the forgotten nodes are all still present: the
    // climb reads `parent_id` on nodes that are themselves about to go.
    for (const id of doomed) {
      const survivors = (this.#childIds.get(id) ?? []).filter(
        childId => !doomed.has(childId)
      );
      if (!survivors.length) {
        continue;
      }
      const ancestorId = this.#survivingAncestor(id, doomed);
      for (const childId of survivors) {
        const child = this.#nodes.get(childId);
        this.#detach(child);
        child.parent_id = ancestorId;
        if (ancestorId !== null) {
          this.#childIds.get(ancestorId).push(childId);
        }
      }
    }

    const touched = new Set();
    for (const id of doomed) {
      const node = this.#nodes.get(id);
      touched.add(node.trail_id);
      // Only off a parent that is staying: a doomed parent's child list is
      // deleted whole a line below, and reaching into one already deleted in
      // this loop would throw on a chain of forgotten pages — the ordinary
      // case, since a site is usually navigated through more than once.
      if (node.parent_id !== null && !doomed.has(node.parent_id)) {
        this.#detach(node);
      }
      this.#childIds.delete(id);
      this.#nodes.delete(id);
    }

    const trails = [];
    for (const trailId of touched) {
      if (this.nodes(trailId).length) {
        this.#touchTrail(trailId);
      } else {
        this.#trails.delete(trailId);
        trails.push(trailId);
      }
    }
    return { nodes: [...doomed], trails };
  }

  /**
   * The nearest ancestor of a node that is not itself being forgotten.
   *
   * @param {number} id A node being forgotten.
   * @param {Set<number>} doomed Every node being forgotten in this pass.
   * @returns {?number} A node id, or null for "make it a root".
   */
  #survivingAncestor(id, doomed) {
    let ancestorId = this.#nodes.get(id).parent_id;
    const seen = new Set([id]);
    while (ancestorId !== null && doomed.has(ancestorId)) {
      if (seen.has(ancestorId)) {
        // Unreachable from the recorder, which only ever parents a new node
        // onto an existing one. A corrupt tree must not hang a delete.
        return null;
      }
      seen.add(ancestorId);
      ancestorId = this.#nodes.get(ancestorId).parent_id;
    }
    return ancestorId;
  }

  /**
   * Record where the user was on the page.
   *
   * The live `nsISHEntry` is authoritative while the node still has one; these
   * columns are the durable copy, written on dismissal and at session end. See
   * SCHEMA.md.
   *
   * @param {number} nodeId
   * @param {object} [state]
   * @param {?number} [state.scrollX] Left unchanged when null.
   * @param {?number} [state.scrollY] Left unchanged when null.
   * @param {?string} [state.formState] Session-store blob.
   */
  setViewState(
    nodeId,
    { scrollX = null, scrollY = null, formState = null } = {}
  ) {
    const node = this.#requireNode(nodeId);
    if (scrollX !== null) {
      node.scroll_x = scrollX;
    }
    if (scrollY !== null) {
      node.scroll_y = scrollY;
    }
    if (formState !== null) {
      node.form_state = formState;
    }
    node.last_visited_at = this.#now();
    return node;
  }

  // ------------------------------------------------------------- hydration

  /**
   * Adopt records into an empty store, so a restart does not start empty.
   *
   * The tree was session-scoped without this, which made pillar B's promise —
   * going back never destroys a branch — true only until the browser closed.
   * The database held every node the whole time; nothing read it back.
   *
   * This is also what `fromJSON` is built on, and deliberately so: an exported
   * trail and a row out of SQLite are the same shape by design, so loading one
   * and loading the other should not be two pieces of code that can disagree
   * about what a tree is.
   *
   * Database ids are adopted as they are rather than reassigned. That is safe
   * because a store is only ever hydrated while empty, and it makes the id in
   * a log line, the id in the rail and the id in `sqlite3` the same number.
   * Ids minted afterwards continue past the highest adopted one, so a new node
   * cannot collide with a restored one.
   *
   * Records arrive in any order — `graft` can put a node under a parent
   * created after it, so ordering by id is not a topological order — and are
   * linked in a second pass once every node exists.
   *
   * @param {object} records
   * @param {object[]} [records.trails] `trail` rows.
   * @param {object[]} [records.nodes] `trail_node` rows, any order.
   * @returns {{trails: Map<number, number>, nodes: Map<number, number>}}
   *   Database id → in-memory id, for the caller to map its own records by.
   */
  hydrate({ trails = [], nodes = [] } = {}) {
    if (this.#trails.size || this.#nodes.size) {
      throw new Error("hydrate expects an empty store");
    }

    // Validated before anything is written, so a refused set leaves the store
    // empty rather than half loaded. A caller that catches this — the Context
    // Engine does — can then carry on with an empty tree instead of a broken
    // one. A parent that is not here at all is refused rather than dropped: a
    // tree restored with a hole in its spine would draw a path the user never
    // browsed, and silently losing the descendants of that hole is worse than
    // restoring nothing.
    const trailIds = new Set(trails.map(trail => trail.id));
    const nodeIds = new Set(nodes.map(node => node.id));
    for (const node of nodes) {
      if (!trailIds.has(node.trail_id)) {
        throw new Error(`node ${node.id} has a missing trail ${node.trail_id}`);
      }
      const parentId = node.parent_id ?? null;
      if (parentId !== null && !nodeIds.has(parentId)) {
        throw new Error(`node ${node.id} has a missing parent ${parentId}`);
      }
    }

    const trailMap = new Map();
    for (const row of trails) {
      this.#trails.set(row.id, {
        id: row.id,
        name: row.name ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        archived_at: row.archived_at ?? null,
      });
      trailMap.set(row.id, row.id);
      this.#nextTrailId = Math.max(this.#nextTrailId, row.id + 1);
    }

    const nodeMap = new Map();
    for (const row of nodes) {
      this.#nodes.set(row.id, {
        id: row.id,
        trail_id: row.trail_id,
        parent_id: row.parent_id ?? null,
        url: row.url,
        title: row.title ?? null,
        scroll_x: row.scroll_x ?? 0,
        scroll_y: row.scroll_y ?? 0,
        form_state: row.form_state ?? null,
        created_at: row.created_at,
        last_visited_at: row.last_visited_at ?? row.created_at,
        dismissed_at: row.dismissed_at ?? null,
      });
      this.#childIds.set(row.id, []);
      nodeMap.set(row.id, row.id);
      this.#nextNodeId = Math.max(this.#nextNodeId, row.id + 1);
    }

    // Second pass: every node exists before any child is linked, so the order
    // records arrived in does not matter — which it would if this linked as it
    // went, since `graft` can put a node under a parent created after it and
    // ordering by id is therefore not a topological order.
    for (const node of this.#nodes.values()) {
      if (node.parent_id !== null) {
        this.#childIds.get(node.parent_id).push(node.id);
      }
    }

    return { trails: trailMap, nodes: nodeMap };
  }

  // ------------------------------------------------------------- promotion

  /**
   * Promote a curated selection of captured nodes into a named Trail.
   *
   * The selection is **copied**, not moved: the captured tree is a record of
   * what happened and must stay intact, while a Trail is an artefact the user
   * made. Structure is preserved where it can be — a copied node keeps its
   * parent if that parent was also selected, and becomes a root otherwise, so
   * a selection with gaps in it flattens rather than failing.
   *
   * @param {number[]} nodeIds The curated selection.
   * @param {object} [options]
   * @param {?string} [options.name] Null until the user names it.
   * @returns {{trailId: number, idMap: Map<number, number>}}
   */
  promote(nodeIds, { name = null } = {}) {
    const selected = [...new Set(nodeIds)];
    if (!selected.length) {
      throw new Error("cannot promote an empty selection");
    }
    for (const id of selected) {
      this.#requireNode(id);
    }
    const selectedSet = new Set(selected);
    const trailId = this.createTrail({ name });
    const idMap = new Map();

    // Parents before children, so a copied parent always exists first.
    const ordered = selected
      .map(id => this.#nodes.get(id))
      .sort((a, b) => this.path(a.id).length - this.path(b.id).length);

    for (const source of ordered) {
      const parentId =
        source.parent_id !== null && selectedSet.has(source.parent_id)
          ? idMap.get(source.parent_id)
          : null;
      const copyId = this.addNode({
        trailId,
        parentId,
        url: source.url,
        title: source.title,
      });
      const copy = this.#nodes.get(copyId);
      copy.scroll_x = source.scroll_x;
      copy.scroll_y = source.scroll_y;
      copy.form_state = source.form_state;
      idMap.set(source.id, copyId);
    }
    return { trailId, idMap };
  }

  // ----------------------------------------------------------------- JSON

  /**
   * Trails are first-class objects: nameable, saveable, exportable. This is the
   * export, and it is the schema's own column names so that a file written here
   * and a row read from SQLite are the same shape.
   *
   * @param {?number} trailId Null exports every trail.
   */
  toJSON(trailId = null) {
    const trails =
      trailId === null ? this.trails() : [this.#requireTrail(trailId)];
    return {
      version: 1,
      trails: trails.map(t => ({ ...t })),
      nodes: trails.flatMap(t => this.nodes(t.id).map(n => ({ ...n }))),
    };
  }

  static fromJSON(data, { now } = {}) {
    if (!data || data.version !== 1) {
      throw new Error(`unsupported trail export version: ${data?.version}`);
    }
    const store = new TrailStore(now ? { now } : {});
    store.hydrate(data);
    return store;
  }

  // -------------------------------------------------------------- internal

  #detach(node) {
    if (node.parent_id === null) {
      return;
    }
    const siblings = this.#childIds.get(node.parent_id);
    const at = siblings.indexOf(node.id);
    if (at !== -1) {
      siblings.splice(at, 1);
    }
  }

  #touchTrail(trailId) {
    const trail = this.#trails.get(trailId);
    if (trail) {
      trail.updated_at = this.#now();
    }
  }

  #requireNode(id) {
    const node = this.#nodes.get(id);
    if (!node) {
      throw new Error(`no such node: ${id}`);
    }
    return node;
  }

  #requireTrail(id) {
    const trail = this.#trails.get(id);
    if (!trail) {
      throw new Error(`no such trail: ${id}`);
    }
    return trail;
  }
}
