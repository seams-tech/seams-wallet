//! Private nonce conversion and commitment decomposition through prepared GMW.

use super::*;

pub(super) async fn prepare_masks<'a>(
    role: SigningRole,
    count: usize,
    preparation: &[u8; 32],
    schedules: &'a [TrustedMlDsaSchedule<'a>],
    correlations: &mut CorrelationStream,
    topologies: &mut PublicTopologies,
    transport: &mut impl BooleanTransport,
) -> Result<(Vec<Zeroizing<Candidate>>, BatchMetrics)> {
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
    let masks = prepare_batch(role, &mask_schedules, correlations, topologies, transport)
        .await
        .map_err(runtime_error)?;
    let mask_binding = shake256(&[preparation, b"gmw-nonce-masks"]);
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
    }
    Ok((values, masks.metrics))
}

pub(super) async fn activate_values(
    values: &mut [Zeroizing<Candidate>],
    role: SigningRole,
    matrix: &PublicMatrix,
    twiddles: &Polynomial,
    binding: &[u8; 64],
    commitments: PreparedGmwBatch<'_>,
    transport: &mut impl BooleanTransport,
) -> Result<BatchMetrics> {
    let inputs = commitment_inputs(values, role, matrix, twiddles)?;
    let commitment_binding = shake256(&[binding, b"gmw-nonce-commitments"]);
    let commitments = commitments
        .run(&inputs, &commitment_binding, transport)
        .await
        .map_err(runtime_error)?;
    apply_commitment_outputs(values, role, &commitments.outputs)?;
    Ok(commitments.metrics)
}

pub(super) fn commitment_inputs(
    values: &mut [Zeroizing<Candidate>],
    role: SigningRole,
    matrix: &PublicMatrix,
    twiddles: &Polynomial,
) -> Result<Vec<Zeroizing<Vec<bool>>>> {
    let mut inputs = Vec::with_capacity(values.len() * ROWS);
    for value in values.iter_mut() {
        value.w = matrix_product_plus_error(matrix, &value.y, twiddles);
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
    Ok(inputs)
}

pub(super) fn apply_commitment_outputs(
    values: &mut [Zeroizing<Candidate>],
    role: SigningRole,
    outputs: &[Zeroizing<Vec<u8>>],
) -> Result<()> {
    if outputs.len() != values.len() * ROWS {
        return Err(SigningError::CircuitOutput);
    }
    for (candidate, value) in values.iter_mut().enumerate() {
        if role == SigningRole::B {
            for row in 0..ROWS {
                let output = &outputs[candidate * ROWS + row];
                if output.len() != 864 {
                    return Err(SigningError::CircuitOutput);
                }
                value.high[row * 128..(row + 1) * 128].copy_from_slice(&output[..128]);
                value.r[row] = decode_polynomial(output, 1024)?;
            }
        }
        value.w.zeroize();
    }
    Ok(())
}
