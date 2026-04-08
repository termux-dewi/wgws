// Cloudflare Worker: WebSocket Proxy
export default {
  async fetch(request, env) {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Harus menggunakan WebSocket', { status: 426 });
    }

    // KONFIGURASI SERVER TUJUAN (DARI VPNJANTIT)
    const remoteHost = 'id1.vpnjantit.com'; // Sesuaikan host dari config WG anda
    const remotePort = 443; // Coba port 443 (TCP/TLS) atau 80

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    try {
      // Menggunakan Cloudflare 'connect' API untuk meneruskan trafik
      const socket = connect(`${remoteHost}:${remotePort}`);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Forward dari Client (WS) ke VPNJantit (TCP)
      server.addEventListener('message', async (event) => {
        await writer.write(event.data);
      });

      // Forward dari VPNJantit (TCP) ke Client (WS)
      (async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            server.close();
            break;
          }
          server.send(value);
        }
      })();

    } catch (e) {
      return new Response("Koneksi ke Server Gagal", { status: 503 });
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
};
