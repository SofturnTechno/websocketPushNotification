const WebSocket = require('ws');
const port = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

const wss = new WebSocket.Server({ port });
const clientsInfo = new Map(); // ws => { user data }

function log(message, data = null) {
  if (isProd) return; // skip logs in production
  const time = new Date().toISOString();
  console.log(`[${time}] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

// Heartbeat to detect and terminate dead clients
function heartbeat() {
  this.isAlive = true;
}

// Register client data
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

// Broadcast notification to matching clients
function SendNotification(filter, message) {
  console.log(`📢 Broadcasting Message`, { filter, message });

  let matchedCount = 0;

  wss.clients.forEach(client => {
    const info = clientsInfo.get(client);

    const match = info && Object.entries(filter).every(([key, val]) => {
      if (!val) return true; // skip null filters
      return info[key] === val;
    });

    if (match) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(JSON.stringify({
            type: 'notification',
            message,
            from: 'server',
          }));
          matchedCount++;
        } catch (err) {
          log('❌ Failed to send message to client', {
            user: info,
            error: err.message,
          });
        }
      } else {
        log('⚠️ Client is disconnected (not OPEN)', {
          user: info,
          readyState: client.readyState,
        });
      }
    }
  });

  if (matchedCount === 0) {
    log(`⚠️ No clients matched filter`, filter);
  }
}


// Setup connection
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', heartbeat);

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

  // Handle client disconnect
  function cleanup() {
    clientsInfo.delete(ws);
    log('❌ Client disconnected/cleaned up');
  }

  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

// Interval to clean up dead sockets
const interval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) {
      clientsInfo.delete(ws);
      ws.terminate();
      log('🧹 Terminated dead connection');
      return;
    }

    ws.isAlive = false;
    ws.ping(() => {});
  });
}, 30000); // every 30 seconds

// Clean shutdown
wss.on('close', () => clearInterval(interval));

log(`🚀 WebSocket server running on port ${port}`);
