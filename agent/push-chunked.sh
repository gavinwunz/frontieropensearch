#!/usr/bin/env bash
# Push agent/dev to origin in chunks.
#
# The fork carries full Firefox history — about 990k commits and 5G. A single
# push of that exceeds GitHub's per-push limit and is rejected outright, so
# history goes up in slices, each one a fast-forward on the last.
#
# Resumable: it finds where origin already is and starts from there, so a
# killed push costs only the chunk in flight. Run it under bg.sh.
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

branch=agent/dev
chunk=${CHUNK:-40000}

# Topological order guarantees every commit is listed after its ancestors, so
# each chunk boundary fast-forwards the previous one.
mapfile -t commits < <(git rev-list --topo-order --reverse HEAD)
total=${#commits[@]}

remote=$(git ls-remote origin "refs/heads/$branch" | cut -f1)
start=0
if [ -n "$remote" ]; then
  for i in "${!commits[@]}"; do
    if [ "${commits[$i]}" = "$remote" ]; then start=$((i + 1)); break; fi
  done
  echo "=== origin at $remote (index $start of $total) ==="
else
  echo "=== origin has no $branch yet ==="
fi

i=$((start + chunk))
while [ "$i" -lt "$total" ]; do
  sha=${commits[$i]}
  echo "=== chunk $i / $total -> $sha ==="
  if ! nice -n 10 git push origin "$sha:refs/heads/$branch"; then
    echo "=== chunk $i rejected, skipping to next ==="
  fi
  i=$((i + chunk))
done

echo "=== final push of HEAD ==="
nice -n 10 git push origin "HEAD:refs/heads/$branch"
echo "PUSH COMPLETE"
