/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The context sidebar: pillar C's second surface, and a place to stay.
 *
 * `SCHEMA.md` names three surfaces over the context store — the command bar
 * ranked by active context, this, and the exported pack. `what` used to answer
 * in a single sentence, which `GRAMMAR.md` §4 always described as "spoken or
 * shown": the sentence is the spoken half and this is the shown one. So `what`
 * opens this panel and the sentence becomes its heading. No verb was added —
 * the alphabet and the action table are unchanged.
 *
 * Built like the rail and the command bar: DOM on first open rather than markup
 * in `browser.xhtml`, so a window that never opens it pays nothing. The view
 * model is in `FOSContextSidebarView.sys.mjs` and is tested in node; what is
 * left here is the part only Gecko can run.
 *
 * It sits on the *inline end*, opposite the trail rail. That is not symmetry
 * for its own sake: the two can be open together and answer different questions
 * — the rail is "how did I get here", the sidebar is "what do I know" — and a
 * surface that displaced the other would make the pair unusable, which is
 * exactly the state the tab strip put every panel in.
 */

import { FOSContextEngine } from "./FOSContextEngine.sys.mjs";
import { FOSTrailSession, nodeKey } from "./FOSTrailSession.sys.mjs";
import { moveSelection, sidebarFor } from "./FOSContextSidebarView.sys.mjs";

import { ensureStylesheet } from "./FOSChrome.sys.mjs";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const STYLESHEET = "chrome://browser/content/fos/fos-contextsidebar.css";

/** One sidebar per chrome window. */
const byWindow = new WeakMap();

/**
 * A window's context sidebar.
 */
export class FOSContextSidebar {
  /**
   * The sidebar for a chrome window, created on first ask.
   *
   * @param {Window} window A browser window.
   * @returns {FOSContextSidebar}
   */
  static forWindow(window) {
    let sidebar = byWindow.get(window);
    if (!sidebar) {
      sidebar = new FOSContextSidebar(window);
      byWindow.set(window, sidebar);
    }
    return sidebar;
  }

  #window;
  #engine;
  #session;
  #root = null;
  #heading = null;
  #summary = null;
  #body = null;
  #unsubscribe = null;
  /** Every rendered row, in order — what the arrow keys move over. */
  #rows = [];
  /** The index into `#rows` of the selected row, or null. */
  #selected = null;
  /** Guards against two renders racing on the same await. */
  #renderToken = 0;

  constructor(window) {
    this.#window = window;
    this.#engine = FOSContextEngine.forWindow(window);
    this.#session = FOSTrailSession.forWindow(window);
  }

  /**
   * Make this the surface `what` shows.
   *
   * The sidebar registers no verb of its own. `what` is pillar C's verb and the
   * engine keeps it; this only tells the engine there is now something to show
   * as well as something to say. Registering `what` here instead would have
   * silently overridden the engine's handler — `FOSActions.register` is
   * last-writer-wins — and made the behaviour depend on wiring order.
   *
   * It takes no command bar for that reason — it is the one surface in this
   * component with no verb to bind.
   *
   * @returns {FOSContextSidebar} This sidebar.
   */
  wire() {
    this.#engine.setSurface(this);
    return this;
  }

  get isOpen() {
    return !!this.#root && !this.#root.hidden;
  }

  /** The panel's body element, or null before first open. Tests read this. */
  get body() {
    return this.#body;
  }

  /** The rows currently rendered, as view-model objects. Tests read this. */
  get rows() {
    return this.#rows;
  }

  async toggle() {
    return this.isOpen ? this.close() : this.open();
  }

  /**
   * Show the panel and fill it.
   *
   * @returns {Promise<void>} Resolves once the first render has landed, so a
   *   test — or a caller wanting to read it — never sees the empty frame.
   */
  async open() {
    this.#build();
    this.#root.hidden = false;
    if (!this.#unsubscribe) {
      // The trail session is the cheapest honest signal that the context may
      // have changed: every navigation, branch and re-entry goes through it,
      // and the engine reconciles off the same announcement. Subscribing to
      // the store instead would mean waiting for a write to land before the
      // surface admitted the page existed.
      this.#unsubscribe = this.#session.subscribe(() => this.render());
    }
    await this.render();
    this.#body.focus();
  }

  close() {
    if (!this.#root) {
      return;
    }
    this.#root.hidden = true;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#selected = null;
    this.#window.gBrowser?.selectedBrowser?.focus();
  }

  // ---- rendering ----------------------------------------------------------

  /**
   * Read the engine and redraw.
   *
   * @returns {Promise<void>}
   */
  async render() {
    if (!this.#root || this.#root.hidden) {
      return;
    }
    const token = ++this.#renderToken;
    const model = await this.#model();
    // A later render started while this one was reading. Its answer is newer,
    // so this one must not paint over it.
    if (token !== this.#renderToken || !this.isOpen) {
      return;
    }
    this.#draw(model);
  }

  /**
   * Everything the panel needs, gathered in one pass.
   *
   * @returns {Promise<object>} A `sidebarFor` model.
   */
  async #model() {
    const contents = await this.#engine.contents();
    const currentNodeId = this.#session.currentNodeId;
    const currentNode =
      currentNodeId === null
        ? null
        : this.#session.store.getNode(currentNodeId);
    // Crossings are keyed by URL, which is what makes them cross trails at all.
    // A window sitting on no node has no page to ask about, and asking for the
    // crossings of an empty URL would return every node that has never had one.
    const crossings = currentNode?.url
      ? await this.#engine.crossings(currentNode.url)
      : [];

    return sidebarFor(contents, {
      crossings,
      // The database's trail id, not the in-memory one: `crossings` rows come
      // from SQLite and the two id spaces are not the same numbers.
      currentTrailId: this.#engine.activeTrailRowId,
      currentNodeId: this.#engine.nodeRowId(currentNodeId),
      mark: this.#engine.activeContextMark,
      marks: {
        markOf: rowId => {
          const memId = this.#engine.nodeIdForRow(rowId);
          return memId === null
            ? null
            : (this.#session.marks?.markOf(nodeKey(memId)) ?? null);
        },
      },
      now: Date.now(),
    });
  }

  #draw(model) {
    const doc = this.#window.document;
    this.#heading.textContent = "";
    this.#body.textContent = "";
    this.#rows = [];

    if (model.mark) {
      const mark = doc.createElementNS(HTML_NS, "span");
      mark.className = "fos-sidebar-mark";
      mark.textContent = model.mark;
      if (model.markWord) {
        mark.title = model.markWord;
      }
      this.#heading.appendChild(mark);
    }
    const title = doc.createElementNS(HTML_NS, "span");
    title.className = "fos-sidebar-title";
    title.textContent = model.title;
    // An unnamed context says how to name it, which is where the verb is
    // learned — the same placeholder argument as the rail's "Unnamed trail".
    if (!model.named) {
      title.title = "Use `name <text>` to name this context";
    }
    this.#heading.appendChild(title);

    this.#summary.textContent = model.summary;

    if (model.empty) {
      const empty = doc.createElementNS(HTML_NS, "p");
      empty.className = "fos-sidebar-empty";
      empty.textContent = model.empty;
      this.#body.appendChild(empty);
      this.#applySelection();
      return;
    }

    for (const section of model.sections) {
      this.#body.appendChild(this.#drawSection(section));
    }
    this.#applySelection();
  }

  #drawSection(section) {
    const doc = this.#window.document;
    const wrapper = doc.createElementNS(HTML_NS, "section");
    wrapper.className = "fos-sidebar-section";
    wrapper.dataset.section = section.id;

    const heading = doc.createElementNS(HTML_NS, "h2");
    heading.className = "fos-sidebar-heading";
    heading.textContent = section.title;
    wrapper.appendChild(heading);

    if (section.note) {
      const note = doc.createElementNS(HTML_NS, "p");
      note.className = "fos-sidebar-note";
      note.textContent = section.note;
      wrapper.appendChild(note);
    }

    const list = doc.createElementNS(HTML_NS, "ul");
    list.className = "fos-sidebar-list";

    for (const row of section.rows) {
      const index = this.#rows.length;
      this.#rows.push(row);
      list.appendChild(this.#drawRow(row, index));
    }

    wrapper.appendChild(list);
    return wrapper;
  }

  #drawRow(row, index) {
    const doc = this.#window.document;
    const item = doc.createElementNS(HTML_NS, "li");
    item.className = "fos-sidebar-row";
    item.id = `fos-sidebar-row-${index}`;
    item.dataset.kind = row.kind;
    item.dataset.index = String(index);
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", "false");
    item.toggleAttribute("data-enterable", row.enterable);
    item.toggleAttribute("data-dismissed", !!row.dismissed);
    item.toggleAttribute("data-current", !!row.current);
    if (row.outcome) {
      item.dataset.outcome = row.outcome;
    }

    if (row.mark) {
      const mark = doc.createElementNS(HTML_NS, "span");
      mark.className = "fos-sidebar-rowmark";
      mark.textContent = row.mark;
      item.appendChild(mark);
    }

    const label = doc.createElementNS(HTML_NS, "span");
    label.className = "fos-sidebar-label";
    label.textContent = row.label;
    if (row.title) {
      label.title = row.title;
    }
    item.appendChild(label);

    if (row.detail) {
      const detail = doc.createElementNS(HTML_NS, "span");
      detail.className = "fos-sidebar-detail";
      detail.textContent = row.detail;
      item.appendChild(detail);
    }

    if (row.enterable) {
      item.addEventListener("mousedown", event => {
        event.preventDefault();
        this.#selected = index;
        this.#enter(row);
      });
    }

    return item;
  }

  #applySelection() {
    const active =
      this.#selected === null
        ? null
        : this.#body.querySelector(`[data-index="${this.#selected}"]`);
    for (const el of this.#body.querySelectorAll(".fos-sidebar-row")) {
      el.setAttribute("aria-selected", String(el === active));
    }
    if (active) {
      this.#body.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    } else {
      this.#body.removeAttribute("aria-activedescendant");
    }
  }

  /**
   * Act on a row: go to the page it stands for.
   *
   * Every enterable row resolves to a trail node, whichever section it came
   * from — a question resolves to the page it opened, a crossing to the visit
   * that other trail made. That is what keeps this one gesture rather than
   * three, and it is why re-entry is the sidebar's only action: the store's
   * rows are all provenance, and provenance is somewhere you have been.
   *
   * @param {object} row A view-model row.
   */
  #enter(row) {
    const memId = this.#engine.nodeIdForRow(row.nodeId);
    if (memId === null) {
      // The row is from the database but not from this session's tree — an
      // older trail that restoration did not bring back. Saying so is better
      // than a click that silently does nothing.
      this.#engine.report(
        async () => "That page is on a trail this session did not restore."
      );
      return;
    }
    this.#session.enter(memId);
  }

  // ---- DOM ----------------------------------------------------------------

  #build() {
    if (this.#root) {
      return;
    }
    const doc = this.#window.document;

    ensureStylesheet(this.#window, STYLESHEET);

    const root = doc.createElementNS(HTML_NS, "aside");
    root.className = "fos-sidebar";
    root.hidden = true;
    root.setAttribute("aria-label", "Context");

    const header = doc.createElementNS(HTML_NS, "header");
    header.className = "fos-sidebar-header";

    const heading = doc.createElementNS(HTML_NS, "h1");
    heading.className = "fos-sidebar-context";

    const summary = doc.createElementNS(HTML_NS, "p");
    summary.className = "fos-sidebar-summary";

    header.append(heading, summary);

    const body = doc.createElementNS(HTML_NS, "div");
    body.className = "fos-sidebar-body";
    body.setAttribute("role", "listbox");
    body.setAttribute("tabindex", "0");
    body.addEventListener("keydown", event => this.#onKeyDown(event));

    root.append(header, body);
    doc.documentElement.appendChild(root);

    this.#root = root;
    this.#heading = heading;
    this.#summary = summary;
    this.#body = body;
  }

  #onKeyDown(event) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        this.close();
        break;

      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        this.#selected = moveSelection(
          this.#rows,
          this.#selected,
          event.key === "ArrowDown" ? 1 : -1
        );
        this.#applySelection();
        break;

      case "Enter": {
        event.preventDefault();
        const row = this.#selected === null ? null : this.#rows[this.#selected];
        if (row?.enterable) {
          this.#enter(row);
        }
        break;
      }
    }
  }
}
