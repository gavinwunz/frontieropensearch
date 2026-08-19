/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * What the Field costs to drive, measured rather than guessed.
 *
 * Phase 3 asks for "60fps pan and zoom, no layout jank". The Field has no pan
 * and no continuous zoom by construction — the stage does not scroll (§2) and
 * zoom is a level switch (§3) — so the two things that actually run
 * continuously are a card drag, which commits on every pointer move, and the
 * full rebuild a level switch does. Those are what this measures.
 *
 * Each measurement is reported as a percentile over a run, and the assertions
 * are deliberately loose: this file exists to produce numbers and to catch an
 * order-of-magnitude regression, not to fail on a busy machine.
 */

const { FOSTrailSession } = ChromeUtils.importESModule(
  "resource:///modules/FOSTrailSession.sys.mjs"
);
const { FOSFieldSurface } = ChromeUtils.importESModule(
  "resource:///modules/FOSFieldSurface.sys.mjs"
);

/** One frame at 60Hz. The budget every number here is read against. */
const FRAME_MS = 1000 / 60;

/**
 * Card counts to measure at.
 *
 * 40+ is what the task asks for. 56 is the third one because that is a
 * region's capacity — eight lattice columns by seven rows — and a full region
 * behaves differently enough to be worth its own case: every push has
 * somewhere to go until it does not.
 */
const SCALES = [10, 40, 56];

/** Pointer moves per drag. Two seconds of dragging at 60Hz is ~120. */
const MOVES = 60;

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[index];
}

function stats(label, values) {
  const summary = {
    label,
    n: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: Math.max(...values),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  };
  info(
    `PERF ${label}: n=${summary.n} ` +
      `p50=${summary.p50.toFixed(2)}ms ` +
      `p95=${summary.p95.toFixed(2)}ms ` +
      `max=${summary.max.toFixed(2)}ms ` +
      `mean=${summary.mean.toFixed(2)}ms`
  );
  return summary;
}

/**
 * A trail of `count` pages, built straight in the store.
 *
 * Deliberately not by navigating: eighty real loads would take minutes and
 * would measure the network stack. What the Field sees is the tree, and the
 * tree is the same either way. The shape is a shallow bush — a root, then
 * children fanning out — because that is what branching three ways repeatedly
 * actually produces.
 *
 * @param {Window} win The chrome window to seed.
 * @param {number} count How many pages.
 * @returns {number} The trail id.
 */
function seedTrail(win, count) {
  const store = FOSTrailSession.forWindow(win).store;
  const trailId = store.createTrail({ name: `Perf ${count}` });
  const root = store.addNode({
    trailId,
    url: "https://example.com/root",
    title: "Root",
  });
  const nodes = [root];
  for (let i = 1; i < count; i++) {
    const parent = nodes[Math.floor((i - 1) / 3)];
    nodes.push(
      store.addNode({
        trailId,
        parentId: parent.id,
        url: `https://example.com/page-${i}`,
        title: `Page ${i}`,
      })
    );
  }
  return trailId;
}

/**
 * Give every card a picture.
 *
 * Without this the stage is forty empty boxes, and a drag across empty boxes
 * measures almost nothing of what paint actually costs. A real card carries a
 * decoded thumbnail at roughly this size, so the drag is re-measured with one
 * on every shot — noise rather than a flat fill, because a flat fill
 * compresses to nothing and would be optimised away in the decode.
 *
 * @param {Window} win The chrome window.
 * @returns {number} How many cards were given one.
 */
function paintThumbs(win) {
  const doc = win.document;
  const canvas = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = 100;
  canvas.height = 60;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = (i * 7) % 256;
    image.data[i + 1] = (i * 13) % 256;
    image.data[i + 2] = (i * 29) % 256;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const url = canvas.toDataURL("image/png");

  const shots = doc.querySelectorAll(".fos-field-shot");
  for (const shot of shots) {
    shot.style.backgroundImage = `url("${url}")`;
    shot.style.backgroundSize = "cover";
    shot.removeAttribute("data-empty");
  }
  return shots.length;
}

/**
 * Force style and layout to flush, and return what it cost.
 *
 * @param {Window} win The chrome window.
 * @returns {number} Milliseconds.
 */
function flush(win) {
  const t0 = win.performance.now();
  // A read of a geometry property on a dirty tree is a synchronous reflow.
  void win.document.documentElement.getBoundingClientRect().height;
  return win.performance.now() - t0;
}

function nextFrame(win) {
  return new Promise(resolve => win.requestAnimationFrame(resolve));
}

/**
 * Drag one card across its region, one move per frame, and time each move.
 *
 * Split into three numbers on purpose. `handler` is the JS the pointer move
 * runs — the model's push, the layout arithmetic, the DOM writes. `flush` is
 * what those writes then cost the engine in style and layout. `frame` is the
 * interval the refresh driver actually delivered, which is the only one of the
 * three that answers "60fps" directly.
 *
 * @param {Window} win The chrome window.
 * @returns {object} Four arrays of milliseconds.
 */
async function measureDrag(win) {
  const stage = win.document.querySelector(".fos-field-stage");
  const cards = [...stage.querySelectorAll(".fos-field-card")];
  Assert.greater(cards.length, 0, "there is a card to drag");

  // The card furthest from the region's centre, so the drag crosses the most
  // occupied space and provokes the most pushing.
  const stageBox = stage.getBoundingClientRect();
  const centre = {
    x: stageBox.left + stageBox.width / 2,
    y: stageBox.top + stageBox.height / 2,
  };
  const target = cards
    .map(el => ({ el, box: el.getBoundingClientRect() }))
    .sort(
      (a, b) =>
        Math.hypot(b.box.left - centre.x, b.box.top - centre.y) -
        Math.hypot(a.box.left - centre.x, a.box.top - centre.y)
    )[0];

  let x = target.box.left + target.box.width / 2;
  let y = target.box.top + target.box.height / 2;
  const stepX = (centre.x - x) / MOVES;
  const stepY = (centre.y - y) / MOVES;

  EventUtils.synthesizeMouseAtPoint(x, y, { type: "mousedown" }, win);

  const handler = [];
  const flushed = [];
  const clean = [];
  const frame = [];
  const cardId = Number(target.el.dataset.cardId);
  let committed = 0;
  let refused = 0;
  let lastLeft = target.el.style.left;

  // One warm-up frame so the first measurement is not the drag's own setup.
  await nextFrame(win);
  let last = win.performance.now();

  for (let i = 0; i < MOVES; i++) {
    await nextFrame(win);
    const t0 = win.performance.now();
    frame.push(t0 - last);
    last = t0;

    x += stepX;
    y += stepY;
    EventUtils.synthesizeMouseAtPoint(x, y, { type: "mousemove" }, win);
    handler.push(win.performance.now() - t0);
    flushed.push(flush(win));
    clean.push(flush(win));
    const now = target.el.style.left;
    if (now !== lastLeft) {
      committed++;
      lastLeft = now;
    }
    if (target.el.hasAttribute("data-refused")) {
      refused++;
    }
  }

  EventUtils.synthesizeMouseAtPoint(x, y, { type: "mouseup" }, win);
  await nextFrame(win);

  info(
    `PERF drag committed=${committed}/${MOVES} refused=${refused} ` +
      `card=${cardId} cards=${cards.length}`
  );
  return { handler, flushed, clean, frame };
}

/**
 * One scale, measured on a trail of its own.
 *
 * A fresh trail per case matters more than it looks. A card keeps the position
 * it was dragged to and is pinned there for good (§4), so re-measuring on the
 * same region measures a region the previous measurement rearranged — the
 * second drag lands in the space the first one filled and is refused, and the
 * numbers quietly become numbers about refusals.
 *
 * @param {Window} win The chrome window.
 * @param {object} field The field surface.
 * @param {number} count How many pages on the trail.
 * @param {boolean} thumbs Whether to give every card a picture first.
 * @returns {Array<object>} Summary rows.
 */
async function measureScale(win, field, count, thumbs) {
  const suffix = thumbs ? `thumbs-${count}` : `bare-${count}`;
  const trailId = seedTrail(win, count);
  field.sync();
  field.open();
  field.showRegion(trailId);
  await nextFrame(win);

  if (thumbs) {
    info(`PERF ${suffix}: ${paintThumbs(win)} thumbnails painted`);
    await nextFrame(win);
  }

  const rendered = win.document.querySelectorAll(".fos-field-card").length;
  info(`PERF ${suffix}: ${rendered} cards rendered for ${count} pages`);
  const drag = await measureDrag(win);

  // A drag every move of which was refused ends as a click, and a click on a
  // card enters it — which closes the Field. Put it back before measuring the
  // level switch, or the next measurement times a render that returns early.
  if (!field.isOpen) {
    field.open();
  }
  field.showRegion(trailId);
  await nextFrame(win);

  const rows = [
    stats(`${suffix}-drag-handler`, drag.handler),
    stats(`${suffix}-drag-flush`, drag.flushed),
    stats(`${suffix}-drag-flush-clean`, drag.clean),
    stats(`${suffix}-drag-frame`, drag.frame),
  ];

  const outs = [];
  const ins = [];
  for (let i = 0; i < 10; i++) {
    await nextFrame(win);
    let t0 = win.performance.now();
    field.showOverview();
    outs.push(win.performance.now() - t0 + flush(win));

    await nextFrame(win);
    t0 = win.performance.now();
    field.showRegion(trailId);
    ins.push(win.performance.now() - t0 + flush(win));
  }
  rows.push(stats(`${suffix}-zoom-out`, outs));
  rows.push(stats(`${suffix}-zoom-in`, ins));

  field.close();
  await nextFrame(win);
  return rows;
}

add_task(async function measure_the_field() {
  const win = await BrowserTestUtils.openNewBrowserWindow();
  const field = FOSFieldSurface.forWindow(win);
  const report = [];

  try {
    for (const count of SCALES) {
      for (const thumbs of [false, true]) {
        report.push(...(await measureScale(win, field, count, thumbs)));
      }
    }
  } finally {
    field.close();
    await BrowserTestUtils.closeWindow(win);
  }

  // Loose ceilings. The point of this file is the numbers in the log; these
  // exist so that a ten-fold regression fails the suite rather than being read
  // about afterwards. The frame interval is excluded because it is the refresh
  // driver's cadence and not ours to assert on — a machine with a 30Hz display
  // would fail an assertion about a number the Field does not control.
  for (const row of report) {
    if (row.label.includes("-frame")) {
      continue;
    }
    Assert.less(
      row.p95,
      10 * FRAME_MS,
      `${row.label} p95 is within ten frames`
    );
  }
});

/**
 * The overview when the Field is genuinely full.
 *
 * The region level draws one region. The overview draws *every* region, and
 * draws each one as a faithful miniature — every card of every trail, as its
 * own element. That makes the overview the only surface in the Field whose
 * cost is the product of two unbounded numbers, and past nine trails it also
 * has to pack the surplus into the nest. So this is the worst case the design
 * permits, and it is the one worth having a number for.
 */
add_task(async function measure_a_crowded_overview() {
  const win = await BrowserTestUtils.openNewBrowserWindow();
  const field = FOSFieldSurface.forWindow(win);

  try {
    const TRAILS = 12;
    const PER_TRAIL = 40;
    for (let i = 0; i < TRAILS; i++) {
      seedTrail(win, PER_TRAIL);
    }
    field.sync();
    field.open();
    field.showOverview();
    await nextFrame(win);

    const minis = win.document.querySelectorAll(".fos-field-mini").length;
    const tiles = win.document.querySelectorAll(".fos-field-tile").length;
    info(
      `PERF crowded overview: ${tiles} tiles, ${minis} miniatures, ` +
        `${field.model.cards().length} cards`
    );
    Assert.greater(minis, 100, "the overview really is crowded");

    const renders = [];
    const script = [];
    const layout = [];
    for (let i = 0; i < 10; i++) {
      await nextFrame(win);
      const t0 = win.performance.now();
      field.render();
      const built = win.performance.now() - t0;
      const flushed = flush(win);
      script.push(built);
      layout.push(flushed);
      renders.push(built + flushed);
    }
    stats("crowded-overview-render-script", script);
    stats("crowded-overview-render-layout", layout);
    const row = stats("crowded-overview-render", renders);
    Assert.less(
      row.p95,
      10 * FRAME_MS,
      "crowded-overview-render p95 is within ten frames"
    );

    // A render this size is affordable as a level switch, which happens once
    // when the user presses a key. It is not affordable once per resize event,
    // and the Field re-renders on every one of those — dragging a window edge
    // is the one gesture that turns this into a per-frame cost.
    const idle = [];
    let last = win.performance.now();
    for (let i = 0; i < 30; i++) {
      await nextFrame(win);
      const t = win.performance.now();
      idle.push(t - last);
      last = t;
    }
    stats("crowded-overview-idle-frame", idle);

    const width = win.outerWidth;
    const height = win.outerHeight;
    const resizing = [];
    const passesBefore = field.resizePasses;
    const rebuildsBefore = field.resizeRebuilds;
    last = win.performance.now();
    for (let i = 0; i < 30; i++) {
      await nextFrame(win);
      const t = win.performance.now();
      resizing.push(t - last);
      last = t;
      win.resizeTo(width - (i % 10) * 20, height);
    }
    win.resizeTo(width, height);
    stats("crowded-overview-resizing-frame", resizing);
    // Which of the two things a pass can do was this loop actually doing?
    // A frame time cannot say, and the two have nothing in common as
    // problems: a rebuild is this module's to fix, and everything else is
    // the engine laying out and painting 489 boxes that are genuinely
    // changing size.
    info(
      `PERF crowded-overview-resizing-passes: ` +
        `${field.resizePasses - passesBefore} passes, ` +
        `${field.resizeRebuilds - rebuildsBefore} of them rebuilds`
    );
    Assert.equal(
      field.resizeRebuilds - rebuildsBefore,
      0,
      "a sustained resize of the crowded overview never rebuilds the stage"
    );
    const passesAfterResize = field.resizePasses;
    const rebuildsAfterResize = field.resizeRebuilds;

    // The control, and the reason the number above means anything. Resizing a
    // chrome window is not free on its own — the whole toolbox relays out — so
    // the same loop is run again with the Field closed. Whatever separates the
    // two is the Field's own re-render.
    field.close();
    await nextFrame(win);
    const control = [];
    last = win.performance.now();
    for (let i = 0; i < 30; i++) {
      await nextFrame(win);
      const t = win.performance.now();
      control.push(t - last);
      last = t;
      win.resizeTo(width - (i % 10) * 20, height);
    }
    win.resizeTo(width, height);
    stats("closed-field-resizing-frame", control);
    // A closed Field still runs a pass per frame, and `render` returns at once
    // on a hidden root — so a fallback counted here is a no-op, not a rebuild.
    // Reported so the number is not read as one.
    info(
      `PERF closed-field-resizing-passes: ` +
        `${field.resizePasses - passesAfterResize} passes, ` +
        `${field.resizeRebuilds - rebuildsAfterResize} fell back`
    );

    // The same question without the window manager in it. A real resize drags
    // the whole toolbox through layout and the numbers above carry that noise;
    // dispatching the event the Field actually listens to isolates what the
    // Field itself does about it. A real resize gesture fires this many times
    // a second, so the burst is not a synthetic load — it is the gesture with
    // the compositor's share taken out.
    field.open();
    field.showOverview();
    await nextFrame(win);
    const BURST = 10;
    const bursts = [];
    const rebuildsAtBurst = field.resizeRebuilds;
    for (let i = 0; i < 10; i++) {
      await nextFrame(win);
      const t0 = win.performance.now();
      for (let j = 0; j < BURST; j++) {
        win.dispatchEvent(new win.Event("resize"));
      }
      bursts.push(win.performance.now() - t0 + flush(win));
    }
    stats(`resize-burst-of-${BURST}`, bursts);
    info(
      `PERF resize-burst rebuilds: ${field.resizeRebuilds - rebuildsAtBurst}`
    );

    // The burst above says what coalescing is worth and deliberately nothing
    // else, and two things about how it is written stop it standing in for
    // one real pass. It never times the pass: the events register a frame
    // callback, and `performance.now()` is read again before that frame has
    // run. And its writes are no-ops — the window never changed size, so the
    // reposition writes every declaration the value already on the element,
    // which invalidates nothing and costs no layout.
    //
    // So this measures one pass with both faults taken out. The stage is
    // given a genuinely different size, so every declaration written differs
    // from the one on the element; and the pass is bracketed by two frame
    // callbacks registered either side of it, which run in the same frame in
    // registration order, so what separates them is the pass and nothing
    // else.
    const stage = field.stage;
    const stageWidth = stage.clientWidth;
    const passScript = [];
    const passLayout = [];
    const rebuildsAtPasses = field.resizeRebuilds;
    for (let i = 0; i < 10; i++) {
      await nextFrame(win);
      stage.style.width = `${stageWidth - (i % 5) * 40}px`;
      let t0 = 0;
      win.requestAnimationFrame(() => {
        t0 = win.performance.now();
      });
      win.dispatchEvent(new win.Event("resize"));
      await new Promise(resolve =>
        win.requestAnimationFrame(() => {
          passScript.push(win.performance.now() - t0);
          resolve();
        })
      );
      passLayout.push(flush(win));
    }
    stage.style.removeProperty("width");
    stats("resize-pass-script", passScript);
    stats("resize-pass-layout", passLayout);
    // Scoped to this loop alone. The two numbers above are a claim about the
    // fast path, and they are only that if the fast path is what ran.
    const passRebuilds = field.resizeRebuilds - rebuildsAtPasses;
    info(`PERF resize-pass rebuilds: ${passRebuilds}`);
    Assert.equal(
      passRebuilds,
      0,
      "a real change of size is repositioned, not rebuilt"
    );
  } finally {
    field.close();
    await BrowserTestUtils.closeWindow(win);
  }
});
