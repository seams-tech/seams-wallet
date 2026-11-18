# Moving the GitHub organisation from seams-tech to purin-io

Status: 2026-11-18. Checklist only. Nothing is moved. The owner set the date of the
organisation rename to 2026-11-20. The brand rename from Seams to Purin (package names,
product names, domains) is later and separate
([Refactor 251](refactor-251-auth-wallet-checkout-modules.md), D22 and D23). Steps 1, 4 and 6,
and part of step 5, were checked on 2026-11-18. The edits of steps 11, 12, 14 and 16 are in
`scripts/org-move-purin-io.sh`; a dry run passed on 2026-11-18 on `origin/dev` of each
repository. No trademark check
is necessary: the owner removed that condition on 2026-11-18.

This rename changes only the GitHub organisation name. It does not change a repository name, an
npm scope, a domain or a Cloudflare resource.

## What GitHub does

From GitHub's page "Renaming an organization", read on 2026-11-18:

| Redirects | Does not redirect |
| --- | --- |
| Web links to existing repositories, issues, pull requests and files | The organisation page `github.com/seams-tech` (404) |
| Git URLs: clone, fetch and push on the old remote | REST and GraphQL API calls with the old name (404). This includes `gh api repos/seams-tech/...` and `gh ... --repo seams-tech/...` |
| Packages and container images of GitHub Packages move to the new namespace | Team mentions such as `@seams-tech/team` |

- **The old name becomes free.** Anybody can then create an organisation `seams-tech`. A
  repository with the same name in it, such as `seams-tech/seams-wallet`, stops the redirect for
  that repository.
- **Busy repositories are protected.** GitHub retires `OLD-OWNER/REPOSITORY-NAME` permanently
  for a public repository that had more than 100 clones or Actions uses in the week before the
  rename. It does the same for public container images with more than 5,000 downloads. Other
  repositories have no such protection.

## The repositories

| Repository | Visibility | Clones in 7 days | Local clone | Files that name `seams-tech` |
| --- | --- | ---: | --- | ---: |
| `seams-tech/seams-wallet` | public | 1,658 | `~/Dev/rust/seams-wallet` | 70 |
| `seams-tech/seams-monorepo` | public | 811 | `~/Dev/rust/seams-monorepo` | 69 |
| `seams-tech/speak-to-sign` | public | 3,492 | `~/Dev/rust/speak-to-sign` | 20 |
| `seams-tech/pantry` | private | - | `~/Dev/purin-io/pantry` (moved on 2026-11-18) | 84 |
| `seams-tech/pantry-history` | private, archived | - | `~/Dev/lowerarchy/seams-atelier` | - |
| `seams-tech/satyr` | private | - | `~/Dev/lowerarchy/satyr` | 15 |
| `seams-tech/seams-sdk` | private, archived | - | none | - |

Pantry restarted with a new history on 2026-11-18. The old history is `pantry-history`.
Listed with `gh repo list seams-tech` and counted with `gh api .../traffic/clones` and
`git grep -l seams-tech` on 2026-11-18. The organisation has one GitHub package: the public
container image `speaker-service`.

- **The public repositories are protected.** Each has far more than 100 clones in 7 days, so
  GitHub retires its old name at the rename. Its redirect stays, even if somebody takes the
  name `seams-tech`.
- **The private repositories are not protected.** Step 8 protects them.

## Before the rename

1. **List every repository of the organisation**, with `gh repo list seams-tech --limit 200`.
   Mark the public ones. Each one without the protection above loses its redirect if somebody
   takes the old name. Done on 2026-11-18: see the table above.
2. **Ask every session and person to push their work.** An open pull request and a branch stay
   valid. A script or a workflow that is running during the rename can fail.
3. **Hold the releases.** Do not start a release from 2026-11-20 until step 13 passes.
4. **Write down the npm trusted publishers.** Done on 2026-11-18. The `@seams` scope has nine
   packages. The table comes from the provenance of each latest version and from its
   publisher name on the npm registry:

   | Packages | Repository | Workflow | Published by |
   | --- | --- | --- | --- |
   | `@seams/wallet`, `@seams/wallet-server`, `@seams/voiceid` | `seams-tech/seams-wallet` | `release-wallet-packages.yml`, job environment `npm-release` | GitHub Actions (trusted publishing) |
   | `@seams/voice-capture`, `@seams/voice-sign`, `@seams/voice-verdict` | `seams-tech/speak-to-sign` | `release-standalone.yml` (`scripts/npm-trust-standalone.sh` sets it) | GitHub Actions (trusted publishing) |
   | `@seams/wallet-cli` | none | none | A person's npm account, with no provenance (0.29.0, 2026-10-30) |
   | `@seams/speak-to-sign`, `@seams/wallet-voice-sign` | `seams-tech/speak-to-sign` | Old workflows that no longer exist | Deprecated. No new release. |

   - `@seams/wallet-cli` has no trusted publisher, so step 10 does not change it. Its
     `repository.url` changes in step 16. No workflow of seams-monorepo publishes to npm.
   - The registry does not show if a trusted publisher also names the environment
     `npm-release`. Before step 10, the owner runs `npm trust list <package>` for each
     package of the first two rows and writes down the environment.
   - The owner created the npm organisation `purin-io` on 2026-11-18. The registry confirms
     the scope, with no packages yet. The Purin rename publishes under `@purin-io`
     ([Refactor 251](refactor-251-auth-wallet-checkout-modules.md), D23).
   - The GitHub name `purin-io` is still free (`gh api users/purin-io` answered 404 on
     2026-11-18).
5. **List the outside connections to GitHub**: Cloudflare Pages and Workers builds, GitHub Apps,
   deploy keys, webhooks and tokens with a repository list. Most use a numeric ID and keep
   working. Write down each one that shows a repository by name.

   Checked on 2026-11-18 with `gh`: no repository has a webhook or a deploy key. The
   organisation webhooks and the GitHub App installs need the `admin:org_hook` and
   `admin:read` scopes, so the owner checks them in the organisation settings (GitHub Apps,
   Webhooks).

   Cloudflare, from the repositories on 2026-11-18: each Pages and Workers deploy is a direct
   upload with an API token, not a Cloudflare Git connection. seams-monorepo deploys from its
   workflows (`deploy-*-frontend.yml`, `deploy-*-backend.yml`, `scripts/deploy-surface.mjs`).
   pantry and satyr deploy with `wrangler` from the `package.json` scripts of `apps/docs` and
   `apps/storefront`. seams-wallet and speak-to-sign do not deploy to Cloudflare. A direct
   upload does not name the repository, so the rename does not change it. A project that was
   connected to Git in the dashboard does not show in the repositories, so the owner checks
   each project in Workers & Pages, Settings, Build.

   seams-monorepo also has 26 deployment environments. Their secrets belong to the
   repository, so they move with it.
6. **Check the voice merge approvals.** A merge approval binds the SHA-256 of the repository
   name, for example `seams-tech/seams-wallet` (`repo_sha256_hex` in the voice verifier of
   speak-to-sign). After the rename, GitHub reports `purin-io/seams-wallet`, which has another
   hash. Find each place that compares the hash: the merge-approval contract, a merge gate, the
   demo and the test vectors. Decide whether old approvals stay valid.

   Checked on 2026-11-18. No decision is necessary before the rename:
   - The Wallet hashes the repository name that the app gives to `requestMergeApproval`.
     `approve_merge` gets the same name as text.
   - No merge-approval contract and no merge gate exist in seams-wallet, seams-monorepo,
     speak-to-sign, speak-to-sign-notes, pantry or satyr. No app or demo calls
     `requestMergeApproval`. So no approval depends on the old name.
   - A merge gate that is written later must compare the name that GitHub reports at the time
     of the check.
   - The test vectors use `seams-tech/seams-wallet` as a fixed input: speak-to-sign
     `crates/spoken-intent/tests/vectors.rs` and the copy of the vector file in seams-wallet
     `tests/fixtures/spoken-intent`. It is test data, not a live name. Keep it, so that the
     vector file stays the same in both repositories.

## The rename (2026-11-20)

7. **Rename the organisation.** Settings, Danger zone, Rename organization: `purin-io`. Only an
   organisation owner can do it.
8. **Take the old name at once.** Create a new, empty organisation `seams-tech` and keep it.
   Then nobody else can take the name, and every repository redirect stays.

## After the rename

9. **Update each git remote.** In each local clone and each worktree:

   ```bash
   git remote set-url origin https://github.com/purin-io/<repository>.git
   ```

   The owner also plans to move the local clones to `/Users/pta/Dev/purin-io`. Move each
   folder with `mv`. Do not make a fresh clone: Git ignores the build outputs, the linked WASM
   package folders, the Lean `.lake` folders and `output/`, so a fresh clone does not have them.
   After the move, run `git worktree repair` in each clone that has worktrees. The agents'
   memory folders are named by the path of the clone, so move them too.
10. **Update each npm trusted publisher** to `purin-io/<repository>` and the same workflow
    file. Do this for the six packages of step 4 that use trusted publishing. The publish token
    of a workflow names the new organisation, so npm refuses the old setting. npm keeps one
    trusted publisher for each package, so revoke the old one first. The owner runs these
    commands, signed in to npm:

    ```bash
    for p in @seams/wallet @seams/wallet-server @seams/voiceid; do npm trust list "$p"; done
    ```

    ```bash
    npm trust revoke --id <id> <package>
    ```

    ```bash
    for p in @seams/wallet @seams/wallet-server @seams/voiceid; do npm trust github "$p" --file release-wallet-packages.yml --repository purin-io/seams-wallet --env npm-release --allow-publish --yes; done
    ```

    Leave out `--env npm-release` if step 4 found no environment. For speak-to-sign, the
    command of step 12 changes `REPO=` in `scripts/npm-trust-standalone.sh`. Then run that
    script: it revokes the old publisher and adds the new one. At the end, `npm trust list`
    must show `purin-io` for each of the six packages.
11. **Fix the API calls in workflows and scripts.** These fail with 404 until they name
    `purin-io`:
    - seams-monorepo `.github/workflows/release-seams-cli.yml`: `gh api
      "repos/seams-tech/seams-wallet/actions/runs/..."` and `--repo seams-tech/seams-wallet`.
    - seams-monorepo `deployment/wallet-system/scripts/apply-github-external-values.mjs`: the
      `--repo seams-tech/seams-monorepo` commands.
    - seams-monorepo `scripts/console-deployment-environment.mjs` and
      `scripts/dispatch-deployment-workflow.mjs`: the default value of `--repo`.
      `gh workflow run` uses it.
    - seams-monorepo `docs/wallet-cli-release.md`: `gh release create ... --repo
      seams-tech/seams-wallet`.
12. **Fix the cross-repository checkouts.** These workflows check out another repository by
    name: `repository: seams-tech/...`:
    - seams-monorepo `deploy-production-frontend.yml`, `deploy-staging-frontend.yml`,
      `release-seams-cli.yml` and `sign-recovery-trust.yml`.
    - pantry `.github/workflows/pantry.yml`.
    - satyr `.github/workflows/satyr.yml`.

    A checkout can follow the redirect, but do not depend on it. Also check that each token or
    GitHub App of these checkouts has access in `purin-io`.

    `scripts/org-move-purin-io.sh` (in seams-wallet) does the file edits of steps 11, 12, 14
    and the links of step 16 for one repository. It holds the file list of each repository.
    After step 8, make a clean worktree of `origin/dev` in each of seams-wallet,
    seams-monorepo, speak-to-sign, pantry and satyr, and run:

    ```bash
    bash ~/Dev/rust/seams-wallet/scripts/org-move-purin-io.sh <worktree>
    ```

    Change the path of the script if the seams-wallet clone has moved. The script changes
    files only. Review its output, then commit and push in each repository. seams-monorepo
    also changes the name that its docs receipt records (`scripts/prepare-wallet-docs-source.mjs`)
    and the test that checks it.

    Dry run on 2026-11-18, on `origin/dev` of each repository. Each changed line differs from
    the old line only in the organisation name, and no history file changes:

    | Repository | Files of steps 11 to 14 | Files with links | Lines left for review |
    | --- | ---: | ---: | ---: |
    | seams-wallet | 0 | 22 | 22 |
    | seams-monorepo | 10 | 17 | 13 |
    | speak-to-sign | 3 | 15 | 1 |
    | pantry | 1 | 79 | 39 |
    | satyr | 1 | 1 | 10 |

    The lines left for review are text, not links:
    - The repository name as a test input: the merge-approval tests of seams-wallet hash
      `seams-tech/seams-wallet`. Keep them (step 6).
    - The Console OIDC checks in seams-monorepo `automationRoute.ts` and
      `tests/helpers/githubDeploymentOidc.ts`. The owner left them out of this checklist on
      2026-11-18.
    - Plan history, such as Plan 91 in pantry and satyr. Keep it.
    - Current facts in README, SECURITY, AGENTS and comments, for example "the private
      `seams-tech/seams-monorepo` repository". Change these by hand in step 16.
13. **Run one workflow of each kind.** A validation run in each repository, one staging
    deploy, and one dry run of each release workflow. Then the releases of step 3 can start
    again.
14. **Update the container image names.** speak-to-sign
    `crates/speaker-service/docker-compose.yml` names
    `ghcr.io/seams-tech/speaker-service`. The image moves to `ghcr.io/purin-io/...`. Keep the
    pinned digest. Check each other image of step 1.
15. **Update the download URL of the CLI.** `packages/seams-cli/bin/seams-wallet.mjs` downloads
    release files from `github.com/seams-tech/seams-wallet/releases/...`. The redirect covers
    it. The script of step 12 changes the link. It reaches users with the next CLI release.
16. **Update the links in each repository** in one change for each repository. The script of
    step 12 changes every link. The rest is by hand, from the lines that the script prints:
    - the `repository.url` of each `package.json` (the npm page shows it, and npm provenance
      compares it with the repository of the build)
    - README, SECURITY, the docs site (`apps/docs`, its footer) and the badges
    - comments that name `seams-tech/speak-to-sign` or `seams-tech/seams-wallet`
    - the memory files of the agents

    Keep `docs/archive`, `docs/evidence` and earlier release notes unchanged. They are history.
17. **Update the outside links:** the organisation page links on X, LinkedIn and the Seams
    sites, and the connections of step 5 that show a name.
18. **Tell the other sessions** the new remote and the new organisation name.

## Checks

- `git grep -l seams-tech` in each repository finds only history files, and the comments that
  step 16 keeps on purpose.
- A release of each npm package publishes with provenance from `purin-io`.
- `github.com/seams-tech/seams-wallet` redirects to `github.com/purin-io/seams-wallet`.
- `github.com/seams-tech` is the empty organisation of step 8.

## Not in this checklist

- **The brand rename** (Seams to Purin): package names, the npm scope, product names, domains
  and Cloudflare names. See [Refactor 251](refactor-251-auth-wallet-checkout-modules.md), D22
  and D23.
- **Repository names.** `seams-wallet`, `seams-monorepo`, `speak-to-sign` and `pantry` keep
  their names in this step.
