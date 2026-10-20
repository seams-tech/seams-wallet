//! Drops PostgreSQL's COMMIT acknowledgement after the real server commits.

use std::io;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{tcp::OwnedReadHalf, tcp::OwnedWriteHalf, TcpListener, TcpStream};
use tokio::task::JoinHandle;
use tokio_postgres::{Client, Config, NoTls};

pub(super) async fn connect(config: &Config) -> (Client, JoinHandle<io::Result<bool>>) {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("proxy listener");
    let address = listener.local_addr().expect("proxy address");
    let port = *config
        .get_ports()
        .first()
        .expect("explicit local database port");
    let proxy = tokio::spawn(serve(listener, port));
    let stream = TcpStream::connect(address).await.expect("proxy socket");
    let (client, connection) = config
        .connect_raw(stream, NoTls)
        .await
        .expect("proxied connection");
    tokio::spawn(connection);
    (client, proxy)
}

async fn serve(listener: TcpListener, port: u16) -> io::Result<bool> {
    let (client, _) = listener.accept().await?;
    let server = TcpStream::connect(("127.0.0.1", port)).await?;
    let (mut client_read, client_write) = client.into_split();
    let (server_read, mut server_write) = server.into_split();
    tokio::select! {
        result = tokio::io::copy(&mut client_read, &mut server_write) => {
            result?;
            Ok(false)
        }
        result = relay_until_commit(server_read, client_write) => result,
    }
}

async fn relay_until_commit(
    mut server: OwnedReadHalf,
    mut client: OwnedWriteHalf,
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
        if tag == b'C' && body == b"COMMIT\0" {
            return Ok(true);
        }
        client.write_u8(tag).await?;
        client.write_u32(length).await?;
        client.write_all(&body).await?;
    }
}
