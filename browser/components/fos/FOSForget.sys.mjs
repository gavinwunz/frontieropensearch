/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Forgetting, joined to the clearing paths Firefox already ships.
 *
 * The Context Engine records more about a session than the history database it
 * replaces: not just which pages were open but what was typed to reach them,
 * which page each search was typed from, how long each page was read, and what
 * the whole thing was about. Until this file existed there was no way to
 * remove any of it — no delete anywhere in the store, and no hook into
 * Clear Recent History or Forget About This Site, which cleared Places and
 * left the richer record beside it untouched.
 *
 * That was the more serious half. "Everything is local" is the fork's stated
 * privacy claim and it was true; a shipped menu item that says it is clearing
 * your history while a second database keeps it is a claim that is false, and
 * false in the direction that matters. Windows Recall is the cautionary case
 * and the argument was had in public: snapshots never left the device, and
 * local-only turned out not to be the whole answer, because the record was
 * still there for anyone who reached the machine and there was no fine-grained
 * way to remove any of it. What Microsoft eventually shipped in answer — clear
 * a range, clear a site, and stop recording — is the same three verbs Firefox
 * already has, so the work here is not to invent a surface but to be reachable
 * from the one that exists.
 *
 * This module is therefore deliberately thin. It is the adapter between
 * `nsIClearDataService`'s cleaner shape and `FOSContextStore`'s forget methods,
 * and every decision about *what* forgetting means to the graph lives in the
 * store beside the SQL that carries it out.
 */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  FOSContextEngine: "resource:///modules/FOSContextEngine.sys.mjs",
  FOSContextStore: "resource:///modules/FOSContextStore.sys.mjs",
});

/**
 * Notified after anything is forgotten, with the summary as its data.
 *
 * The live surfaces do not yet act on it. A card on the Field and a node in
 * the rail are in-memory objects built during the session, and taking a page
 * out from under them mid-session is a separate piece of work with its own
 * question to answer — what happens to the tab you are looking at when you
 * forget the site it is on. The notification exists so that work has something
 * to attach to, and so a test can observe that clearing happened at all.
 */
export const FORGOTTEN_TOPIC = "fos-context-forgotten";

/**
 * The profile's store, but only if forgetting has anything to act on.
 *
 * Opening the store would create and migrate a database, so a profile that has
 * never run the Context Engine would get an empty one built for it by the act
 * of clearing history — which is absurd on its face and would also mean the
 * first clear on any profile is the slowest. If the file is not there, there is
 * nothing recorded and nothing to forget.
 *
 * When the store is already open this must return *that* store rather than a
 * second connection to the same file: two connections would take their own
 * locks and the delete would contend with the recorder writing behind it.
 *
 * @returns {Promise<?object>} The open store, or null.
 */
async function storeIfPresent() {
  if (!lazy.FOSContextEngine.storeIsOpen) {
    const path = PathUtils.join(
      PathUtils.profileDir,
      lazy.FOSContextStore.DATABASE_FILENAME
    );
    if (!(await IOUtils.exists(path))) {
      return null;
    }
  }
  return lazy.FOSContextEngine.store();
}

/**
 * Run a forget and announce it.
 *
 * Failures are swallowed to a warning rather than rethrown. A cleaner that
 * rejects reports its flag as failed and Sanitizer surfaces that to the user,
 * which is right for a component whose data is the point of the clear — but it
 * would mean a fault in this fork's own store could make Clear Recent History
 * look broken for cookies and cache too. The store is the thing at risk here,
 * and it is better for it to fail loudly in the console than to take the
 * shipped clearing UI down with it.
 *
 * @param {Function} work Takes the store, returns a summary.
 * @returns {Promise<void>}
 */
async function forget(work) {
  let store;
  try {
    store = await storeIfPresent();
  } catch (e) {
    console.error("FOSForget: cannot open the store to clear it", e);
    return;
  }
  if (!store) {
    return;
  }
  try {
    const summary = await work(store);
    Services.obs.notifyObservers(
      null,
      FORGOTTEN_TOPIC,
      JSON.stringify(summary)
    );
  } catch (e) {
    console.error("FOSForget: clearing the Context Engine failed", e);
  }
}

/**
 * The Context Engine as an `nsIClearDataService` cleaner.
 *
 * Named for the module rather than for what it is because
 * `ChromeUtils.defineESModuleGetters` resolves each key to the *export of that
 * name*, so the importing side's key and this identifier have to agree.
 *
 * Registered under `CLEAR_HISTORY`, which is the flag behind "Browsing &
 * download history" in Clear Recent History and behind Forget About This Site.
 * That is the right flag rather than one of this fork's own: everything stored
 * here is a record of browsing, and a user who asks for their browsing history
 * to be cleared has asked for this too. Putting it behind a separate checkbox
 * would mean the obvious action quietly did less than it said.
 */
export const FOSForget = {
  deleteByHost(aHost) {
    return forget(store => store.forgetHost(aHost));
  },

  deleteByPrincipal(aPrincipal) {
    // A null or system principal has no host and nothing was ever recorded
    // against one.
    if (!aPrincipal?.host) {
      return Promise.resolve();
    }
    return forget(store => store.forgetHost(aPrincipal.host));
  },

  deleteBySite(aSchemelessSite) {
    return this.deleteByHost(aSchemelessSite);
  },

  deleteByRange(aFrom, aTo) {
    // The service deals in microseconds and the store in milliseconds.
    return forget(store =>
      store.forgetRange(Math.floor(aFrom / 1000), Math.ceil(aTo / 1000))
    );
  },

  deleteAll() {
    return forget(store => store.forgetAll());
  },
};
