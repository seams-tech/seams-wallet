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
const PREPARATION_BOUNDARIES: u8 = 8;

enum Scheduling {
    Online,
    Preparation { remaining: u8 },
}

pub(super) struct Duplex<'a> {
    socket: &'a WebSocket,
    events: EventStream<'a>,
    deadline: u64,
    sent: u32,
    acknowledged: u32,
    received: u32,
    pending: VecDeque<Vec<u8>>,
    scheduling: Scheduling,
}
impl<'a> Duplex<'a> {
    pub(super) fn new(socket: &'a WebSocket, deadline: u64) -> worker::Result<Self> {
        Self::with_scheduling(socket, deadline, Scheduling::Online)
    }
    pub(super) fn for_preparation(socket: &'a WebSocket, deadline: u64) -> worker::Result<Self> {
        Self::with_scheduling(
            socket,
            deadline,
            Scheduling::Preparation {
                remaining: PREPARATION_BOUNDARIES,
            },
        )
    }
    fn with_scheduling(
        socket: &'a WebSocket,
        deadline: u64,
        scheduling: Scheduling,
    ) -> worker::Result<Self> {
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
            scheduling,
        })
    }
    async fn cooperate(&mut self) -> core::result::Result<(), RuntimeError> {
        let yield_now = match &mut self.scheduling {
            Scheduling::Online => false,
            Scheduling::Preparation { remaining } => {
                *remaining -= 1;
                if *remaining == 0 {
                    *remaining = PREPARATION_BOUNDARIES;
                    true
                } else {
                    false
                }
            }
        };
        if yield_now {
            // Promise-ready socket reads can monopolize the event loop. A timer
            // yields at a fixed public frame count, independent of secret values.
            worker::Delay::from(Duration::ZERO).await;
            self.remaining()?;
        }
        Ok(())
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
        self.cooperate().await?;
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
        self.cooperate().await?;
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
    /// Wait for delivery acknowledgments before the server closes its socket.
    pub(super) async fn flush(&mut self) -> core::result::Result<(), RuntimeError> {
        while self.acknowledged < self.sent {
            self.poll().await?;
        }
        if !self.pending.is_empty() {
            return Err(RuntimeError::SessionBinding);
        }
        Ok(())
    }
    pub(super) async fn peer_closed(&mut self) -> core::result::Result<bool, RuntimeError> {
        if self.acknowledged != self.sent || !self.pending.is_empty() {
            return Err(RuntimeError::SessionBinding);
        }
        match self.event().await? {
            WebsocketEvent::Close(event) if event.code() == 1000 => Ok(event.was_clean()),
            _ => Err(RuntimeError::SessionBinding),
        }
    }
    async fn event(&mut self) -> core::result::Result<WebsocketEvent, RuntimeError> {
        let delay = worker::Delay::from(Duration::from_millis(self.remaining()?));
        let event = self.events.next();
        futures::pin_mut!(delay, event);
        match select(event, delay).await {
            Either::Left((event, _)) => event
                .ok_or(RuntimeError::MessageLength)?
                .map_err(transport_error),
            Either::Right(_) => Err(RuntimeError::SessionBinding),
        }
    }
    async fn poll(&mut self) -> core::result::Result<(), RuntimeError> {
        let WebsocketEvent::Message(message) = self.event().await? else {
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
