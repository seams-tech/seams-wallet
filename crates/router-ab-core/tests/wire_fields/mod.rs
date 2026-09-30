//! Field edits on the u32-length-prefixed canonical bytes that the role-command and
//! capability tests tamper with.

use std::ops::Range;

pub fn field_ranges(bytes: &[u8]) -> Vec<Range<usize>> {
    let mut ranges = Vec::new();
    let mut offset = 0;
    while offset < bytes.len() {
        let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        let start = offset + 4;
        ranges.push(start..start + length);
        offset = start + length;
    }
    assert_eq!(offset, bytes.len());
    ranges
}

pub fn replace_field(bytes: &[u8], index: usize, replacement: &[u8]) -> Vec<u8> {
    let range = field_ranges(bytes)[index].clone();
    assert_eq!(range.len(), replacement.len());
    let mut result = bytes.to_vec();
    result[range].copy_from_slice(replacement);
    result
}
