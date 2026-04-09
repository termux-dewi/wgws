import { connect } from 'cloudflare:sockets';

const VALID_UUID = "eb231f45-8b1a-4b2a-9f1a-5b231f458b1a";

export default {
  async fetch(request, env, ctx) {
    // Pastikan request adalah POST dan menggunakan content-type gRPC
    if (request.method === 'POST' && request.headers.get('content-type')?.includes('application/grpc')) {
      return await handleVLESSgRPC(request, ctx);
    }
    return new Response('VLESS gRPC Server is Online', { status: 200 });
  },
};

async function handleVLESSgRPC(request, ctx) {
  const { readable, writable } = new TransformStream();
  const reader = request.body.getReader();
  const writer = writable.getWriter();

  let isConnected = false;
  let remoteSocket = null;

  // Fungsi untuk memproses stream dari klien
  const processStream = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (!isConnected) {
          // Parsing VLESS Header (Standard Xray/V2Ray)
          // Index 1-17: UUID
          const clientUUID = [...value.slice(1, 17)].map(b => b.toString(16).padStart(2, '0')).join('');
          if (clientUUID !== VALID_UUID.replace(/-/g, '')) {
            console.log("Unauthorized: UUID Mismatch");
            break;
          }

          // Parsing Port (2 bytes) & Address
          const port = (value[18] << 8) | value[19];
          const addressType = value[20];
          let address = '';
          let addressEnd = 21;

          if (addressType === 0x02) { // Domain
            const len = value[21];
            address = new TextDecoder().decode(value.slice(22, 22 + len));
            addressEnd = 22 + len;
          } else if (addressType === 0x01) { // IPv4
            address = value.slice(21, 25).join('.');
            addressEnd = 25;
          }

          // Dial ke Target (VPNJantit)
          remoteSocket = connect({ hostname: address, port: port });
          isConnected = true;

          // Teruskan data payload setelah header
          const payload = value.slice(addressEnd);
          if (payload.length > 0) {
            const tcpWriter = remoteSocket.writable.getWriter();
            await tcpWriter.write(payload);
            tcpWriter.releaseLock();
          }

          // Pipe data balik dari server target ke klien
          remoteSocket.readable.pipeTo(writable);
        } else {
          // Kirim data langsung ke target socket
          const tcpWriter = remoteSocket.writable.getWriter();
          await tcpWriter.write(value);
          tcpWriter.releaseLock();
        }
      }
    } catch (err) {
      console.log("gRPC Stream Error: " + err.message);
    } finally {
      if (remoteSocket) remoteSocket.close();
    }
  };

  ctx.waitUntil(processStream());

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'application/grpc',
      'X-Accel-Buffering': 'no',
      'grpc-status': '0',
      'grpc-message': 'OK'
    }
  });
}