#!/bin/bash
# The files this run's work is in, plus the two that share the window before
# them alphabetically — which is what reproduced the exclusion bug when the
# sidebar file alone did not.
set -o pipefail
cd /data/frontieropensearch
source agent/env.sh 2>/dev/null
./mach test browser/components/fos/tests/browser/browser_commandbar.js \
            browser/components/fos/tests/browser/browser_contextengine.js \
            browser/components/fos/tests/browser/browser_contextsidebar.js
