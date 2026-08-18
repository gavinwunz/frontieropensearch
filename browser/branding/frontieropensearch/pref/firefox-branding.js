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

// Telemetry. The build is compiled without MOZ_TELEMETRY_REPORTING, so nothing
// is uploaded, but the collection prefs still default to on and a fresh profile
// reports toolkit.telemetry.enabled=true. Turn the collection itself off so the
// pref state matches what the build actually does.
pref("toolkit.telemetry.enabled", false);
pref("toolkit.telemetry.unified", false);
pref("toolkit.telemetry.archive.enabled", false);
pref("toolkit.telemetry.newProfilePing.enabled", false);
pref("toolkit.telemetry.shutdownPingSender.enabled", false);
pref("toolkit.telemetry.updatePing.enabled", false);
pref("toolkit.telemetry.bhrPing.enabled", false);
pref("toolkit.telemetry.firstShutdownPing.enabled", false);

// Mozilla services. Each of these is a user-visible surface carrying the
// Firefox name and a network path to Mozilla: Relay offers an email mask in the
// password manager, and Firefox Accounts puts a "Sign in" button on the first
// run screen. The fork has no account system, so both are switched off rather
// than rebranded.
pref("signon.firefoxRelay.feature", "disabled");
pref("identity.fxaccounts.enabled", false);

// Mozilla product promotion. The protections report and the settings panes
// advertise Mozilla VPN, Mozilla Monitor and the Firefox mobile apps. Observed
// live in about:preferences on a fresh profile; all three are adverts for
// products this fork has nothing to do with.
pref("browser.vpn_promo.enabled", false);
pref("browser.contentblocking.report.hide_vpn_banner", true);
pref("browser.contentblocking.report.show_mobile_app", false);
