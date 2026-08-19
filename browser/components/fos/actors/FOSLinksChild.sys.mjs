/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The page's half of link marks: find the links, draw the letters, do the click.
 *
 * This is the first FOS code that runs in a content process, and it is the only
 * part of the fork that touches a page at all. It is kept to three messages and
 * no state beyond the current mark set, because everything else — which links
 * deserve a letter, which letter, what to say about it — is a decision the
 * chrome side makes and can test without a page (`FOSLinkMarks`, `FOSMarks`).
 *
 * The letters are drawn in **anonymous content**, not in the page's DOM.
 * `document.insertAnonymousContent()` renders into the canvas frame, which is
 * the same mechanism the find bar's highlighter and the screenshots overlay
 * use, and it is the right one here for three separate reasons:
 *
 *   - The page cannot see it. No mutation observer fires, no `querySelector`
 *     finds it, no framework reconciles it away, and a site cannot detect that
 *     the user is browsing hands-free.
 *   - The page cannot style it. Every extension that injects hints into the DOM
 *     fights the page's CSS forever; a `z-index` or a `filter` on an ancestor is
 *     enough to hide a hint, and a hidden hint is a link that has silently
 *     stopped being addressable.
 *   - It costs the page's layout nothing, so drawing twenty-six of them cannot
 *     reflow the article underneath.
 *
 * Positions are in page coordinates, which is what the canvas frame uses, so
 * the letters scroll with the links they name rather than being re-measured on
 * every scroll event.
 */

const HTML_NS = "http://www.w3.org/1999/xhtml";
const STYLESHEET = "chrome://browser/content/fos/fos-links.css";

/**
 * What counts as a link.
 *
 * Deliberately narrow: things that are links, not things that are clickable.
 * A page's buttons, menus and JavaScript-driven widgets are the larger problem
 * and a much worse one to guess at — `[onclick]` and `[role=button]` sweep in
 * every layout wrapper on a modern site, and a hint on a `div` that does
 * nothing teaches the user that the hints lie. `role="link"` is in because it
 * is a promise the page has made about the element in the same vocabulary
 * assistive technology already reads.
 */
const LINK_SELECTOR = "a[href], area[href], [role='link']";

/**
 * The page's half of link marks. Driven entirely by `FOSLinkSurface`.
 */
export class FOSLinksChild extends JSWindowActorChild {
  /** Mark letter → the elements it addresses. Empty when no marks are up. */
  #marked = new Map();
  /**
   * This pass's links, indexed by the id handed to the parent.
   *
   * Rebuilt by every collect and emptied by every clear, so an id is only ever
   * meaningful between one collect and the clear that follows it.
   */
  #elements = [];
  /** The anonymous content holding the letters, or null. */
  #content = null;
  #root = null;

  handleEvent(event) {
    // Any navigation or teardown invalidates every element handle this actor is
    // holding, and a stale handle is worse than no marks: the letter would still
    // be on screen and would follow a link on a page the user has left. The
    // parent is not told, because it is watching the same navigation for its own
    // reasons and a message racing a process swap is the thing being avoided.
    if (event.type === "pagehide" || event.type === "unload") {
      this.clear();
    }
  }

  async receiveMessage(message) {
    switch (message.name) {
      case "FOSLinks:Collect":
        return this.#collect();
      case "FOSLinks:Paint":
        return this.#paint(message.data.assigned);
      case "FOSLinks:Follow":
        return this.#follow(message.data.letter);
      case "FOSLinks:Clear":
        return this.clear();
    }
    return null;
  }

  didDestroy() {
    this.clear();
  }

  /**
   * Every link a user can currently see, in document order.
   *
   * "Can see" is three separate questions and all three have to be asked.
   * `checkVisibility` answers the CSS ones — `display: none`, `visibility`,
   * `content-visibility`, and an empty inline element with no box. It does not
   * answer whether the box is inside the viewport, which is the one that matters
   * most here: a mark on a link four screens down is a letter spent on something
   * the user has not seen and therefore cannot have chosen. §2 says marks go to
   * what is on screen, and this is the line where that is enforced.
   *
   * The `id` handed back is an index into this pass's own list. It is never
   * persisted and never sent back for a different page: the parent's marks are
   * dropped on navigation, so a stale index has nothing to resolve against.
   */
  #collect() {
    const doc = this.document;
    const win = this.contentWindow;
    if (!doc || !win || !doc.documentElement) {
      return { candidates: [] };
    }

    this.#elements = [];
    const candidates = [];
    const width = win.innerWidth;
    const height = win.innerHeight;

    for (const el of doc.querySelectorAll(LINK_SELECTOR)) {
      if (
        !el.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
          contentVisibilityAuto: true,
        })
      ) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      // Intersects the viewport, rather than being wholly inside it. A link
      // half off the bottom of the screen is one the user is looking at and is
      // about to scroll to; refusing to mark it would make the marks flicker in
      // and out at exactly the moment they are being read.
      if (
        rect.bottom <= 0 ||
        rect.right <= 0 ||
        rect.top >= height ||
        rect.left >= width
      ) {
        continue;
      }

      const id = this.#elements.length;
      this.#elements.push(el);
      candidates.push({
        id,
        href: this.#hrefOf(el),
        text: el.textContent ?? "",
        aria: this.#ariaOf(el),
        host: this.#hostOf(el),
      });
    }

    return { candidates };
  }

  /**
   * The destination, for merging two links that go to the same place.
   *
   * `href` as an IDL attribute is already absolute, which is what makes the
   * comparison meaningful: `./b` and `/a/b` are the same page and the raw
   * attribute would say otherwise. A `role="link"` element usually has no href
   * at all, and gets none here rather than a guess — it merges with nothing and
   * keeps its own letter.
   *
   * @param {Element} el A link element.
   */
  #hrefOf(el) {
    try {
      return el.href ? String(el.href) : "";
    } catch (e) {
      return "";
    }
  }

  /**
   * The name the element would be announced by.
   *
   * Not a full accessible-name computation — that is `nsIAccessible`'s job and
   * instantiating a11y for every link on the page to pick a letter would be a
   * heavy price for a mnemonic. These four cover the cases that actually have no
   * text: an icon link, an image link, and a link whose whole label is on an
   * ancestor.
   *
   * @param {Element} el A link element.
   */
  #ariaOf(el) {
    return (
      el.getAttribute("aria-label") ||
      el.querySelector("img[alt]")?.getAttribute("alt") ||
      el.getAttribute("title") ||
      ""
    );
  }

  #hostOf(el) {
    try {
      return el.host ?? "";
    } catch (e) {
      return "";
    }
  }

  /**
   * Draw the letters.
   *
   * Positions are measured here rather than carried through the parent and
   * back. A round trip is a frame or more, and a page that reflowed in it would
   * have every letter drawn beside where its link used to be — measuring at
   * paint time makes that impossible instead of unlikely.
   *
   * @param {object[]} assigned `{id, letter, aliases}` from the parent.
   */
  #paint(assigned) {
    this.#clearContent();
    const doc = this.document;
    if (!doc || !assigned?.length) {
      return { painted: 0 };
    }

    let content;
    try {
      content = doc.insertAnonymousContent();
    } catch (e) {
      // A document that is not showing yet refuses anonymous content. The marks
      // are still assigned and `follow` still works; only the drawing is lost,
      // which is the right way round for a hands-free path.
      console.error(e);
      return { painted: 0 };
    }
    this.#content = content;
    this.#root = content.root;

    const link = doc.createElementNS(HTML_NS, "link");
    link.setAttribute("rel", "stylesheet");
    link.setAttribute("href", STYLESHEET);
    this.#root.appendChild(link);

    const layer = doc.createElementNS(HTML_NS, "div");
    layer.className = "fos-link-hints";

    this.#marked.clear();
    let painted = 0;
    for (const entry of assigned) {
      const targets = [entry.id, ...(entry.aliases ?? [])]
        .map(id => this.#elements[id])
        .filter(Boolean);
      if (!targets.length) {
        continue;
      }
      this.#marked.set(entry.letter, targets);

      // One badge per element, all of them reading the same letter. Two links
      // to one destination share a mark; they do not share a position, and a
      // badge drawn on only one of them would say the other is unreachable.
      for (const el of targets) {
        const rect = el.getBoundingClientRect();
        const hint = doc.createElementNS(HTML_NS, "span");
        hint.className = "fos-link-hint";
        hint.textContent = entry.letter;
        hint.style.left = `${rect.left + this.contentWindow.scrollX}px`;
        hint.style.top = `${rect.top + this.contentWindow.scrollY}px`;
        layer.appendChild(hint);
        painted++;
      }
    }

    this.#root.appendChild(layer);
    return { painted };
  }

  /**
   * Follow the link a letter addresses.
   *
   * The first of the aliases is the one clicked, which is the earliest in
   * document order and so the one a reader would have reached first. They all
   * go to the same URL by construction, so the choice only decides which
   * element's own handlers run — and the first is the one the page's author put
   * in the reading path.
   *
   * `click()` rather than a synthesized mouse event at the element's centre.
   * The centre of a link is not reliably over the link — an inline link wrapping
   * two lines has a centre in the gap, and a sticky header is routinely over the
   * thing beneath it — so a coordinate-based click silently activates the wrong
   * element, which for a user who cannot see the page is the worst available
   * failure. `click()` addresses the element itself, runs the page's own
   * handlers, and performs the default action for an anchor, which is the
   * navigation. The cost is that the event is not trusted; the sites that check
   * for that are a much smaller set than the sites with a sticky header.
   *
   * The marks come down either way. A `follow` that hit a JavaScript handler
   * doing nothing visible still means the user has finished with this set of
   * letters, and leaving them up over a page that may have changed underneath
   * would leave stale marks pointing at moved links.
   *
   * @param {string} letter A mark letter.
   * @returns {object} `{followed}`.
   */
  #follow(letter) {
    const targets = this.#marked.get(letter);
    const el = targets?.[0];
    this.clear();
    if (!el || !el.isConnected) {
      return { followed: false };
    }
    // Focused first, so that a page which moves focus on activation starts from
    // the link rather than from wherever the last click left it, and so that the
    // browser's own focus ring lands somewhere sensible if the click turns out
    // to do nothing.
    try {
      el.focus({ preventScroll: true });
    } catch (e) {
      // Not every element accepts focus. It can still be clicked.
    }
    el.click();
    return { followed: true };
  }

  /** Take the letters down and forget them. */
  clear() {
    this.#marked.clear();
    this.#elements = [];
    this.#clearContent();
    return { cleared: true };
  }

  #clearContent() {
    if (!this.#content) {
      return;
    }
    try {
      this.document?.removeAnonymousContent(this.#content);
    } catch (e) {
      // The document may already have gone, which is the common case on
      // navigation and is not worth reporting.
    }
    this.#content = null;
    this.#root = null;
  }
}
