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
    username: data.username || '' // optional if available
  };

  clientsInfo.set(ws, userInfo);
  log(`✅ Client Registered`, userInfo);

  ws.send(JSON.stringify({ status: 'registered' }));

  // Send POST request to PHP server
  fetch('https://qataraddress.counterbill.com/websocket_push_notification.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'add_client',
      ...userInfo
    })
  })
  .then(res => res.json())
  .then(response => {
    console.log('☁️ Sent to PHP API', response);
  })
  .catch(err => {
    console.log('❌ Error sending to PHP API', { error: err.message });
  });
}


// Broadcast notification to matching clients
function SendNotification(filter, message) {
  console.log(`📢 Broadcasting Message`, { filter, message });

  let matchedCount = 0;
// Send to PHP API to store as pending notification
      const payload = {
        action: 'add_notification',
        message: message,
        status: 'pending',
        receiving_status: '0',
        ...filter // includes domain, platform, user_id, role
      };
      console.log('📤 Sending to PHP API', payload);
      fetch('https://qataraddress.counterbill.com/websocket_push_notification.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(res => res.json())
      .then(response => {
        console.log('✅ Stored in DB via API:', response);
      })
      .catch(err => {
        console.error('❌ Error calling API for offline client:', err.message);
      });

  wss.clients.forEach(client => {
    if (
      client.readyState === WebSocket.OPEN &&
      clientsInfo.has(client)
    ) {
      const info = clientsInfo.get(client);

      const match = Object.entries(filter).every(([key, val]) => {
        if (!val) return true; // skip null filters
        return info[key] === val;
      });

      if (match) {
        matchedCount++;
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
        case 'ping':
    log('🔄 Ping received from client');
    ws.send(JSON.stringify({
      type: 'status', 
      message: 'pong'
    }));
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
