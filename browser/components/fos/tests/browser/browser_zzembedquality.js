/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/**
 * The embedding pass, as a measurement rather than an argument.
 *
 * `IDEAS.md` records the gap this is aimed at, and it is a specific one:
 * **queries are typed in lower case**, so the capitalisation signal
 * `FOSContextSignals.extractEntities` rests on is absent from exactly the
 * input that carries the user's intent. "vannevar bush memex" yields three
 * plain words rather than a name. Page titles are capitalised and are where
 * the shallow extractor earns its keep; queries are where it does not.
 *
 * A static embedding is the obvious candidate because its tokenizer lowercases
 * anyway — `BertNormalizer` with `lowercase: true` — so the signal it reads was
 * never the one the shallow path is missing. `potion-retrieval-32M` is a
 * lookup table rather than a transformer: an embedding is a sum of rows and a
 * normalisation, so there is no encoder to run and no reason to expect the
 * per-query cost to matter. What is genuinely uncertain is **quality on four
 * lower-case words**, which is shorter than anything a retrieval benchmark
 * scores.
 *
 * So this measures three things, in the order they decide anything:
 *
 *   1. **Does it beat what the fork already has?** The control is Jaccard
 *      overlap on `normaliseIntent` tokens — the stopword-filtered lowercase
 *      string the Context Engine stores today. If a 30MB download does not
 *      beat set intersection on short queries, there is nothing here worth
 *      asking a user to download, and that is a result.
 *   2. **Where would a merge threshold go?** Cross-trail context merging needs
 *      a number, not a ranking. Same-task and different-task pair similarities
 *      are reported as distributions, with the threshold that best separates
 *      them and what it costs in precision and recall. An overlap that leaves
 *      no usable threshold is also a result, and a more useful one than a
 *      score.
 *   3. **Does a lower-case query reach a capitalised title?** This is the
 *      cross-type probe, and it is the one the command bar would use: ranking
 *      the active context's pages by what has been typed means comparing a
 *      query to a title. Same-type similarity does not imply it.
 *
 * Both published dimensions are measured. `EmbeddingsGenerator` prefers 512
 * and the backend also publishes 256; the fetch is 60MB against 30MB, and a
 * one-time download is something this fork asks the user for, so its size is a
 * design decision rather than a default to inherit.
 *
 * **The weights come off a local hub, and they have to.** mochitest aborts the
 * process on any non-local connection, which is what killed run 27 after the
 * runtime had already loaded. Same gate and same hook as the ASR measurement:
 *
 *   agent/jobs/fetch-static-embeddings.sh   # once, ~86MB, outside the repo
 *   FOS_MEASURE_EMBED=1 MOZ_ML_LOCAL_DIR=/data/ml-models \
 *     ./mach mochitest --keep-open=false \
 *     --hooks toolkit/components/ml/tests/tools/hooks_local_hub.py \
 *     browser/components/fos/tests/browser/browser_zzembedquality.js
 *
 * Read the results by grepping the log for `##### EMBED`.
 */

const { createEngine } = ChromeUtils.importESModule(
  "chrome://global/content/ml/EngineProcess.sys.mjs"
);
const { normaliseIntent } = ChromeUtils.importESModule(
  "resource:///modules/FOSContextSignals.sys.mjs"
);

requestLongerTimeout(20);

/** How many timed runs, after the untimed warm-up. */
const ITERATIONS = 9;

/**
 * Eight enquiries, written the way they are typed: lower case, no punctuation,
 * three to six words. Four queries and three page titles each — titles
 * capitalised, because that is how they arrive from a document.
 *
 * Two pairs are deliberately adjacent. `memex` and `spatial` are both
 * hypertext history and share vocabulary; `sqlite` and `onnx` are both this
 * project's own plumbing. A model that cannot separate those is not usable for
 * cross-trail merging however well it scores on the easy pairs, and one that
 * can has demonstrated something Jaccard cannot do at all.
 */
const CORPUS = [
  {
    task: "memex",
    queries: [
      "vannevar bush memex",
      "as we may think associative trails",
      "who invented the memex",
      "memex trail sharing between researchers",
    ],
    titles: [
      "As We May Think - The Atlantic",
      "The Memex and the Origins of Hypertext",
      "Vannevar Bush: Science, the Endless Frontier",
    ],
  },
  {
    task: "spatial",
    queries: [
      "spatial hypertext viki tinderbox",
      "why did spatial hypertext never ship",
      "zoomable canvas interface research",
      "information workspace pad zooming",
    ],
    titles: [
      "Spatial Hypertext: An Alternative to Navigational and Semantic Links",
      "Pad++: A Zoomable Graphical Interface System",
      "Tinderbox: The Tool for Notes",
    ],
  },
  {
    task: "sqlite",
    queries: [
      "sqlite schema migration versioning",
      "how to add a column without rewriting the table",
      "sqlite write ahead log mode",
      "storing a tree in a relational table",
    ],
    titles: [
      "SQLite: Write-Ahead Logging",
      "Database Migrations Done Right",
      "Modeling Hierarchies in Relational Databases",
    ],
  },
  {
    task: "onnx",
    queries: [
      "onnx runtime cpu inference speed",
      "run a transformer model offline in javascript",
      "quantized model int8 accuracy loss",
      "static embeddings versus transformer embeddings",
    ],
    titles: [
      "ONNX Runtime Performance Tuning",
      "Model2Vec: Fast State-of-the-Art Static Embeddings",
      "Quantization for Neural Network Inference",
    ],
  },
  {
    task: "rust",
    queries: [
      "rust borrow checker cannot borrow as mutable",
      "lifetime annotation error struct",
      "rust arc mutex across threads",
      "why does my closure move the value",
    ],
    titles: [
      "Understanding Ownership - The Rust Programming Language",
      "Rust Borrow Checker Errors Explained",
      "Fearless Concurrency with Arc and Mutex",
    ],
  },
  {
    task: "keyboard",
    queries: [
      "best mechanical keyboard for typing",
      "tactile versus linear switches",
      "hot swappable keyboard under 150",
      "keycap profile comparison cherry sa",
    ],
    titles: [
      "The Best Mechanical Keyboards of the Year",
      "A Guide to Mechanical Switch Types",
      "Keycap Profiles Compared: Cherry, OEM, SA, DSA",
    ],
  },
  {
    task: "lisbon",
    queries: [
      "flights to lisbon in october",
      "where to stay in lisbon alfama",
      "lisbon tram 28 worth it",
      "day trip from lisbon to sintra",
    ],
    titles: [
      "Lisbon Travel Guide: Where to Stay",
      "Sintra Day Trip from Lisbon",
      "Cheap Flights to Lisbon (LIS)",
    ],
  },
  {
    task: "sourdough",
    queries: [
      "sourdough starter not rising",
      "how long to bulk ferment dough",
      "why is my crumb so dense",
      "baking bread in a dutch oven",
    ],
    titles: [
      "Troubleshooting Your Sourdough Starter",
      "Bulk Fermentation: A Complete Guide",
      "Baking Bread in a Dutch Oven",
    ],
  },
];

/** Every query, flattened, paired with the task it belongs to. */
const QUERIES = CORPUS.flatMap(({ task, queries }) =>
  queries.map(text => ({ task, text }))
);

/** Every title, flattened, paired with the task it belongs to. */
const TITLES = CORPUS.flatMap(({ task, titles }) =>
  titles.map(text => ({ task, text }))
);

/**
 * The corpus again, cut into half-enquiries, for the merge question.
 *
 * The `related` tier compares one query to one title, and the threshold for
 * that is measured above. Offering to merge two *contexts* is a different
 * question with a different shape: a context is a set of queries, so the score
 * is an aggregate over many pairs and the single-pair threshold does not
 * transfer to it. Run 37's lesson is exactly this one — a threshold is only
 * measured if you can say what it was measured over — so the aggregate is
 * measured over aggregates.
 *
 * Splitting each enquiry in two is what makes positives exist at all. Every
 * enquiry in `CORPUS` is one topic, so no two of them should ever merge; the
 * case the feature is *for* is one topic the user researched on two trails,
 * and two halves of one enquiry are that case. It gives 8 pairs that should
 * merge against 112 that should not, which is few positives and plenty of
 * negatives — the right way round for a rule whose whole risk is offering a
 * merge that is wrong.
 */
const WHOLES = CORPUS.map(({ task, queries, titles }, index) => {
  const queryBase = CORPUS.slice(0, index).reduce(
    (sum, entry) => sum + entry.queries.length,
    0
  );
  const titleBase = CORPUS.slice(0, index).reduce(
    (sum, entry) => sum + entry.titles.length,
    0
  );
  return {
    task,
    text: task,
    queries: queries.map((_, k) => queryBase + k),
    titles: titles.map((_, k) => titleBase + k),
  };
});

const HALVES = (() => {
  const halves = [];
  let queryBase = 0;
  let titleBase = 0;
  const span = (base, from, to) =>
    Array.from({ length: to - from }, (_, k) => base + from + k);

  for (const { task, queries, titles } of CORPUS) {
    const queryCut = Math.ceil(queries.length / 2);
    const titleCut = Math.ceil(titles.length / 2);
    halves.push({
      task,
      text: `${task}/a`,
      queries: span(queryBase, 0, queryCut),
      titles: span(titleBase, 0, titleCut),
    });
    halves.push({
      task,
      text: `${task}/b`,
      queries: span(queryBase, queryCut, queries.length),
      titles: span(titleBase, titleCut, titles.length),
    });
    queryBase += queries.length;
    titleBase += titles.length;
  }
  return halves;
})();

/** @param {number[]} values */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * @param {number[]} values
 * @param {number} fraction
 */
function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(fraction * (sorted.length - 1)))
  );
  return sorted[index];
}

/** @param {number} value */
function round(value) {
  return Math.round(value * 1000) / 1000;
}

/** @param {number} ms */
function roundMs(ms) {
  return Math.round(ms * 100) / 100;
}

/**
 * Jaccard overlap on the normalised intent, which is the control: the string
 * the Context Engine already stores for every query, compared the only way it
 * can be compared without a model.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} 0 to 1.
 */
function lexicalSimilarity(a, b) {
  const left = new Set(normaliseIntent(a).split(" ").filter(Boolean));
  const right = new Set(normaliseIntent(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) {
    return 0;
  }
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) {
      shared++;
    }
  }
  return shared / (left.size + right.size - shared);
}

/**
 * @param {Float32Array} a
 * @param {Float32Array} b
 */
function cosine(a, b) {
  let dot = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    leftSquares += a[i] * a[i];
    rightSquares += b[i] * b[i];
  }
  const magnitude = Math.sqrt(leftSquares) * Math.sqrt(rightSquares);
  return magnitude === 0 ? 0 : dot / magnitude;
}

/**
 * Rank every row against every column and score how often the top of the
 * ranking is from the same task.
 *
 * `skipSelf` is what separates the two probes: comparing queries to queries
 * has to drop the diagonal, and comparing queries to titles has no diagonal to
 * drop.
 *
 * @param {{task: string, text: string}[]} rows
 * @param {{task: string, text: string}[]} columns
 * @param {(rowIndex: number, columnIndex: number) => number} similarity
 * @param {boolean} skipSelf
 */
function score(rows, columns, similarity, skipSelf) {
  let atOne = 0;
  let atThree = 0;
  const ties = [];

  for (let i = 0; i < rows.length; i++) {
    const ranked = [];
    for (let j = 0; j < columns.length; j++) {
      if (skipSelf && i === j) {
        continue;
      }
      ranked.push({ task: columns[j].task, value: similarity(i, j) });
    }
    ranked.sort((left, right) => right.value - left.value);

    if (ranked[0].task === rows[i].task) {
      atOne++;
    }
    // A tie at the top is a non-answer, not a hit: set overlap produces a lot
    // of exact zeroes and whichever one sorted first would otherwise be
    // credited as a ranking.
    if (ranked[0].value === ranked[ranked.length - 1].value) {
      ties.push(rows[i].text);
    }
    const top = ranked.slice(0, 3);
    atThree +=
      top.filter(entry => entry.task === rows[i].task).length / top.length;
  }

  return {
    atOne: atOne / rows.length,
    atThree: atThree / rows.length,
    flat: ties.length,
  };
}

/**
 * Every pair's similarity, split by whether the pair is the same task. This is
 * what a threshold is chosen from, and reporting the two distributions rather
 * than one score is the point: a mean that separates cleanly and a
 * ninety-fifth percentile that does not means there is no threshold.
 *
 * `columns` defaults to `items`, which is the within-type case — every
 * unordered pair, diagonal dropped. Passing a different array gives the
 * **cross-type** case, every row against every column, which is a genuinely
 * different distribution and not an approximation of the first one. Getting
 * that wrong is what run 37 caught: a floor derived from query→query pairs was
 * applied to a tier that only ever compares a query to a title, and it
 * rejected a page it should have offered at 0.159 against a floor of 0.169.
 *
 * @param {{task: string, text: string}[]} items
 * @param {(a: number, b: number) => number} similarity
 * @param {{task: string, text: string}[]} [columns]
 */
function pairs(items, similarity, columns = null) {
  const same = [];
  const different = [];
  const against = columns ?? items;
  for (let i = 0; i < items.length; i++) {
    // Within one set a pair is unordered and self-comparison is meaningless;
    // across two sets every cell is a real pair.
    const from = columns ? 0 : i + 1;
    for (let j = from; j < against.length; j++) {
      const value = similarity(i, j);
      (items[i].task === against[j].task ? same : different).push(value);
    }
  }

  // The best separating threshold by F1, swept over the values that actually
  // occur. Sweeping the observed values rather than a fixed grid means the
  // reported threshold is one a rule could really use.
  let best = { threshold: 0, f1: 0, precision: 0, recall: 0 };
  const candidates = [...new Set([...same, ...different])].sort(
    (a, b) => a - b
  );
  for (const threshold of candidates) {
    const truePositives = same.filter(value => value >= threshold).length;
    const falsePositives = different.filter(value => value >= threshold).length;
    if (!truePositives) {
      continue;
    }
    const precision = truePositives / (truePositives + falsePositives);
    const recall = truePositives / same.length;
    const f1 = (2 * precision * recall) / (precision + recall);
    if (f1 > best.f1) {
      best = { threshold, f1, precision, recall };
    }
  }

  return { same, different, best };
}

/**
 * @param {string} label
 * @param {{same: number[], different: number[], best: object}} distribution
 */
function reportPairs(label, distribution) {
  const { same, different, best } = distribution;
  info(
    `##### EMBED ${label} same-task  median ${round(median(same))}  ` +
      `p05 ${round(percentile(same, 0.05))}  p95 ${round(percentile(same, 0.95))}`
  );
  info(
    `##### EMBED ${label} diff-task  median ${round(median(different))}  ` +
      `p05 ${round(percentile(different, 0.05))}  ` +
      `p95 ${round(percentile(different, 0.95))}`
  );
  info(
    `##### EMBED ${label} best threshold ${round(best.threshold)} → ` +
      `precision ${round(best.precision)} recall ${round(best.recall)} ` +
      `f1 ${round(best.f1)}`
  );
}

/**
 * The cheapest threshold that reaches a given precision, and what recall costs.
 *
 * `pairs` reports the F1 optimum, which is the right summary for a ranking and
 * the wrong one for an offer. F1 treats a missed merge and a wrong merge as
 * equally bad; this feature does not. A merge it fails to offer costs the user
 * nothing they had — the two contexts go on working exactly as they do today —
 * while a merge it offers wrongly spends their attention and, if accepted,
 * puts two unrelated enquiries in one sidebar. So the threshold this fork
 * ships is chosen for precision and the recall is whatever is left.
 *
 * @param {string} label
 * @param {{same: number[], different: number[]}} distribution
 * @param {number} target Precision to reach.
 */
function reportPrecisionFirst(label, { same, different }, target) {
  const candidates = [...new Set([...same, ...different])].sort(
    (a, b) => a - b
  );
  for (const threshold of candidates) {
    const truePositives = same.filter(value => value >= threshold).length;
    const falsePositives = different.filter(value => value >= threshold).length;
    if (!truePositives) {
      break;
    }
    const precision = truePositives / (truePositives + falsePositives);
    if (precision >= target) {
      info(
        `##### EMBED ${label} precision>=${target} at threshold ` +
          `${round(threshold)} → precision ${round(precision)} ` +
          `recall ${round(truePositives / same.length)} ` +
          `(${truePositives}/${same.length} found, ${falsePositives} wrong)`
      );
      return;
    }
  }
  info(
    `##### EMBED ${label} precision>=${target} UNREACHABLE at any threshold`
  );
}

/**
 * Ways of turning many pairwise similarities into one score for two contexts.
 *
 * This is the choice the merge offer rests on, and the reason it is measured
 * rather than picked is that the rules fail in opposite directions. `max` asks
 * whether the two contexts share *any* question, so it rises with the number
 * of pairs compared and two large unrelated contexts will eventually contain
 * one accidental near-match. `mean` asks whether they are about the same thing
 * throughout, so it is dragged down by the breadth that any real enquiry has.
 * Neither is obviously right, and the corpus can say which.
 *
 * `centroid` is the one the schema already anticipated — `context.centroid` is
 * documented as the mean of member embeddings — so measuring it here says
 * whether that column would have earned its keep.
 *
 * @type {Record<string, (values: number[]) => number>}
 */
const AGGREGATIONS = {
  max: values => Math.max(...values),
  mean: values => values.reduce((sum, value) => sum + value, 0) / values.length,
  top3: values => {
    const top = [...values].sort((a, b) => b - a).slice(0, 3);
    return top.reduce((sum, value) => sum + value, 0) / top.length;
  },
};

/**
 * The mean of a set of vectors, normalised — one context as one vector.
 *
 * @param {number[]} indices
 * @param {Float32Array[]} vectors
 * @returns {number[]}
 */
function centroid(indices, vectors) {
  const dimensions = vectors[indices[0]].length;
  const sum = new Array(dimensions).fill(0);
  for (const index of indices) {
    for (let d = 0; d < dimensions; d++) {
      sum[d] += vectors[index][d];
    }
  }
  let squares = 0;
  for (let d = 0; d < dimensions; d++) {
    sum[d] /= indices.length;
    squares += sum[d] * sum[d];
  }
  const magnitude = Math.sqrt(squares);
  return magnitude ? sum.map(value => value / magnitude) : sum;
}

/**
 * Load the static backend at one dimension and embed the whole corpus.
 *
 * @param {number} dimensions
 * @returns {Promise<?{queries: Float32Array[], titles: Float32Array[]}>}
 */
async function embedCorpus(dimensions) {
  const label = `static/d${dimensions}`;
  const options = {
    featureId: "simple-text-embedder",
    engineId: `fos-embed-measure-d${dimensions}`,
    taskName: "static-embeddings",
    backend: "static-embeddings",
    modelId: "mozilla/static-embeddings",
    // Not `modelHub: "mozilla"`: that setter overwrites the root URL with the
    // real hub and resets the revision to "main", which is a non-local fetch
    // and therefore fatal under mochitest.
    modelHubRootUrl: Services.env.get("MOZ_MODELS_HUB"),
    modelHubUrlTemplate: "{model}/{revision}",
    modelRevision: "v1.0.0",
    timeoutMS: -1,
    staticEmbeddingsOptions: {
      subfolder: "models/minishlab/potion-retrieval-32M",
      dtype: "fp16",
      dimensions,
      compression: true,
    },
  };

  let engine;
  const loadStart = ChromeUtils.now();
  try {
    engine = await createEngine(options);
  } catch (error) {
    info(`##### EMBED ${label} UNAVAILABLE ${error}`);
    return null;
  }
  const loadMs = ChromeUtils.now() - loadStart;

  const run = async texts => {
    const { output } = await engine.run({
      args: texts,
      options: { pooling: "mean", normalize: true },
    });
    return output;
  };

  try {
    // The first call pays for whatever the engine defers past `createEngine`,
    // and the user pays that once at startup rather than per keystroke.
    await run([QUERIES[0].text]);

    const singles = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = ChromeUtils.now();
      await run([QUERIES[i % QUERIES.length].text]);
      singles.push(ChromeUtils.now() - start);
    }

    const batchStart = ChromeUtils.now();
    const queries = await run(QUERIES.map(entry => entry.text));
    const batchMs = ChromeUtils.now() - batchStart;

    const titles = await run(TITLES.map(entry => entry.text));

    info(
      `##### EMBED ${label} load ${roundMs(loadMs)}ms  ` +
        `one query median ${roundMs(median(singles))}ms  ` +
        `batch of ${QUERIES.length} ${roundMs(batchMs)}ms`
    );

    is(queries.length, QUERIES.length, `${label} embedded every query`);
    is(queries[0].length, dimensions, `${label} returned ${dimensions} dims`);

    return { queries, titles };
  } finally {
    await engine.terminate();
  }
}

add_task(async function measure_embedding_quality() {
  if (!Services.env.get("FOS_MEASURE_EMBED")) {
    ok(true, "skipped: set FOS_MEASURE_EMBED to measure static embeddings");
    return;
  }
  if (!Services.env.get("MOZ_MODELS_HUB")) {
    ok(
      true,
      "skipped: no MOZ_MODELS_HUB. Run agent/jobs/fetch-static-embeddings.sh, " +
        "then pass --hooks toolkit/components/ml/tests/tools/hooks_local_hub.py " +
        "with MOZ_ML_LOCAL_DIR set."
    );
    return;
  }

  info(
    `##### EMBED corpus ${QUERIES.length} queries, ${TITLES.length} titles, ` +
      `${CORPUS.length} tasks`
  );

  // The control first, so a model that fails to load still leaves the run with
  // the number it would have had to beat.
  const lexicalQuery = (i, j) =>
    lexicalSimilarity(QUERIES[i].text, QUERIES[j].text);
  const lexicalTitle = (i, j) =>
    lexicalSimilarity(QUERIES[i].text, TITLES[j].text);

  const lexicalQueries = score(QUERIES, QUERIES, lexicalQuery, true);
  const lexicalTitles = score(QUERIES, TITLES, lexicalTitle, false);
  info(
    `##### EMBED lexical query→query  p@1 ${round(lexicalQueries.atOne)}  ` +
      `p@3 ${round(lexicalQueries.atThree)}  ` +
      `no-signal rows ${lexicalQueries.flat}/${QUERIES.length}`
  );
  info(
    `##### EMBED lexical query→title  p@1 ${round(lexicalTitles.atOne)}  ` +
      `p@3 ${round(lexicalTitles.atThree)}  ` +
      `no-signal rows ${lexicalTitles.flat}/${QUERIES.length}`
  );
  reportPairs("lexical q→q", pairs(QUERIES, lexicalQuery));
  reportPairs("lexical q→t", pairs(QUERIES, lexicalTitle, TITLES));

  for (const dimensions of [256, 512]) {
    const label = `static/d${dimensions}`;
    const vectors = await embedCorpus(dimensions);
    if (!vectors) {
      continue;
    }

    const queryToQuery = (i, j) =>
      cosine(vectors.queries[i], vectors.queries[j]);
    const queryToTitle = (i, j) =>
      cosine(vectors.queries[i], vectors.titles[j]);

    const queries = score(QUERIES, QUERIES, queryToQuery, true);
    const titles = score(QUERIES, TITLES, queryToTitle, false);
    info(
      `##### EMBED ${label} query→query  p@1 ${round(queries.atOne)}  ` +
        `p@3 ${round(queries.atThree)}`
    );
    info(
      `##### EMBED ${label} query→title  p@1 ${round(titles.atOne)}  ` +
        `p@3 ${round(titles.atThree)}`
    );
    reportPairs(`${label} q→q`, pairs(QUERIES, queryToQuery));
    // The distribution the `related` tier actually thresholds on.
    reportPairs(`${label} q→t`, pairs(QUERIES, queryToTitle, TITLES));

    // Named so a regression says which enquiry stopped working rather than
    // only that the mean fell.
    for (const { task } of CORPUS) {
      const rows = QUERIES.map((entry, index) => ({ entry, index })).filter(
        item => item.entry.task === task
      );
      const hits = rows.filter(item => {
        let bestIndex = -1;
        let bestValue = -Infinity;
        for (let j = 0; j < QUERIES.length; j++) {
          if (j === item.index) {
            continue;
          }
          const value = queryToQuery(item.index, j);
          if (value > bestValue) {
            bestValue = value;
            bestIndex = j;
          }
        }
        return QUERIES[bestIndex].task === task;
      });
      info(
        `##### EMBED ${label} task ${task}: ${hits.length}/${rows.length} ` +
          `nearest neighbours stayed in task`
      );
    }

    // The merge question, over aggregates rather than over pairs. Reported at
    // both dimensions like everything else here, but only d256 can decide
    // anything: it is what the fork ships and what the offer would run on.
    for (const [name, combine] of Object.entries(AGGREGATIONS)) {
      const aggregate = (i, j) => {
        const values = [];
        for (const a of HALVES[i].queries) {
          for (const b of HALVES[j].queries) {
            values.push(cosine(vectors.queries[a], vectors.queries[b]));
          }
        }
        return combine(values);
      };
      const distribution = pairs(HALVES, aggregate);
      reportPairs(`${label} merge/${name}`, distribution);
      reportPrecisionFirst(`${label} merge/${name}`, distribution, 1);
    }

    const centroids = HALVES.map(half =>
      centroid(half.queries, vectors.queries)
    );
    const byCentroid = pairs(HALVES, (i, j) =>
      cosine(centroids[i], centroids[j])
    );
    reportPairs(`${label} merge/centroid`, byCentroid);
    reportPrecisionFirst(`${label} merge/centroid`, byCentroid, 1);

    // Does the rule's threshold survive a bigger context?
    //
    // Every context above holds two queries, and a real one holds more. `max`
    // is the order statistic of the pairs compared, so it must climb as the
    // number of pairs grows whether or not the contexts are any more alike;
    // `centroid` compares one vector to one vector however many queries went
    // into each. Whether that difference is big enough to matter is not
    // something to reason about, so it is measured: the same rules over whole
    // enquiries (4 queries, 16 pairs) against halves (2 queries, 4 pairs),
    // reading only the different-task side, which is the side a threshold
    // chosen for precision is holding back.
    for (const [name, combine] of Object.entries(AGGREGATIONS)) {
      const at = items => {
        const values = [];
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            if (items[i].task === items[j].task) {
              continue;
            }
            const cells = [];
            for (const a of items[i].queries) {
              for (const b of items[j].queries) {
                cells.push(cosine(vectors.queries[a], vectors.queries[b]));
              }
            }
            values.push(combine(cells));
          }
        }
        return values;
      };
      const small = at(HALVES);
      const large = at(WHOLES);
      info(
        `##### EMBED ${label} size ${name} diff-task ` +
          `k=2 median ${round(median(small))} p95 ${round(percentile(small, 0.95))} max ${round(Math.max(...small))} | ` +
          `k=4 median ${round(median(large))} p95 ${round(percentile(large, 0.95))} max ${round(Math.max(...large))}`
      );
    }
    {
      const centroidsWhole = WHOLES.map(whole =>
        centroid(whole.queries, vectors.queries)
      );
      const at = (items, vecs) => {
        const values = [];
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            if (items[i].task !== items[j].task) {
              values.push(cosine(vecs[i], vecs[j]));
            }
          }
        }
        return values;
      };
      const small = at(HALVES, centroids);
      const large = at(WHOLES, centroidsWhole);
      info(
        `##### EMBED ${label} size centroid diff-task ` +
          `k=2 median ${round(median(small))} p95 ${round(percentile(small, 0.95))} max ${round(Math.max(...small))} | ` +
          `k=4 median ${round(median(large))} p95 ${round(percentile(large, 0.95))} max ${round(Math.max(...large))}`
      );
    }

    ok(true, `${label} scored the corpus`);
  }
});
