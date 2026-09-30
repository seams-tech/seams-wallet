-- The generation of each stored object: a random value assigned when the
-- object is written, as R2 assigns an object version. A replay of the same
-- object keeps it; deleting the object and writing it again assigns a new one,
-- so a recorded generation names one exact write. Refresh records it and
-- checks it again before activating.
ALTER TABLE local_tenant_root_managed_backups
  ADD COLUMN object_generation TEXT NOT NULL DEFAULT '';
