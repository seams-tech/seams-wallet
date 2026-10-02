# Refactor 154: automatic wallet placement and relocation

Status: intent draft, October 2, 2026. Depends on a validated
[R153 relocation operation](refactor-153-wallet-region-selection.md).

## Intent

Extend Wallet region settings so the owner can choose **Automatic** or explicitly
select a supported region. Automatic placement should recognize sustained changes
in authenticated usage and relocate the wallet when a different eligible home
would materially improve the owner's experience.

Automatic mode manages one stable wallet home. Requests continue reaching the
current home until a controlled relocation completes. Short visits and individual
requests should not cause repeated moves.

Use the same relocation operation, ownership enforcement, and recovery behavior
as R153. This phase adds the policy deciding when to request a move.

## Working assumptions and boundaries

- The single-owner, multiple-device model carries forward from R153. Placement
  preference and resulting moves apply to the entire wallet.
- Evaluate usage across the owner's devices. Mixed regional usage may justify
  keeping the current home; background traffic should not dominate the decision.
- A specifically selected region remains pinned. Changing the preference must
  prevent stale automatic proposals from overriding the owner's current choice.
- Keep the selected policy separate from the actual home and any move in progress.
  The owner should be able to understand where the wallet currently lives.
- Automatic execution needs explicit authorization under the owner's selected
  policy. Location observations alone confer no authority to move custody.
- Carry forward the clean wallet reset and preservation requirements from R153.
  Existing-wallet migration and compatibility paths remain outside scope.
- Use R153's presignature invalidation and regeneration behavior, one active move,
  and proposed server-enforced five-minute minimum between wallet relocation
  admissions. Manual and automatic requests share this limit across all devices;
  failed attempts and duplicate requests must not create unbounded refill work.
- A move can complete while other devices are offline. Their fresh presignatures
  are generated when they reconnect or next sign through the normal client/server
  protocol. Measure the temporary signing latency alongside the regional benefit.

## Assumptions to resolve and validate

- Whether R153's custody operation can run unattended for each supported
  configuration, or needs owner interaction. Automatic mode depends on resolving
  that requirement.
- Which authenticated signals reliably indicate a lasting move, what observations
  to retain, and how to handle VPNs, background activity, and devices in different
  regions.
- How to estimate an end-to-end latency benefit using actual regional resources
  and travel measurements, including shared-authority and custody calls.
- What observation period, confidence, minimum benefit, and cooldown prevent
  unnecessary movement. Keep these policy thresholds open until measured;
  R153's proposed five-minute minimum is a shared compute guard. A sustained-move
  policy can require a much longer interval between automatic relocations.
- How automatic mode is enabled and authorized, its default, eligible regions,
  owner notifications, and behavior when the preferred destination is unavailable.
- How preference changes interact with queued or already-running relocations.

After validation, add policy details and E2E scenarios covering sustained moves,
mixed-device usage, manual overrides, and failed automatic attempts with repeatable
evidence. No separate transfer mechanism is planned.
