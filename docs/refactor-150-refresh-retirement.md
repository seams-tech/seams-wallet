# R150: erase retired epochs after refresh

Status: implementation and recorded checks completed September 27, 2026. Deployment
was not established by that record.

## Why

A committed refresh could leave retired shares and backups behind. Cleanup needed to
resume safely after interruptions and managed restores.

## What changed

- Made the Router carry and resume the pending retirement after committing refresh.
- Required each Deriver to settle or cancel every admission before erasing that epoch.
- Recovered claimed execution through its peer and retained exact replay after share erasure.
- Carried pending retirement across managed restore and subsequent Router restarts.

A grace interval alone did not prove safe erasure. Role settlement and fencing remained
required. New refreshes waited for the prior retirement to complete.

## Related work

[Admission identity](refactor-150-admission-identity.md) records the settlement boundary.
The separate [root-retirement admission proposal](refactor-150-root-retirement-admission.md)
retains its own approval and implementation status.

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/refactor-150-refresh-retirement.md).
