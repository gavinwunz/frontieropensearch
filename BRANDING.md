# BRANDING.md

The canonical name of this project. The build agent reads this file and must use
these forms exactly. Do not rename the project without editing this file first.

## Name

**Frontier OpenSearch**

| Context | Form |
|---|---|
| Display name, UI, docs, prose | Frontier OpenSearch |
| Short form after first mention | Frontier |
| Repo, package, directory slug | `frontieropensearch` |
| Internal code prefix, CSS namespace | `fos` |
| Binary / executable | `frontieropensearch` |
| Profile directory | `.frontieropensearch` |
| Branding directory | `browser/branding/frontieropensearch/` |
| Frontend components | `browser/components/fos/` |

Never write "FrontierOpenSearch" (no space), "Frontier Open Search" (two spaces),
or "FOS" in user-visible text. `fos` is for code identifiers only.

## Mozilla constants

```
MOZ_APP_BASENAME=FrontierOpenSearch
MOZ_APP_VENDOR=Frontier
MOZ_APP_DISPLAYNAME="Frontier OpenSearch"
MOZ_APP_PROFILE=frontieropensearch
```

## Mark

A geometric wordmark plus a glyph. The glyph is a single stroke that divides into
three, each branch continuing past the point where a linear path would have
ended — the thesis of the browser in one shape. Flat, monoline, no gradients, no
gloss, works legibly at 16px. Generate it as SVG in-repo; no raster source of
truth.

## Voice

Plain and technical. This is a research tool, not a lifestyle product. Describe
what it does, never how it will make anyone feel. No exclamation marks in
product copy.

## What this project is not

Not affiliated with Mozilla or Firefox. Not affiliated with the OpenSearch
project (opensearch.org), Amazon, or Elastic. Not affiliated with the OpenSearch
description format specification. Every distribution surface — README, about
dialog, website — must state that this is an independent fork of Firefox under
MPL 2.0 and carries no endorsement from any of the above.
