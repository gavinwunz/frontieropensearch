-- This Source Code Form is subject to the terms of the Mozilla Public
-- License, v. 2.0. If a copy of the MPL was not distributed with this
-- file, You can obtain one at http://mozilla.org/MPL/2.0/.
--
-- Context Engine, schema version 2. See context-engine/SCHEMA.md.
--
-- A migration is never edited once it has shipped. Correct it with a new one.
--
-- Statements are separated by a line containing only `--@`.

-- An accepted merge offer: this context is the same enquiry as another one,
-- and the user said so.
--
-- STATE planned to record this in `context_member.source` as `manual`, and
-- that does not work. `contextsForTrails` — the query that decides which
-- context a trail is in, and therefore which one is active — filters on
-- `source = 'provenance'` by construction, so membership rows written with any
-- other source change what a context *contains* without changing what a trail
-- *is*. A merge recorded that way would leave the two trails still resolving
-- to two different contexts, each seeing the other's material one-way. Wrong
-- in a way that reads as working, because the sidebar would show the union.
--
-- So a merge is a fact about contexts, not about membership. That keeps every
-- provenance row exactly as it was written: "why is this page in this context"
-- still answers "provenance, on its trail", and the merge is a second, visible
-- statement layered over it rather than a rewrite of the first. Nothing is
-- deleted and nothing is re-pointed, which is what makes an accepted offer
-- undoable later without having to reconstruct what provenance had said.
--
-- Invariant, enforced in `mergeContexts`: `merged_into` never names a context
-- that is itself merged. Merging into a merged context follows the chain to
-- its root instead, so resolution is always one hop and a cycle cannot form.
ALTER TABLE context ADD COLUMN merged_into INTEGER REFERENCES context(id)
--@
-- Resolution reads this on every hydrate, and the column is null for all but
-- the few contexts a user has ever merged.
CREATE INDEX context_merged_into ON context(merged_into) WHERE merged_into IS NOT NULL
--@
-- An offer the user turned down, so it is not made again.
--
-- Horvitz's seventh principle is to minimise the cost of a poor guess, and for
-- an offer that means a rejection has to stick: an offer that returns after
-- being declined is worse than one never made, because the second showing
-- proves the first was not listened to. Keyed both ways round, since "these
-- two are not the same enquiry" is a symmetric statement.
CREATE TABLE context_merge_declined (
  low_id      INTEGER NOT NULL REFERENCES context(id),
  high_id     INTEGER NOT NULL REFERENCES context(id),
  declined_at INTEGER NOT NULL,
  PRIMARY KEY (low_id, high_id)
)
