#!/usr/bin/env bash
# The file edits of the GitHub organisation move from seams-tech to purin-io
# (docs/github-org-move-purin-io.md, steps 11, 12, 14 and the links of step 16), for one
# clean checkout of seams-wallet, seams-monorepo, speak-to-sign, pantry or satyr. Run it
# only after step 8: before the rename, the new names answer 404.
#
#   bash scripts/org-move-purin-io.sh <checkout>
#
# 1. Steps 11, 12 and 14: in the CI, script and image files of that repository, each
#    `seams-tech/` becomes `purin-io/`.
# 2. Step 16: in each tracked text file, each link to `github.com/seams-tech`,
#    `raw.githubusercontent.com/seams-tech` and `ghcr.io/seams-tech` names `purin-io`.
#    History stays: docs/archive, docs/evidence, the checklist, this script, the Plan 91
#    and Plan 92 port scripts of pantry, and the spoken-intent test vectors.
# 3. It prints each line that still names seams-tech, for a review by hand.
#
# It changes files only. It does not commit or push.
set -euo pipefail

checkout=${1:?usage: bash scripts/org-move-purin-io.sh <checkout>}
cd "$checkout"

if [ -n "$(git status --porcelain)" ]; then
  echo "$checkout has uncommitted changes. Use a clean worktree of origin/dev." >&2
  exit 1
fi

repository=$(basename -s .git "$(git remote get-url origin)")
case "$repository" in
  seams-monorepo)
    ci_files=(
      .github/workflows/deploy-production-frontend.yml
      .github/workflows/deploy-staging-frontend.yml
      .github/workflows/release-seams-cli.yml
      .github/workflows/sign-recovery-trust.yml
      deployment/wallet-system/scripts/apply-github-external-values.mjs
      scripts/console-deployment-environment.mjs
      scripts/dispatch-deployment-workflow.mjs
      scripts/prepare-wallet-docs-source.mjs
      tests/e2e/wallet-marketing-seo.e2e.mjs
      docs/wallet-cli-release.md
    )
    ;;
  speak-to-sign)
    ci_files=(
      scripts/npm-trust-standalone.sh
      .github/workflows/release-standalone.yml
      crates/speaker-service/docker-compose.yml
    )
    ;;
  pantry) ci_files=(.github/workflows/pantry.yml) ;;
  satyr) ci_files=(.github/workflows/satyr.yml) ;;
  seams-wallet) ci_files=() ;;
  *)
    echo "Unknown repository: $repository" >&2
    exit 1
    ;;
esac

history=(
  ':!docs/archive'
  ':!docs/evidence'
  ':!docs/github-org-move-purin-io.md'
  ':!scripts/org-move-purin-io.sh'
  ':!scripts/plan-92-port.sh'
  ':!scripts/rename/plan-91-port.sh'
  ':!tests/fixtures/spoken-intent'
  ':!crates/spoken-intent/tests'
)

# macOS has bash 3.2, where an empty array fails under `set -u`; the guards avoid that.
if [ ${#ci_files[@]} -gt 0 ]; then
  for file in "${ci_files[@]}"; do
    if [ ! -f "$file" ]; then
      echo "Missing file of steps 11 to 14: $file. Check the checklist." >&2
      exit 1
    fi
  done
  perl -pi -e 's{seams-tech/}{purin-io/}g' "${ci_files[@]}"
fi

link='(github\.com|githubusercontent\.com|ghcr\.io)/seams-tech'
link_files=()
while IFS= read -r file; do link_files+=("$file"); done < <(
  git grep -l -I -E "${link}([^-[:alnum:]_]|\$)" -- . "${history[@]}" || true
)
if [ ${#link_files[@]} -gt 0 ]; then
  perl -pi -e 's{\b(github\.com|githubusercontent\.com|ghcr\.io)/seams-tech(?![-\w])}{$1/purin-io}g' \
    "${link_files[@]}"
fi

echo "== $repository: ${#ci_files[@]} files of steps 11 to 14, ${#link_files[@]} files with links"
git diff --shortstat
remaining=$(git grep -n -I 'seams-tech' -- . "${history[@]}" || true)
if [ -z "$remaining" ]; then
  echo "No other line names seams-tech."
else
  echo "Lines that still name seams-tech ($(printf '%s\n' "$remaining" | wc -l | tr -d ' ')). Review each one by hand:"
  printf '%s\n' "$remaining"
fi
