/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Branding-specific prefs for Frontier OpenSearch.
//
// The file name is dictated by FirefoxBranding() in
// browser/branding/branding-common.mozbuild, which hardcodes
// "pref/firefox-branding.js". It is a build-internal path and is never
// user-visible, so it is left alone rather than patched upstream.

// Frontier OpenSearch never contacts Mozilla. There is no update service and
// no telemetry endpoint; the update machinery is switched off outright rather
// than pointed somewhere else.
pref("app.update.auto", false);
pref("app.update.background.enabled", false);
pref("app.update.checkInstallTime", false);
pref("app.update.service.enabled", false);
pref("app.update.url.manual", "");
pref("app.update.url.details", "");

pref("startup.homepage_override_url", "");
pref("startup.homepage_welcome_url", "");
pref("startup.homepage_welcome_url.additional", "");

// Number of usages of the web console.
// If this is less than 5, then pasting code into the web console is disabled.
pref("devtools.selfxss.count", 5);
