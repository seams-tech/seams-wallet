# Hosted combined comparison — October 11, 2026

With every change of R155F and R155G so far, registration plus the first
signature measures **4.37 s** at the median on staging, twelve wallets, against
**4.68 s** for the complete R155F hosts without the two R155G changes, six
wallets. The **4 s target is not met**: two of twelve wallets finished under
4.0 s and eight under 4.5 s. All 24 signatures of the completed groups passed
independent verification. Staging was restored and independently checked.

## Fixed inputs

- Every group serves the complete R155F Gateway, Runtime and Console versions
  of the [combined R155F run](refactor-155f-combined-registration-hosted.md):
  public `0e00b591`, private `0a85921`, on the Hong Kong layout.
- Control: the comparison Deriver A `fd1c1f00` and the `a3dd064f` SDK payload.
- Candidate: Deriver A `e1996ba4` with the Deriver B load (`fedad1f3`) and the
  SDK with the early sign prepare (`3670b1cd`). SDK sources are identical
  between `a3dd064f` and the candidate's base.
- Chromium runs in Tokyo. Wallets use APAC homes and implicit NEAR accounts.
  Browser requests reach staging without interception.

The order is a discarded warm-up, two control groups, a version switch, a
discarded warm-up, four candidate groups, three wallets each.

## Measured results

Values are medians, then the observed minimum and maximum.

| Workload | Control, 6 wallets | Candidate, 12 wallets |
| --- | ---: | ---: |
| Registration, excluding WebAuthn | 3,861 ms (3,360–4,703) | 3,767 ms (3,270–5,358) |
| Registration after setup | 3,331 ms (2,819–3,831) | 3,138 ms (2,632–3,923) |
| First signature, excluding confirmation | 771 ms (693–863) | **479 ms (411–2,246)** |
| Registration plus first signature | 4,675 ms (4,089–5,480) | **4,368 ms (3,691–7,604)** |
| Wallets under 4.0 s / under 4.5 s | 0 / 2 of 6 | 2 / 8 of 12 |

| Stage, SDK timing | Control | Candidate |
| --- | ---: | ---: |
| Setup | 542 ms (514–872) | 698 ms (528–1,434) |
| Respond | 258 ms (212–412) | 257 ms (204–396) |
| Yao execution | 1,807 ms (1,638–2,558) | 1,770 ms (1,427–2,173) |
| Finalization | 920 ms (775–1,311) | 912 ms (731–1,575) |
| Sign prepare, wait after the confirmation | 392 ms (317–491) | 84 ms (43–1,864) |
| Sign request | 343 ms (304–411) | 345 ms (309–1,076) |

The established difference is the first signature, about 0.3 s. The Yao
execution's median differs by 37 ms here, inside the spread; the connection
spans of the [Deriver B load comparison](refactor-155g-yao-prewarm-hosted.md)
remain the evidence for that change. Setup, respond and finalization use the
same code on both sides.

The Yao execution is now 47% of a registration. Finalization is 24%, setup
14 to 19%, respond 7%. The registration metric includes setup. The hosted auth
menu runs setup before the click, so a user of that menu waits for the
"after setup" row and the signature: about 3.6 s at these medians.

## The incomplete control repeat

The run planned two more control groups after the candidate. After the switch
back to the control Deriver A, two of three warm-up registrations failed with
HTTP 503 from the Yao execution. Deriver B's wallet object took 14.6 s for one
preparation, with 506 ms for one D1 read against the usual 50 ms, and refused
the pair as not prepared after the ceremony's time. Deriver B's version is the
same in every group of every run, and the third wallet of that group passed.
The driver stopped and restored staging. This is an infrastructure failure of
that minute, not a result of either side. The control side therefore holds six
wallets.

## Verification and restoration

- 24 registrations and signatures of the eight completed groups passed.
- Node.js independently verified all 24 NEP-413 signatures.
- All 25 comparison checks passed: identical versions within each side, only
  Deriver A differing between the sides, three verified samples per group,
  every invocation on its expected version, one early prepare per candidate
  signature and none on the control side.
- All 13 original Worker versions and both Deriver schemas were restored.
  Independent read-back and tenant activation passed.

The [sanitized JSON evidence](refactor-155g-combined-hosted.json) holds every
sample with its stages. The private directory is
`.artifacts/r155g-combined-hosted/` in `seams-monorepo`.
