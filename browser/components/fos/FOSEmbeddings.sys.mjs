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
 * and it is off by default. The one thing that turns it on is `download`,
 * which the `model` verb calls — a word the user types or says, whose summary
 * is on screen in the list the bar opens with. **The pref records that the
 * weights are here and wanted, not that a fetch was attempted**, so it is set
 * after the engine loads and never before: a download that failed with the
 * pref already flipped would leave the next session's first keystroke making
 * the unasked request all over again, which is the exact thing being avoided.
 *
 * WHERE THE WEIGHTS COME FROM, AND WHY IT IS NOT HUGGING FACE
 *
 * The voice path fetches `whisper-tiny` from Hugging Face on the argument that
 * this fork should not lean on Firefox's infrastructure for a file it can get
 * from the model's own home. That argument does not survive contact with this
 * model: `Mozilla/static-embeddings` on Hugging Face is the *build* repository
 * — scripts, a README per model, no weights — and the `.npy.zst` tables this
 * backend loads are published only on `model-hub.mozilla.org`. Checked, not
 * assumed: the HF tree at `v1.0.0` carries 29 files and not one of them is a
 * weight.
 *
 * So this download does contact Mozilla, once, and the answer is not to hide
 * it. `download` names the host in the line it puts on screen, alongside the
 * size and the fact that it happens once. A user who does not want that runs
 * a browser with five suggestion tiers instead of six.
 *
 * The size is measured rather than rounded from the model card: 29,836,775
 * bytes of table plus 478,156 of tokeniser, which are the only two files
 * `StaticEmbeddingsPipeline` asks for at `d256`. Hence 30MB.
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
 * Roughly what the user is agreeing to fetch, for the one line that says so.
 *
 * See the file comment for where the number comes from. It is deliberately the
 * total of both files rather than the headline weight table, because the thing
 * being consented to is a transfer and not a model.
 */
const WEIGHTS_MB = 30;

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

  /** @type {boolean} Whether `download` is running, in any window. */
  _downloading: false,

  /** Whether the tier is switched on. */
  get enabled() {
    return lazy.enabled;
  },

  /**
   * Whether a fetch is in flight. Process-wide, like the engine — a second
   * window running the verb must join the account rather than start a second
   * download of the same 30MB.
   */
  get downloading() {
    return this._downloading;
  },

  /**
   * The host the weights would come from, for the line that says so.
   *
   * Read from the effective configuration rather than written out as a string,
   * so the sentence stays true under the local-hub harness — a test that
   * claims "from model-hub.mozilla.org" while fetching from localhost is
   * asserting the wrong thing.
   *
   * @returns {string}
   */
  get hubHost() {
    const root =
      this._hubRoot ||
      Services.prefs.getStringPref("browser.ml.modelHubRootUrl", "");
    try {
      return Services.io.newURI(root).host;
    } catch (error) {
      return "the model hub";
    }
  },

  /** How large the one-time fetch is, in MB. */
  get weightsMB() {
    return WEIGHTS_MB;
  },

  /**
   * Are the weights already in the profile's model cache?
   *
   * Asked of the cache and never of the network, so that the answer on a
   * machine with no connection is "yes" whenever it is true: an offline
   * browser must never need permission from a server to use a model it
   * already has.
   *
   * Two things about `ModelHub.listFiles` have to be right and neither is what
   * the file's own documentation says, which is why this took a real cache to
   * get working rather than a careful read.
   *
   *   - It resolves to `{files, metadata}`, **not** to an array. Its JSDoc
   *     promises an array.
   *   - The cache keys a model by `hostname/organization/name`, so the id this
   *     module configures is only two thirds of the key. The `model` parameter
   *     is documented as `organization/name` in one JSDoc block and as
   *     `hostname/organization/name` in another, thirty lines apart.
   *
   * Both mistakes fail the same way — a check that compiles, runs, and answers
   * "no weights" on a machine holding the weights — and this fork shipped the
   * first of them in the voice path from run 25 to run 38, where it cost a
   * spurious download line on the first press of every session. Nothing but a
   * real load could have caught either; `browser_zzrelated.js` is where that
   * question is asked.
   *
   * @returns {Promise<boolean>}
   */
  async present() {
    try {
      const { ModelHub } = ChromeUtils.importESModule(
        "chrome://global/content/ml/ModelHub.sys.mjs"
      );
      const hub = new ModelHub({
        rootUrl: this._hubRoot || undefined,
        urlTemplate: ENGINE_OPTIONS.modelHubUrlTemplate,
      });
      const { files } = await hub.listFiles({
        taskName: ENGINE_OPTIONS.taskName,
        // The same host the download line names, which is not a coincidence:
        // weights fetched from one hub are a different cache entry from the
        // same weights fetched from another, and both statements are about
        // where this browser's copy came from.
        model: `${this.hubHost}/${ENGINE_OPTIONS.modelId}`,
        revision: ENGINE_OPTIONS.modelRevision,
      });
      return !!files?.length;
    } catch (error) {
      console.error(error);
      return false;
    }
  },

  /**
   * Fetch the weights once, in the open, and switch the tier on.
   *
   * This is the whole of the consent step. Running the verb is the agreement —
   * there is no second prompt, because `GRAMMAR.md` §8 settled that nothing in
   * this grammar needs a confirmation step and a verb whose own summary says
   * what it downloads has already made the disclosure. What the caller owes
   * the user is the running account, which is why `onProgress` is a parameter
   * rather than something this module decides how to show.
   *
   * The pref is set last. See the file comment: it means "the weights are here
   * and wanted", so a failed fetch must leave it alone rather than arm the
   * next session to retry the request unasked.
   *
   * @param {?Function} onProgress Called with a 0-100 number as bytes arrive.
   * @returns {Promise<?object>} The engine, or null if it could not be had.
   */
  async download(onProgress = null) {
    this._downloading = true;
    try {
      // A keystroke may have a load in flight already. It is waited out rather
      // than raced or joined: it holds the same single engine slot this call
      // wants, and — since `ensure` never fetches — it may be about to resolve
      // to null for weights this call is here to go and get.
      if (this._loading) {
        await this._loading;
      }
      if (this._engine) {
        Services.prefs.setBoolPref(PREF_ENABLED, true);
        return this._engine;
      }
      // A load that gave up for want of weights is exactly what this call is
      // here to fix, so the flag that stops keystrokes retrying must not stop
      // this one.
      this._unavailable = false;
      const engine = await (this._loading = this._open(onProgress).finally(
        () => {
          this._loading = null;
        }
      ));
      if (engine) {
        Services.prefs.setBoolPref(PREF_ENABLED, true);
      }
      return engine;
    } finally {
      this._downloading = false;
    }
  },

  /**
   * Load the engine, if the weights are already here.
   *
   * **This path never fetches.** `createEngine` would happily do it — it is
   * the same call `download` makes — and the pref alone is not enough to let
   * it, because a pref set months ago is not consent to a transfer happening
   * now. The case that decides it is the one Chrome was taken apart over in
   * May 2026: it wrote a 4GB model to disk unasked, and the complaint that
   * outlasted the headline was that deleting the file simply got it downloaded
   * again. A user who clears this browser's model cache to reclaim 30MB, with
   * the tier still switched on from last month, would have hit exactly that —
   * the weights back on disk on the next keystroke into the command bar, with
   * no one asked and nothing said. `IDEAS.md` run 38.
   *
   * So the presence check is the gate, `download` is the only method in this
   * module that may transfer anything, and deleting the weights degrades the
   * bar to five tiers until the user runs `model` again.
   *
   * @returns {Promise<?object>} The engine, or null.
   */
  async ensure() {
    if (this._engine) {
      return this._engine;
    }
    // Checked on every call rather than cached as unavailable: the pref is
    // what the `model` verb flips, and the tier should start working when it
    // does rather than at the next restart.
    if (!lazy.enabled) {
      return null;
    }
    if (this._unavailable) {
      return null;
    }
    return (this._loading ??= this._openIfPresent());
  },

  /**
   * @returns {Promise<?object>} The engine, or null if nothing is cached.
   */
  async _openIfPresent() {
    try {
      if (!(await this.present())) {
        // Remembered, so the cache is asked once per session rather than once
        // per first-keystroke-after-a-failure.
        this._unavailable = true;
        return null;
      }
      return await this._open(null);
    } finally {
      this._loading = null;
    }
  },

  /**
   * Create the engine, fetching the weights if they are not here.
   *
   * The one place that talks to the ML runtime, and the one place that can put
   * bytes on the wire. `ensure` reaches it only behind the presence check
   * above; `download` reaches it directly, which is what the verb is for.
   *
   * @param {?Function} onProgress
   * @returns {Promise<?object>}
   */
  _open(onProgress) {
    const options = {
      ...ENGINE_OPTIONS,
      staticEmbeddingsOptions: { ...STATIC_OPTIONS },
    };
    const hub = this._hubRoot;
    if (hub) {
      options.modelHubRootUrl = hub;
    }
    return lazy
      .createEngine(options, onProgress ?? null)
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
      });
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
    this._downloading = false;
    this._cache = new Map();
    if (engine) {
      await engine.terminate().catch(console.error);
    }
  },
};
