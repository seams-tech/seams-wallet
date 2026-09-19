const ECDSA_TIMING_METRICS = new Set([
  'ecdsa_sign_authorize',
  'ecdsa_sign_admit',
  'ecdsa_sign_proxy',
  'ecdsa_sign_complete',
  'ecdsa_sign_total',
  'ecdsa_presign_queue',
  'ecdsa_presign_authenticate',
  'ecdsa_presign_material',
  'ecdsa_presign_admit',
  'ecdsa_presign_proxy',
  'ecdsa_presign_total',
  'ecdsa_presign_sw_material',
  'ecdsa_presign_sw_session',
  'ecdsa_presign_sw_admit',
  'ecdsa_presign_sw_total',
]);

export function parseEcdsaServerTiming(header: string | null): Map<string, number> {
  const durations = new Map<string, number>();
  if (!header) return durations;
  for (const metric of header.split(',')) {
    const [name, ...parameters] = metric.trim().split(';');
    if (!ECDSA_TIMING_METRICS.has(name) || durations.has(name)) continue;
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
