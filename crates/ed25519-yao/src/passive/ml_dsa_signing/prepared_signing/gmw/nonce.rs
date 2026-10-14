//! Private nonce conversion and commitment decomposition through prepared GMW.

use super::*;

pub(super) async fn prepare_values<'a>(
    role: SigningRole,
    count: usize,
    key: &SigningKeyState,
    schedules: &'a [TrustedMlDsaSchedule<'a>],
    correlations: &mut CorrelationStream,
    transport: &mut impl BooleanTransport,
) -> Result<(Vec<Zeroizing<Candidate>>, [BatchMetrics; 2])> {
    let mut values = Vec::with_capacity(count);
    let mut inputs = Vec::with_capacity(count * COLUMNS);
    for _ in 0..count {
        let mut value = Zeroizing::new(Candidate::empty());
        for column in 0..COLUMNS {
            let mut entropy = Zeroizing::new([0; 640]);
            random_bytes(entropy.as_mut())?;
            let mut bits = Zeroizing::new(Vec::new());
            append_bytes(&mut bits, entropy.as_slice());
            if role == SigningRole::A {
                fill_uniform(&mut value.y[column])?;
                append_polynomial(&mut bits, &value.y[column]);
            }
            inputs.push(bits);
        }
        values.push(value);
    }
    let mask_schedules = vec![schedule(schedules, 0x92)?; count * COLUMNS];
    let masks = prepare_batch(role, &mask_schedules, correlations, transport)
        .await
        .map_err(runtime_error)?;
    let mask_binding = shake256(&[&key.binding, b"gmw-nonce-masks"]);
    let masks = masks
        .run(&inputs, &mask_binding, transport)
        .await
        .map_err(runtime_error)?;
    inputs.clear();
    for (candidate, value) in values.iter_mut().enumerate() {
        if role == SigningRole::B {
            for column in 0..COLUMNS {
                value.y[column] =
                    decode_polynomial(&masks.outputs[candidate * COLUMNS + column], 0)?;
            }
        }
        value.w = matrix_product_plus_error(&key.matrix, &value.y, &key.twiddles);
        for row in 0..ROWS {
            let mut bits = Zeroizing::new(Vec::new());
            append_polynomial(&mut bits, &value.w[row]);
            if role == SigningRole::A {
                let high = &mut value.high[row * 128..(row + 1) * 128];
                random_bytes(high)?;
                append_bytes(&mut bits, high);
                fill_uniform(&mut value.r[row])?;
                append_polynomial(&mut bits, &value.r[row]);
            }
            inputs.push(bits);
        }
    }
    let commitment_schedules = vec![schedule(schedules, 0x96)?; count * ROWS];
    let commitments = prepare_batch(role, &commitment_schedules, correlations, transport)
        .await
        .map_err(runtime_error)?;
    let commitment_binding = shake256(&[&key.binding, b"gmw-nonce-commitments"]);
    let commitments = commitments
        .run(&inputs, &commitment_binding, transport)
        .await
        .map_err(runtime_error)?;
    for (candidate, value) in values.iter_mut().enumerate() {
        if role == SigningRole::B {
            for row in 0..ROWS {
                let output = &commitments.outputs[candidate * ROWS + row];
                if output.len() != 864 {
                    return Err(SigningError::CircuitOutput);
                }
                value.high[row * 128..(row + 1) * 128].copy_from_slice(&output[..128]);
                value.r[row] = decode_polynomial(output, 1024)?;
            }
        }
        value.w.zeroize();
    }
    Ok((values, [masks.metrics, commitments.metrics]))
}
