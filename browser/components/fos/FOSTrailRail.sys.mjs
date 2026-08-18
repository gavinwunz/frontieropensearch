/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The trail rail: pillar B's surface.
 *
 * Built the same way as the command bar — DOM on first open rather than markup
 * in `browser.xhtml`, so a window that never opens it pays nothing and the
 * whole surface stays in one file while it is still changing shape. The view
 * model is in `FOSTrailRailView.sys.mjs` and is tested in node; the tree and the
 * capture are in `FOSTrailTree` and `FOSTrailSession`. What is left here is the
 * part only Gecko can run.
 *
 * THIS RAIL IS NOT READ-ONLY, AND THAT IS THE POINT. The most repeated
 * complaint about the shipped tree-history extensions is that you can look at
 * the tree and do nothing to it, which makes a tree view a decoration rather
 * than a capability. So every row is a live object: Enter re-enters it with its
 * scroll offset and form values, and the command bar's `graft` and `name` act
 * on the marks this rail displays. A row is somewhere to go, not a picture of
 * somewhere you went.
 */

import {
  collapseTarget,
  moveSelection,
  railFor,
} from "./FOSTrailRailView.sys.mjs";
import { FOSTrailSession, nodeKey } from "./FOSTrailSession.sys.mjs";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const STYLESHEET = "chrome://browser/content/fos/fos-trailrail.css";

/**
 * The disclosure glyph for a row: pointing along the branch it would open.
 *
 * @param {object} row A row from `railFor`.
 * @returns {string} The glyph, or empty for a leaf.
 */
function twistyGlyph(row) {
  if (!row.hasChildren) {
    return "";
  }
  return row.collapsed ? "\u25b8" : "\u25be";
}

/** One rail per chrome window. */
// eslint-disable-next-line jsdoc/require-jsdoc
const byWindow = new WeakMap();

/**
 *
 */
export class FOSTrailRail {
  /**
   * The rail for a chrome window, created on first ask.
   *
   * @param {Window} window A browser window.
   * @returns {FOSTrailRail}
   */
  static forWindow(window) {
    let rail = byWindow.get(window);
    if (!rail) {
      rail = new FOSTrailRail(window);
      byWindow.set(window, rail);
    }
    return rail;
  }

  #window;
  #session;
  #root = null;
  #crumbs = null;
  #list = null;
  #empty = null;
  #unsubscribe = null;
  #collapsed = new Set();
  #hoistRoot = null;
  #selected = null;

  constructor(window) {
    this.#window = window;
    this.#session = FOSTrailSession.forWindow(window);
  }

  get isOpen() {
    return !!this.#root && !this.#root.hidden;
  }

  /** The rail's list element, or null before first open. Tests read this. */
  get list() {
    return this.#list;
  }

  /** The node ids currently rendered, in order. Tests read this. */
  get renderedIds() {
    return [...(this.#list?.querySelectorAll(".fos-rail-row") ?? [])].map(el =>
      Number(el.dataset.nodeId)
    );
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    this.#build();
    this.#root.hidden = false;
    if (!this.#unsubscribe) {
      this.#unsubscribe = this.#session.subscribe(() => this.render());
    }
    this.render();
    this.#list.focus();
  }

  close() {
    if (!this.#root) {
      return;
    }
    this.#root.hidden = true;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#window.gBrowser?.selectedBrowser?.focus();
  }

  /**
   * Hoist to a node: it becomes the rail's root and its ancestors a breadcrumb.
   *
   * A view operation, like collapsing — it moves nothing and runs no action, so
   * it needs no verb in the action table and no spoken form, by the same
   * argument that keeps Tab out of the grammar in the command bar.
   *
   * @param {?number} nodeId The node to hoist to, or null to show the whole
   *   trail.
   */
  hoist(nodeId) {
    this.#hoistRoot = nodeId;
    this.render();
  }

  /** Hoist out one level, to the parent of the current hoist root. */
  unhoist() {
    if (this.#hoistRoot === null) {
      return;
    }
    this.hoist(this.#session.store.getNode(this.#hoistRoot)?.parent_id ?? null);
  }

  // ---- rendering ----------------------------------------------------------

  render() {
    if (!this.#root || this.#root.hidden) {
      return;
    }
    const trailId = this.#session.activeTrailId;
    if (trailId === null) {
      this.#list.textContent = "";
      this.#crumbs.textContent = "";
      this.#empty.hidden = false;
      return;
    }
    this.#empty.hidden = true;

    // A hoist root belongs to whichever trail it came from, so switching trails
    // has to drop it rather than throw.
    if (
      this.#hoistRoot !== null &&
      this.#session.store.getNode(this.#hoistRoot)?.trail_id !== trailId
    ) {
      this.#hoistRoot = null;
    }

    const currentId = this.#session.currentNodeId;
    const { rows, breadcrumb, trail } = railFor(this.#session.store, {
      trailId,
      currentId,
      collapsed: this.#collapsed,
      hoistRoot: this.#hoistRoot,
      marks: { markOf: id => this.#marks?.markOf(nodeKey(id)) ?? null },
    });

    if (!rows.some(row => row.id === this.#selected)) {
      this.#selected = currentId ?? rows[0]?.id ?? null;
    }

    this.#renderCrumbs(trail, breadcrumb);
    this.#renderRows(rows);
  }

  get #marks() {
    return this.#session.marks ?? null;
  }

  #renderCrumbs(trail, breadcrumb) {
    const doc = this.#window.document;
    this.#crumbs.textContent = "";

    const name = doc.createElementNS(HTML_NS, "button");
    name.className = "fos-rail-crumb";
    name.type = "button";
    // An unnamed trail says so rather than showing an id. `name <text>` is the
    // gesture that fixes it, and the placeholder is where that is learned.
    name.textContent = trail.name ?? "Unnamed trail";
    name.addEventListener("click", () => this.hoist(null));
    this.#crumbs.appendChild(name);

    for (const crumb of breadcrumb) {
      const step = doc.createElementNS(HTML_NS, "button");
      step.className = "fos-rail-crumb";
      step.type = "button";
      step.textContent = crumb.label;
      step.addEventListener("click", () => this.hoist(crumb.id));
      this.#crumbs.appendChild(step);
    }
  }

  #renderRows(rows) {
    const doc = this.#window.document;
    this.#list.textContent = "";

    for (const row of rows) {
      const item = doc.createElementNS(HTML_NS, "li");
      item.className = "fos-rail-row";
      item.id = `fos-rail-node-${row.id}`;
      item.dataset.nodeId = String(row.id);
      item.setAttribute("role", "treeitem");
      // Depth is one-based for ARIA, and it is the *rendered* depth, so a
      // hoisted subtree reports itself honestly as starting at level 1.
      item.setAttribute("aria-level", String(row.depth + 1));
      item.setAttribute("aria-selected", String(row.id === this.#selected));
      if (row.hasChildren) {
        item.setAttribute("aria-expanded", String(!row.collapsed));
      }
      item.toggleAttribute("data-current", row.isCurrent);
      item.toggleAttribute("data-spine", row.onSpine);
      item.toggleAttribute("data-dismissed", row.dismissed);
      // Indentation is presentational; ARIA already carries the real depth, so
      // a screen reader is not asked to interpret a pixel measurement.
      item.style.setProperty("--fos-rail-depth", String(row.depth));

      const twisty = doc.createElementNS(HTML_NS, "span");
      twisty.className = "fos-rail-twisty";
      twisty.setAttribute("aria-hidden", "true");
      twisty.textContent = twistyGlyph(row);
      if (row.hasChildren) {
        twisty.addEventListener("mousedown", event => {
          event.preventDefault();
          event.stopPropagation();
          this.#toggleCollapse(row.id);
        });
      }

      const mark = doc.createElementNS(HTML_NS, "span");
      mark.className = "fos-rail-mark";
      mark.textContent = row.mark ?? "";
      if (row.spoken) {
        // The spoken form is the mark's other half, and a word never shown is
        // a word that cannot be said. It is a tooltip rather than a column
        // because the rail is narrow and the letter is the addressable part.
        mark.title = row.spoken;
      }

      const label = doc.createElementNS(HTML_NS, "span");
      label.className = "fos-rail-label";
      label.textContent = row.label;
      label.title = row.url;

      item.append(twisty, mark, label);

      if (row.hasChildren && row.collapsed) {
        const count = doc.createElementNS(HTML_NS, "span");
        count.className = "fos-rail-count";
        // A collapsed branch has to advertise that something is under it, or
        // collapsing becomes indistinguishable from pruning.
        count.textContent = String(row.childCount);
        item.append(count);
      }

      item.addEventListener("mousedown", event => {
        event.preventDefault();
        this.#selected = row.id;
        this.#session.enter(row.id);
      });

      this.#list.appendChild(item);
    }

    this.#applySelection();
  }

  #applySelection() {
    const active = this.#list.querySelector(
      `[data-node-id="${this.#selected}"]`
    );
    for (const el of this.#list.querySelectorAll(".fos-rail-row")) {
      el.setAttribute("aria-selected", String(el === active));
    }
    if (active) {
      this.#list.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    } else {
      this.#list.removeAttribute("aria-activedescendant");
    }
  }

  #rows() {
    const trailId = this.#session.activeTrailId;
    if (trailId === null) {
      return [];
    }
    return railFor(this.#session.store, {
      trailId,
      currentId: this.#session.currentNodeId,
      collapsed: this.#collapsed,
      hoistRoot: this.#hoistRoot,
    }).rows;
  }

  #toggleCollapse(nodeId) {
    if (this.#collapsed.has(nodeId)) {
      this.#collapsed.delete(nodeId);
    } else {
      this.#collapsed.add(nodeId);
    }
    this.render();
  }

  // ---- DOM ----------------------------------------------------------------

  #build() {
    if (this.#root) {
      return;
    }
    const doc = this.#window.document;

    if (!doc.querySelector(`link[href="${STYLESHEET}"]`)) {
      const link = doc.createElementNS(HTML_NS, "link");
      link.rel = "stylesheet";
      link.href = STYLESHEET;
      doc.documentElement.appendChild(link);
    }

    const root = doc.createElementNS(HTML_NS, "aside");
    root.className = "fos-rail";
    root.hidden = true;
    root.setAttribute("aria-label", "Trail");

    const crumbs = doc.createElementNS(HTML_NS, "nav");
    crumbs.className = "fos-rail-crumbs";

    const list = doc.createElementNS(HTML_NS, "ul");
    list.className = "fos-rail-list";
    list.setAttribute("role", "tree");
    list.setAttribute("tabindex", "0");

    const empty = doc.createElementNS(HTML_NS, "p");
    empty.className = "fos-rail-empty";
    empty.textContent = "Nowhere yet. Every page you open joins the trail.";

    list.addEventListener("keydown", event => this.#onKeyDown(event));

    root.append(crumbs, list, empty);
    doc.documentElement.appendChild(root);

    this.#root = root;
    this.#crumbs = crumbs;
    this.#list = list;
    this.#empty = empty;
  }

  #onKeyDown(event) {
    const rows = this.#rows();
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        this.close();
        break;

      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        this.#selected = moveSelection(
          rows,
          this.#selected,
          event.key === "ArrowDown" ? 1 : -1
        );
        this.#applySelection();
        break;
      }

      case "ArrowLeft": {
        event.preventDefault();
        const target = collapseTarget(
          this.#session.store,
          rows,
          this.#selected,
          this.#collapsed
        );
        if (target) {
          this.#collapsed.add(target.collapse);
          this.#selected = target.select;
          this.render();
        }
        break;
      }

      case "ArrowRight": {
        event.preventDefault();
        if (this.#collapsed.delete(this.#selected)) {
          this.render();
        } else {
          const child = this.#session.store.children(this.#selected)[0];
          if (child) {
            this.#selected = child.id;
            this.#applySelection();
          }
        }
        break;
      }

      case "Enter": {
        event.preventDefault();
        if (this.#selected !== null) {
          this.#session.enter(this.#selected);
        }
        break;
      }

      // Hoisting: the same "this part, larger" gesture as the Field's zoom.
      case "z":
        event.preventDefault();
        this.hoist(this.#selected);
        break;

      case "Backspace":
        event.preventDefault();
        this.unhoist();
        break;
    }
  }
}
