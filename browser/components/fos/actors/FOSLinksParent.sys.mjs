/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The parent half of link marks, and it is deliberately almost nothing.
 *
 * A `JSWindowActorParent` has to exist for `getActor("FOSLinks")` to be
 * reachable from the chrome window at all, but there is no reason for any
 * decision to live in it: the decisions belong to a window, not to a browsing
 * context, because the alphabet they draw on is the window's and the surface
 * that reports the outcome is the window's command bar. `FOSLinkSurface` is
 * that window-scoped owner, and it drives this class rather than the other way
 * round.
 *
 * Keeping it empty also keeps the actor's lifetime out of the design. A window
 * global is replaced on every process swap; the surface is not, so the marks
 * and the registry survive exactly as long as they should and no state has to
 * be handed between actors.
 */
export class FOSLinksParent extends JSWindowActorParent {}
