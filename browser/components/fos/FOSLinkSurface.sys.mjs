/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The page as an addressable surface: `follow`, and the alphabet it draws on.
 *
 * Every other FOS surface addresses one of the browser's own objects. This one
 * addresses what is inside the page, which is the gap the keyset manifest made
 * visible — the fork had a complete spoken grammar for everything *around* a
 * page and no way at all to click a link in one. `design/GRAMMAR.md` §2 had
 * listed in-page links among the addressable kinds since marks landed, and
 * `FOSMarks` had "link" in its own doc comment, and nothing had ever registered
 * one.
 *
 * ## The page has its own alphabet
 *
 * There are twenty-six letters. Trail nodes hold most of them within minutes of
 * a session starting, so links competing for the same alphabet would get
 * nothing — or, worse, would evict the node marks the user had learned, which
 * is the one thing §2's stickiness rule exists to prevent. So the page gets its
 * own `MarkRegistry` and `ScopedMarks` resolves between them by what the verb
 * accepts: `enter cap` is a node and `follow cap` is a link, and no user and no
 * parser is ever choosing between the two.
 *
 * That is stickiness applied to a shorter-lived object rather than an exception
 * to it. A link's object goes away when the page view does, and the marks go
 * with it.
 *
 * ## The page is the candidate list
 *
 * For every other verb the bar shows the candidates, because the objects are
 * not on screen as themselves. Links are: the letter is drawn *on* the link it
 * addresses, which carries strictly more than a row reading "cap — Downloads"
 * and is why every tool that has solved this — Vimium, Rango, Cursorless's hats
 * — draws hints rather than listing them.
 *
 * ## Why the marks are put up by a whole command
 *
 * `follow` takes an *optional* target, and the bare form is what makes the
 * links addressable. The tempting alternative is a required target, so that the
 * pending slot itself raises the marks — the keyboard user types `follow ` and
 * the letters appear. That works for the keyboard and cannot work for voice:
 * §8's rule is that voice writes the whole line, so a spoken "follow" would
 * leave a half-finished line in the bar and the next utterance would replace it
 * rather than complete it. Two whole commands is the shape that is identical in
 * both modalities, which is the only test §5 accepts.
 */

import { MarkRegistry } from "./FOSMarks.sys.mjs";
import {
  chooseMarkable,
  labelFor,
  markedMessage,
} from "./FOSLinkMarks.sys.mjs";

/** One surface per chrome window. */
const byWindow = new WeakMap();

/**
 * A `MarkRegistry` id for a link. Namespaced like pillar B's node keys, so that
 * an id from one scope can never be mistaken for an id from another if the two
 * ever meet in a log or a test.
 *
 * @param {number} index The link's index in the collect pass that found it.
 */
export function linkKey(index) {
  return `link:${index}`;
}

/**
 * The link index behind a key, or null.
 *
 * @param {?string} key A key from `linkKey`.
 */
export function linkIndexFromKey(key) {
  const match = /^link:(\d+)$/.exec(key ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * The window-scoped owner of `follow` and of the page's alphabet.
 */
export class FOSLinkSurface {
  /**
   * The surface for a chrome window, created on first ask.
   *
   * @param {Window} window A browser window.
   * @returns {FOSLinkSurface}
   */
  static forWindow(window) {
    let surface = byWindow.get(window);
    if (!surface) {
      surface = new FOSLinkSurface(window);
      byWindow.set(window, surface);
    }
    return surface;
  }

  /** The page's alphabet. Emptied whenever the marks come down. */
  marks = new MarkRegistry();

  #window;
  #bar = null;
  /** The browser the current marks were raised over, or null. */
  #markedBrowser = null;
  /** The tabs progress listener that invalidates marks, while wired. */
  #progress = null;

  constructor(window) {
    this.#window = window;
  }

  /** Whether letters are currently up. Tests and the surface itself read it. */
  get isMarked() {
    return !!this.#markedBrowser;
  }

  /**
   * Register the verb and hand the bar the page's scope.
   *
   * @param {object} bar The window's `FOSCommandBar`.
   * @returns {FOSLinkSurface}
   */
  wire(bar) {
    this.#bar = bar;
    bar.addMarkScope(this.marks);
    bar.actions.register("follow", cmd => this.#run(cmd));

    // The marks describe one rendering of one page, so anything that replaces
    // that rendering has to take them down. The child clears its own drawing on
    // `pagehide` — it must, because its element handles die with the document —
    // but only the parent can forget the letters, and a registry still holding
    // them would let `follow cap` name a link that no longer exists.
    //
    // A tab progress listener rather than a load event: it fires for the
    // selected browser and for any other, and a background load replacing the
    // document under a mark set is exactly as invalidating as a foreground one.
    this.#progress = {
      onLocationChange: (browser, _webProgress, _request, _location, flags) => {
        // Same document, different fragment: the links did not move and the
        // marks are still good. Clearing here would take the letters down every
        // time an in-page anchor was followed, which is the one navigation most
        // likely to be followed by another `follow`.
        const sameDocument =
          flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT;
        if (!sameDocument && browser === this.#markedBrowser) {
          this.clear();
        }
      },
    };
    this.#window.gBrowser.addTabsProgressListener(this.#progress);
    this.#window.addEventListener("unload", () => this.#unwire(), {
      once: true,
    });
    return this;
  }

  #unwire() {
    if (this.#progress) {
      this.#window.gBrowser?.removeTabsProgressListener(this.#progress);
      this.#progress = null;
    }
  }

  /**
   * `follow`, both forms.
   *
   * @param {object} cmd A parsed command.
   */
  #run(cmd) {
    return cmd.target ? this.follow(cmd.target) : this.mark();
  }

  /**
   * Put letters on the links of the current page.
   *
   * Returns a promise, and the dispatcher does not await it — every verb is
   * synchronous from the bar's point of view, and this one cannot be, because
   * the links are in another process. What that costs is that the notice
   * arrives a frame or two after the bar closes, which is where notices arrive
   * anyway.
   *
   * @returns {Promise<object>} `{marked, assigned, total, dropped, painted}`.
   */
  async mark() {
    const browser = this.#window.gBrowser?.selectedBrowser;
    const actor = this.#actorFor(browser);
    if (!actor) {
      this.#bar?.notify("There is no page to mark links on.");
      return { marked: [], total: 0, dropped: 0 };
    }

    // Any previous set goes first. Re-marking is the ordinary way to pick up
    // links that scrolled into view, and letters held by the old set would
    // otherwise make the new one start from a nearly full alphabet — the marks
    // would drift down the alphabet on every re-mark and stop being learnable.
    this.clear();

    let candidates;
    try {
      ({ candidates } = await actor.sendQuery("FOSLinks:Collect", {}));
    } catch (e) {
      // A browsing context that went away mid-query. Nothing is marked, and
      // saying so is better than a silent no-op on a hands-free path.
      console.error(e);
      this.#bar?.notify("That page could not be read.");
      return { marked: [], total: 0, dropped: 0 };
    }

    const outcome = chooseMarkable(
      candidates.map(c => ({
        id: c.id,
        href: c.href,
        label: labelFor(c),
      }))
    );

    const assigned = [];
    for (const candidate of outcome.marked) {
      const letter = this.marks.assign(linkKey(candidate.id), {
        label: candidate.label,
        type: "link",
      });
      if (letter) {
        assigned.push({
          id: candidate.id,
          letter,
          aliases: candidate.aliases,
        });
      }
    }

    let painted = 0;
    if (assigned.length) {
      this.#markedBrowser = browser;
      try {
        ({ painted } = await actor.sendQuery("FOSLinks:Paint", { assigned }));
      } catch (e) {
        console.error(e);
      }
    }

    // Counted from what was actually assigned rather than from what was chosen.
    // The two agree today — the choice is capped at the alphabet and the
    // registry was just emptied — and the sentence is the user's only account of
    // what is reachable, so it should not be the place that assumes they still
    // do.
    const result = {
      ...outcome,
      assigned,
      // How many badges reached the page. It is not `assigned.length`: a
      // destination linked twice carries one letter and two badges. It is
      // returned rather than kept because it is the only evidence from the
      // parent process that anything was drawn at all — nothing in the chrome
      // can see into anonymous content, so a test that did not have this number
      // could assert that the marks exist and never that the user can see them.
      painted,
      dropped: Math.max(0, outcome.total - assigned.length),
    };
    this.#bar?.notify(markedMessage({ ...result, marked: assigned }));
    return result;
  }

  /**
   * Follow the link a letter addresses.
   *
   * The letter is resolved here rather than in the page, so that a mark the
   * parser accepted and a mark the page acts on can never be two different
   * things. The page is told a letter because it drew that letter and knows
   * which elements it drew it on; it is never asked to interpret one.
   *
   * @param {string} letter A mark letter.
   * @returns {Promise<boolean>} Whether a link was activated.
   */
  async follow(letter) {
    const key = this.marks.objectAt(letter);
    const browser = this.#markedBrowser;
    if (key === null || !browser) {
      this.#bar?.notify("No link is marked with that letter.");
      return false;
    }
    const actor = this.#actorFor(browser);
    // The letters come down whatever happens next — but *after* the page has
    // been asked to follow one, not before. Clearing first was the first
    // version of this method and it could not work: `clear` tells the child to
    // drop the very map that resolves the letter to an element, so every
    // `follow` reported that it had activated nothing, on a page where the
    // letter was plainly correct and had just been read off the screen.
    //
    // The child takes its own drawing down as part of following, so this is
    // only the parent forgetting; there is no second message.
    if (!actor) {
      this.#forget();
      return false;
    }
    try {
      const { followed } = await actor.sendQuery("FOSLinks:Follow", { letter });
      return !!followed;
    } catch (e) {
      console.error(e);
      return false;
    } finally {
      this.#forget();
    }
  }

  /**
   * Take the letters down, in the page and in the registry.
   *
   * Safe to call when nothing is marked, which is what lets every route to it —
   * the verb, a navigation, a window closing — be unconditional.
   */
  clear() {
    const browser = this.#markedBrowser;
    this.#forget();
    if (browser) {
      // Not awaited and not reported. The child clears itself on navigation
      // anyway, so this is the case where the page is still there — and a
      // failure to erase a drawing must not be able to stop the letters being
      // forgotten, which is the half that decides what `follow` will accept.
      this.#actorFor(browser)
        ?.sendQuery("FOSLinks:Clear", {})
        .catch(() => {});
    }
  }

  /**
   * Drop the parent's half of the marks, and tell nobody.
   *
   * Split out from `clear` because the two halves have different orderings.
   * Anything that invalidates the page — a navigation, a window closing, a
   * fresh `follow` — wants both halves; following a link wants the page to act
   * *first* and the letters forgotten after, because the page is what resolves
   * the letter.
   */
  #forget() {
    this.#markedBrowser = null;
    this.marks.clear();
  }

  /**
   * The page actor for a browser, or null if there is no live page.
   *
   * Every access goes through here rather than being held, because a window
   * global is replaced on every process swap and a held actor is a handle into
   * a process that may have gone.
   *
   * @param {?object} browser A `<browser>` element.
   */
  #actorFor(browser) {
    try {
      return (
        browser?.browsingContext?.currentWindowGlobal?.getActor("FOSLinks") ??
        null
      );
    } catch (e) {
      return null;
    }
  }
}
