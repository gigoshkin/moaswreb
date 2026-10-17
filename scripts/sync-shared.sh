#!/usr/bin/env bash
# Keeps every Claude session up to date with the shared notes on main.
# Meant to run as a Claude Code hook (see .claude/settings.json):
#   sync-shared.sh start   SessionStart: always checks.
#   sync-shared.sh prompt  UserPromptSubmit: checks at most every 5 minutes.
# Prints new inbox notes and requests (full text) and changed knowledge-base
# files since this clone last showed them. Claude Code adds stdout to the
# session's context. Never fails the session: every error exits 0.

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
gitdir=$(git rev-parse --git-dir)
seen="$gitdir/claude-last-seen"
fetched="$gitdir/claude-last-fetch"

now=$(date +%s)
if [ "$1" = prompt ]; then
  last=$(cat "$fetched" 2>/dev/null || echo 0)
  [ $((now - last)) -lt 300 ] && exit 0
fi
echo "$now" > "$fetched"

git fetch -q origin main 2>/dev/null || exit 0
head=$(git rev-parse origin/main)
base=$(cat "$seen" 2>/dev/null)
if [ -z "$base" ] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  # First run in this clone: show the last 3 days.
  base=$(git rev-list -1 --before="3 days ago" origin/main 2>/dev/null)
  [ -z "$base" ] && base=$(git rev-list --max-parents=0 origin/main | tail -1)
fi

# On a clean main, fast-forward so the files on disk match.
if [ "$(git branch --show-current)" = main ] && [ -z "$(git status --porcelain)" ]; then
  git merge -q --ff-only origin/main 2>/dev/null
fi

notes=$(git diff --name-only --diff-filter=AM "$base" "$head" -- inbox requests | grep -v 'TEMPLATE.md$')
kb=$(git diff --name-only --diff-filter=AMD "$base" "$head" -- knowledge-base CLAUDE.md .claude)
pending=$(git grep -l "status: pending" "$head" -- requests | sed "s|^$head:||" | grep -v 'TEMPLATE.md$')

if [ -n "$notes$kb$pending" ]; then
  echo "=== Shared repo updates (origin/main) ==="
  echo "Tell your human about these before other work: what changed, what is asked of them, and any pending request addressed to them."
  for f in $notes; do
    echo; echo "----- $f -----"
    git show "$head:$f" 2>/dev/null | head -150
  done
  if [ -n "$kb" ]; then
    echo; echo "Changed rules / knowledge base (read the ones that touch your work):"
    echo "$kb" | sed 's/^/  - /'
  fi
  if [ -n "$pending" ]; then
    echo; echo "Requests still pending (check the to: line):"
    for f in $pending; do
      echo "  - $f ($(git show "$head:$f" | grep -m1 '^to:'))"
    done
  fi
  if [ "$(git branch --show-current)" != main ] && ! git merge-base --is-ancestor "$head" HEAD; then
    echo; echo "Your branch is behind main: merge or rebase origin/main before pushing."
  fi
fi
echo "$head" > "$seen"
exit 0
