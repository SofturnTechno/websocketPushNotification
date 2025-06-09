const WebSocket = require('ws');
const port = process.env.PORT || 3001;
const wss = new WebSocket.Server({ port });

const clientsInfo = new Map(); // ws => { user data }

function log(message, data = null) {
  const time = new Date().toISOString();
  console.log(`[${time}] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function RegisterClient(ws, data) {
  const userInfo = {
    domain: data.domain,
    platform: data.platform,
    user_id: data.user_id,
    first_name: data.first_name,
    role: data.role,
  };

  clientsInfo.set(ws, userInfo);

  log(`✅ Client Registered`, userInfo);

  ws.send(JSON.stringify({ status: 'registered' }));
}

function SendNotification(filter, message) {
  log(`📢 Broadcasting Message`, { filter, message });

  let matchedCount = 0;

  wss.clients.forEach(client => {
    if (
      client.readyState === WebSocket.OPEN &&
      clientsInfo.has(client)
    ) {
      const info = clientsInfo.get(client);

      const match = Object.entries(filter).every(([key, val]) => {
        if (!val) return true; // skip null/undefined filters
        return info[key] === val;
      });

      if (match) {
        matchedCount++;
        log(`➡️ Sending to client`, info);

        client.send(JSON.stringify({
          type: 'notification',
          message,
          from: 'server',
        }));
      }
    }
  });

  if (matchedCount === 0) {
    log(`⚠️ No clients matched filter`, filter);
  }
}

wss.on('connection', ws => {
  log('🔌 Client connected');

  ws.on('message', message => {
    log('📥 Message received from client', { raw: message });

    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'register':
          RegisterClient(ws, data.user || {});
          break;

        case 'broadcast':
          const {
            message: msg,
            domain,
            platform,
            user_id,
            role
          } = data;

          SendNotification({ domain, platform, user_id, role }, msg);
          ws.send(JSON.stringify({ status: 'broadcast_sent' }));
          break;

        default:
          ws.send(JSON.stringify({ status: 'error', message: 'Unknown message type' }));
          log('❌ Unknown message type', data);
      }
    } catch (e) {
      log('❌ Error parsing JSON', { error: e.message });
      ws.send(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
    }
  });

  ws.on('close', () => {
    const info = clientsInfo.get(ws);
    clientsInfo.delete(ws);
    log('❌ Client disconnected', info || {});
  });
});

log(`🚀 WebSocket server running on port ${port}`);
