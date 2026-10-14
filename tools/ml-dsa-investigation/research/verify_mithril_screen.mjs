import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

function shortDer(tag, content) {
  assert(content.length < 128);
  return Buffer.concat([Buffer.from([tag, content.length]), content]);
}
function measured(sample) {
  return !sample.warmup;
}
function signTime(sample) {
  return sample.sign_ms;
}
function protocolBytes(sample) {
  return sample.total_protocol_bytes;
}
function attempts(sample) {
  return sample.attempts;
}
function numericOrder(left, right) {
  return left - right;
}
function sum(left, right) {
  return left + right;
}
function verified(sample) {
  return sample.openssl_verified;
}
function replayRejected(sample) {
  return sample.round_state_replay_rejected;
}
function median(values) {
  const middle = Math.floor(values.length / 2);
  if (values.length % 2) return values[middle];
  return (values[middle - 1] + values[middle]) / 2;
}

const path = process.argv[2];
assert(path, 'Provide the generated native report path');
const data = JSON.parse(readFileSync(path, 'utf8'));
assert.equal(data.schema, 'seams.ml-dsa-specialized-native-screen.v1');
const publicKey = createPublicKey({
  key: Buffer.concat([
    Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex'),
    Buffer.from(data.public_key_hex, 'hex'),
  ]),
  format: 'der',
  type: 'spki',
});
for (const sample of data.samples) {
  const message = Buffer.from(sample.message_hex, 'hex');
  const signature = Buffer.from(sample.signature_hex, 'hex');
  assert.equal(signature.length, 3309);
  sample.openssl_verified = verify(null, message, publicKey, signature);
  message[0] ^= 1;
  sample.altered_message_rejected = !verify(null, message, publicKey, signature);
  assert(sample.openssl_verified && sample.altered_message_rejected);
}
const seed = Buffer.from(data.public_fixture_seed_hex, 'hex');
assert.equal(seed.length, 32);
const algorithm = Buffer.from('300b0609608648016503040312', 'hex');
const privateDer = shortDer(
  0x30,
  Buffer.concat([Buffer.from('020100', 'hex'), algorithm, shortDer(0x04, shortDer(0x80, seed))]),
);
const ordinaryPrivate = createPrivateKey({ key: privateDer, format: 'der', type: 'pkcs8' });
const ordinaryPublic = createPublicKey(ordinaryPrivate).export({ format: 'der', type: 'spki' });
assert.equal(ordinaryPublic.subarray(-1952).toString('hex'), data.ordinary_seed_public_key_hex);
data.ordinary_seed_reference_openssl_confirmed = true;
const samples = data.samples.filter(measured);
const times = samples.map(signTime).sort(numericOrder);
const bytes = samples.map(protocolBytes).sort(numericOrder);
data.independent_verifier = {
  node: process.version,
  openssl: process.versions.openssl,
  context: 'empty',
  timing: 'after signing timer',
};
data.summary = {
  measured_samples: samples.length,
  sign_ms: { minimum: times[0], median: median(times), maximum: times.at(-1) },
  protocol_bytes_both_directions: {
    minimum: bytes[0],
    median: median(bytes),
    maximum: bytes.at(-1),
    mean: bytes.reduce(sum, 0) / bytes.length,
  },
  maximum_attempts: Math.max(...samples.map(attempts)),
  all_standard_verified: data.samples.every(verified),
  all_replay_rejected: data.samples.every(replayRejected),
};
writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify(data.summary));
