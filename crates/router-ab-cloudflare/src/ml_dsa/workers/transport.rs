//! Bounded binary messages. Every blocked receive ends at the operation deadline.
use ed25519_yao::ml_dsa_runtime::{boolean_comparison as boolean, prepared, RuntimeError};
use futures::{
    future::{select, Either},
    StreamExt,
};
use std::{collections::VecDeque, time::Duration};
use worker::{EventStream, WebSocket, WebsocketEvent};
const WINDOW: u32 = 8;
const MAX_BYTES: usize = ed25519_yao::ml_dsa_runtime::MAX_MESSAGE_BYTES;

pub(super) struct Duplex<'a> {
    socket: &'a WebSocket,
    events: EventStream<'a>,
    deadline: u64,
    sent: u32,
    acknowledged: u32,
    received: u32,
    pending: VecDeque<Vec<u8>>,
}
impl<'a> Duplex<'a> {
    pub(super) fn new(socket: &'a WebSocket, deadline: u64) -> worker::Result<Self> {
        socket
            .as_ref()
            .set_binary_type(worker::web_sys::BinaryType::Arraybuffer);
        let events = socket.events()?;
        socket.accept()?;
        Ok(Self {
            socket,
            events,
            deadline,
            sent: 0,
            acknowledged: 0,
            received: 0,
            pending: VecDeque::new(),
        })
    }
    fn remaining(&self) -> core::result::Result<u64, RuntimeError> {
        let now = crate::cloudflare_now_unix_ms_v1().map_err(transport_error)?;
        self.deadline
            .checked_sub(now)
            .filter(|left| *left > 0)
            .ok_or(RuntimeError::SessionBinding)
    }
    pub(super) async fn send(&mut self, bytes: &[u8]) -> core::result::Result<(), RuntimeError> {
        self.remaining()?;
        if bytes.len() > MAX_BYTES {
            return Err(RuntimeError::MessageLength);
        }
        while self.sent - self.acknowledged >= WINDOW {
            self.poll().await?;
        }
        let next = self
            .sent
            .checked_add(1)
            .ok_or(RuntimeError::MessageLength)?;
        let mut frame = Vec::with_capacity(bytes.len() + 5);
        frame.push(0);
        frame.extend_from_slice(&self.sent.to_le_bytes());
        frame.extend_from_slice(bytes);
        self.socket
            .send_with_bytes(frame)
            .map_err(transport_error)?;
        self.sent = next;
        Ok(())
    }
    pub(super) async fn receive(
        &mut self,
        length: usize,
    ) -> core::result::Result<Vec<u8>, RuntimeError> {
        self.remaining()?;
        if length > MAX_BYTES {
            return Err(RuntimeError::MessageLength);
        }
        loop {
            if let Some(bytes) = self.pending.pop_front() {
                if bytes.len() != length {
                    return Err(RuntimeError::MessageLength);
                }
                return Ok(bytes);
            }
            self.poll().await?;
        }
    }
    async fn poll(&mut self) -> core::result::Result<(), RuntimeError> {
        let delay = worker::Delay::from(Duration::from_millis(self.remaining()?));
        let event = self.events.next();
        futures::pin_mut!(delay, event);
        let event = match select(event, delay).await {
            Either::Left((event, _)) => event
                .ok_or(RuntimeError::MessageLength)?
                .map_err(transport_error)?,
            Either::Right(_) => return Err(RuntimeError::SessionBinding),
        };
        let WebsocketEvent::Message(message) = event else {
            return Err(RuntimeError::MessageLength);
        };
        let bytes = message.bytes().ok_or(RuntimeError::MessageLength)?;
        if bytes.len() < 5 || bytes.len() > MAX_BYTES + 5 {
            return Err(RuntimeError::MessageLength);
        }
        let sequence = u32::from_le_bytes(bytes[1..5].try_into().map_err(transport_error)?);
        match bytes[0] {
            0 if sequence == self.received && self.pending.len() < WINDOW as usize => {
                self.received = self
                    .received
                    .checked_add(1)
                    .ok_or(RuntimeError::MessageLength)?;
                self.pending.push_back(bytes[5..].to_vec());
                let mut ack = vec![1];
                ack.extend_from_slice(&self.received.to_le_bytes());
                self.socket.send_with_bytes(ack).map_err(transport_error)
            }
            1 if bytes.len() == 5
                && sequence > self.acknowledged
                && sequence - self.acknowledged == 1
                && sequence <= self.sent =>
            {
                self.acknowledged = sequence;
                Ok(())
            }
            _ => Err(RuntimeError::SessionBinding),
        }
    }
}
fn transport_error(_: impl core::fmt::Display) -> RuntimeError {
    RuntimeError::MessageLength
}
impl prepared::Transport for Duplex<'_> {
    async fn send(&mut self, bytes: &[u8]) -> core::result::Result<(), RuntimeError> {
        self.send(bytes).await
    }
    async fn receive(&mut self, length: usize) -> core::result::Result<Vec<u8>, RuntimeError> {
        self.receive(length).await
    }
    async fn store(
        &mut self,
        _: [u8; 32],
        _: usize,
        _: &[u8],
    ) -> core::result::Result<(), RuntimeError> {
        Err(RuntimeError::TableFrame)
    }
    async fn load(
        &mut self,
        _: [u8; 32],
        _: usize,
        _: usize,
    ) -> core::result::Result<Vec<u8>, RuntimeError> {
        Err(RuntimeError::TableFrame)
    }
    fn phase(&mut self, _: prepared::Phase) {}
}
impl boolean::Transport for Duplex<'_> {
    async fn send(&mut self, bytes: &[u8]) -> core::result::Result<(), RuntimeError> {
        self.send(bytes).await
    }
    async fn receive(&mut self, length: usize) -> core::result::Result<Vec<u8>, RuntimeError> {
        self.receive(length).await
    }
    fn phase(&mut self, _: boolean::Phase) {}
}
