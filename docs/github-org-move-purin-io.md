# Moving the GitHub organisation from seams-tech to purin-io

Status: 2026-11-18. Checklist only. Nothing is moved. The owner set the date of the
organisation rename to 2026-11-20. The brand rename from Seams to Purin (package names,
product names, domains) is later and separate
([Refactor 251](refactor-251-auth-wallet-checkout-modules.md), D22 and D23).

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

| Repository | Local clone | Files that name `seams-tech` |
| --- | --- | ---: |
| `seams-tech/seams-wallet` | `~/Dev/rust/seams-wallet` | 70 |
| `seams-tech/seams-monorepo` | `~/Dev/rust/seams-monorepo` | 69 |
| `seams-tech/speak-to-sign` | `~/Dev/rust/speak-to-sign` | 20 |
| `seams-tech/pantry` | `~/Dev/lowerarchy/seams-atelier` | 15 |

Counted with `git grep -l seams-tech` on 2026-11-18. Other repositories of the organisation are
not counted. Step 1 lists them.

## Before the rename

1. **List every repository of the organisation**, with `gh repo list seams-tech --limit 200`.
   Mark the public ones. Each one without the protection above loses its redirect if somebody
   takes the old name.
2. **Ask every session and person to push their work.** An open pull request and a branch stay
   valid. A script or a workflow that is running during the rename can fail.
3. **Hold the releases.** Do not start a release from 2026-11-20 until step 13 passes.
4. **Write down the npm trusted publishers.** For each package on npmjs.com, note the
   repository and the workflow file of its trusted publisher. Today these name `seams-tech`:
   - `@seams/wallet`, `@seams/wallet-server` and `@seams/voiceid`:
     `seams-tech/seams-wallet`, `release-wallet-packages.yml`.
   - The speak-to-sign packages: `seams-tech/speak-to-sign`, `release-standalone.yml`
     (`scripts/npm-trust-standalone.sh` sets them).
   - The CLI package of seams-monorepo, if it uses trusted publishing.
5. **List the outside connections to GitHub**: Cloudflare Pages and Workers builds, GitHub Apps,
   deploy keys, webhooks and tokens with a repository list. Most use a numeric ID and keep
   working. Write down each one that shows a repository by name.
6. **Check the voice merge approvals.** A merge approval binds the SHA-256 of the repository
   name, for example `seams-tech/seams-wallet` (`repo_sha256_hex` in the voice verifier of
   speak-to-sign). After the rename, GitHub reports `purin-io/seams-wallet`, which has another
   hash. Find each place that compares the hash: the merge-approval contract, a merge gate, the
   demo and the test vectors. Decide whether old approvals stay valid.

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

10. **Update each npm trusted publisher** to `purin-io/<repository>` and the same workflow
    file. Do this for every package of step 4. The publish token of a workflow names the new
    organisation, so npm refuses the old setting. Then edit
    `scripts/npm-trust-standalone.sh` in speak-to-sign (`REPO=`).
11. **Fix the API calls in workflows and scripts.** These fail with 404 until they name
    `purin-io`:
    - seams-monorepo `.github/workflows/release-seams-cli.yml`: `gh api
      "repos/seams-tech/seams-wallet/actions/runs/..."` and `--repo seams-tech/seams-wallet`.
    - seams-monorepo `deployment/wallet-system/scripts/apply-github-external-values.mjs`: the
      `--repo seams-tech/seams-monorepo` commands.
    - seams-monorepo `docs/wallet-cli-release.md`: `gh release create ... --repo
      seams-tech/seams-wallet`.
12. **Fix the cross-repository checkouts.** These workflows check out another repository by
    name: `repository: seams-tech/...`:
    - seams-monorepo `deploy-production-frontend.yml`, `deploy-staging-frontend.yml`,
      `release-seams-cli.yml` and `sign-recovery-trust.yml`.
    - pantry `.github/workflows/atelier.yml`.

    A checkout can follow the redirect, but do not depend on it. Also check that each token or
    GitHub App of these checkouts has access in `purin-io`.
13. **Run one workflow of each kind.** A validation run in each repository, one staging
    deploy, and one dry run of each release workflow. Then the releases of step 3 can start
    again.
14. **Update the container image names.** speak-to-sign
    `crates/speaker-service/docker-compose.yml` names
    `ghcr.io/seams-tech/speaker-service`. The image moves to `ghcr.io/purin-io/...`. Keep the
    pinned digest. Check each other image of step 1.
15. **Update the download URL of the CLI.** `packages/seams-cli/bin/seams-wallet.mjs` downloads
    release files from `github.com/seams-tech/seams-wallet/releases/...`. The redirect covers
    it. Change it in the next CLI release, so that it does not depend on the redirect.
16. **Update the links in each repository** in one change for each repository:
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
