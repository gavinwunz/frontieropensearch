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

  /** `name <mark> <text>`: naming is what makes a trail a first-class object. */
  nameTrail(id, name) {
    const trail = this.#trails.get(id);
    if (!trail) {
      throw new Error(`no such trail: ${id}`);
    }
    trail.name = name;
    trail.updated_at = this.#now();
    return trail;
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

  /** Sibling nodes, excluding the node itself. */
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

  /** Root-to-node path, which is what the rail renders as the current spine. */
  path(id) {
    const out = [];
    let node = this.#requireNode(id);
    while (node) {
      out.unshift(node);
      node = node.parent_id === null ? null : this.#nodes.get(node.parent_id);
    }
    return out;
  }

  /** The node and everything under it, depth first. */
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
   * Record where the user was on the page.
   *
   * The live `nsISHEntry` is authoritative while the node still has one; these
   * columns are the durable copy, written on dismissal and at session end. See
   * SCHEMA.md.
   */
  setViewState(nodeId, { scrollX = null, scrollY = null, formState = null } = {}) {
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
   */
  toJSON(trailId = null) {
    const trails = trailId === null ? this.trails() : [this.#requireTrail(trailId)];
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
    for (const trail of data.trails) {
      store.#trails.set(trail.id, { ...trail });
      store.#nextTrailId = Math.max(store.#nextTrailId, trail.id + 1);
    }
    for (const node of data.nodes) {
      store.#nodes.set(node.id, { ...node });
      store.#childIds.set(node.id, []);
      store.#nextNodeId = Math.max(store.#nextNodeId, node.id + 1);
    }
    // Second pass: every node exists before any child is linked, so export
    // order does not matter.
    for (const node of data.nodes) {
      if (node.parent_id !== null) {
        const siblings = store.#childIds.get(node.parent_id);
        if (!siblings) {
          throw new Error(`node ${node.id} has a missing parent ${node.parent_id}`);
        }
        siblings.push(node.id);
      }
    }
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
