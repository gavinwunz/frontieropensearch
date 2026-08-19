/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Text to vectors, for the one tier of the command bar that needs them.
 *
 * `FOSSuggest`'s `related` tier is pure and takes similarities it is given.
 * This is the half that cannot be pure: it owns the ML engine, its lifetime,
 * and what happens on a machine that does not have the weights.
 *
 * WHY STATIC EMBEDDINGS, AT 256 DIMENSIONS
 *
 * Measured, not assumed — `browser_zzembedquality.js`, run by
 * `agent/jobs/run36.sh`. `potion-retrieval-32M` beat the lexical control this
 * fork already ships on every probe (query→title p@1 0.938 against 0.750), and
 * its two published dimensions were indistinguishable on that corpus while the
 * download is 30MB against 60MB. Where the evidence is a tie, the smaller one
 * wins. `IDEAS.md` run 36 carries the table.
 *
 * The model is a **lookup table**, not a transformer: an embedding is a sum of
 * token rows and a normalisation, which is why one is 1.27ms and all 32
 * queries of that corpus were 3.1ms. Two design decisions fall out of that
 * number, and both are the reason this module is as small as it is.
 *
 *   - **Nothing is persisted.** There is no vector column, no migration and no
 *     staleness rule, because embedding a candidate on demand is cheaper than
 *     the read that would avoid it. The Context Engine's schema does not move
 *     for this feature.
 *   - **The cache is a convenience, not a store.** Titles repeat across
 *     keystrokes, so a bounded in-memory map means a second keystroke embeds
 *     only the query. It is dropped whole at shutdown and is never written
 *     anywhere.
 *
 * WHY A PREF GUARDS THE LOAD
 *
 * `createEngine` fetches the weights if it does not have them, so on an
 * ordinary machine the first keystroke into the command bar would have sent a
 * ~30MB request to Mozilla's model hub that nobody asked for. This fork
 * disables app update and telemetry precisely so that it never contacts
 * Mozilla behind the user's back, and a suggestion tier quietly downloading a
 * model is the same thing wearing a different hat.
 *
 * So `browser.fos.suggest.semanticTier` is consent rather than a feature flag,
 * and it is off by default. Nothing here turns it on; the surfaced "download
 * the search model" step belongs on a command the user runs, and that is the
 * piece still to build.
 *
 * WHAT HAPPENS WITHOUT THE WEIGHTS
 *
 * `embed` returns null and the `related` tier is simply absent from the list.
 *
 * That is a deliberate difference from the voice path, which refuses to fail
 * quietly: pressing a key and getting nothing is a broken promise, so the
 * microphone surfaces its download. A suggestion tier promises nothing — the
 * bar has five other tiers and the user did not ask for this one by name — so
 * fewer suggestions is a degradation, not a failure.
 *
 * The engine is **process-wide** rather than per-window, unlike every other
 * FOS component. The ML engine already lives in its own process and costs
 * ~0.5s to load; three windows must not pay it three times.
 */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  createEngine: "chrome://global/content/ml/EngineProcess.sys.mjs",
});

/** The user's consent to a one-time model download. See the file comment. */
const PREF_ENABLED = "browser.fos.suggest.semanticTier";

XPCOMUtils.defineLazyPreferenceGetter(lazy, "enabled", PREF_ENABLED, false);

/**
 * The engine configuration, which is `EmbeddingsGenerator`'s static entry with
 * the dimension this fork chose.
 *
 * `modelHub: "mozilla"` is deliberately not used: that setter overwrites the
 * root URL and resets the revision, which breaks the local-hub harness the
 * measurement runs under. The two fields it would have set are set directly.
 */
const ENGINE_OPTIONS = Object.freeze({
  featureId: "simple-text-embedder",
  engineId: "fos-related",
  taskName: "static-embeddings",
  backend: "static-embeddings",
  modelId: "mozilla/static-embeddings",
  modelRevision: "v1.0.0",
  modelHubUrlTemplate: "{model}/{revision}",
  timeoutMS: -1,
});

/** The weights, and the shape the backend loads them in. */
const STATIC_OPTIONS = Object.freeze({
  subfolder: "models/minishlab/potion-retrieval-32M",
  dtype: "fp16",
  dimensions: 256,
  compression: true,
});

/**
 * How many texts to keep vectors for.
 *
 * Sized against what one keystroke asks for: the bar reads at most twenty
 * Places rows plus a context, a trail and its crossings, so a few hundred
 * entries covers a whole session of typing without the map becoming a thing
 * that needs managing. At 256 fp32 values an entry is 1KB.
 */
const CACHE_LIMIT = 512;

/**
 * Vectors for text, from a model that may not be here.
 *
 * @see FOSSuggest for what is done with them.
 */
export const FOSEmbeddings = {
  /** @type {?object} The engine, once one has loaded. */
  _engine: null,

  /** @type {?Promise<?object>} The in-flight load, so it is only tried once. */
  _loading: null,

  /**
   * Whether a load has already failed. A machine without the weights must not
   * retry the fetch on every keystroke.
   *
   * @type {boolean}
   */
  _unavailable: false,

  /** @type {Map<string, Float32Array>} */
  _cache: new Map(),

  /**
   * The model hub to read from.
   *
   * `MOZ_MODELS_HUB` is what the tree's own local-hub harness exports, and
   * reading it here is what lets the measurement and the browser test run
   * against weights on disk. Unset — which is every ordinary launch — leaves
   * the option out entirely, so the engine uses its configured default.
   *
   * @returns {?string}
   */
  get _hubRoot() {
    return Services.env.get("MOZ_MODELS_HUB") || null;
  },

  /**
   * Load the engine, or report that this machine cannot.
   *
   * @returns {Promise<?object>} The engine, or null.
   */
  async ensure() {
    if (this._engine) {
      return this._engine;
    }
    // Checked on every call rather than cached as unavailable: the pref is
    // what a future "download the search model" command will flip, and the
    // tier should start working when it does rather than at the next restart.
    if (!lazy.enabled) {
      return null;
    }
    if (this._unavailable) {
      return null;
    }
    if (!this._loading) {
      const options = {
        ...ENGINE_OPTIONS,
        staticEmbeddingsOptions: { ...STATIC_OPTIONS },
      };
      const hub = this._hubRoot;
      if (hub) {
        options.modelHubRootUrl = hub;
      }
      this._loading = lazy
        .createEngine(options)
        .then(engine => {
          this._engine = engine;
          return engine;
        })
        .catch(error => {
          // Not console.error: a missing optional model is the expected state
          // on a machine that has never downloaded it, and the tier's absence
          // is the whole report.
          console.warn(`FOS: no embedding engine, related tier off — ${error}`);
          this._unavailable = true;
          return null;
        })
        .finally(() => {
          this._loading = null;
        });
    }
    return this._loading;
  },

  /**
   * Vectors for texts, in the order given.
   *
   * @param {string[]} texts
   * @returns {Promise<?Float32Array[]>} One vector per text, or null when this
   *   machine has no engine. A text that is empty gets a zero vector rather
   *   than a hole, so the caller's indexes line up.
   */
  async embed(texts) {
    const wanted = (texts ?? []).map(text => String(text ?? "").trim());
    if (!wanted.length) {
      return [];
    }

    const missing = [...new Set(wanted.filter(t => t && !this._cache.has(t)))];
    if (missing.length) {
      const engine = await this.ensure();
      if (!engine) {
        return null;
      }
      const { output } = await engine.run({
        args: missing,
        options: { pooling: "mean", normalize: true },
      });
      missing.forEach((text, index) => this._remember(text, output[index]));
    } else if (this._unavailable) {
      // Every text was cached, but a caller must not be told the engine works
      // when it does not: the next uncached text would return null.
      return null;
    }

    return wanted.map(
      text =>
        this._cache.get(text) ?? new Float32Array(STATIC_OPTIONS.dimensions)
    );
  },

  /**
   * @param {string} text
   * @param {Float32Array} vector
   */
  _remember(text, vector) {
    if (!vector) {
      return;
    }
    // Insertion-ordered eviction: a Map iterates oldest first, so the first
    // key is the least recently *added*. Not an LRU, deliberately — tracking
    // reads would cost more than re-embedding a title for 1.27ms.
    if (this._cache.size >= CACHE_LIMIT) {
      this._cache.delete(this._cache.keys().next().value);
    }
    this._cache.set(text, vector);
  },

  /**
   * Drop the engine and everything derived from it.
   *
   * Nothing in the browser calls this, and that is deliberate rather than an
   * omission: the engine lives in a process Gecko already tears down at
   * shutdown, exactly as the Context Engine's store is never explicitly
   * closed. It exists so a test can start from nothing — which for this module
   * includes starting from "the weights were missing last time".
   *
   * @returns {Promise<void>}
   */
  async shutdown() {
    const engine = this._engine;
    this._engine = null;
    this._loading = null;
    this._unavailable = false;
    this._cache = new Map();
    if (engine) {
      await engine.terminate().catch(console.error);
    }
  },
};
