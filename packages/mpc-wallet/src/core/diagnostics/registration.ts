export function isRegistrationBenchmarkDiagnosticsEnabled(): boolean {
  return Reflect.get(globalThis, '__SEAMS_REGISTRATION_BENCHMARK_DIAGNOSTICS') === true;
}
