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

    ok(used.size >= 10, `the surfaces are written against tokens (${used.size})`);

    // `--fos-rail-depth` is set per row from script rather than declared as a
    // design token, and is the one legitimate exception.
    const runtimeSet = new Set(["--fos-rail-depth"]);

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
