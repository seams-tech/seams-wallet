//! Wire arenas for validated circuit schedules.
/// Allocates empty slots for a validated circuit schedule.
pub fn empty_arena<T>(length: usize) -> Vec<Option<T>> {
    let mut arena = Vec::with_capacity(length);
    let mut index = 0_usize;
    while index < length {
        arena.push(None);
        index += 1;
    }
    arena
}

/// Installs the validated input wires in schedule order.
pub fn install_inputs<T>(arena: &mut [Option<T>], inputs: Vec<T>) {
    for (slot, input) in inputs.into_iter().enumerate() {
        arena[slot] = Some(input);
    }
}

/// A validated schedule referenced an uninitialized wire.
#[derive(Debug)]
pub struct MissingWire;
/// Borrow the installed wire at a validated slot.
pub fn required_wire<T>(arena: &[Option<T>], slot: usize) -> Result<&T, MissingWire> {
    arena[slot].as_ref().ok_or(MissingWire)
}
