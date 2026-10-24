const SIGNING_TIMING_METRICS = new Set([
  'ed25519_sign_authorize',
  'ed25519_sign_admit',
  'ed25519_sign_proxy',
  'ed25519_sign_complete',
  'ed25519_sign_total',
  'near_router_admission',
  'near_router_service',
  'near_sw_dispatch_setup',
  'near_sw_decode_validate',
  'near_sw_wallet_call',
  'near_sw_do_decode_validate',
  'near_sw_do_schema',
  'near_sw_do_execute',
  'near_sw_do_handler',
  'near_sw_handler',
  'wallet_gateway_binding',
  'wallet_gateway_total',
  'wallet_console_binding_d1',
  'wallet_console_binding_sql',
  'ecdsa_sign_authorize',
  'ecdsa_sign_admit',
  'ecdsa_sign_proxy',
  'ecdsa_sign_complete',
  'ecdsa_sign_total',
  'ecdsa_presign_authenticate',
  'ecdsa_presign_material',
  'ecdsa_presign_admit',
  'ecdsa_presign_proxy',
  'ecdsa_presign_total',
  'ecdsa_presign_sw_material',
  'ecdsa_presign_sw_session',
  'ecdsa_presign_sw_do_response_headers',
  'ecdsa_presign_sw_do_response_body',
  'ecdsa_presign_sw_admit',
  'ecdsa_presign_sw_total',
]);

export function parseSigningServerTiming(header: string | null): Map<string, number> {
  const durations = new Map<string, number>();
  if (!header) return durations;
  for (const metric of header.split(',')) {
    const [name, ...parameters] = metric.trim().split(';');
    if (!SIGNING_TIMING_METRICS.has(name) || durations.has(name)) continue;
    for (const parameter of parameters) {
      const [key, rawValue] = parameter.trim().split('=');
      if (key !== 'dur' || !rawValue?.trim()) continue;
      const duration = Number(rawValue);
      if (Number.isFinite(duration) && duration >= 0) durations.set(name, duration);
      break;
    }
  }
  return durations;
}
