#!/usr/bin/env bash
# Decide whether the four real failures in the urlbar suite belong to this fork.
#
# Run 21 pinned browser.fos.commandBar.replacesAddressBar=false in all eighteen
# urlbar manifests and started the whole directory. Run 22 read the log: four
# files fail for reasons that are not the teardown crash and not the missing
# clipboard, and every one of them is short of results rather than slow.
#
#   browser_autoselect.js          1 result where 10 history visits were added
#   browser_excludeResults.js      1 result where 3 were expected
#   browser_resultTypes_display.js "Not enough results" in test_remote_tab_result
#   browser_glean_..._groups.js    the remote_tab group missing from three probes
#
# Three of those four want a *remote* tab, which this fork has no account
# system to produce, so the expected answer for them is "fails with every FOS
# surface off too". browser_autoselect wants ordinary Places history and has no
# such excuse, which is why it is the one worth the run.
#
# Two runs per file, and the pair is the whole point:
#   alone  — the pinned manifest as it stands, one file, no neighbours.
#   fosoff — the same file with all three surface prefs off.
# Same result in both means the fork is not what breaks it.
#
# Waits for fos-job-urlbarall to finish first: mochitest binds 8888 and a
# second harness would only fail to start.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."/..
source agent/env.sh

while systemctl --user is-active --quiet fos-job-urlbarall.service; do
  sleep 60
done
echo "=== urlbarall finished, triage starting $(date -u +%FT%TZ) ==="

FILES="
browser/components/urlbar/tests/browser-results/browser_autoselect.js
browser/components/urlbar/tests/browser-searchMode/browser_excludeResults.js
browser/components/urlbar/tests/browser-UrlbarView/browser_resultTypes_display.js
browser/components/urlbar/tests/browser-engagementTelemetry/browser_glean_telemetry_abandonment_groups.js
"

for f in $FILES; do
  echo "##### ALONE $f"
  ./mach mochitest --keep-open=false "$f"
  echo "##### ALONE EXIT $? $f"

  echo "##### FOSOFF $f"
  ./mach mochitest --keep-open=false \
    --setpref browser.fos.field.replacesTabStrip=false \
    --setpref browser.fos.trailRail.replacesHistorySidebar=false \
    --setpref browser.fos.commandBar.replacesAddressBar=false \
    "$f"
  echo "##### FOSOFF EXIT $? $f"
done
echo "=== triage done $(date -u +%FT%TZ) ==="
