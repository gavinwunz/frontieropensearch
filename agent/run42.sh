#!/bin/bash
set -o pipefail
cd /data/frontieropensearch
source agent/env.sh 2>/dev/null
./mach test browser/components/fos/tests/browser/browser_field.js \
            browser/components/fos/tests/browser/browser_contextengine.js
