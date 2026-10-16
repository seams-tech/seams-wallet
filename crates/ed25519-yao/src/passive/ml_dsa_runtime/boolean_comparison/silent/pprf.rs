//! Regular-noise PPRF adapted from CryProt's MIT-licensed implementation.
//! Source: 1e5cb7ac039cc72896f4c85572180c8d13c34d85, cryprot-pprf/src/lib.rs.
//! Fixed public scans replace secret active-path indexing and branches.

use super::*;
use subtle::{Choice, ConstantTimeEq};

const MESSAGE_BLOCKS: usize = 2 * (DEPTH - 1) * TREES + 4 * TREES;

fn ciphers() -> [CorrelationAes; 2] {
    [
        CorrelationAes::new(&91389970179024809574621370423327856399_u128.to_le_bytes()),
        CorrelationAes::new(&297966570818470707816499469807199042980_u128.to_le_bytes()),
    ]
}

fn mask(choice: Choice) -> Block {
    Block::splat(0u8.wrapping_sub(choice.unwrap_u8()))
}

fn expand_level(tree: &mut SecretBlocks, depth: usize, aes: &[CorrelationAes; 2]) -> SecretBlocks {
    let parent_start = ((1 << depth) - 1) * TREES;
    let child_start = ((1 << (depth + 1)) - 1) * TREES;
    let mut sums = SecretBlocks::zeroed(2 * TREES);
    let parent_count = (1 << depth) * TREES;
    for branch in 0..2 {
        for offset in (0..parent_count).step_by(8) {
            let count = (parent_count - offset).min(8);
            let mut blocks = Zeroizing::new(SecretBlockBatch::<8>::default());
            for index in 0..count {
                blocks.0[index].copy_from_slice(tree.0[parent_start + offset + index].as_bytes());
            }
            aes[branch].encrypt(&mut blocks.0[..]);
            for index in 0..count {
                let lane = (offset + index) % TREES;
                let node = (offset + index) / TREES;
                let parent = tree.0[parent_start + offset + index];
                let child_index = child_start + (2 * node + branch) * TREES + lane;
                tree.0[child_index] =
                    Block::new(blocks.0[index].as_slice().try_into().expect("AES block")) ^ parent;
                sums.0[branch * TREES + lane] ^= tree.0[child_index];
            }
        }
    }
    sums
}

fn write_block(message: &mut [u8], index: usize, block: Block) {
    message[index * 16..(index + 1) * 16].copy_from_slice(block.as_bytes());
}

fn read_block(message: &[u8], index: usize) -> Block {
    Block::new(
        message[index * 16..(index + 1) * 16]
            .try_into()
            .expect("fixed PPRF frame"),
    )
}

pub(super) async fn send(
    base: &[[[u8; 16]; 2]],
    delta: &[u8; 16],
    output: &mut SecretBlocks,
    context: &mut Context<'_, impl Transport>,
) -> Result<()> {
    let aes = ciphers();
    let last_hash = hash_cipher();
    for group in (0..PARTITIONS).step_by(TREES) {
        let mut tree = SecretBlocks::zeroed((2 * DOMAIN - 1) * TREES);
        for root in &mut tree.0[..TREES] {
            getrandom::getrandom(root.as_mut_bytes()).map_err(|_| RuntimeError::Randomness)?;
        }
        let mut message = Zeroizing::new(vec![0; MESSAGE_BLOCKS * 16]);
        for depth in 0..DEPTH {
            let sums = expand_level(&mut tree, depth, &aes);
            for lane in 0..TREES {
                let base_index = (group + lane) * DEPTH + DEPTH - 1 - depth;
                if depth < DEPTH - 1 {
                    for branch in 0..2 {
                        let block = sums.0[branch * TREES + lane]
                            ^ Block::new(base[base_index][branch ^ 1]);
                        write_block(&mut message, (depth * 2 + branch) * TREES + lane, block);
                    }
                } else {
                    let offset = 2 * (DEPTH - 1) * TREES + lane * 4;
                    for branch in 0..2 {
                        let mut key = Zeroizing::new(base[base_index][branch ^ 1]);
                        let first = hash(&last_hash, &key);
                        for byte in key.iter_mut() {
                            *byte ^= 0xff;
                        }
                        let second = hash(&last_hash, &key);
                        write_block(
                            &mut message,
                            offset + 2 * branch,
                            sums.0[branch * TREES + lane] ^ Block::new(*first),
                        );
                        write_block(
                            &mut message,
                            offset + 2 * branch + 1,
                            sums.0[(branch ^ 1) * TREES + lane]
                                ^ Block::new(*delta)
                                ^ Block::new(*second),
                        );
                    }
                }
            }
        }
        let source = (DOMAIN - 1) * TREES;
        let destination = group * DOMAIN;
        output.0[destination..destination + DOMAIN * TREES].copy_from_slice(&tree.0[source..]);
        context.send(&message).await?;
    }
    Ok(())
}

pub(super) async fn receive(
    base: &[[u8; 16]],
    points: &[u16; PARTITIONS],
    output: &mut SecretBlocks,
    context: &mut Context<'_, impl Transport>,
) -> Result<()> {
    let aes = ciphers();
    let last_hash = hash_cipher();
    for group in (0..PARTITIONS).step_by(TREES) {
        let message = context.receive(MESSAGE_BLOCKS * 16).await?;
        let mut tree = SecretBlocks::zeroed((2 * DOMAIN - 1) * TREES);
        for depth in 0..DEPTH {
            let sums = expand_level(&mut tree, depth, &aes);
            let mut corrections = SecretBlocks::zeroed(2 * TREES);
            let mut inactive_paths = Zeroizing::new([0u16; TREES]);
            let mut active_paths = Zeroizing::new([0u16; TREES]);
            for lane in 0..TREES {
                active_paths[lane] = points[group + lane] >> (DEPTH - 1 - depth);
                inactive_paths[lane] = active_paths[lane] ^ 1;
                let base_index = (group + lane) * DEPTH + DEPTH - 1 - depth;
                if depth < DEPTH - 1 {
                    for branch in 0..2 {
                        corrections.0[branch * TREES + lane] =
                            read_block(&message, (depth * 2 + branch) * TREES + lane)
                                ^ Block::new(base[base_index])
                                ^ sums.0[branch * TREES + lane];
                    }
                } else {
                    let offset = 2 * (DEPTH - 1) * TREES + lane * 4;
                    let mut key = Zeroizing::new(base[base_index]);
                    let first = hash(&last_hash, &key);
                    for byte in key.iter_mut() {
                        *byte ^= 0xff;
                    }
                    let second = hash(&last_hash, &key);
                    for branch in 0..2 {
                        let inactive = (inactive_paths[lane] & 1).ct_eq(&(branch as u16));
                        let mut first_message =
                            read_block(&message, offset + 2 * branch) ^ Block::new(*first);
                        let mut second_message =
                            read_block(&message, offset + 2 * (branch ^ 1) + 1)
                                ^ Block::new(*second);
                        corrections.0[branch * TREES + lane] = (first_message & mask(inactive))
                            ^ (second_message & mask(!inactive))
                            ^ sums.0[branch * TREES + lane];
                        first_message.as_mut_bytes().zeroize();
                        second_message.as_mut_bytes().zeroize();
                    }
                }
            }
            let child_start = ((1 << (depth + 1)) - 1) * TREES;
            for node in 0..1 << (depth + 1) {
                for lane in 0..TREES {
                    let mut selected = (node as u16).ct_eq(&inactive_paths[lane]);
                    if depth == DEPTH - 1 {
                        selected |= (node as u16).ct_eq(&active_paths[lane]);
                    }
                    tree.0[child_start + node * TREES + lane] ^=
                        corrections.0[(node & 1) * TREES + lane] & mask(selected);
                }
            }
        }
        let source = (DOMAIN - 1) * TREES;
        let destination = group * DOMAIN;
        for node in 0..DOMAIN {
            for lane in 0..TREES {
                let mut block = tree.0[source + node * TREES + lane];
                block.as_mut_bytes()[0] &= 0xfe;
                block.as_mut_bytes()[0] |= (node as u16).ct_eq(&points[group + lane]).unwrap_u8();
                output.0[destination + node * TREES + lane] = block;
                block.as_mut_bytes().zeroize();
            }
        }
    }
    Ok(())
}
