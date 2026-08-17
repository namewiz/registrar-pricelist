#!/usr/bin/env bash
# Blocks the commit when unit test line coverage drops by more than 5
# percentage points versus the baseline recorded in coverage-baseline.txt
# (updated on every commit that passes, or is bypassed). This is the only
# place tests run in the hook chain (see pre-commit) — a single
# coverage-instrumented `bun test --coverage` run doubles as both the
# test-pass gate and the coverage-drop gate. Prints the files whose
# coverage regressed the most. Bypass (strongly discouraged) with a
# `POOR_COVERAGE=<reason>` line in the commit message body.
#
# `git add` here can't land the updated baseline file in the commit
# currently being created — git has already resolved the tree by the time
# commit-msg hooks run. Instead this drops a marker that post-commit picks
# up to fold the baseline into the just-made commit via a scoped amend.
set -euo pipefail

commit_msg_file="$1"
repo_root="$(git rev-parse --show-toplevel)"
baseline_file="$repo_root/coverage-baseline.txt"
[ -f "$baseline_file" ] || : > "$baseline_file"

timeout_cmd=""
if command -v timeout > /dev/null 2>&1; then
  timeout_cmd="timeout 300"
fi

bypass_reason=""
if grep -qE '^POOR_COVERAGE=.+' "$commit_msg_file"; then
  bypass_reason="$(grep -E '^POOR_COVERAGE=.+' "$commit_msg_file" | head -n1 | sed -E 's/^POOR_COVERAGE=//')"
fi

echo "[coverage-check] Running tests with coverage..."
output="$($timeout_cmd npm run test:coverage 2>&1)" || {
  echo "$output"
  echo "[coverage-check] Tests failed, or timed out after 300s; fix the failure before the coverage check can run."
  exit 1
}

table_file="$(mktemp)"
new_baseline_file="$(mktemp)"
cleanup() { rm -f "$table_file" "$new_baseline_file"; }
trap cleanup EXIT

awk '/^-+\|/ { n++; next } n==2 { print }' <<< "$output" > "$table_file"

if ! grep -q "All files" "$table_file"; then
  echo "[coverage-check] Could not parse coverage output; skipping check."
  exit 0
fi

awk_out="$(awk -F'|' -v THRESHOLD=5 -v BASEFILE="$baseline_file" '
FILENAME == BASEFILE {
  eq = index($0, "=")
  if (eq > 0) base[substr($0, 1, eq - 1)] = substr($0, eq + 1) + 0
  next
}
{
  name = $1
  gsub(/^[ \t]+|[ \t]+$/, "", name)
  if (name == "") next
  linepct = $3 + 0
  cur[name] = linepct
  order[++n] = name
}
END {
  overall = cur["All files"]
  baseover = ("__overall__" in base) ? base["__overall__"] : -1

  print "B|__overall__=" overall
  for (i = 1; i <= n; i++) {
    if (order[i] == "All files") continue
    print "B|" order[i] "=" cur[order[i]]
  }

  if (baseover < 0) {
    print "S|STATUS=NEW"
    print "S|MSG=No coverage baseline found; recording " overall "% as the baseline."
    exit
  }

  drop = baseover - overall
  if (drop <= THRESHOLD) {
    print "S|STATUS=OK"
    print "S|MSG=Coverage OK: " overall "% (baseline " baseover "%)."
    exit
  }

  print "S|STATUS=DROP"
  print "S|MSG=Overall line coverage dropped from " baseover "% to " overall "% (-" drop " pts)."
  for (i = 1; i <= n; i++) {
    name = order[i]
    if (name == "All files") continue
    if (!(name in base)) continue
    fdrop = base[name] - cur[name]
    if (fdrop > 0) print "S|FILE=" name " | " base[name] "% -> " cur[name] "% (-" fdrop " pts)"
  }
}
' "$baseline_file" "$table_file")"

grep '^B|' <<< "$awk_out" | sed 's/^B|//' | sort > "$new_baseline_file"
status="$(grep '^S|STATUS=' <<< "$awk_out" | sed 's/^S|STATUS=//')"
msg="$(grep '^S|MSG=' <<< "$awk_out" | sed 's/^S|MSG=//')"

echo "[coverage-check] $msg"

# Only touch the baseline file (and trigger post-commit's amend) when its
# content actually changed, so a coverage-neutral commit doesn't get its
# hash needlessly rewritten.
update_baseline_if_changed() {
  if ! cmp -s "$new_baseline_file" "$baseline_file"; then
    cp "$new_baseline_file" "$baseline_file"
    touch "$repo_root/.git/COVERAGE_BASELINE_PENDING"
  fi
}

if [ "$status" != "DROP" ]; then
  update_baseline_if_changed
  exit 0
fi

echo "[coverage-check] Files that may need more test coverage:"
grep '^S|FILE=' <<< "$awk_out" | sed -E 's/^S\|FILE=/  - /'
echo

if [ -n "$bypass_reason" ]; then
  echo "[coverage-check] Bypassed via POOR_COVERAGE=$bypass_reason. This is strongly discouraged; please add tests soon."
  update_baseline_if_changed
  exit 0
fi

echo "[coverage-check] Blocked: coverage dropped by more than 5 points. Add tests for the files above,"
echo "  or bypass (strongly discouraged) by adding a line 'POOR_COVERAGE=<reason>' to the commit message body."
exit 1
