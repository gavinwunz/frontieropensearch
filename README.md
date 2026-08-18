# Frontier OpenSearch

A browser built on the idea that research is not a single thread.

An independent fork of Firefox, rebuilt around three ideas that replace the tab
strip, the back button, and the history list.

> **Status: early.** This repository is under active construction. Nothing here
> is stable, and the browser is not yet usable as a daily driver.

## The three pillars

**The Field** replaces the tab strip. Every open page is a live card on an
infinite zoomable canvas, clustered automatically by where it came from. Zoom out
to see everything you have open at once; zoom in and a page fills the window.

**Trails** replace linear history. Navigation is a tree, not a list. Going back
never destroys the branch you came from — it stays visible as a sibling you can
re-enter. Trails are objects: nameable, saveable, exportable.

**The Context Engine** replaces the flat history database. A local store records
what you asked, what answered it, and what you did next, and clusters that into
research contexts. Suggestions rank by the context you are in rather than by
global visit frequency. Any context can be exported as a markdown brief.

Everything is local. There is no account, no sync service, and no telemetry.

## Building

Requires roughly 40GB of free disk and 16GB of RAM.

```bash
git clone https://github.com/gavinwunz/frontieropensearch
cd frontieropensearch
./mach bootstrap        # choose "Firefox for Desktop"
./mach build
./mach run
```

For frontend-only changes, `./mach build faster && ./mach run` takes minutes
rather than hours.

## Licence and attribution

This project is a fork of Mozilla Firefox and is licensed under the
[Mozilla Public License 2.0](LICENSE). All MPL headers in inherited files are
preserved.

Frontier OpenSearch is **not** affiliated with, endorsed by, or sponsored by
Mozilla. Firefox and Mozilla are trademarks of the Mozilla Foundation, used here
only to describe the origin of this code. It is likewise unaffiliated with the
OpenSearch project (opensearch.org), Amazon, Elastic, or the OpenSearch
description format.

## Documentation

| Document | What it covers |
| --- | --- |
| [`design/ARCHITECTURE.md`](design/ARCHITECTURE.md) | How the three pillars fit together — start here |
| [`design/FIELD.md`](design/FIELD.md) | The Field: cards, regions, zoom levels |
| [`design/GRAMMAR.md`](design/GRAMMAR.md) | The command bar, marks, and one parse path for keyboard and voice |
| [`design/SYSTEM.md`](design/SYSTEM.md) | The design system every chrome surface is styled from |
| [`context-engine/SCHEMA.md`](context-engine/SCHEMA.md) | The Context Engine's data layer |

The research log — every interface idea considered, adopted, or rejected, with
reasons — is in `agent/IDEAS.md` and is probably the most interesting file in
the repository.
