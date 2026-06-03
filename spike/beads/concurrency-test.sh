#!/usr/bin/env bash
#
# RLF-213 spike — two worktrees sharing one main-repo .beads/.
#
# Throwaway harness (spike scope). Proves the operational model behind a future
# BeadsChangeStore: a git worktree resolves to the main repo's shared bd store,
# concurrent `bd ready --claim` is race-safe (no double-claim, no JSONL
# corruption), and characterises the embedded-Dolt single-writer lock that makes
# bd return empty output silently under write contention.
#
# Requires: bd 1.0.5+ (`brew install beads`), python3. Findings transcript lives
# in ../../openspec/changes/rlf-213-.../design.md under "Concurrency".
#
# Usage: bash spike/beads/concurrency-test.sh
set -uo pipefail

ROOT=/tmp/bd-concurrency
MAIN=$ROOT/main
WT1=$ROOT/wt1

jid() { python3 -c 'import sys,json;r=sys.stdin.read().strip();print(json.loads(r)["id"] if r else "")'; }

echo "== setup: main repo + bd init =="
rm -rf "$ROOT"; mkdir -p "$MAIN"; cd "$MAIN"
git init -q
git config user.email spike@example.com
git config user.name "Spike Runner"
bd init --quiet >/dev/null 2>&1
git add AGENTS.md >/dev/null 2>&1 || true
git commit -q -m init --no-verify >/dev/null 2>&1 || true

echo "== epic + 4 independently-ready children =="
EPIC=$(bd create "Change: concurrency-demo" -t epic --json 2>/dev/null | jid)
for n in 1 2 3 4; do
  ID=$(bd create "Mission task $n" -t task --json 2>/dev/null | jid)
  [ -n "$ID" ] && bd dep add "$ID" "$EPIC" -t parent-child >/dev/null 2>&1
done

echo "== add worktree; confirm it resolves to MAIN's shared .beads/ (no daemon) =="
git worktree add -q "$WT1" -b wt1 >/dev/null 2>&1
echo "  daemon procs: $(pgrep -fl 'dolt sql-server|beads' | wc -l | tr -d ' ') (expect 0)"
echo "  main where: $(bd -C "$MAIN" where 2>/dev/null | grep -i database)"
echo "  wt1  where: $(bd -C "$WT1"  where 2>/dev/null | grep -i database)  <- same store"

echo "== TEST 1: two worktrees, 4 ready, simultaneous claim -> 2 DISTINCT tasks =="
( bd -C "$MAIN" ready --claim --exclude-type=epic --limit 1 --json >"$ROOT/c1" 2>/dev/null ) &
( bd -C "$WT1"  ready --claim --exclude-type=epic --limit 1 --json >"$ROOT/c2" 2>/dev/null ) &
wait
python3 - "$ROOT/c1" "$ROOT/c2" <<'PY'
import sys,json
def one(f):
    r=open(f).read().strip(); d=json.loads(r) if r else []
    d=d if isinstance(d,list) else [d]
    return d[0]["id"] if d else "(empty)"
a,b=one(sys.argv[1]),one(sys.argv[2])
print(f"  main={a}  wt1={b}  -> {'DISTINCT, no double-claim' if a!=b else 'DOUBLE-CLAIM!!'}")
PY

echo "== TEST 2: exactly ONE ready, two claimers -> one winner + clean empty =="
# Drain any leftover ready tasks from Test 1 so only the contested one is ready.
while :; do
  N=$(bd ready --exclude-type=epic --limit 1 --json 2>/dev/null | python3 -c 'import sys,json;r=sys.stdin.read().strip();print(len(json.loads(r)) if r else 0)')
  [ "$N" = "0" ] && break
  bd ready --claim --exclude-type=epic --limit 1 --json >/dev/null 2>&1
done
ONE=$(bd create "Single contested task" -t task --json 2>/dev/null | jid)
[ -n "$ONE" ] && bd dep add "$ONE" "$EPIC" -t parent-child >/dev/null 2>&1
( bd -C "$MAIN" ready --claim --exclude-type=epic --limit 1 --json >"$ROOT/d1" 2>/dev/null ) &
( bd -C "$WT1"  ready --claim --exclude-type=epic --limit 1 --json >"$ROOT/d2" 2>/dev/null ) &
wait
python3 - "$ROOT/d1" "$ROOT/d2" <<'PY'
import sys,json
def s(f):
    r=open(f).read().strip(); d=json.loads(r) if r else []
    d=d if isinstance(d,list) else [d]
    return d[0]["id"] if d else "[] (no claim)"
print(f"  main={s(sys.argv[1])}  wt1={s(sys.argv[2])}  -> exactly one winner expected")
PY

echo "== integrity: no duplicate ids, JSONL export valid =="
bd list --json 2>/dev/null | python3 -c 'import sys,json;d=json.load(sys.stdin);ids=[x["id"] for x in d];print("  issues:",len(d)," dup ids:",[i for i in set(ids) if ids.count(i)>1] or "NONE")'
bd export --output "$ROOT/final.jsonl" >/dev/null 2>&1
python3 -c 'import json,sys;ok=bad=0
for ln in open(sys.argv[1]):
    ln=ln.strip()
    if not ln: continue
    try: json.loads(ln); ok+=1
    except: bad+=1
print(f"  JSONL: {ok} valid, {bad} malformed")' "$ROOT/final.jsonl"

echo "== embedded-Dolt single-writer lock (cause of silent-empty under contention) =="
find "$MAIN/.beads/embeddeddolt" -iname '*lock*' 2>/dev/null | sed 's/^/  /'
echo "  NOTE: bursts of rapid bd writes make losers return empty stdout (exit 0)."
echo "        A BeadsChangeStore MUST retry on empty and disambiguate empty-ready"
echo "        from done via 'bd list --status open --parent <epic>'."
