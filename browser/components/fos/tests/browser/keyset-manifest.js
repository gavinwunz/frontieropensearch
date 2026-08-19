/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * The keyset manifest: every command a key in this window can reach, and what
 * `design/GRAMMAR.md` §5 makes of it.
 *
 * §5.1 requires that no action exist which only one input modality can reach.
 * That is true of the action table by construction — a verb is one word, typed
 * or spoken — and it was claimed of the whole window on the strength of the
 * action table, which does not follow. Run 53 counted a running window and
 * found forty-six commands inherited from Firefox whole, every one reachable by
 * a gesture and none by a word, and one of them (`Browser:Back`) corrupting the
 * trail tree on every press because nothing had ever looked at it.
 *
 * This file is the audit's standing form. `browser_zzkeymanifest.js` enumerates
 * the live window and fails if any command is missing from here, or if anything
 * here is no longer bound. That is what makes §5.1's "by construction" a claim
 * about the window rather than about the table.
 *
 * The rule that sorts the entries is `IDEAS.md`'s, stated first for Tab in the
 * command bar and again for rail hoisting: **§5 governs actions, and an
 * affordance that runs no action needs no word.** Every class below is an
 * application of that sentence, except `debt`, which is the class for the cases
 * where it does not apply and no word exists anyway.
 *
 * A reason is required on every entry and is the point of the file. "Devtools"
 * is a class, not a reason; the reason says why *this* command is outside what
 * §5 governs, in a sentence someone can disagree with.
 */

/**
 * The classes, and what claiming one commits you to.
 *
 * Ordered from "§5 is satisfied" to "§5 is not satisfied and we know it".
 */
const KEY_CLASSES = Object.freeze({
  /**
   * The action table gives this command a word. The reason names the verb.
   * The test checks the named verb actually exists in ACTIONS, so this class
   * cannot rot into a claim about a word that was renamed away.
   */
  verb: "reachable by a word in the action table",

  /**
   * Moves focus, opens or closes chrome, changes what is on screen — and runs
   * no action on any object. The hoisting and Tab precedents. The reason must
   * say what it moves and what it leaves untouched.
   */
  affordance: "a view or focus operation that runs no action",

  /**
   * Belongs to whatever is doing the dictating. A spoken "copy" cannot mean
   * the browser's copy and the dictation layer's copy at once, and the layer
   * that owns the text cursor has the better claim.
   */
  editing: "text editing, owned by the input layer rather than the browser",

  /**
   * A surface that is not browsing. §5 is a rule about the browser's actions;
   * devtools is a development environment that happens to ship in the window.
   */
  devtools: "not a browsing surface",

  /**
   * The window manager, the desktop or the OS owns this. Minimising a window
   * by voice is a desktop feature, and duplicating it in a browser grammar
   * makes the browser wrong on every desktop that already has it.
   */
  desktop: "owned by the window manager or the OS",

  /**
   * The key exists to display a shortcut in a menu; the keystroke is handled
   * natively and the element runs nothing. `internal="true"` in the XUL.
   */
  display: "a label for a shortcut handled elsewhere; runs nothing",

  /**
   * The surface this command acts on is one the fork replaced, so the command
   * reaches nothing a user of this build can see. The reason must name the
   * replacement, because the day the replacement grows the same capability is
   * the day this becomes `debt`.
   */
  replaced: "acts on a surface this fork replaced",

  /**
   * The key element carries no keystroke at all, so no modality reaches the
   * command and §5 has nothing to say about it yet. Checked rather than
   * claimed: the test asserts none of the entry's keys has a `key` or
   * `keycode`, so this class cannot be used to park an inconvenient binding.
   */
  unbound: "bound to no keystroke, so no modality reaches it",

  /**
   * A real browsing action, reachable by hand and by nothing else. §5 says
   * this is a bug. The reason must say what the verb would be or why it has
   * not been decided, so that the list reads as work rather than as absolution.
   */
  debt: "a browsing action with no spoken form — a known §5 violation",
});

/**
 * Every command reachable from a `<key>` in the window.
 *
 * Keyed by the key element's `command` attribute. A key with no `command` is
 * keyed as `key#<id>`: it runs whatever a listener elsewhere does with it, and
 * that is still an affordance or an action and still needs classifying.
 */
const KEYSET_MANIFEST = Object.freeze({
  // ---------------------------------------------------------------- verb ---

  "FOS:Field": {
    class: "verb",
    verb: "field",
    reason:
      "F2 and the word `field` run the same toggle between the page and the " +
      "overview. This is the one command in the window where the gesture was " +
      "added after the word rather than the other way round.",
  },
  "Browser:Stop": {
    class: "verb",
    verb: "stop",
    reason:
      "Escape over the page and the word `stop` both abandon the load and put " +
      "the location display back to where you are. Run 52 added the word for " +
      "exactly this command; it is the only inherited one that has been paid.",
  },

  // ----------------------------------------------------------- affordance ---

  "FOS:CommandBar": {
    class: "affordance",
    reason:
      "Focuses the entry surface and runs nothing. The spoken path does not " +
      "pass through it at all — a verb is said outright — so a word for " +
      '"open the bar" would be a word for a step that only the keyboard has. ' +
      "This is the clearest case in the file for why §5 is about actions.",
  },
  "FOS:TrailRail": {
    class: "affordance",
    reason:
      "Shows or hides the rail. Nothing moves, nothing is recorded, and the " +
      "trail is unchanged whether it is on screen or not — the same argument " +
      "that keeps hoisting and Tab-completion out of the grammar.",
  },
  "key#toggleSidebarKb": {
    class: "affordance",
    reason: "Toggles the sidebar launcher. Reveals chrome; acts on no object.",
  },
  "key#viewBookmarksSidebarKb": {
    class: "affordance",
    reason:
      "Opens the bookmarks sidebar. Showing a list of bookmarks is not the " +
      "same act as making one — `Browser:AddBookmarkAs` is the action, and it " +
      "is filed as debt below.",
  },
  "key#viewBookmarksToolbarKb": {
    class: "affordance",
    reason:
      "Toggles whether the bookmarks toolbar is displayed. A visibility " +
      "setting on a piece of chrome.",
  },
  "key#viewOpenTabsSidebarKb": {
    class: "affordance",
    reason:
      "Opens the open-tabs sidebar, which lists the same pages the Field " +
      "shows as cards. A second view of one set, and switching between views " +
      "is not an action on any page in it.",
  },
  "key#viewGenaiChatSidebarKb": {
    class: "affordance",
    reason:
      "Opens the chatbot sidebar, and only when `browser.ml.chat.enabled` is " +
      "set — off in this build, which disables update and telemetry for the " +
      "same reason. Opening a panel; the panel's own actions are its own.",
  },
  "Browser:ShowAllBookmarks": {
    class: "affordance",
    reason:
      "Opens the Library window on the bookmarks root. A place to look, not " +
      "a change to anything.",
  },
  "Browser:ShowAllHistory": {
    class: "affordance",
    reason:
      "Opens the Library window on history. The fork's own answer to the same " +
      "question — what have I seen — is the rail and the context sidebar, both " +
      "of which are affordances too.",
  },
  "View:PageInfo": {
    class: "affordance",
    reason:
      "Opens the Page Info dialog. Reports what the page is; changes nothing " +
      "about it. Its permission controls are actions, and they belong to that " +
      "dialog's own surface rather than to this key.",
  },
  "Tools:Downloads": {
    class: "affordance",
    reason:
      "Opens the downloads panel. Starting a download is a page's doing and " +
      "cancelling one is the panel's; this key only puts the list on screen.",
  },
  "Tools:Addons": {
    class: "affordance",
    reason:
      "Navigates to about:addons, which the command bar already reaches by " +
      "name in either modality. The shortcut is a shortcut, not a capability.",
  },
  "Browser:OpenFile": {
    class: "affordance",
    reason:
      "Opens the OS file picker. The action underneath — go to a local file — " +
      "is reachable in both modalities already, because a `file:///` path is " +
      "prose the command bar resolves like any other. What is missing is the " +
      "picker, and the picker belongs to the OS, which has its own answer for " +
      "operating dialogs without hands.",
  },

  // -------------------------------------------------------------- editing ---
  //
  // All six `internal="true"` keys plus the two that are not. `internal` means
  // the element exists to print a shortcut in a menu and the keystroke is
  // handled by the editor natively — so these run nothing here even as
  // gestures. They are classed by what they do rather than by that, because
  // the §5 question is about the act and not about the element.

  "key#key_undo": {
    class: "editing",
    reason:
      'Undo in whatever field has the caret. A spoken "undo" has to mean the ' +
      "dictation layer's undo, which knows what it just inserted; a browser " +
      "verb of the same name would race it and win the wrong half the time.",
  },
  "key#key_redo": {
    class: "editing",
    reason:
      "Redo, and the same argument as undo — the layer holding the caret " +
      "owns the word.",
  },
  "key#key_cut": {
    class: "editing",
    reason:
      "Cut from the focused field. The clipboard verbs are the canonical " +
      "example of words every dictation system already binds.",
  },
  "key#key_copy": {
    class: "editing",
    reason: "Copy from the focused field; see cut.",
  },
  "key#key_paste": {
    class: "editing",
    reason: "Paste into the focused field; see cut.",
  },
  "key#key_selectAll": {
    class: "editing",
    reason:
      "Select all within the focused field. A selection is an argument to the " +
      "next editing verb, and belongs with them.",
  },
  cmd_delete: {
    class: "editing",
    reason:
      "Forward delete in the focused field. Bound to bare Delete, which is why " +
      "it must not become a browser verb: it is pressed constantly while " +
      "typing and would mean something different depending on focus.",
  },
  cmd_switchTextDirection: {
    class: "editing",
    reason:
      "Flips the paragraph direction of an editable field. Bidi text entry, " +
      "and the layer doing the entering owns it.",
  },

  // ------------------------------------------------------------- devtools ---
  //
  // Fourteen of these are installed at window load by DevToolsStartup rather
  // than declared in the markup, which is the concrete reason this file is
  // checked against a running window and not against browser-sets.inc.xhtml.

  "key#key_toggleToolbox": {
    class: "devtools",
    reason:
      "Opens the developer toolbox. Developing a page is not browsing one, and " +
      "a grammar that covered it would be a second product's grammar.",
  },
  "key#key_toggleToolboxF12": {
    class: "devtools",
    reason: "The F12 binding for the toolbox; same surface, second gesture.",
  },
  "key#key_webconsole": {
    class: "devtools",
    reason: "Opens the toolbox on the web console.",
  },
  "key#key_browserConsole": {
    class: "devtools",
    reason:
      "Opens the browser console — chrome-level logging, which is this fork's " +
      "own debugging surface and not a user-facing one.",
  },
  "key#key_browserToolbox": {
    class: "devtools",
    reason: "Opens the browser toolbox, debugging the chrome itself.",
  },
  "key#key_inspector": {
    class: "devtools",
    reason: "Opens the toolbox on the inspector.",
  },
  "key#key_jsdebugger": {
    class: "devtools",
    reason: "Opens the toolbox on the debugger.",
  },
  "key#key_netmonitor": {
    class: "devtools",
    reason: "Opens the toolbox on the network monitor.",
  },
  "key#key_storage": {
    class: "devtools",
    reason: "Opens the toolbox on the storage inspector.",
  },
  "key#key_styleeditor": {
    class: "devtools",
    reason: "Opens the toolbox on the style editor.",
  },
  "key#key_performance": {
    class: "devtools",
    reason: "Opens the toolbox on the profiler.",
  },
  "key#key_responsiveDesignMode": {
    class: "devtools",
    reason: "Toggles responsive design mode.",
  },
  "key#key_dom": {
    class: "devtools",
    reason: "Opens the toolbox on the DOM property viewer.",
  },
  "key#key_accessibility": {
    class: "devtools",
    reason:
      "Opens the accessibility inspector — a tool for auditing a page's " +
      "accessibility tree, which despite the name is a development surface " +
      "and not an assistive one.",
  },
  "View:PageSource": {
    class: "devtools",
    reason:
      "Opens view-source. Reading the markup is development; the command bar " +
      "reaches `view-source:` URLs by name in either modality anyway.",
  },
  "View:AboutProcesses": {
    class: "devtools",
    reason:
      "Opens about:processes, the task manager. A diagnostic on the browser " +
      "rather than an act of browsing, and reachable by name from the bar.",
  },
  cmd_quickRestart: {
    class: "devtools",
    reason:
      "Restarts the browser, keeping the session. Added by " +
      "browser-development-helpers.js on non-release builds only; a build tool.",
  },
  windowRecordingCmd: {
    class: "devtools",
    reason:
      "Toggles WebRender window recording. Nightly-only graphics debugging.",
  },

  // -------------------------------------------------------------- desktop ---

  cmd_newNavigator: {
    class: "desktop",
    reason:
      "Opens a new browser window. Which windows exist is the window " +
      "manager's business, and every desktop that offers hands-free control " +
      "already has a word for it. A browser verb here would compete with the " +
      "layer that can also move, tile and focus the window it just made.",
  },
  cmd_close: {
    class: "desktop",
    reason:
      "Closes the current tab, or the window when it is the last one. Named " +
      "as desktop rather than debt because what it acts on — a page's " +
      "existence in a window — is the same object the window manager closes, " +
      "and the Field's `dismiss` is deliberately not this: dismissing drops a " +
      "card and keeps the page on its trail.",
  },
  cmd_closeWindow: {
    class: "desktop",
    reason: "Closes the window; the window manager's own word covers it.",
  },
  cmd_quitApplication: {
    class: "desktop",
    reason:
      "Quits. The desktop quits applications, and a browser that had its own " +
      "spoken quit would be one utterance away from losing the session on a " +
      "misrecognition.",
  },
  "View:FullScreen": {
    class: "desktop",
    reason:
      "Toggles fullscreen — a property of the window on the display. The " +
      "second binding is present and disabled, which is how Firefox arranges " +
      "for the menubar to print the same shortcut for entering and leaving.",
  },

  // -------------------------------------------------------------- display ---

  "key#key_showAllTabs": {
    class: "display",
    reason:
      "Nothing in the tree listens for this key. It exists so the View menu " +
      'can print Ctrl+Shift+Tab beside "Show All Tabs"; the keystroke itself ' +
      "is handled by tab cycling further down. Found by the enumeration, which " +
      "is the only thing that would find it — it looks like a binding.",
  },

  // ------------------------------------------------------------- replaced ---
  //
  // Nine keys that address a page by its position in a strip this build does
  // not draw. `browser.fos.field.replacesTabStrip=false` brings the strip back
  // and with it the thing these point at, which is why they are still bound.

  "key#key_selectTab1": {
    class: "replaced",
    reason:
      "Selects the first tab by position. The Field replaced the strip, so " +
      "there is no first position on screen to count to — and `enter <mark>` " +
      "is the fork's addressing scheme for the same intent, reachable by both " +
      "modalities and stable when the set changes, which an index is not.",
  },
  "key#key_selectTab2": {
    class: "replaced",
    reason: "Selects the second tab by position; see key_selectTab1.",
  },
  "key#key_selectTab3": {
    class: "replaced",
    reason: "Selects the third tab by position; see key_selectTab1.",
  },
  "key#key_selectTab4": {
    class: "replaced",
    reason: "Selects the fourth tab by position; see key_selectTab1.",
  },
  "key#key_selectTab5": {
    class: "replaced",
    reason: "Selects the fifth tab by position; see key_selectTab1.",
  },
  "key#key_selectTab6": {
    class: "replaced",
    reason: "Selects the sixth tab by position; see key_selectTab1.",
  },
  "key#key_selectTab7": {
    class: "replaced",
    reason: "Selects the seventh tab by position; see key_selectTab1.",
  },
  "key#key_selectTab8": {
    class: "replaced",
    reason: "Selects the eighth tab by position; see key_selectTab1.",
  },
  "key#key_selectLastTab": {
    class: "replaced",
    reason: "Selects the last tab by position; see key_selectTab1.",
  },

  // -------------------------------------------------------------- unbound ---

  "Browser:DuplicateTab": {
    class: "unbound",
    reason:
      "The key element carries no keystroke, so no modality reaches it and §5 " +
      "has nothing to say. It is here for the customisable-shortcuts UI to " +
      "assign. It becomes debt the day somebody assigns one.",
  },
  "Browser:AddTabSplitView": {
    class: "unbound",
    reason:
      "No keystroke; see Browser:DuplicateTab. Split view also has no place " +
      "in a build with no strip to split.",
  },
  "Browser:SeparateTabSplitView": {
    class: "unbound",
    reason: "No keystroke; see Browser:AddTabSplitView.",
  },

  // ----------------------------------------------------------------- debt ---
  //
  // Real browsing actions this build ships, reachable by hand and by nothing
  // else. §5 says each of these is a bug. They are written down rather than
  // reclassified, because a class that absorbed them would make this whole
  // file a way of agreeing with yourself.

  "Browser:Back": {
    class: "debt",
    reason:
      "The verb `back` is not this. `back` moves to the node visited before " +
      "this one in time; the gesture steps the session history chain. They " +
      "agree on a linear walk and diverge the moment there is a branch, which " +
      "is the case pillar B exists for. Two movements under one name is worse " +
      "than one movement with no name, so this wants deciding rather than " +
      "declaring covered.",
  },
  "Browser:Forward": {
    class: "debt",
    reason:
      "No verb at all, and not merely the mirror of back: in a tree the " +
      "forward direction is plural, and the rail already shows the siblings " +
      "a linear forward would have to pick between. Deciding this and " +
      "Browser:Back is one question, not two.",
  },
  cmd_handleBackspace: {
    class: "debt",
    reason:
      "Backspace, which does nothing under this build's default " +
      "`browser.backspace_action`, goes back when it is set to 0 and scrolls " +
      "a page up when set to 1. Inherits Browser:Back's problem behind a pref, " +
      "which makes it worse rather than smaller.",
  },
  cmd_handleShiftBackspace: {
    class: "debt",
    reason: "Shift+Backspace: forward, or page down, on the same pref.",
  },
  "Browser:Reload": {
    class: "debt",
    reason:
      "Ask for this page again. Run 52 called it the last nav-bar verb with " +
      "no spoken form, which was a sampling error — it is one of these — but " +
      "the gap it named is real and it is the cheapest one here to close.",
  },
  "Browser:ReloadSkipCache": {
    class: "debt",
    reason:
      "Reload ignoring the cache. Wants settling with Browser:Reload, and " +
      "probably as a modifier on one word rather than a fifteenth verb.",
  },
  cmd_find: {
    class: "debt",
    reason:
      "Find in page. The most-used browsing action with no word, and the one " +
      "with the clearest shape — it takes terminal free text exactly like " +
      "`search` and `name` do, so the grammar already has the form for it.",
  },
  cmd_findAgain: {
    class: "debt",
    reason:
      "Next match. A repeat-last-command shape the grammar has no instance " +
      "of yet; worth settling once for every verb rather than once for find.",
  },
  cmd_findPrevious: {
    class: "debt",
    reason: "Previous match; see cmd_findAgain.",
  },
  cmd_fullZoomEnlarge: {
    class: "debt",
    reason:
      "Zoom the page in. Note what this is not: the Field's zoom, which is a " +
      "view operation over cards and needs no word. This one changes a " +
      "per-site setting that persists, so it is an action on the site.",
  },
  cmd_fullZoomReduce: {
    class: "debt",
    reason: "Zoom the page out; see cmd_fullZoomEnlarge.",
  },
  cmd_fullZoomReset: {
    class: "debt",
    reason: "Clear the per-site zoom; see cmd_fullZoomEnlarge.",
  },
  "Tools:Sanitize": {
    class: "debt",
    reason:
      "Clear Recent History, which this fork taught to delete from the " +
      "context store as well — the store's first delete of any kind, built " +
      "because a record the user cannot remove is not private for staying on " +
      "the machine. It was given a dialog and no word. The sharpest entry in " +
      "this file: the fork built the capability itself and still reached it " +
      "only by hand.",
  },
  "Tools:PrivateBrowsing": {
    class: "debt",
    reason:
      "Open a private window. This build keeps private browsing out of the " +
      "context database entirely, which makes it a first-class state of the " +
      "fork rather than an inherited mode, and states you have opinions about " +
      "should be sayable.",
  },
  "Browser:AddBookmarkAs": {
    class: "debt",
    reason:
      "Bookmark this page. Not `replaced`: trails and `name` are the fork's " +
      "answer to the bookmark graveyard, but bookmarks are still shipped, " +
      "still written and still shown in a toolbar and a sidebar this build " +
      "draws, and a surface a user can see is a surface §5 covers.",
  },
  "key#bookmarkAllTabsKb": {
    class: "debt",
    reason:
      "Bookmark every open page as a folder. The same action as " +
      "Browser:AddBookmarkAs over a set, and the set it means is now the " +
      "Field's.",
  },
  "Browser:SavePage": {
    class: "debt",
    reason:
      "Save this page to disk. Produces an artefact, which is what separates " +
      "it from the affordances above.",
  },
  "Browser:Screenshot": {
    class: "debt",
    reason:
      "Capture the page. Produces an artefact; also the one action here whose " +
      "second half — choosing a region by dragging — has no hands-free form " +
      "either, so a word alone would not finish it.",
  },
  cmd_print: {
    class: "debt",
    reason:
      "Print. Opens preview, so the word would reach a dialog whose own " +
      "controls are outside the grammar — the same shape as Browser:OpenFile, " +
      "but filed as debt because printing is not a thing the OS does for you.",
  },
  cmd_toggleMute: {
    class: "debt",
    reason:
      "Mute this page. A per-page state that persists and that the user can " +
      "see; a strong candidate for a word, and cheap, since it needs no " +
      "argument and no dialog.",
  },
  "View:PictureInPicture": {
    class: "debt",
    reason:
      "Pop the video out into its own always-on-top window. An action on the " +
      "page's media, and the window it makes is then the desktop's.",
  },
  "View:ReaderView": {
    class: "debt",
    reason:
      "Switch to reader view. Bound and disabled in this window because the " +
      "page is not readerable — disabled is a per-page state, not a missing " +
      "binding, so it is debt like any other.",
  },
  cmd_newNavigatorTabNoEvent: {
    class: "debt",
    reason:
      "Open a new blank page. `branch` is adjacent and is not it: branch " +
      "forks a sibling at the page you are on, and this starts from nothing. " +
      "The Field has no word for putting an empty card on it, which is the " +
      "actual gap.",
  },
  "key#goHome": {
    class: "debt",
    reason:
      "Go to the home page. The command bar reaches any URL by word, so what " +
      'has no spoken form is the indirection — "home" as a name for a page ' +
      "the user chose earlier.",
  },
  "History:RestoreLastClosedTabOrWindowOrSession": {
    class: "debt",
    reason:
      "Reopen what was just closed. The fork has strong opinions about " +
      "returning to things — `done`, re-entry, the Field surviving a restart " +
      "— and none of them is this, which is an undo over closing.",
  },
  "History:UndoCloseWindow": {
    class: "debt",
    reason: "Reopen the last closed window; see the entry above.",
  },
});

// Support files are loaded with loadSubScript, which shares the test's global,
// so these are already visible to the test. The export is for lint's benefit.
/* exported KEY_CLASSES, KEYSET_MANIFEST */
