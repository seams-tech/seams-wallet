use super::*;
use serde::de::{DeserializeSeed, Error, MapAccess, SeqAccess, Visitor};
use std::{fmt, marker::PhantomData};

trait RestoreRow: DeserializeOwned {
    fn restore<Sql: SigningWorkerWalletSqlV1>(
        self,
        store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<()>;
}
impl RestoreRow for PoolSnapshotRow {
    fn restore<Sql: SigningWorkerWalletSqlV1>(
        self,
        store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<()> {
        store.restore_pool_record(scope, self)
    }
}
impl RestoreRow for ActivationSnapshotRow {
    fn restore<Sql: SigningWorkerWalletSqlV1>(
        self,
        store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<()> {
        store.restore_activation_record(scope, self)
    }
}
impl RestoreRow for LinkedSnapshotRow {
    fn restore<Sql: SigningWorkerWalletSqlV1>(
        self,
        store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<()> {
        store.restore_linked_reservation(scope, self)
    }
}
impl RestoreRow for EffectSnapshotRow {
    fn restore<Sql: SigningWorkerWalletSqlV1>(
        self,
        store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<()> {
        store.restore_effect_record(scope, self)
    }
}
impl RestoreRow for presign_authority::PresignAuthorityRow {
    fn restore<Sql: SigningWorkerWalletSqlV1>(
        self,
        store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<()> {
        store.restore_presign_authority(scope, self)
    }
}
impl RestoreRow for linked_presign_inventory::LinkedPresignSessionRow {
    fn restore<Sql: SigningWorkerWalletSqlV1>(
        self,
        store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<()> {
        store.restore_linked_presign_session(scope, self)
    }
}

struct Rows<'a, 'db, Sql, Row> {
    store: &'a SigningWorkerWalletEcdsaStoreV1<'db, Sql>,
    scope: &'a CloudflareSigningWorkerWalletScopeV1,
    row: PhantomData<Row>,
}
impl<'de, Sql: SigningWorkerWalletSqlV1, Row: RestoreRow> DeserializeSeed<'de>
    for Rows<'_, '_, Sql, Row>
{
    type Value = u64;
    fn deserialize<D: serde::Deserializer<'de>>(self, deserializer: D) -> Result<u64, D::Error> {
        deserializer.deserialize_seq(self)
    }
}
impl<'de, Sql: SigningWorkerWalletSqlV1, Row: RestoreRow> Visitor<'de> for Rows<'_, '_, Sql, Row> {
    type Value = u64;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("an array of historical wallet records")
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<u64, A::Error> {
        let mut count = 0;
        while let Some(row) = sequence.next_element::<Row>()? {
            row.restore(self.store, self.scope)
                .map_err(A::Error::custom)?;
            count += 1;
        }
        Ok(count)
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(field_identifier, rename_all = "snake_case")]
enum Field {
    Pools,
    Activations,
    LinkedReservations,
    Effects,
    PresignAuthorities,
    LinkedPresignSessions,
}

struct Inventory<'a, 'db, Sql> {
    store: &'a SigningWorkerWalletEcdsaStoreV1<'db, Sql>,
    scope: &'a CloudflareSigningWorkerWalletScopeV1,
}
impl<'a, 'db, Sql> Inventory<'a, 'db, Sql> {
    fn rows<Row>(&self) -> Rows<'a, 'db, Sql, Row> {
        Rows {
            store: self.store,
            scope: self.scope,
            row: PhantomData,
        }
    }
}
impl<'de, Sql: SigningWorkerWalletSqlV1> DeserializeSeed<'de> for Inventory<'_, '_, Sql> {
    type Value = u64;
    fn deserialize<D: serde::Deserializer<'de>>(self, deserializer: D) -> Result<u64, D::Error> {
        deserializer.deserialize_map(self)
    }
}
impl<'de, Sql: SigningWorkerWalletSqlV1> Visitor<'de> for Inventory<'_, '_, Sql> {
    type Value = u64;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("the six ECDSA historical record families")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<u64, A::Error> {
        const ALL_FIELDS: u8 = (1 << 6) - 1;
        let mut seen = 0u8;
        let mut count = 0;
        while let Some(field) = map.next_key::<Field>()? {
            let bit = 1 << field as u8;
            if seen & bit != 0 {
                return Err(A::Error::custom("ECDSA snapshot repeats a record family"));
            }
            seen |= bit;
            count += match field {
                Field::Pools => map.next_value_seed(self.rows::<PoolSnapshotRow>())?,
                Field::Activations => map.next_value_seed(self.rows::<ActivationSnapshotRow>())?,
                Field::LinkedReservations => {
                    map.next_value_seed(self.rows::<LinkedSnapshotRow>())?
                }
                Field::Effects => map.next_value_seed(self.rows::<EffectSnapshotRow>())?,
                Field::PresignAuthorities => {
                    map.next_value_seed(self.rows::<presign_authority::PresignAuthorityRow>())?
                }
                Field::LinkedPresignSessions => map.next_value_seed(
                    self.rows::<linked_presign_inventory::LinkedPresignSessionRow>(),
                )?,
            };
        }
        if seen != ALL_FIELDS {
            return Err(A::Error::custom(
                "ECDSA snapshot is missing a record family",
            ));
        }
        Ok(count)
    }
}

struct Snapshot<'a, 'db, Sql> {
    store: &'a SigningWorkerWalletEcdsaStoreV1<'db, Sql>,
    receipt: &'a SigningWorkerPoolFreezeReceiptV1,
}
impl<'de, Sql: SigningWorkerWalletSqlV1> DeserializeSeed<'de> for Snapshot<'_, '_, Sql> {
    type Value = u64;
    fn deserialize<D: serde::Deserializer<'de>>(self, deserializer: D) -> Result<u64, D::Error> {
        deserializer.deserialize_tuple(3, self)
    }
}
impl<'de, Sql: SigningWorkerWalletSqlV1> Visitor<'de> for Snapshot<'_, '_, Sql> {
    type Value = u64;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("wallet scope, move identity, and historical inventory")
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<u64, A::Error> {
        let scope: CloudflareSigningWorkerWalletScopeV1 = sequence
            .next_element()?
            .ok_or_else(|| A::Error::custom("ECDSA snapshot scope is missing"))?;
        let request: SigningWorkerRelocationRequestV1 = sequence
            .next_element()?
            .ok_or_else(|| A::Error::custom("ECDSA snapshot move is missing"))?;
        if scope != self.receipt.scope || request != self.receipt.request {
            return Err(A::Error::custom(
                "ECDSA staged inventory binding differs from source",
            ));
        }
        let count = sequence
            .next_element_seed(Inventory {
                store: self.store,
                scope: &scope,
            })?
            .ok_or_else(|| A::Error::custom("ECDSA snapshot inventory is missing"))?;
        if sequence.next_element::<serde::de::IgnoredAny>()?.is_some() {
            return Err(A::Error::custom("ECDSA snapshot has extra fields"));
        }
        Ok(count)
    }
}

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    pub(crate) fn restore_ecdsa_snapshot(
        &self,
        receipt: &SigningWorkerPoolFreezeReceiptV1,
        reader: &mut impl std::io::Read,
    ) -> RouterAbProtocolResult<()> {
        let mut deserializer = serde_json::Deserializer::from_reader(reader);
        let count = Snapshot {
            store: self,
            receipt,
        }
        .deserialize(&mut deserializer)
        .map_err(|error| wallet_error(error.to_string()))?;
        deserializer
            .end()
            .map_err(|error| wallet_error(error.to_string()))?;
        if count != receipt.record_count {
            return Err(wallet_error(
                "ECDSA staged inventory count differs from source",
            ));
        }
        Ok(())
    }
}
