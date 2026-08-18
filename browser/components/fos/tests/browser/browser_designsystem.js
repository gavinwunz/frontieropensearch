/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/* The design system's contract, checked against a running window.
 *
 * `design/SYSTEM.md` is the prose and `fos-tokens.css` is the declaration;
 * this is what makes either of them true. It exists because of a specific
 * failure that nothing else in the project could see: `--font-size-small` is
 * defined for in-content pages but set to `unset` for chrome, so twenty-two
 * declarations across four surfaces asked for small text and silently got
 * body text. Every stylesheet was valid, every lint was clean, every test was
 * green, and the whole fork rendered at one size.
 *
 * A token that resolves to nothing is therefore the thing to test for, and it
 * can only be tested where the tokens actually resolve. */

const { ensureStylesheet } = ChromeUtils.importESModule(
  "resource:///modules/FOSChrome.sys.mjs"
);
const { FOSTrailRail } = ChromeUtils.importESModule(
  "resource:///modules/FOSTrailRail.sys.mjs"
);
const { FOSContextSidebar } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextSidebar.sys.mjs"
);

const SHEETS = [
  "fos-tokens.css",
  "fos-commandbar.css",
  "fos-contextsidebar.css",
  "fos-field.css",
  "fos-locationdisplay.css",
  "fos-trailrail.css",
];

const BASE = "chrome://browser/content/fos/";

/**
 * A stylesheet's rules, with comments removed.
 *
 * These files carry a lot of prose, and some of it quotes the very
 * declarations this file forbids — the explanation of why the platform's
 * small-text token is inert necessarily names it. Scanning the comments too
 * would make the documentation fail the test that documents it.
 *
 * @param {string} name A sheet's file name.
 * @returns {Promise<string>} The sheet with `/* ... *\/` stripped.
 */
async function sheetText(name) {
  const response = await fetch(BASE + name);
  ok(response.ok, `${name} is packaged and readable`);
  const text = await response.text();
  return text.replace(/\/\*[^]*?\*\//g, "");
}

/**
 * Resolve a custom property the way the cascade would, in this window.
 *
 * A property that was never defined and one defined as `unset` both come back
 * as the empty string, which is the distinction that matters here.
 *
 * @param {Window} win A chrome window.
 * @param {string} name The custom property, including the leading dashes.
 * @returns {string} The declared value, or "" if it resolves to nothing.
 */
function declaredValue(win, name) {
  return win
    .getComputedStyle(win.document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/**
 * The px size `font-size: var(name)` actually produces, against a parent of a
 * known size — which is what catches a token that quietly inherits instead of
 * setting anything.
 *
 * @param {Window} win A chrome window.
 * @param {string} name The font-size token.
 * @returns {{used: number, parent: number}} Both sizes, in px.
 */
function usedFontSize(win, name) {
  const doc = win.document;
  const parent = doc.createElement("div");
  // A fixed parent size, so "inherited" is distinguishable from "set".
  parent.style.fontSize = "20px";
  const child = doc.createElement("div");
  child.style.fontSize = `var(${name})`;
  parent.appendChild(child);
  doc.documentElement.appendChild(parent);
  const used = parseFloat(win.getComputedStyle(child).fontSize);
  const parentSize = parseFloat(win.getComputedStyle(parent).fontSize);
  parent.remove();
  return { used, parent: parentSize };
}

add_task(async function every_fos_token_resolves() {
  // This test needs a chrome window with the token sheet on it and nothing
  // else. It deliberately does not open one: the suite shares a single profile
  // database, `browser_zdemoflow.js` is named to run last over whatever it
  // finds there, and a new window wires up a trail session that writes to it.
  // Opening two windows here was enough to change what the demo flow's
  // exported context pack contained.
  const win = window;
  {
    ensureStylesheet(win, BASE + "fos-tokens.css");

    const used = new Set();
    const defined = new Set();

    for (const name of SHEETS) {
      const text = await sheetText(name);
      for (const [, token] of text.matchAll(/var\((--fos-[a-z0-9-]+)/g)) {
        used.add(token);
      }
      if (name == "fos-tokens.css") {
        for (const [, token] of text.matchAll(/^\s*(--fos-[a-z0-9-]+):/gm)) {
          defined.add(token);
        }
      }
    }

    Assert.greaterOrEqual(
      used.size,
      10,
      "the surfaces are written against the fork's tokens"
    );

    // Measurements, not design tokens: both are written from script because
    // their value is a fact about the running window rather than a decision.
    // `--fos-rail-depth` is set per row; `--fos-chrome-block-start` is the
    // height of the browser's own toolbar, which the panels stop below.
    const runtimeSet = new Set([
      "--fos-rail-depth",
      "--fos-chrome-block-start",
    ]);

    for (const token of used) {
      if (runtimeSet.has(token)) {
        continue;
      }
      ok(defined.has(token), `${token} is declared in fos-tokens.css`);
      Assert.notEqual(
        declaredValue(win, token),
        "",
        `${token} resolves to a value in a chrome window`
      );
    }

    for (const token of defined) {
      ok(used.has(token), `${token} is used by a surface`);
    }
  }
});

add_task(async function the_type_scale_has_three_steps() {
  const win = window;
  {
    ensureStylesheet(win, BASE + "fos-tokens.css");

    // The base is the chrome font size, which in this window is the OS one:
    // both fork tokens are `rem`, precisely so they track it.
    const base = parseFloat(
      win.getComputedStyle(win.document.documentElement).fontSize
    );

    const small = usedFontSize(win, "--fos-font-size-small");
    const large = usedFontSize(win, "--fos-font-size-large");

    // Each token sets a size rather than inheriting one. The parent is 20px,
    // a value nothing in the scale resolves to, so equality here would mean
    // the declaration had evaporated and left the parent's size showing
    // through — which is exactly the failure this file exists for.
    Assert.notEqual(
      small.used,
      small.parent,
      "small type sets a size rather than inheriting"
    );
    Assert.notEqual(
      large.used,
      large.parent,
      "large type sets a size rather than inheriting"
    );

    // And the three steps are in order around the chrome base.
    Assert.less(
      small.used,
      base,
      `small type is smaller than body type (${small.used}px < ${base}px)`
    );
    Assert.greater(
      large.used,
      base,
      `large type is larger than body type (${large.used}px > ${base}px)`
    );

    // The platform token the fork had to replace is still inert. If this ever
    // fails, upstream has given chrome a small size and `fos-tokens.css`
    // should defer to it instead of carrying its own.
    const platform = usedFontSize(win, "--font-size-small");
    Assert.equal(
      platform.used,
      platform.parent,
      "the platform's --font-size-small is still inert in chrome"
    );
  }
});

add_task(async function text_is_quieted_by_colour_not_opacity() {
  // Opacity de-emphasises an element and everything inside it, so a row
  // quieted that way takes its own mark's accent down with it, and contrast
  // tooling measures the colour before compositing and calls it a pass.
  // SYSTEM.md §3 reserves opacity for whole objects; the Field's dimming of
  // unrelated cards is the one such case and names itself.
  const allowed = /\.fos-field-stage\[data-lineage-active\]/;

  for (const name of SHEETS) {
    const text = await sheetText(name);
    const rules = text.split("}");
    for (const rule of rules) {
      if (!/opacity:\s*var\(--opacity-deemphasized/.test(rule)) {
        continue;
      }
      ok(
        allowed.test(rule),
        `${name}: opacity de-emphasis only on a whole object — ${rule
          .trim()
          .split("\n")
          .pop()
          .trim()}`
      );
    }
  }
});

/**
 * The used block padding of a bare element carrying a class, in this window.
 *
 * Read off a real element rather than out of the stylesheet, because the
 * failure this guards against is a later rule overriding the token — which is
 * exactly how the sidebar's entity rows came to have no block padding at all
 * while the row rule above them said otherwise.
 *
 * @param {Window} win A chrome window.
 * @param {string} className The row's class.
 * @param {object} [attrs] Attributes to set, for rows selected by one.
 * @returns {number} The used `padding-block-start`, in px.
 */
function usedRowPadding(win, className, attrs = {}) {
  const doc = win.document;
  const el = doc.createElement("div");
  el.className = className;
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
  doc.documentElement.appendChild(el);
  const used = parseFloat(win.getComputedStyle(el).paddingBlockStart);
  el.remove();
  return used;
}

add_task(async function every_list_row_shares_one_rhythm() {
  // SYSTEM.md §6. The rail and the sidebar are open at the same time on either
  // side of the page and list the same nodes; they ran at different line
  // rhythms, and the sidebar's entity list ran at none, which read as a
  // paragraph rather than as rows.
  const win = window;
  {
    for (const name of SHEETS) {
      ensureStylesheet(win, BASE + name);
    }

    const rows = [
      ["fos-rail-row", {}],
      ["fos-sidebar-row", {}],
      // The list that had `padding-block: 0` of its own.
      ["fos-sidebar-row", { "data-kind": "entity" }],
      ["fos-commandbar-row", {}],
    ];

    const [first] = rows;
    const expected = usedRowPadding(win, first[0], first[1]);
    Assert.greater(expected, 0, "a row has block padding at all");

    for (const [className, attrs] of rows) {
      const used = usedRowPadding(win, className, attrs);
      const what = Object.entries(attrs)
        .map(([k, v]) => `[${k}="${v}"]`)
        .join("");
      Assert.equal(
        used,
        expected,
        `.${className}${what} is on the one row rhythm (${used}px)`
      );
    }

    // And the two flanking panels inset their scrolling bodies by the same
    // amount, so neither list starts hard against the header rule over it.
    const rail = usedRowPadding(win, "fos-rail-list");
    const sidebar = usedRowPadding(win, "fos-sidebar-body");
    Assert.greater(rail, expected, "a body is inset further than a row");
    Assert.equal(
      rail,
      sidebar,
      `the rail and the sidebar inset their bodies alike (${rail}px)`
    );
  }
});

add_task(async function the_focus_ring_is_never_around_the_container() {
  // SYSTEM.md §5. All three focusable containers fill the window, so a ring on
  // one of them drew a 700px accent rectangle beside a faintly shaded row —
  // the loudest mark in the surface on the box rather than on the page Enter
  // would open, saying twice what selection already means.
  //
  // A container may still declare the ring, because it is the only thing left
  // to carry one when nothing is selected. What it must then also do is turn
  // it off again the moment it points at a descendant — and turn it off
  // *explicitly*, because the declaration it is replacing was overriding the
  // UA stylesheet's own `outline: auto` rather than adding a ring, so removing
  // it left the container ringed and looked like nothing had changed. That is
  // why this is checked at all, and why the three surfaces check it live as
  // well: browser_trailrail.js, browser_contextsidebar.js, browser_field.js.
  for (const name of SHEETS) {
    const text = await sheetText(name);
    const rules = text.split("}").map(rule => {
      const [selector, body = ""] = rule.split("{");
      return { selector: selector.trim(), body };
    });

    for (const { selector, body } of rules) {
      if (
        !selector.includes(":focus-visible") ||
        !/outline:\s*var\(--focus-outline\)/.test(body)
      ) {
        continue;
      }

      const tail = selector.slice(
        selector.lastIndexOf(":focus-visible") + ":focus-visible".length
      );
      if (/\S/.test(tail)) {
        ok(true, `${name}: ${selector} — the ring is on a descendant`);
        continue;
      }

      const container = selector.split(":focus-visible")[0].trim();
      const off = rules.some(
        rule =>
          rule.selector.includes(`${container}[aria-activedescendant]`) &&
          /outline:\s*none/.test(rule.body)
      );
      ok(
        off,
        `${name}: ${selector} gives itself a ring, and gives it up again ` +
          `once it points at a descendant`
      );
    }
  }
});

add_task(async function the_dead_token_is_gone() {
  // The exact declaration that produced the bug, so it cannot come back by
  // being copied out of an older surface.
  for (const name of SHEETS) {
    const text = await sheetText(name);
    const uses = [...text.matchAll(/[^-]var\(--font-size-small\)/g)];
    Assert.equal(
      uses.length,
      0,
      `${name} does not reach for the platform's inert --font-size-small`
    );
  }
});

add_task(async function a_panel_never_covers_the_browsers_own_controls() {
  // Found by looking at a screenshot rather than at a stylesheet, which is the
  // only way it could have been: every assertion in the suite measures a panel,
  // and none of them asks what the panel is on top of. With the rail open there
  // was no back button, and with the sidebar open there was no app menu, no
  // page actions and no unseen mark — the one signal this fork keeps
  // permanently on screen, covered by the surface that answers it.
  //
  // Both panels sit above the toolbox on purpose: it carries `z-index: 0` and
  // would otherwise paint over them. Overlaying the *page* is the staged
  // trade-off recorded in STATE. Overlaying the browser was never chosen.
  const win = window;
  const toolbox = win.document.getElementById("navigator-toolbox");
  const chrome = toolbox.getBoundingClientRect();
  Assert.greater(chrome.bottom, 0, "this window has a toolbar to be covered");

  const rail = FOSTrailRail.forWindow(win);
  const sidebar = FOSContextSidebar.forWindow(win);
  await rail.open();
  await sidebar.open();

  try {
    for (const [what, selector] of [
      ["the rail", ".fos-rail"],
      ["the sidebar", ".fos-sidebar"],
    ]) {
      const panel = win.document.querySelector(selector);
      const box = panel.getBoundingClientRect();
      Assert.greater(box.height, 0, `${what} is on screen`);
      Assert.greaterOrEqual(
        Math.round(box.top),
        Math.round(chrome.bottom),
        `${what} starts below the toolbar (${Math.round(box.top)} >= ` +
          `${Math.round(chrome.bottom)})`
      );
    }

    // And the measurement is a measurement, not a constant that happens to be
    // right on this machine: it says what the toolbox says.
    const declared = win
      .getComputedStyle(win.document.documentElement)
      .getPropertyValue("--fos-chrome-block-start");
    Assert.equal(
      Math.round(parseFloat(declared)),
      Math.round(chrome.bottom),
      `--fos-chrome-block-start tracks the toolbox (${declared})`
    );
  } finally {
    sidebar.close();
    rail.close();
  }
});
