#!/usr/bin/env bash
set -euo pipefail

output="${1:-Alex-Studio-Phase-2-Source.zip}"
if [[ "$output" != /* ]]; then
  output="$PWD/$output"
fi

# Match credential/config filenames, not source code containing the word secret.
sensitive_name_pattern='(^|/)(\.env([^/]*)?|credentials(\.[^/]*)?|secrets?(\.[^/]*)?|id_rsa(\.[^/]*)?|id_ed25519(\.[^/]*)?)(/|$)|\.(pem|key|p12|pfx)$'
tracked_paths="$(git ls-files)"
if printf '%s\n' "$tracked_paths" | grep -Eiq "$sensitive_name_pattern"; then
  echo "::error::Refusing to create source archive: a sensitive-looking file is tracked by Git."
  printf '%s\n' "$tracked_paths" | grep -Ei "$sensitive_name_pattern" || true
  exit 1
fi

mkdir -p "$(dirname "$output")"
rm -f "$output"
git archive --format=zip --output="$output" HEAD -- . ':(exclude)workspace/**'

unzip -tq "$output"
# Validate the actual ZIP entries as well as tracked Git filenames.
archive_paths="$(unzip -Z1 "$output")"
if printf '%s\n' "$archive_paths" | grep -Eiq '(^|/)(\.git|\.next|node_modules|workspace|\.alex)(/|$)|(^|/)\.env([^/]*)?$|\.(pem|key|p12|pfx)$'; then
  echo "::error::Source archive contains a forbidden path."
  exit 1
fi
if printf '%s\n' "$archive_paths" | grep -Eiq "$sensitive_name_pattern"; then
  echo "::error::Source archive contains a credential/config filename."
  exit 1
fi

# Scan extracted text content, not only filenames, before accepting the archive.
node scripts/scan-source-archive-secrets.mjs "$output"

echo "Created and validated source archive: $output"
