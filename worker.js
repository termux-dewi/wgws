import { connect } from 'cloudflare:sockets';

export default {
  async fetch(request, env, ctx) {
    const upgradeHeader = request.headers.get('Upgrade');
    
    // Deteksi jika request adalah gRPC/Stream
    if (request.headers.get('content-type') === 'application/grpc' || upgradeHeader === 'websocket') {
      return await vlessOverGRPC(request);
    }

    return new Response('VLESS-gRPC Worker is Running', { status: 200 });
  },
};

async function vlessOverGRPC(request) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const reader = request.body.getReader();

  // Handle stream dari Client ke Remote
  let isHeaderParsed = false;
  let remoteSocket = null;

  async function processClientStream() {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (!isHeaderParsed) {
          // Parsing Header VLESS (Sederhana)
          // [0] Ver, [1-16] UUID, [17] Addons, [18] Command
          const addressType = value[21]; 
          let addressLength = 0;
          let address = '';
          let portIndex = 19;

          if (addressType === 2) { // Domain Name
            addressLength = value[22];
            address = new TextDecoder().decode(value.slice(23, 23 + addressLength));
            portIndex = 23 + addressLength - 2;
          }

          const port = (value[portIndex] << 8) | value[portIndex + 1];

          // Buka koneksi ke Target (VPNJantit)
          remoteSocket = connect({ hostname: address, port: port });
          isHeaderParsed = true;

          // Teruskan sisa data setelah header
          const payload = value.slice(portIndex + 2 + addressLength);
          if (payload.length > 0) {
            const remoteWriter = remoteSocket.writable.getWriter();
            await remoteWriter.write(payload);
            remoteWriter.releaseLock();
          }

          // Pipe data dari Remote kembali ke Client
          remoteSocket.readable.pipeTo(writable);
        } else if (remoteSocket) {
          const remoteWriter = remoteSocket.writable.getWriter();
          await remoteWriter.write(value);
          remoteWriter.releaseLock();
        }
      }
    } catch (err) {
      console.error('Stream Error:', err);
    }
  }

  processClientStream();

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'application/grpc',
      'X-Accel-Buffering': 'no', // Penting untuk streaming instan
    },
  });
}