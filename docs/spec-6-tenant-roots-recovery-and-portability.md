# Spec 6: Tenant roots, recovery, and portability

Operators need to maintain the server side of Wallet without changing users'
keys. They also need a way to recover or move it if a deployment is lost.

The server's key-setup protocols use a **tenant derivation root**. Its shares
stay separated between Deriver A and Deriver B. A tenant root serves the tenant's
wallet infrastructure; each wallet has its own separate custody seed.

## Refreshing shares

A share refresh gives the Derivers new shares of the same tenant root. The
root's identity and derived public keys remain unchanged, so users keep their
wallet addresses.

The roles save and verify their new material before it becomes active. New work
then uses the new version, while work already in progress follows the version
it started with. Old material is retired and erased only when the recorded
completion conditions allow it.

Replacing the root creates a new root identity. It requires a separate
migration decision and cannot be treated as a routine share refresh.

## Backing up the deployment

There are two kinds of backup:

- An **availability backup** restores one role's encrypted state.
- A **tenant recovery package** contains the protected artifacts needed to restore
  the tenant root across its roles in a compatible deployment.

The recovery package keeps role shares separated and requires authorized
restore. Neither backup exposes an assembled root or a wallet custody seed.
Optional archive-password protection adds another layer around the package's
existing encryption.

## Restoring to a new deployment

A valid recovery package works without contacting the source deployment.

1. Check the package and the destination's compatibility.
2. Install each role's material through its private channel.
3. Verify that the roles reproduce the expected public commitment.
4. Keep the restored root dormant until the operator authorizes activation.

A dormant root is installed and verified, but unavailable for new signing or
derivation work. This gives the operator a clear checkpoint before enabling the
destination.

The CLI uses browser-approved credentials scoped to the chosen tenant and
operations. It verifies the destination's trust information before sending
recovery material. Expired or revoked credentials cannot authorize a restore.

## Moving an active deployment

For a planned migration, keep the source available while the destination is
restored and verified. Then authorize cutover. Only one deployment is admitted
as the active authority for the root at a time.

Retire the source after target activation, and erase its material according to
the operator's policy. Interrupted operations resume from saved progress;
retries must not create another root, restore, or activation.

See the [Router protocol](router-ab/protocol.md) for role requirements and
[Wallet Console Lite](../examples/wallet-console-lite/README.md) for the local
CLI workflows.
