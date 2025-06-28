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
const { v4: uuidv4 } = require('uuid'); // Install with: npm install uuid

const pendingAcks = new Map(); // message_id => { timeout, user_id }

function sendPushNotification(filter, message) {
  const messageId = uuidv4();
  message.id = messageId;

  console.log(`📢 Sending Push Notification`, { filter, message });

  let matched = 0;

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && clientsInfo.has(client)) {
      const info = clientsInfo.get(client);

      const match = Object.entries(filter).every(([key, val]) => {
        if (!val) return true;
        return info[key] === val;
      });

      if (match) {
        matched++;
        try {
          client.send(JSON.stringify({
            type: 'notification',
            message,
            from: 'server',
          }));

          // Wait for ACK within 10s
          const timeout = setTimeout(() => {
            console.warn(`❌ No ACK for message ${messageId} from user ${info.user_id}`);
            pendingAcks.delete(messageId);
          }, 2000);

          pendingAcks.set(messageId, { timeout, user_id: info.user_id });

        } catch (err) {
          console.error(`❌ Error sending message to user ${info.user_id}:`, err.message);
        }
      }
    }
  });

  if (matched === 0) {
    console.warn(`⚠️ No clients matched for push notification`, filter);
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
