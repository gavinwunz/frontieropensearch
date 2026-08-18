/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The command bar: the one entry surface.
 *
 * Phase 2's plan asks for a single surface handling search, URL, commands,
 * trail-jump and context-switch, with no separate URL bar, search box or menu
 * for any of them. This is that surface. Everything it knows how to do comes
 * from the action table, and everything it does with what the user typed goes
 * through `FOSCommandParser` — the bar itself contains no grammar, so the
 * transcript front end can be attached later without a second parse path.
 *
 * The DOM is built on first open rather than declared in `browser.xhtml`. The
 * bar is a transient overlay, so there is nothing to show at startup, and
 * keeping it out of the window's markup means it costs a window that never
 * opens it exactly nothing. It also keeps the whole surface in one file, which
 * matters while it is still changing shape every run.
 *
 * The view model — what to show for a given parse — is in
 * `FOSCommandBarView.sys.mjs` and is pure, so it is tested in node. This file
 * is the part that can only be tested in Gecko, and it is kept thin on purpose.
 */

import { QUERY, parse } from "./FOSCommandParser.sys.mjs";
import { MarkRegistry } from "./FOSMarks.sys.mjs";
import { FOSActionDispatcher, resolveInput } from "./FOSActions.sys.mjs";
import {
  R_ACTION,
  R_MARK,
  completionsFor,
  viewFor,
} from "./FOSCommandBarView.sys.mjs";

import { ensureStylesheet } from "./FOSChrome.sys.mjs";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const STYLESHEET = "chrome://browser/content/fos/fos-commandbar.css";

/**
 * How long a transient answer stays up.
 *
 * Long enough to read a sentence without hurrying, short enough that it is
 * gone before it becomes furniture. It is dismissible by click and is replaced
 * outright by the next one, so overrunning costs nothing.
 */
const NOTICE_MS = 8000;

/** One bar per chrome window. */
// eslint-disable-next-line jsdoc/require-jsdoc
const byWindow = new WeakMap();

/**
 *
 */
export class FOSCommandBar {
  /**
   * The bar for a chrome window, created on first ask.
   *
   * @param {Window} window A browser window.
   * @returns {FOSCommandBar}
   */
  static forWindow(window) {
    let bar = byWindow.get(window);
    if (!bar) {
      bar = new FOSCommandBar(window);
      byWindow.set(window, bar);
    }
    return bar;
  }

  /** The window's mark registry. Pillars register their objects here. */
  marks = new MarkRegistry();

  /** The window's action dispatcher. Pillars register their verbs here. */
  actions;

  #window;
  #root = null;
  #input = null;
  #status = null;
  #report = null;
  #reportTimer = 0;
  #list = null;
  #view = null;
  #selected = -1;

  constructor(window) {
    this.#window = window;
    this.actions = new FOSActionDispatcher(window);
  }

  get isOpen() {
    return !!this.#root && !this.#root.hidden;
  }

  /** The input element, or null before first open. Tests read this. */
  get input() {
    return this.#input;
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open({ initialValue = "" } = {}) {
    this.#build();
    this.#root.hidden = false;
    this.#input.value = initialValue;
    this.#input.focus();
    this.#input.select();
    this.#update();
  }

  close() {
    if (!this.#root) {
      return;
    }
    this.#root.hidden = true;
    this.#input.value = "";
    this.#selected = -1;
    // Focus has to go somewhere the user can keep browsing from. The content
    // area is the only honest answer while there is no tab strip to return to.
    this.#window.gBrowser?.selectedBrowser?.focus();
  }

  /**
   * Parse the current input and run it. Exposed so that a transcript front end
   * can drive exactly this, rather than synthesising keystrokes.
   *
   * @param {string} [text] Defaults to what is in the input.
   * @returns {object} What was run: `{type, ran}` or `{type, resolved}`.
   */
  run(text = this.#input?.value ?? "") {
    const result = parse(text, { marks: this.marks });

    if (result.type === QUERY) {
      const resolved = this.actions.openQuery(result.query);
      this.close();
      return { type: QUERY, resolved };
    }

    const view = viewFor(result, { marks: this.marks, input: text });
    if (!view.canRun) {
      // An incomplete or ill-formed line leaves the bar open with the status
      // already explaining why. Closing it here would throw away what the user
      // typed at the exact moment they need to correct it.
      return { type: result.type, ran: [] };
    }

    const ran = this.actions.runAll(result.commands);
    this.close();
    return { type: result.type, ran };
  }

  // ---- DOM ----------------------------------------------------------------

  #build() {
    if (this.#root) {
      return;
    }
    const doc = this.#window.document;

    ensureStylesheet(this.#window, STYLESHEET);

    const root = doc.createElementNS(HTML_NS, "div");
    root.className = "fos-commandbar-backdrop";
    root.hidden = true;

    const bar = doc.createElementNS(HTML_NS, "div");
    bar.className = "fos-commandbar";

    const input = doc.createElementNS(HTML_NS, "input");
    input.className = "fos-commandbar-input";
    input.setAttribute("type", "text");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "fos-commandbar-list");
    input.setAttribute("placeholder", "Search, or type a command");

    const status = doc.createElementNS(HTML_NS, "div");
    status.className = "fos-commandbar-status";
    // The status line is the bar's whole feedback channel and it changes on
    // every keystroke, so it is a live region: a screen-reader user has to be
    // told that Enter is about to search rather than navigate, and that is the
    // only place it is ever said.
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    const list = doc.createElementNS(HTML_NS, "ul");
    list.className = "fos-commandbar-list";
    list.id = "fos-commandbar-list";
    list.setAttribute("role", "listbox");

    bar.append(input, status, list);
    root.appendChild(bar);
    doc.documentElement.appendChild(root);

    input.addEventListener("input", () => this.#update());
    input.addEventListener("keydown", event => this.#onKeyDown(event));
    root.addEventListener("mousedown", event => {
      if (event.target === root) {
        this.close();
      }
    });

    this.#root = root;
    this.#input = input;
    this.#status = status;
    this.#list = list;
  }

  /**
   * Say one line to the user, with the bar closed.
   *
   * Pillar C's `what` and `pack` both answer a question asked in passing, and
   * both answer *after* running, by which time the bar has closed and its
   * status line has gone with it. Rather than keep the bar open — which would
   * make an answer feel like an unfinished command — the answer gets its own
   * transient line.
   *
   * It is a live region for the same reason the status line is: this is the
   * only place the sentence is ever said, so a screen-reader user who does not
   * get it here does not get it at all. It is polite rather than assertive
   * because it always follows something the user just did deliberately.
   *
   * @param {string} message
   */
  notify(message) {
    this.#build();
    const doc = this.#window.document;
    if (!this.#report) {
      const report = doc.createElementNS(HTML_NS, "div");
      report.className = "fos-report";
      report.setAttribute("role", "status");
      report.setAttribute("aria-live", "polite");
      report.hidden = true;
      // Clicking it dismisses it, so a long answer never sits in the way of
      // the page it is about.
      report.addEventListener("click", () => this.dismissNotice());
      doc.documentElement.appendChild(report);
      this.#report = report;
    }
    this.#report.textContent = message;
    this.#report.hidden = false;
    this.#window.clearTimeout(this.#reportTimer);
    this.#reportTimer = this.#window.setTimeout(
      () => this.dismissNotice(),
      NOTICE_MS
    );
  }

  /** Hide the transient line, if one is showing. */
  dismissNotice() {
    this.#window.clearTimeout(this.#reportTimer);
    this.#reportTimer = 0;
    if (this.#report) {
      this.#report.hidden = true;
    }
  }

  #update() {
    const text = this.#input.value;
    const result = parse(text, { marks: this.marks });

    // Only a query needs the URL-or-search decision, and it is the one part of
    // the view that cannot be computed without Gecko, so it is resolved here
    // and handed in rather than reached for from the view model.
    let resolved = null;
    if (result.type === QUERY) {
      resolved = resolveInput(result.query);
    }

    this.#view = viewFor(result, { marks: this.marks, resolved, input: text });
    this.#selected = -1;
    this.#render();
  }

  #render() {
    const doc = this.#window.document;
    const { status, rows } = this.#view;

    this.#status.textContent = status.text;
    this.#status.setAttribute("data-kind", status.kind);

    this.#list.textContent = "";
    let lastGroup = null;
    rows.forEach((row, index) => {
      if (row.group && row.group !== lastGroup) {
        const heading = doc.createElementNS(HTML_NS, "li");
        heading.className = "fos-commandbar-group";
        heading.setAttribute("role", "presentation");
        heading.textContent = row.group;
        this.#list.appendChild(heading);
        lastGroup = row.group;
      }

      const item = doc.createElementNS(HTML_NS, "li");
      item.className = "fos-commandbar-row";
      item.id = `fos-row-${row.id}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");
      item.setAttribute("data-kind", row.kind);
      item.setAttribute("data-key", row.key);

      const label = doc.createElementNS(HTML_NS, "span");
      label.className = "fos-commandbar-label";
      label.textContent = row.label;

      const detail = doc.createElementNS(HTML_NS, "span");
      detail.className = "fos-commandbar-detail";
      detail.textContent = row.detail ?? "";

      item.append(label);
      if (row.spoken) {
        const spoken = doc.createElementNS(HTML_NS, "span");
        spoken.className = "fos-commandbar-spoken";
        // The spoken form is shown beside every mark, always. A word the user
        // has never been told is a word they cannot say, and there is no
        // separate place to learn it — this bar is the only surface there is.
        spoken.textContent = row.spoken;
        item.append(spoken);
      }
      item.append(detail);

      item.addEventListener("mousedown", event => {
        event.preventDefault();
        this.#accept(index);
      });

      this.#list.appendChild(item);
    });

    this.#applySelection();
  }

  #rowElements() {
    return [...this.#list.querySelectorAll(".fos-commandbar-row")];
  }

  #applySelection() {
    const elements = this.#rowElements();
    elements.forEach((el, i) => {
      el.setAttribute("aria-selected", i === this.#selected ? "true" : "false");
    });
    if (this.#selected >= 0 && elements[this.#selected]) {
      this.#input.setAttribute(
        "aria-activedescendant",
        elements[this.#selected].id
      );
      elements[this.#selected].scrollIntoView({ block: "nearest" });
    } else {
      this.#input.removeAttribute("aria-activedescendant");
    }
  }

  #move(delta) {
    const count = this.#view?.rows.length ?? 0;
    if (!count) {
      return;
    }
    // -1 is "no row selected", and it stays in the cycle rather than being
    // skipped: arrowing back off the top has to return the user to the line
    // they typed, or the line becomes unreachable without the mouse.
    const positions = count + 1;
    const current = this.#selected + 1;
    this.#selected =
      ((((current + delta) % positions) + positions) % positions) - 1;
    this.#applySelection();
  }

  /**
   * Take a row into the input.
   *
   * Accepting never executes. An action row becomes the verb and waits for its
   * target; a mark row fills the pending slot. Both leave the caret where the
   * next token goes, so the keyboard user is walked through the same slots the
   * voice grammar would constrain — one path, two front ends.
   *
   * @param {number} index Which row of the current view to take.
   */
  #accept(index) {
    const row = this.#view?.rows[index];
    if (!row) {
      return;
    }
    if (row.kind === R_ACTION) {
      this.#input.value = `${row.key} `;
    } else if (row.kind === R_MARK) {
      const text = this.#input.value.replace(/\s*\S*$/, "");
      this.#input.value = `${text.trim()} ${row.key} `.trimStart();
    } else {
      this.run();
      return;
    }
    this.#input.focus();
    this.#update();
  }

  #onKeyDown(event) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        this.close();
        break;

      case "Enter": {
        event.preventDefault();
        // A highlighted row is the user pointing at something, so it wins over
        // running the line as typed.
        if (this.#selected >= 0) {
          this.#accept(this.#selected);
        } else {
          this.run();
        }
        break;
      }

      case "Tab": {
        // Completion, not triggering. See FOSCommandBarView's header: this
        // changes what is shown, never what Enter does.
        const completions = completionsFor(this.#input.value);
        if (completions.length) {
          event.preventDefault();
          this.#input.value = `${
            this.#selected >= 0
              ? this.#view.rows[this.#selected].key
              : completions[0]
          } `;
          this.#update();
        }
        break;
      }

      case "ArrowDown":
        event.preventDefault();
        this.#move(1);
        break;

      case "ArrowUp":
        event.preventDefault();
        this.#move(-1);
        break;
    }
  }
}
