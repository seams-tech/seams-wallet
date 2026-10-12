# Local Deriver CPU profile — October 12, 2026

One Yao registration execution cost about **95 ms of CPU in Deriver A and
103 ms in Deriver B** on a laptop, once their isolates were warm. The Router
adds 12 ms and the Signing Worker 4 ms. Curve arithmetic and the AES gate hash
took 62% of the two Derivers' CPU. One change came out of the profile: the
joined root commitment now costs two point additions, and the Derivers need
**86 ms and 84 ms**. The 64-bit curve backend is slower on `wasm32` and stays
off.

## Method

- Local Worker stack on one laptop, release Worker builds of `2937ee3e`, one
  NEAR-only passkey registration per sample.
- The V8 CPU profiler samples each role every 100 µs through its inspector port.
  It starts before the Yao execute POST and stops 300 ms after its answer.
- Four registrations run in one stack. Sample 1 is the first execution of new
  isolates. The warm value is the mean of samples 2 to 4.
- The sampler takes samples only while the isolate runs. Each sample counts at
  most 300 µs; a longer gap is a wait, not work.

## Measured results

| Role | First execution | Warm execution |
| --- | ---: | ---: |
| Deriver A | 132.8 ms | 95.0 ms |
| Deriver B | 161.8 ms | 103.2 ms |
| Router | 43.7 ms | 12.0 ms |
| Signing Worker | 21.1 ms | 4.2 ms |

The execute POST took 370 ms for the first registration and 227 to 231 ms for
the next three.

Warm CPU by work:

| Work | Deriver A | Deriver B |
| --- | ---: | ---: |
| Curve arithmetic | 23.5 ms | 46.2 ms |
| AES gate hash | 34.3 ms | 18.4 ms |
| SHA-256 | 9.9 ms | 9.8 ms |
| Circuit engine | 9.4 ms | 8.5 ms |
| Zeroize of wire labels | 7.0 ms | 5.9 ms |
| JavaScript and VM calls | 4.1 ms | 5.4 ms |
| Framing and serialization | 2.5 ms | 4.0 ms |
| Sealing and key derivation | 0.8 ms | 0.6 ms |
| Other | 3.5 ms | 4.4 ms |

What the split shows:

- **Curve arithmetic is 35% of the two Derivers' CPU.** It runs in
  `curve25519-dalek`'s 32-bit field backend, the default on `wasm32`. More than
  half of it is not the protocol: 10.8 ms in Deriver A and 24.6 ms in Deriver B
  build and parse the tenant-root commitments, which are the same for every
  wallet of one tenant. The Yao handler with its oblivious transfers takes
  9.3 ms and 17.0 ms.
- **The AES gate hash is 27%.** The `aes` crate uses its bitsliced software
  cipher on `wasm32`, two blocks per batch. Garbling already hashes four blocks
  per AND gate in one call and evaluation two.
- **Sealing, framing and serialization are 4% together.** They are not the cost.
- **A first execution costs 38 ms more in Deriver A and 59 ms more in Deriver B.**
  The extra time is in framing, glue and other code that runs once per isolate.

## The joined root commitment

`TwoPartyRootShareCommitments::new` computed the joined root `2A − B` with a
full scalar multiplication, then compressed the point and decompressed it
again. The validation layers call it several times in one execution. Both
commitments are public points, so two point additions give the same result.
The function now adds and keeps the point, with the same identity check.

| Warm CPU | Before | After |
| --- | ---: | ---: |
| Deriver A | 95.0 ms | 86.5 ms |
| Deriver B | 103.2 ms | 83.6 ms |
| Curve arithmetic, Deriver A | 23.5 ms | 16.3 ms |
| Curve arithmetic, Deriver B | 46.2 ms | 28.8 ms |
| Execute POST, warm | 227 to 231 ms | 195 to 202 ms |

The two Derivers together need 14% less CPU. The remaining commitment cost is
the point decoding in `TenantRootEpochCommitmentsV1::new`, 2.0 ms and 4.1 ms.

## The 64-bit curve backend

Both Derivers were built with `--cfg curve25519_dalek_bits="64"` and profiled
the same way.

| Warm CPU | Default backend | 64-bit backend |
| --- | ---: | ---: |
| Deriver A | 95.0 ms | 139.0 ms |
| Deriver B | 103.2 ms | 176.1 ms |

`wasm32` has no 128-bit multiplication. The 64-bit backend calls the software
routine `__multi3` for each product: 37 ms in Deriver A and 73 ms in Deriver B.
The default backend stays. The execute POST times of that run are not
comparable, because the machine carried other load.

## Limits

- One laptop. Cloudflare bills more CPU time for the same work; this run does
  not measure that factor.
- Three warm samples per build.
- The caller attribution walks each curve sample up to its first caller outside
  the curve crates. Inlining moves some oblivious-transfer work into the Yao
  handler's frame.
- Categories come from function names. An inlined callee counts toward its
  caller.

The [JSON record](refactor-155g-deriver-cpu-local.json) holds every split.

## Reproduction

The private directory is `.artifacts/r155g-deriver-cpu/` in `seams-wallet`.

```sh
node .artifacts/r155g-deriver-cpu/run.mjs
python3 .artifacts/r155g-deriver-cpu/split.py results --names
```
