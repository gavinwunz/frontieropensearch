# CLAUDE.md

Conventions for Frontier OpenSearch. Read before any commit.

## Commit conventions — strict

**Never add `Co-Authored-By:` lines to commits.** Never add "Generated with
Claude Code", robot emoji, or any AI attribution to commit messages, PR bodies,
tag messages, or code comments. Every commit in this repository is authored by
gavinwunz and nobody else.

Do not use `--author`, `--no-verify`, or `GIT_AUTHOR_*` / `GIT_COMMITTER_*`
overrides. A `commit-msg` hook strips attribution trailers automatically; leave
it in place.

Message style: imperative mood, summary under 72 characters, body only when the
change genuinely needs explaining.

- Good: `Add trail tree serialisation to context store`
- Bad: `Updated some files 🤖 Generated with Claude Code`

## Naming

`BRANDING.md` is the single source of truth for the project name and every slug
derived from it. Read it before creating any file, directory, pref, or
user-visible string. Never invent a variant spelling.

## Build

```bash
./mach build faster && ./mach run     # frontend-only changes — minutes
./mach build                          # full build — hours, background it
./mach test browser/components/fos/   # component tests
```

## Repo rules

- Public repo. No secrets, tokens, home paths, or personal information anywhere
  in the tree or in commit messages.
- Work on `agent/dev`. `main` must always build.
- Firefox is MPL 2.0: keep every MPL header and the LICENSE file intact. Mozilla
  and Firefox trademarks must not appear in user-visible surfaces of the build.
- Agent state lives in `agent/STATE.md`, `agent/IDEAS.md`, and
  `agent/JOURNAL.md`. Read at session start, update at session end.
