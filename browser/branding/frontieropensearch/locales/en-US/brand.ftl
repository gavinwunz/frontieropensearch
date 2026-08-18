# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Frontier OpenSearch brand strings.
##
## Frontier OpenSearch is an independent fork of Firefox under MPL 2.0. It is
## not affiliated with, endorsed by, or sponsored by Mozilla, and no Mozilla or
## Firefox trademark may appear in a user-visible surface of this build.
##
## The short form after first mention is "Frontier". Never "FOS".

-brand-shorter-name = Frontier
-brand-short-name = Frontier
-brand-shortcut-name = Frontier OpenSearch
-brand-full-name = Frontier OpenSearch
# Used where the product name must stay constant across release channels.
-brand-product-name = Frontier OpenSearch
-vendor-short-name = Frontier
trademarkInfo =
    Frontier OpenSearch is an independent fork of Mozilla Firefox, distributed
    under the Mozilla Public License 2.0. It is not affiliated with or endorsed
    by Mozilla, and is unrelated to the OpenSearch project, Amazon, or Elastic.

## About dialog.
##
## Upstream's about dialog credits the Mozilla community and asks for donations
## to the Mozilla Foundation, with the product name itself hyperlinked to
## mozilla.org. None of that is true of this fork, and a user who clicked it
## landed on a Firefox page from a window that must not present itself as
## Firefox. These ids are fork-owned and replace those blocks outright; no
## upstream string is overridden.

fos-about-community =
    { -brand-full-name } is an independent browser built on Gecko, the engine
    behind Firefox, and developed in the open.
fos-about-no-services =
    This build has no telemetry, no update service and no account integration.
    It does not contact Mozilla.
fos-about-source-link = Source code

## about:rights.
##
## Upstream redirects about:rights to Mozilla's Firefox Terms of Use. This fork
## serves a local page instead; these are its strings.

fos-rights-page-title = About Your Rights
fos-rights-heading = About your rights

fos-rights-licence =
    { -brand-full-name } is free software, released under the Mozilla Public
    License 2.0. You may use, copy, modify and redistribute it under that
    licence. The full text ships with this build and is available at
    <a data-l10n-name="licence-link">Licensing Information</a>.

fos-rights-trademark =
    { -brand-full-name } is an independent fork of Mozilla Firefox. It is not
    affiliated with, endorsed by, or sponsored by Mozilla, and it carries none
    of Mozilla's trademarks. Mozilla's Firefox Terms of Use do not govern this
    build; the licence above is the only agreement that applies.

fos-rights-warranty =
    This software is provided without warranty of any kind, to the extent
    permitted by law. You are responsible for how you use it.

fos-rights-services =
    { -brand-short-name } has no telemetry, no update service, no crash
    reporter and no account system. It does not contact Mozilla, and it sends
    no data anywhere except to the sites you choose to visit and the search
    engine you choose to use.

fos-rights-source =
    The complete source, including every change made to Firefox, is at
    <a data-l10n-name="source-link">github.com/gavinwunz/frontieropensearch</a>.
