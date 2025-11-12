#!/usr/bin/env bash
set -euo pipefail
BASE="$1"; OURS="$2"; THEIRS="$3"; OUT="$4"
cat "$BASE" "$OURS" "$THEIRS" 2>/dev/null | awk '!seen[$0]++' > "$OUT"
exit 0
