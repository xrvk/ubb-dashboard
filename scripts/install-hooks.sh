#!/usr/bin/env bash
# Install repo git hooks into .git/hooks/. Safe to re-run.
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
src="$repo_root/scripts/hooks/pre-commit"
hooks_dir=$(git rev-parse --git-path hooks)
dest="$hooks_dir/pre-commit"

mkdir -p "$hooks_dir"
install -m 0755 "$src" "$dest"
echo "Installed $dest"

patterns_file="$(git rev-parse --git-common-dir)/forbidden-patterns"
if [ ! -e "$patterns_file" ]; then
  cat > "$patterns_file" <<'EOF'
# One extended-regex pattern per line. Lines starting with # are ignored.
# This file lives inside the git dir so it is never committed. Add tenant
# slugs, internal hostnames, or other strings you don't want to push.
EOF
  echo "Created $patterns_file (add your patterns to it)"
fi
