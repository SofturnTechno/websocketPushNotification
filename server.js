const WebSocket = require('ws');

const port = process.env.PORT || 3001;
const wss = new WebSocket.Server({ port });

// Store client info: ws => clientInfo object
const clientsInfo = new Map();

// Function to register a client with their info
function RegisterClient(ws, data) {
  clientsInfo.set(ws, {
    domain: data.domain,
    platform: data.platform,
    user_id: data.user_id,
    first_name: data.first_name,
    role: data.role,
  });
  console.log(`Client registered: ${data.user_id} on domain ${data.domain}`);
  ws.send(JSON.stringify({ status: 'registered' }));
}

// Function to send notification to filtered clients
function SendNotification(filter, message) {
  wss.clients.forEach(client => {
    if (
      client.readyState === WebSocket.OPEN &&
      clientsInfo.has(client)
    ) {
      const info = clientsInfo.get(client);

      // Check filters: send if all filter keys match or if filter key not provided
      const match = Object.entries(filter).every(([key, val]) => {
        // If filter value is null/undefined/empty, skip that filter
        if (!val) return true;
        return info[key] === val;
      });

      if (match) {
        client.send(JSON.stringify({
          type: 'notification',
          message,
          from: 'server',
        }));
      }
    }
  });
}

wss.on('connection', ws => {
  console.log('Client connected');

  ws.on('message', message => {
    console.log('Received from client:', message);

    try {
      const data = JSON.parse(message);

      switch(data.type) {
        case 'register':
          RegisterClient(ws, data);
          break;

        case 'broadcast':
          // Expecting data.message and optional filter keys domain, platform, user_id, etc.
          const { message: msg, domain, platform, user_id } = data;
          SendNotification({ domain, platform, user_id }, msg);
          ws.send(JSON.stringify({ status: 'broadcast_sent' }));
          break;

        default:
          ws.send(JSON.stringify({ status: 'error', message: 'Unknown message type' }));
      }
    } catch (e) {
      console.error('Invalid JSON', e);
      ws.send(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
    }
  });

  ws.on('close', () => {
    clientsInfo.delete(ws);
    console.log('Client disconnected and removed from clientsInfo');
  });
});

console.log(`WebSocket server running on port ${port}`);
