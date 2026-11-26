/** Whether registration provisions a threshold ECDSA signer for a chain family. */
export interface EcdsaSignerProvisioningPolicy {
  enabled: boolean;
}

export interface EcdsaSignerProvisioningDefaults {
  tempo: EcdsaSignerProvisioningPolicy;
  evm: EcdsaSignerProvisioningPolicy;
}
