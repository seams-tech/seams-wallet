# Refactor 154: region-change notifications

Status: intent draft, revised October 5, 2026. Depends on a validated
[R153 relocation operation](refactor-153-wallet-region-selection.md).

## Intent

Detect when the owner's current network region differs from the active wallet
home. Show a dismissible notification that opens the existing Wallet region
setting. The owner reviews the destination and authorizes each move through R153.

Owners mainly use one region and occasionally travel. They decide whether a move
is useful for their visit. Region detection never admits a relocation, pauses the
wallet, or starts material preparation.

## Region observation

- Check during wallet load, unlock, or lock activity. Prefer an observation in an
  existing response. Use a lightweight probe when no suitable response exists.
- Derive the observation from trusted original ingress metadata at the server.
  Preserve it before routing to the wallet home. Browser location claims and the
  destination Worker's region do not establish the device's network region.
- Map the observation to a supported region. Keep the observed region separate
  from the active wallet home and pending relocation state. A VPN can change the
  observation without a physical move.
- Coalesce overlapping checks. A probe failure must not block wallet use or lock.
  Lock immediately and clear credentials normally. Show any suggestion only when
  the owner can access the wallet settings after authentication.
- A closed or suspended wallet has no background detection guarantee. Lifecycle
  checks are sufficient for this scope; a periodic background scheduler is excluded.

## Notification and owner action

Show the notification when the observed region differs from the active home and
the destination is supported for that wallet. Require full-owner access to the
relocation setting. Suppress new suggestions while a move is pending.

Suggested copy:

> Experiencing slow signing? Your wallet is hosted in APAC. Moving it to Europe
> may reduce delays.

Actions: **Review wallet region** and **Dismiss**.

Use the actual region names. Describe a possible improvement without claiming
that the observation measures latency or guarantees faster signing.

The review action opens R153 settings with the suggested destination selected.
Show the current home, destination, wallet-wide effect, and temporary pause before
confirmation. Require R153's fresh operation-bound owner proof for admission.
Opening the notification or settings grants no authority to move the wallet.
After submission, use R153's blocking progress view and recovery behavior. Region
notifications do not create a separate loading, cancellation, or retry flow.

Deduplicate repeated notifications for the same wallet home and observed region.
Remember dismissal on that device until the home or observed region changes.
Keep manual region selection available after dismissal. Before admission,
reconcile current placement and eligibility through the existing R153 flow.

## Boundaries

- R153 owns transfer, fencing, verification, cutover, recovery, and cleanup.
- All owner-confirmed moves use R153's five-minute admission limit and one pending
  move per wallet. Notification checks do not consume that limit.
- A move affects every device. Offline devices reconcile placement and refresh
  invalidated presignatures through R153 when they reconnect.
- Automatic moves, standing consent, travel prediction, device-location voting,
  and benefit-scoring policies are outside this scope.
- Preserve R153's clean wallet reset and identity-preservation requirements.
  No existing-wallet migration or compatibility path is required.

## Verification

Use composed browser E2Es and retain repeatable evidence:

- Load and unlock a wallet through a different regional ingress while requests
  reach its original home. Show the correct suggestion without changing placement.
  Dismiss it, reload, and verify that the same suggestion stays dismissed.
- Review the suggestion, confirm with the required owner proof, and complete a
  real R153 move. Verify signing and an offline second device's reconciliation.
- Exercise lock during a failed probe, unsupported regions, a pending move, and
  another device changing placement before confirmation. Preserve lock behavior
  and R153's stale-generation, eligibility, and admission checks.

Record commands, source revisions, region observations, notification actions,
move outcomes, and verified signatures. Exclude credentials and custody material.
This draft changes no runtime behavior.
