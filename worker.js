import { connect } from 'cloudflare:sockets';

const VALID_UUID = "eb231f45-8b1a-4b2a-9f1a-5b231f458b1a";
const SERVICE_NAME = "vless-grpc";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const contentType = request.headers.get('content-type') || '';

    // Validasi Service Name melalui URL Path
    if (url.pathname.includes(SERVICE_NAME) && contentType.includes('application/grpc')) {
      return await handleVLESSgRPC(request, ctx);
    }

    return new Response('gRPC Node is On', { status: 200 });
  },
};

async function handleVLESSgRPC(request, ctx) {
  const { readable, writable } = new TransformStream();
  const reader = request.body.getReader();
  let remoteSocket = null;
  let isConnected = false;

  const processStream = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (!isConnected) {
          // Parsing UUID (Index 1-17)
          const clientUUID = [...value.slice(1, 17)].map(b => b.toString(16).padStart(2, '0')).join('');
          if (clientUUID !== VALID_UUID.replace(/-/g, '')) break;

          // Parsing Port & Address
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

          // Forward sisa data payload
          const payload = value.slice(addressEnd);
          if (payload.length > 0) {
            const tcpWriter = remoteSocket.writable.getWriter();
            await tcpWriter.write(payload);
            tcpWriter.releaseLock();
          }

          // Full Duplex Pipe
          remoteSocket.readable.pipeTo(writable);
        } else {
          const tcpWriter = remoteSocket.writable.getWriter();
          await tcpWriter.write(value);
          tcpWriter.releaseLock();
        }
      }
    } catch (err) {
      console.log("Stream Error: " + err.message);
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