#!/usr/bin/env bash
set -euo pipefail
find . -name '*.sh' -not -path '*/node_modules/*' -not -path '*/.husky/_/*' -print0 | xargs -0 shellcheck
