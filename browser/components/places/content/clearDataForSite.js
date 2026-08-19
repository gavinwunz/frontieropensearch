/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  ForgetAboutSite:
    "moz-src:///toolkit/components/forgetaboutsite/ForgetAboutSite.sys.mjs",
});

// Not lazy: this dialog previews as soon as it opens, so the getter would be
// read on the next line and never save anything.
const { FOSForgetPreview } = ChromeUtils.importESModule(
  "resource:///modules/FOSForgetPreview.sys.mjs"
);

let retVals = window.arguments[0];
const { onAccept, onCancel } = retVals;

document.l10n.setArgs(document.getElementById("clear-data-for-site-list"), {
  site: retVals.hostOrBaseDomain,
});

// Frontier OpenSearch: forgetting a site takes pages out of the middle of
// trails that are mostly about other sites, and can take a whole research
// context with them. `retVals.host` rather than `hostOrBaseDomain` because
// that is the value `removeDataFromBaseDomain` below is given, and the preview
// has to describe the delete the accept button runs.
FOSForgetPreview.showForSite(
  document.getElementById("fosForgetPreview"),
  retVals.host
);

document.addEventListener("dialogaccept", e => {
  e.preventDefault();
  lazy.ForgetAboutSite.removeDataFromBaseDomain(retVals.host).catch(
    console.error
  );
  window.close();
  if (typeof onAccept === "function") {
    onAccept();
  }
});

document.addEventListener("dialogcancel", e => {
  e.preventDefault();
  window.close();
  if (typeof onCancel === "function") {
    onCancel();
  }
});
