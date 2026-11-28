# Conformance suite

These checks state the behaviour at the boundaries that stay when auth and the wallet's account
layer are written again: the account journeys, the stored records, the server routes and the
integrator contracts. They pass against today's code. The new code must pass the same checks.

The plan is `docs/refactor-251-auth-wallet-checkout-modules.md` (Section 2). The audit rows that
each check covers are in `docs/refactor-251-slice-0-inventory.md`, "What Slice 2 writes first".

## Run

- The fast checks (Node and Chromium). CI runs them in the Validate Wallet workflow. The UI checks
  load the built wallet CSS and modules, and the wallet's auth menu loads the connectors of
  `@seams/wallet-connect`, so build both first:

  ```bash
  pnpm -C packages/wallet-connect build
  ```

  ```bash
  pnpm -C packages/mpc-wallet build:rolldown
  ```

  ```bash
  pnpm -C tests test:conformance
  ```

- The journeys. Each journey starts a fresh local Wallet system on ports 4100 to 4202. The Email
  OTP journeys need the intended Google test token (`pnpm -C tests ensure:intended-google-token`):

  ```bash
  pnpm -C tests test:conformance:journeys
  ```

- Write the record fixtures again from today's writers:

  ```bash
  SEAMS_CONFORMANCE_WRITE_FIXTURES=1 pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts conformance/records
  ```

## Folders

| Folder | What it checks |
| --- | --- |
| `journeys` | Registration, sign-in, unlock, step-up, signing, adding and removing a method, device linking and recovery, as steps of a small driver |
| `records` | IndexedDB records and D1 rows made by today's writers, as committed fixtures that today's readers read |
| `routes` | The request and the response of the auth routes, the project-key refusals and the login scope |
| `ceremonies` | The WebAuthn options, the server checks of a passkey, the PRF salts and the user handle |
| `errors` | The signer codes, the Google and Email OTP codes and the device-linking codes |
| `ui` | The auth menu's integrator contracts (card radius, copy, host error event), its outcome codes and the methods screen of the account menu |

## The journey driver

`journeys/journeys.ts` holds each journey as a list of steps of `ConformanceDevice`
(`journeys/driver.ts`). `journeys/seamsWebDriver.ts` runs the steps with today's `SeamsWeb` API,
through the intended-behaviour harness. A driver for the new API implements the same interface,
and the journeys do not change. The `SeamsWeb` driver goes away with the `SeamsWeb` API.

## Expected failures

A check whose contract today's code breaks calls `expectKnownFault(row, fault)` from
`knownFault.ts`. Playwright reports such a check as failed when it starts to pass, so the change
that fixes the fault also removes the marker. `grep -rn expectKnownFault tests/conformance` lists
them.
