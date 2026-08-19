/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Saying what a clear will take out of the Context Engine, before it takes it.
 *
 * Firefox does not do this and is right not to. Its history is a flat list, so
 * the blast radius of clearing an hour of it is exactly the pages visited in
 * that hour, and a user asked to confirm already knows what they are agreeing
 * to. The dialog spends its one line of consequence on the thing that *is*
 * unguessable there — how many megabytes of cookies and cache go with it.
 *
 * This store is a graph, and that changes the arithmetic rather than merely
 * the size of it. Clearing an hour takes pages out of the middle of trails
 * that started long before it, strands the questions asked from those pages,
 * and can delete a whole context — a research topic the engine named after the
 * material in it, so the label is a description of an afternoon's work and it
 * goes when the last of that work does. None of that is inferable from "last
 * hour", and all of it has already been computed by the time the store has
 * decided what to delete. See `FOSContextStore.previewForget`, which gets the
 * numbers by *running the delete and rolling it back*, so this can never
 * describe something other than what the button does.
 *
 * The rung this puts the dialog on is explicit consequence, and deliberately
 * no higher. The confirmation literature is consistent that friction is spent
 * by frequency and that the escalation to a typed confirmation is for actions
 * that break something running; forgetting is a thing users should find easy.
 * `IDEAS.md` (run 45) has the argument, including why an undo window is the
 * wrong answer here and stays rejected.
 */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  // Not the cleaner but the "is there anything at all" question in front of
  // it, which a preview must ask in exactly the same way.
  contextStoreIfPresent: "resource:///modules/FOSForget.sys.mjs",
});

/** How many names the sentence sets out before falling back on the counts. */
const MAX_NAMES = 3;

/**
 * The most recent call for each element, so a stale answer cannot land.
 *
 * The timespan menulist can be changed twice before the first preview's
 * transaction has finished, and the two run concurrently on the same
 * connection. Keyed on the element rather than tracked on `this` because two
 * dialogs can be open at once — the one in `about:preferences` and the one
 * from the browser window — and a module is shared by both.
 *
 * @type {WeakMap<Element, number>}
 */
const generations = new WeakMap();

/**
 * Ask the store what a forget would take.
 *
 * Every failure answers null, and null means the element is left empty rather
 * than filled with zeroes. A preview that could not run has nothing to say,
 * and "0 pages" is a claim — the wrong one, and made in the one place the user
 * is relying on being told the truth.
 *
 * There is no `settledEverywhere()` here, unlike the delete this describes. A
 * preview that waited on every window's write queue would make the dialog's
 * first paint wait on browsing that is still happening, and a count that is
 * one visit stale is a preview of a delete the user has not asked for yet.
 *
 * @param {object} target `{ host }`, `{ from, to }` in ms, or `{ all: true }`.
 * @returns {Promise<?object>} A `ForgetPreview`, or null.
 */
async function fetchPreview(target) {
  let store;
  try {
    store = await lazy.contextStoreIfPresent();
  } catch (e) {
    console.error("FOSForgetPreview: cannot open the store to read it", e);
    return null;
  }
  if (!store) {
    return null;
  }
  try {
    return await store.previewForget(target);
  } catch (e) {
    console.error("FOSForgetPreview: cannot preview the clear", e);
    return null;
  }
}

/**
 * @param {number} n
 * @param {string} singular
 * @returns {string} `1 page` / `128 pages`, with the number grouped.
 */
function counted(n, singular) {
  return `${n.toLocaleString()} ${n === 1 ? singular : singular + "s"}`;
}

/**
 * @param {string[]} parts
 * @returns {string} A locale-appropriate "a, b and c".
 */
function joined(parts) {
  return new Intl.ListFormat(undefined, {
    style: "long",
    type: "conjunction",
  }).format(parts);
}

/**
 * @param {object} preview A `ForgetPreview`.
 * @returns {string[]} Up to `MAX_NAMES` quoted names, contexts first.
 */
function namesClause(preview) {
  const room = { left: MAX_NAMES };
  const take = (names, singular) => {
    const chosen = names.slice(0, Math.max(0, room.left));
    room.left -= chosen.length;
    if (!chosen.length) {
      return null;
    }
    const noun = chosen.length === 1 ? `the ${singular}` : `the ${singular}s`;
    return `${noun} ${joined(chosen.map(name => `“${name}”`))}`;
  };
  // Contexts first: a context label names what the work was about, where a
  // trail name is one the user typed and can therefore be pictured from a
  // count. The names are already ordered most-recently-active first.
  return [
    take(preview.contextLabels ?? [], "context"),
    take(preview.trailNames ?? [], "trail"),
  ].filter(Boolean);
}

/**
 * The sentence, or "" when there is nothing to warn about.
 *
 * Named and exported for its own tests: it is the whole user-visible payload
 * of this feature and it is pure, so it should not need a browser to check.
 *
 * @param {?object} preview A `ForgetPreview`.
 * @returns {string}
 */
export function describeForgetPreview(preview) {
  if (!preview) {
    return "";
  }
  const items = [];
  if (preview.nodes) {
    items.push(counted(preview.nodes, "page"));
  }
  if (preview.queries) {
    items.push(counted(preview.queries, "question"));
  }
  if (preview.trails) {
    items.push(counted(preview.trails, "trail"));
  }
  if (preview.contexts) {
    items.push(counted(preview.contexts, "context"));
  }
  if (!items.length) {
    // Nothing recorded in the range at all. Silence is the right answer: a
    // line saying nothing will happen is a line the user has to read on every
    // clear in order to learn nothing.
    return "";
  }

  const lead = preview.all
    ? "This empties your Context Engine"
    : "This also takes";
  const tail = preview.all ? "" : " out of your Context Engine";
  const names = namesClause(preview);
  // The counts have already said how many, so the names need no "and 2 more":
  // they are examples of a number the reader has just been given.
  const including = names.length ? `, including ${joined(names)}` : "";
  return `${lead} ${joined(items)}${tail}${including}.`;
}

export const FOSForgetPreview = {
  /**
   * Fill an element with what a forget would take, or empty it.
   *
   * Empty and hidden first, then filled if there turns out to be something to
   * say — so a dialog whose selection has changed never shows the previous
   * selection's numbers while the new ones are being counted. That is the one
   * state this must not have: a stale consequence is worse than no
   * consequence, because it is believed.
   *
   * No spinner, unlike the site-data sizes beside it. Those wait on the disk
   * cache and the quota manager and routinely take seconds; this is four
   * counts off a small local database and arrives within a frame or two, and a
   * spinner that flashes is noise.
   *
   * @param {?Element} element The line to fill. Absent in dialog modes that
   *   have none, so a missing element is not an error.
   * @param {?object} target `{ host }`, `{ from, to }` in ms, `{ all: true }`,
   *   or null to say only that nothing will be taken.
   * @returns {Promise<void>}
   */
  async show(element, target) {
    if (!element) {
      return;
    }
    const generation = (generations.get(element) ?? 0) + 1;
    generations.set(element, generation);
    element.textContent = "";
    element.hidden = true;
    if (!target) {
      return;
    }
    const text = describeForgetPreview(await fetchPreview(target));
    if (generations.get(element) !== generation) {
      return;
    }
    element.textContent = text;
    element.hidden = !text;
  },

  /**
   * The same, for a host, converted the way `ForgetAboutSite` converts it.
   *
   * `ForgetAboutSite.removeDataFromBaseDomain` reduces what it is given to a
   * schemeless site before handing it to `nsIClearDataService`, and that
   * reduced form is what reaches `FOSForget.deleteBySite`. The preview has to
   * make the same reduction or it would describe a narrower delete than the
   * button performs — `docs.example.org` rather than `example.org` and every
   * subdomain of it.
   *
   * @param {?Element} element
   * @param {string} hostOrDomain
   * @returns {Promise<void>}
   */
  showForSite(element, hostOrDomain) {
    let host;
    try {
      host = Services.eTLD.getSchemelessSiteFromHost(hostOrDomain);
    } catch (e) {
      // An IP literal or a host with no known suffix. `getSchemelessSiteFromHost`
      // throws where `deleteDataFromSite` would still be given something, so
      // fall back to what was asked for rather than saying nothing.
      host = hostOrDomain;
    }
    return this.show(element, { host });
  },
};
