use threshold_prf::TwoPartyDeriverRole;

use super::tenant_root_protocol::{
    push_bounded_field, TenantRootWireDecoderV1, TenantRootWireMessagesV1,
};
use super::{RouterAbDerivationError, RouterAbDerivationErrorCode, RouterAbDerivationResult};

/// Bounded wire of non-empty fields, each prefixed with its big-endian `u32`
/// length, shared by the role creation and refresh commands and the role
/// creation package.
///
/// Every error message starts with the label of `messages`, which names the
/// command or package.
#[derive(Clone, Copy)]
pub(super) struct TenantRootRoleCommandWireV1 {
    messages: &'static TenantRootWireMessagesV1,
    max_bytes: usize,
}

impl TenantRootRoleCommandWireV1 {
    pub(super) const fn new(messages: &'static TenantRootWireMessagesV1, max_bytes: usize) -> Self {
        Self {
            messages,
            max_bytes,
        }
    }

    pub(super) fn push_field(
        self,
        bytes: &mut Vec<u8>,
        value: &[u8],
    ) -> RouterAbDerivationResult<()> {
        push_bounded_field(bytes, value, self.max_bytes, self.messages.label)
    }

    pub(super) fn push_role(
        self,
        bytes: &mut Vec<u8>,
        role: TwoPartyDeriverRole,
    ) -> RouterAbDerivationResult<()> {
        self.push_field(bytes, role.as_str().as_bytes())?;
        self.push_field(bytes, &role.share_id().get().get().to_be_bytes())
    }

    /// Appends the issuer signature to the unsigned command bytes.
    pub(super) fn append_signature(
        self,
        unsigned: Vec<u8>,
        signature: &[u8; 64],
    ) -> RouterAbDerivationResult<Vec<u8>> {
        if signature.iter().all(|byte| *byte == 0) {
            return Err(self.malformed("signature must be nonzero"));
        }
        let mut bytes = unsigned;
        self.push_field(&mut bytes, signature)?;
        Ok(bytes)
    }

    pub(super) const fn decoder(self, bytes: &[u8]) -> TenantRootWireDecoderV1<'_> {
        self.messages.decoder(bytes)
    }

    fn malformed(self, problem: &str) -> RouterAbDerivationError {
        RouterAbDerivationError::new(
            RouterAbDerivationErrorCode::MalformedInput,
            format!("{} {problem}", self.messages.label),
        )
    }
}
