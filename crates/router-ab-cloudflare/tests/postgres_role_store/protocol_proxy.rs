//! Counts protocol exchanges and can drop an implicit commit acknowledgement.

use std::io;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{tcp::OwnedReadHalf, tcp::OwnedWriteHalf, TcpListener, TcpStream};
use tokio::task::JoinHandle;
use tokio_postgres::{Client, Config, NoTls};

#[derive(Default)]
struct ProtocolState {
    exchanges: AtomicUsize,
    drop_commit: AtomicBool,
}

pub(super) struct ProtocolProbe {
    state: Arc<ProtocolState>,
    task: JoinHandle<io::Result<bool>>,
}

impl ProtocolProbe {
    pub(super) fn reset(&self) {
        self.state.exchanges.store(0, Ordering::SeqCst);
    }

    pub(super) fn exchanges(&self) -> usize {
        self.state.exchanges.load(Ordering::SeqCst)
    }

    pub(super) fn drop_next_commit(&self) {
        self.state.drop_commit.store(true, Ordering::SeqCst);
    }

    pub(super) async fn assert_committed_fault(&mut self) {
        assert!(
            (&mut self.task)
                .await
                .expect("proxy task")
                .expect("proxy relay"),
            "the server must acknowledge an idle connection after commit"
        );
    }
}

impl Drop for ProtocolProbe {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub(super) async fn connect(config: &Config) -> (Client, ProtocolProbe) {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("proxy listener");
    let address = listener.local_addr().expect("proxy address");
    let port = *config
        .get_ports()
        .first()
        .expect("explicit local database port");
    let state = Arc::new(ProtocolState::default());
    let task = tokio::spawn(serve(listener, port, state.clone()));
    let stream = TcpStream::connect(address).await.expect("proxy socket");
    let (client, connection) = config
        .connect_raw(stream, NoTls)
        .await
        .expect("proxied connection");
    tokio::spawn(connection);
    (client, ProtocolProbe { state, task })
}

async fn serve(listener: TcpListener, port: u16, state: Arc<ProtocolState>) -> io::Result<bool> {
    let (client, _) = listener.accept().await?;
    let server = TcpStream::connect(("127.0.0.1", port)).await?;
    client.set_nodelay(true)?;
    server.set_nodelay(true)?;
    let (mut client_read, client_write) = client.into_split();
    let (server_read, mut server_write) = server.into_split();
    tokio::select! {
        result = tokio::io::copy(&mut client_read, &mut server_write) => {
            result?;
            Ok(false)
        }
        result = relay(server_read, client_write, state) => result,
    }
}

async fn relay(
    mut server: OwnedReadHalf,
    mut client: OwnedWriteHalf,
    state: Arc<ProtocolState>,
) -> io::Result<bool> {
    loop {
        let tag = server.read_u8().await?;
        let length = server.read_u32().await?;
        if !(4..=16_777_216).contains(&length) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid PostgreSQL frame",
            ));
        }
        let mut body = vec![0; usize::try_from(length - 4).expect("bounded frame length")];
        server.read_exact(&mut body).await?;
        if tag == b'Z' {
            state.exchanges.fetch_add(1, Ordering::SeqCst);
            if body == b"I" && state.drop_commit.load(Ordering::SeqCst) {
                return Ok(true);
            }
        }
        let mut frame = Vec::with_capacity(body.len() + 5);
        frame.push(tag);
        frame.extend_from_slice(&length.to_be_bytes());
        frame.extend_from_slice(&body);
        client.write_all(&frame).await?;
    }
}
