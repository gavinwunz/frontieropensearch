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
import { MarkRegistry, ScopedMarks } from "./FOSMarks.sys.mjs";
import { FOSActionDispatcher, resolveInput } from "./FOSActions.sys.mjs";
import {
  R_ACTION,
  R_MARK,
  completionsFor,
  viewFor,
} from "./FOSCommandBarView.sys.mjs";
import { R_PAGE } from "./FOSSuggest.sys.mjs";

import { ensureStylesheet, releaseFocus, takeFocus } from "./FOSChrome.sys.mjs";

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

  /**
   * Every alphabet a mark in this bar could be resolved against.
   *
   * The window's own registry is the first and, for three of the four
   * addressable kinds, the only one. The page adds a second (`FOSLinkSurface`):
   * links turn over on every navigation and there are far too many of them to
   * share twenty-six letters with the cards and nodes a user has spent a session
   * learning, so they get their own alphabet and the verb's accepted types
   * decide which one answers.
   *
   * Reading goes through this and writing goes through `marks`, which is what
   * keeps the split from leaking: a pillar registering an object never has to
   * know that scopes exist, because there is only one place to put an object.
   */
  #lookup = new ScopedMarks([this.marks]);

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

  /**
   * Where ranked page suggestions come from, and what accepting one means.
   *
   * Set by pillar C through `setSuggestions`. The bar deliberately holds a
   * pair of callbacks rather than importing the engine: it must keep working
   * — teaching the verbs, running commands, searching — in a window whose
   * context store failed to open, and a bar that imported the engine to ask it
   * for rows would be a bar that could not.
   */
  #suggest = null;
  #activate = null;
  /** Rows from the last completed read, and the input they answer. */
  #suggestions = [];
  #suggestedFor = null;
  /** Bumped on every input change, so a late read knows it is late. */
  #suggestToken = 0;

  constructor(window) {
    this.#window = window;
    this.actions = new FOSActionDispatcher(window);

    // The one verb the bar itself registers, and it is here rather than in the
    // dispatcher for one reason: the mechanism is the dispatcher's, but the
    // sentence is the bar's, and `notify` is the bar's to call.
    //
    // It is worth a sentence when nothing was pending as much as when
    // something was. A stop with nothing to stop is otherwise silent, and
    // silence is the one answer this surface never gives to a verb the user
    // reached for deliberately. The pending case names what was dropped, which
    // is what makes stopping cheap: the request is on screen to be asked for
    // again, so the user is not punished for stopping a load that turned out
    // to be nearly finished.
    this.actions.register("stop", () => {
      const abandoned = this.actions.abandon();
      this.notify(
        abandoned
          ? `Stopped. ${abandoned} was not loaded.`
          : "Nothing was loading."
      );
      return abandoned;
    });
  }

  /**
   * Add an alphabet for marks to be resolved against.
   *
   * Surfaces whose objects outlive a page register them in `marks` and never
   * call this. It exists for the one case that cannot: a scope whose objects are
   * so numerous and so short-lived that putting them in the window's registry
   * would evict everything the user had learned.
   *
   * @param {object} registry A `MarkRegistry`.
   */
  addMarkScope(registry) {
    this.#lookup.add(registry);
  }

  /**
   * The read-only view across every alphabet, as the parser sees it.
   *
   * Exposed for tests and for anything that needs to resolve a mark exactly the
   * way this bar would. Writing still goes through `marks`; there is no way to
   * register an object through this.
   */
  get markLookup() {
    return this.#lookup;
  }

  get isOpen() {
    return !!this.#root && !this.#root.hidden;
  }

  /** The input element, or null before first open. Tests read this. */
  get input() {
    return this.#input;
  }

  /**
   * Attach a source of ranked page suggestions.
   *
   * @param {object} source
   * @param {Function} source.suggest `(query) => Promise<object[]>`.
   * @param {Function} source.activate `(row) => void`, when one is accepted.
   */
  setSuggestions({ suggest, activate }) {
    this.#suggest = suggest;
    this.#activate = activate;
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open({ initialValue = "" } = {}) {
    this.#build();
    this.#root.hidden = false;
    this.#input.value = initialValue;
    takeFocus(this.#window, this, this.#input);
    this.#input.select();
    this.#update();
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.toPage] Whether the line that closed this bar
   *   navigated. See `releaseFocus`.
   */
  close({ toPage = false } = {}) {
    if (!this.#root) {
      return;
    }
    this.#root.hidden = true;
    this.#input.value = "";
    this.#selected = -1;
    this.#suggestions = [];
    this.#suggestedFor = null;
    this.#suggestToken++;
    releaseFocus(this.#window, this, { toPage });
  }

  /**
   * Parse the current input and run it. Exposed so that a transcript front end
   * can drive exactly this, rather than synthesising keystrokes.
   *
   * @param {string} [text] Defaults to what is in the input.
   * @returns {object} What was run: `{type, ran}` or `{type, resolved}`.
   */
  run(text = this.#input?.value ?? "") {
    const result = parse(text, { marks: this.#lookup });

    if (result.type === QUERY) {
      const resolved = this.actions.openQuery(result.query);
      this.close({ toPage: !!resolved });
      return { type: QUERY, resolved };
    }

    const view = viewFor(result, { marks: this.#lookup, input: text });
    if (!view.canRun) {
      // An incomplete or ill-formed line leaves the bar open with the status
      // already explaining why. Closing it here would throw away what the user
      // typed at the exact moment they need to correct it.
      return { type: result.type, ran: [] };
    }

    // Where the keyboard goes depends on what the line did, not on what was
    // open before it. A line that loaded a page hands over to the page; a line
    // that opened the Field, or renamed a trail, hands back to whatever
    // surface the user was on.
    const loads = this.actions.loads;
    const ran = this.actions.runAll(result.commands);
    this.close({ toPage: this.actions.loads !== loads });
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
    const result = parse(text, { marks: this.#lookup });

    // Only a query needs the URL-or-search decision, and it is the one part of
    // the view that cannot be computed without Gecko, so it is resolved here
    // and handed in rather than reached for from the view model.
    let resolved = null;
    if (result.type === QUERY) {
      resolved = resolveInput(result.query);
    }

    this.#view = viewFor(result, {
      marks: this.#lookup,
      resolved,
      input: text,
    });
    // Typing clears the selection, which is also upstream's rule: a list that
    // renumbers under a held selection is how a user ends up opening a page
    // they never looked at.
    this.#selected = -1;
    this.#askForSuggestions(result, text);
    this.#render();
  }

  /**
   * Start a suggestion read, and decide what to show until it lands.
   *
   * Rows from the previous keystroke stay up while the new read is in flight.
   * That is Firefox's own behaviour — its view holds stale rows rather than
   * emptying between queries — and the reason is the same: a list that blinks
   * out on every keystroke is unreadable, and these rows are usually still
   * right, since the new query is the old one plus a letter.
   *
   * @param {object} result The parse of the current input.
   * @param {string} text The raw input.
   */
  #askForSuggestions(result, text) {
    const token = ++this.#suggestToken;
    const query = result.type === QUERY ? text.trim() : "";

    // Anything that is not a query has no pages to offer, and its own rows are
    // the answer — a pending command is asking for a mark, not for a page. Drop
    // the stale ones at once rather than leaving pages under a prompt that has
    // stopped being about them.
    if (!query || !this.#suggest) {
      this.#suggestions = [];
      this.#suggestedFor = null;
      return;
    }
    if (query === this.#suggestedFor) {
      return;
    }

    Promise.resolve(this.#suggest(query))
      .then(rows => {
        if (token !== this.#suggestToken || !this.isOpen) {
          return;
        }
        this.#suggestions = rows ?? [];
        this.#suggestedFor = query;
        this.#render();
      })
      .catch(error => {
        // A store that cannot answer costs the user their suggestions, never
        // their command bar.
        console.error(error);
      });
  }

  /**
   * Everything the list is showing: the view's own rows, then ranked pages.
   *
   * Action-word completions come first because they are few and because they
   * are the only teaching this bar does; pages follow because there can be
   * eight of them and because a user reaching for a page will read down.
   * `FOSSuggest` decides the order among the pages themselves.
   */
  get #rows() {
    return [...(this.#view?.rows ?? []), ...this.#suggestions];
  }

  #render() {
    const doc = this.#window.document;
    const { status } = this.#view;
    const rows = this.#rows;

    this.#status.textContent = status.text;
    this.#status.setAttribute("data-kind", status.kind);

    // What the user had highlighted, by identity rather than by position. A
    // read that lands while they are arrowing down must not move the row under
    // the selection: the list is allowed to change beneath them, but the thing
    // Enter would open is not. If the row is gone, the selection returns to
    // the line they typed rather than landing on whatever took its place.
    const anchor =
      this.#list.querySelector('[aria-selected="true"]')?.id ?? null;

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

      if (row.kind === R_PAGE) {
        // The letter this page already answers to, shown where the user is
        // about to go to it. The spoken word is not repeated here — the
        // candidate list a verb opens is where the vocabulary is taught, and
        // eight rows each carrying a word would drown the titles.
        //
        // The badge is rendered even when there is no letter, because a page
        // out of Places never has one and a title that starts a character to
        // the left of the marked titles above it reads as a different kind of
        // row rather than as the same row without a mark.
        const badge = doc.createElementNS(HTML_NS, "span");
        badge.className = "fos-commandbar-mark";
        badge.textContent = row.mark ?? "";
        item.append(badge);
      }

      item.append(label);
      if (row.kind !== R_PAGE && row.spoken) {
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

    if (anchor) {
      const index = rows.findIndex(row => `fos-row-${row.id}` === anchor);
      this.#selected = index;
    }

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
    const count = this.#rows.length;
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
   * Accepting an *incomplete* row never executes. An action row becomes the
   * verb and waits for its target; a mark row fills the pending slot. Both
   * leave the caret where the next token goes, so the keyboard user is walked
   * through the same slots the voice grammar would constrain — one path, two
   * front ends.
   *
   * A page row is not incomplete. It is an address the user has picked off a
   * list, so accepting it goes there, exactly as accepting a fully parsed
   * command runs it. The rule is about completeness, not about executing being
   * forbidden.
   *
   * @param {number} index Which row of the current view to take.
   */
  #accept(index) {
    const row = this.#rows[index];
    if (!row) {
      return;
    }
    if (row.kind === R_PAGE) {
      this.#activate?.(row);
      this.close();
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
          // A highlighted row completes to itself, but only if it is an action
          // word: Tab is the completion gesture and a page is not a completion
          // of anything, so a selected page leaves Tab meaning what it always
          // meant.
          const selected = this.#rows[this.#selected];
          this.#input.value = `${
            selected?.kind === R_ACTION ? selected.key : completions[0]
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
