use core::fmt;

use threshold_prf::TwoPartyDeriverRole;

use super::{RouterAbDerivationError, RouterAbDerivationErrorCode, RouterAbDerivationResult};

/// Bounded wire of non-empty fields, each prefixed with its big-endian `u32`
/// length, shared by the role creation and refresh commands and the role
/// creation package.
///
/// Every error message starts with `label`, which names the command or package.
#[derive(Clone, Copy)]
pub(super) struct TenantRootRoleCommandWireV1 {
    label: &'static str,
    max_bytes: usize,
}

impl TenantRootRoleCommandWireV1 {
    pub(super) const fn new(label: &'static str, max_bytes: usize) -> Self {
        Self { label, max_bytes }
    }

    pub(super) fn push_field(
        self,
        bytes: &mut Vec<u8>,
        value: &[u8],
    ) -> RouterAbDerivationResult<()> {
        if value.is_empty() {
            return Err(RouterAbDerivationError::new(
                RouterAbDerivationErrorCode::EmptyField,
                format!("{} field is required", self.label),
            ));
        }
        let length = u32::try_from(value.len()).map_err(|_| self.malformed("field is too long"))?;
        let new_len = bytes
            .len()
            .checked_add(4)
            .and_then(|length| length.checked_add(value.len()))
            .ok_or_else(|| self.malformed("wire length overflows"))?;
        if new_len > self.max_bytes {
            return Err(self.malformed("wire is too long"));
        }
        bytes.extend_from_slice(&length.to_be_bytes());
        bytes.extend_from_slice(value);
        Ok(())
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

    pub(super) const fn decoder(self, bytes: &[u8]) -> TenantRootRoleCommandWireDecoderV1<'_> {
        TenantRootRoleCommandWireDecoderV1 {
            wire: self,
            bytes,
            offset: 0,
        }
    }

    fn malformed(self, problem: &str) -> RouterAbDerivationError {
        RouterAbDerivationError::new(
            RouterAbDerivationErrorCode::MalformedInput,
            format!("{} {problem}", self.label),
        )
    }
}

pub(super) struct TenantRootRoleCommandWireDecoderV1<'a> {
    wire: TenantRootRoleCommandWireV1,
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> TenantRootRoleCommandWireDecoderV1<'a> {
    pub(super) fn field(&mut self, name: impl fmt::Display) -> RouterAbDerivationResult<&'a [u8]> {
        let length_end = self
            .offset
            .checked_add(4)
            .ok_or_else(|| self.wire.malformed("wire offset overflows"))?;
        let length_bytes = self
            .bytes
            .get(self.offset..length_end)
            .ok_or_else(|| self.wire.malformed("field length is truncated"))?;
        let length = u32::from_be_bytes(
            length_bytes
                .try_into()
                .expect("fixed four-byte role command field length"),
        ) as usize;
        let value_end = length_end
            .checked_add(length)
            .ok_or_else(|| self.wire.malformed("field length overflows"))?;
        let value = self
            .bytes
            .get(length_end..value_end)
            .ok_or_else(|| self.wire.malformed("field is truncated"))?;
        self.offset = value_end;
        if value.is_empty() {
            return Err(RouterAbDerivationError::new(
                RouterAbDerivationErrorCode::EmptyField,
                format!("{name} is required"),
            ));
        }
        Ok(value)
    }

    pub(super) fn require_domain(&mut self, expected: &[u8]) -> RouterAbDerivationResult<()> {
        let label = self.wire.label;
        if self.field(format_args!("{label} domain"))? != expected {
            return Err(self.wire.malformed("domain is invalid"));
        }
        Ok(())
    }

    pub(super) fn fixed_field<const N: usize>(
        &mut self,
        name: impl fmt::Display,
    ) -> RouterAbDerivationResult<[u8; N]> {
        self.field(name)?
            .try_into()
            .map_err(|_| self.wire.malformed("fixed field length is invalid"))
    }

    pub(super) fn u64_field(&mut self, name: impl fmt::Display) -> RouterAbDerivationResult<u64> {
        Ok(u64::from_be_bytes(self.fixed_field::<8>(name)?))
    }

    pub(super) fn text_field(
        &mut self,
        name: impl fmt::Display,
        max_bytes: usize,
    ) -> RouterAbDerivationResult<String> {
        let bytes = self.field(name)?;
        if bytes.len() > max_bytes {
            return Err(self.wire.malformed("text field is too long"));
        }
        core::str::from_utf8(bytes)
            .map(str::to_owned)
            .map_err(|_| self.wire.malformed("text field is invalid UTF-8"))
    }

    pub(super) fn role(&mut self) -> RouterAbDerivationResult<TwoPartyDeriverRole> {
        let label = self.wire.label;
        let role = self.field(format_args!("{label} role"))?;
        let share_id = self.fixed_field::<2>(format_args!("{label} role share id"))?;
        match (role, u16::from_be_bytes(share_id)) {
            (b"deriver_a", 1) => Ok(TwoPartyDeriverRole::DeriverA),
            (b"deriver_b", 2) => Ok(TwoPartyDeriverRole::DeriverB),
            _ => Err(self.wire.malformed("role encoding is invalid")),
        }
    }

    pub(super) fn finish(self) -> RouterAbDerivationResult<()> {
        if self.offset != self.bytes.len() {
            return Err(self.wire.malformed("wire has trailing bytes"));
        }
        Ok(())
    }
}
