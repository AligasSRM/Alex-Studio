#!/usr/bin/env bash
set -euo pipefail

output="${1:-Alex-Studio-Phase-2-Source.zip}"
if [[ "$output" != /* ]]; then
  output="$PWD/$output"
fi

# A source bundle must never silently package sensitive tracked files.
tracked_paths="$(git ls-files)"
if printf '%s\n' "$tracked_paths" | grep -Eiq '(^|/)(\.env([^/]*)?|credentials[^/]*|secrets?[^/]*|id_rsa[^/]*|id_ed25519[^/]*)(/|$)|\.(pem|key|p12|pfx)$'; then
  echo "::error::Refusing to create source archive: a sensitive-looking file is tracked by Git."
  printf '%s\n' "$tracked_paths" | grep -Ei '(^|/)(\.env([^/]*)?|credentials[^/]*|secrets?[^/]*|id_rsa[^/]*|id_ed25519[^/]*)(/|$)|\.(pem|key|p12|pfx)$' || true
  exit 1
fi

mkdir -p "$(dirname "$output")"
rm -f "$output"
git archive --format=zip --output="$output" HEAD -- . ':(exclude)workspace/**'

unzip -tq "$output"
if unzip -Z1 "$output" | grep -Eiq '(^|/)(\.git|\.next|node_modules|workspace|\.alex)(/|$)|(^|/)\.env([^/]*)?$|\.(pem|key|p12|pfx)$'; then
  echo "::error::Source archive contains a forbidden path."
  exit 1
fi

echo "Created and validated source archive: $output"
