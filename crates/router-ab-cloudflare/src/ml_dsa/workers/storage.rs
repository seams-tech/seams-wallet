//! Cloudflare transaction and ciphertext storage adapter.
use super::*;

pub(super) struct TransactionStore {
    pub(super) transaction: Transaction,
    pub(super) trace: Option<durable_trace::DurableTrace>,
}
impl TransactionStore {
    pub(super) fn untraced(transaction: Transaction) -> Self {
        Self {
            transaction,
            trace: None,
        }
    }
}
struct CiphertextChunk<'a>(&'a [u8]);
impl Serialize for CiphertextChunk<'_> {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> core::result::Result<S::Ok, S::Error> {
        serializer.serialize_bytes(self.0)
    }
}
impl Store for TransactionStore {
    async fn get<T: serde::de::DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        durable_trace::observe(self.trace.as_ref(), "get", async {
            match self.transaction.get(key).await {
                Ok(value) => Ok(Some(value)),
                Err(worker::Error::JsError(message)) if message == "No such value in storage." => {
                    Ok(None)
                }
                Err(error) => Err(storage_error(error)),
            }
        })
        .await
    }

    async fn put<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        durable_trace::observe(self.trace.as_ref(), "put", self.transaction.put(key, value))
            .await
            .map_err(storage_error)
    }
    async fn delete(&self, key: &str) -> Result<()> {
        durable_trace::observe(self.trace.as_ref(), "delete", self.transaction.delete(key))
            .await
            .map(|_| ())
            .map_err(storage_error)
    }
    async fn put_chunk(&self, key: &str, bytes: &[u8]) -> Result<()> {
        durable_trace::observe(
            self.trace.as_ref(),
            "put_chunk",
            self.transaction.put(key, &CiphertextChunk(bytes)),
        )
        .await
        .map_err(storage_error)
    }
    async fn get_chunks(
        &self,
        keys: &[String],
        maximum_bytes: usize,
    ) -> Result<Vec<Option<Vec<u8>>>> {
        use worker::wasm_bindgen::JsCast;
        let entries = durable_trace::observe(
            self.trace.as_ref(),
            "get_chunks",
            self.transaction.get_multiple(keys.to_vec()),
        )
        .await
        .map_err(storage_error)?;
        let mut values = Vec::with_capacity(keys.len());
        for key in keys {
            let value = entries.get(&worker::wasm_bindgen::JsValue::from_str(key));
            values.push(if value.is_undefined() {
                None
            } else {
                let bytes = value
                    .dyn_into::<worker::js_sys::Uint8Array>()
                    .map_err(|_| invalid("Invalid ML-DSA stored ciphertext"))?;
                if bytes.length() as usize > maximum_bytes {
                    return Err(invalid("Oversized ML-DSA ciphertext chunk"));
                }
                Some(bytes.to_vec())
            });
        }
        Ok(values)
    }
    async fn delete_many(&self, keys: &[String]) -> Result<()> {
        durable_trace::observe(
            self.trace.as_ref(),
            "delete_many",
            self.transaction.delete_multiple(keys.to_vec()),
        )
        .await
        .map(|_| ())
        .map_err(storage_error)
    }
}

pub(super) async fn transaction<T, F, Fut>(state: &State, work: F) -> Result<T>
where
    T: 'static,
    F: FnOnce(TransactionStore) -> Fut + 'static,
    Fut: Future<Output = Result<T>> + 'static,
{
    let output = Rc::new(RefCell::new(None));
    let captured = Rc::clone(&output);
    state
        .storage()
        .transaction(move |tx| async move {
            let value = work(TransactionStore::untraced(tx))
                .await
                .map_err(protocol_error)?;
            captured.replace(Some(value));
            Ok(())
        })
        .await
        .map_err(storage_error)?;
    let result = output
        .borrow_mut()
        .take()
        .ok_or_else(|| invalid("Registration transaction returned no result"));
    result
}
