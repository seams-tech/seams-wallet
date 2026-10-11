# Hosted early sign prepare comparison — October 11, 2026

The SDK now sends the NEP-413 sign prepare while the confirmation dialog is
open (public `3670b1cd`). On staging, with every Worker version fixed, the
first signature after the confirmation fell from **694 ms to 358 ms**, and the
first signature excluding the confirmation from **720 ms to 396 ms**, six
wallets per side. All 15 signatures passed independent verification. Staging
was restored and independently checked.

## Fixed inputs

- Every group serves the same 13 Worker versions: the hosts of the earlier
  runs, the Console against the Hong Kong database, and Deriver A `e1996ba4`
  with the Deriver B load of `fedad1f3`.
- The late-prepare side uses the frozen early-preflight SDK payload of the
  earlier runs. The early-prepare side uses public `2b0e427d` plus the change.
  Registration takes the same code path in both.
- Chromium runs in Tokyo. Wallets use APAC homes and implicit NEAR accounts.
  Browser requests reach staging without interception.

The order is one discarded warm-up group, then late, early, late, early, with
three fresh wallets in each group.

## Measured results

Values are medians, then the observed minimum and maximum, over six wallets.

| Six wallets each | Late prepare | Early prepare |
| --- | ---: | ---: |
| Confirmation to signature | 694 ms (636–1,132) | **358 ms (327–471)** |
| First signature, excluding confirmation | 720 ms (662–1,154) | **396 ms (367–513)** |
| Prepare wait after the confirmation | 298 ms (279–370) | 65 ms (42–90) |
| Sign request | 358 ms (309–810) | 285 ms (278–374) |
| Automated confirmation | 272 ms (262–298) | 267 ms (261–271) |
| Registration, excluding WebAuthn | 3,952 ms (3,250–4,097) | 3,741 ms (3,620–4,661) |
| Registration plus first signature | 4,704 ms (4,014–4,933) | 4,144 ms (3,989–5,028) |

The prepare leaves when the dialog opens and returns during it. The automated
confirmation takes about 267 ms, slightly less than one prepare exchange, so
42–90 ms of the prepare still follows the confirmation. A person takes longer
to confirm, and that wait then disappears. The registration rows use the same
code on both sides; their difference is spread between groups.

Each early-prepare wallet sent exactly one prepare request and one sign
request, and emitted `prepare_sent` once. No late-prepare wallet emitted it.

## Verification and restoration

- All 15 registrations and signatures passed the browser workload.
- Node.js independently verified all 15 NEP-413 signatures with its own
  payload encoder. Changed signed fields were rejected.
- All 22 comparison checks passed: identical versions in every group, three
  verified samples per group, every invocation on its expected version, no
  session-status request, and the request and stage counts above.
- All 13 original Worker versions and both Deriver schemas were restored.
  Independent read-back verified the versions, the schemas and the four Gateway
  address tables. Tenant activation on the restored versions passed.

A second launcher started the same driver three seconds after the first. It
stopped at its own active-run check before any staging call and left a
traceback at the top of the log. The
[sanitized JSON evidence](refactor-155g-early-sign-prepare-hosted.json) holds
every sample with its signing stages, the checks, the proofs and the
restoration record. The private directory is
`.artifacts/r155g-prepare-hosted/` in `seams-monorepo`.
