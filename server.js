const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';
const pendingFile = path.join(__dirname, 'pushNotificationPending.json');

const wss = new WebSocket.Server({ port });
const clientsInfo = new Map(); // ws => { user data }

function log(message, data = null) {
  if (isProd) return;
  const time = new Date().toISOString();
  console.log(`[${time}] ${message}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

function heartbeat() {
  this.isAlive = true;
}

function ensurePendingFile() {
  if (!fs.existsSync(pendingFile)) {
    fs.writeFileSync(pendingFile, '[]');
  }
}

function loadPendingMessages() {
  ensurePendingFile();
  return JSON.parse(fs.readFileSync(pendingFile, 'utf-8'));
}

function savePendingMessages(messages) {
  fs.writeFileSync(pendingFile, JSON.stringify(messages, null, 2));
}

function queuePendingMessage(messageObj) {
  const current = loadPendingMessages();
  current.push(messageObj);
  savePendingMessages(current);
}

function partition(array, predicate) {
  const matched = [], unmatched = [];
  for (const item of array) {
    (predicate(item) ? matched : unmatched).push(item);
  }
  return [matched, unmatched];
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

  // Send pending messages
  const allPending = loadPendingMessages();
  const [toSend, remaining] = partition(allPending, item =>
    item.user_id === userInfo.user_id &&
    item.domain === userInfo.domain &&
    item.platform === userInfo.platform &&
    item.role === userInfo.role
  );

  toSend.forEach(item => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'notification', message: item.message }), (err) => {
        if (err) {
          log(`❌ Send failed. Re-adding to pending`, item);
          queuePendingMessage(item);
        } else {
          log(`✅ Pending message delivered to ${userInfo.user_id}`);
        }
      });
    } else {
      log(`❌ WebSocket not open for ${userInfo.user_id}, re-queuing message`);
      queuePendingMessage(item);
    }
  });

  savePendingMessages(remaining);
  ws.send(JSON.stringify({ status: 'registered' }));
}

function SendNotification(filter, message) {
  console.log(`📢 Broadcasting Message`, { filter, message });

  let matched = false;

  wss.clients.forEach(client => {
    if (client.readyState !== WebSocket.OPEN || !clientsInfo.has(client)) return;

    const info = clientsInfo.get(client);
    const match = Object.entries(filter).every(([key, val]) => !val || info[key] === val);

    if (match) {
      matched = true;
      client.send(JSON.stringify({ type: 'notification', message }), (err) => {
        if (err) {
          log(`❌ Failed to send. Queuing for ${info.user_id}`);
          queuePendingMessage({ ...filter, message });
        } else {
          log(`✅ Notification sent to ${info.user_id}`);
        }
      });
    }
  });

  if (!matched) {
    log(`⚠️ No matching client connected. Queuing message`);
    queuePendingMessage({ ...filter, message });
  }
}

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  log('🔌 Client connected');

  ws.on('message', message => {
    try {
      const data = JSON.parse(message);
      switch (data.type) {
        case 'register':
          RegisterClient(ws, data.user || {});
          break;
        case 'broadcast':
          SendNotification(data, data.message);
          break;
        default:
          ws.send(JSON.stringify({ status: 'error', message: 'Unknown message type' }));
      }
    } catch (err) {
      log('❌ Invalid JSON', { error: err.message });
      ws.send(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
    }
  });

  ws.on('close', () => {
    clientsInfo.delete(ws);
    log('❌ Client disconnected');
  });

  ws.on('error', () => {
    clientsInfo.delete(ws);
    log('❌ Client error');
  });
});

const interval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) {
      clientsInfo.delete(ws);
      ws.terminate();
      log('🧹 Terminated dead socket');
    } else {
      ws.isAlive = false;
      ws.ping(() => {});
    }
  });
}, 30000);

wss.on('close', () => clearInterval(interval));

log(`🚀 WebSocket server running on port ${port}`);
