const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';
const pendingFile = path.join(__dirname, 'pushNotificationPending.json');

const wss = new WebSocket.Server({ port });
const clientsInfo = new Map(); // ws => { user data }

function log(message, data = null) {
  if (isProd) return; // skip logs in production
  const time = new Date().toISOString();
  console.log(`[${time}] ${message}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

function heartbeat() {
  this.isAlive = true;
  log('🏓 Pong received, heartbeat alive');
}

function ensurePendingFile() {
  if (!fs.existsSync(pendingFile)) {
    log('📄 Pending file missing. Creating new one.');
    fs.writeFileSync(pendingFile, '[]');
  }
}

function loadPendingMessages() {
  ensurePendingFile();
  try {
    const data = fs.readFileSync(pendingFile, 'utf-8');
    const messages = JSON.parse(data);
    log(`📂 Loaded ${messages.length} pending messages from disk`);
    return messages;
  } catch (err) {
    log('❌ Error loading pending messages, resetting file.', { error: err.message });
    fs.writeFileSync(pendingFile, '[]');
    return [];
  }
}

function savePendingMessages(messages) {
  try {
    fs.writeFileSync(pendingFile, JSON.stringify(messages, null, 2));
    log(`💾 Saved ${messages.length} pending messages to disk`);
  } catch (err) {
    log('❌ Failed to save pending messages.', { error: err.message });
  }
}

function queuePendingMessage(messageObj) {
  log('➕ Queueing pending message', messageObj);
  const current = loadPendingMessages();
  current.push(messageObj);
  savePendingMessages(current);
}

function partition(array, predicate) {
  const matched = [], unmatched = [];
  for (const item of array) {
    (predicate(item) ? matched : unmatched).push(item);
  }
  log(`🔀 Partitioned array into ${matched.length} matched and ${unmatched.length} unmatched items`);
  return [matched, unmatched];
}

function RegisterClient(ws, data) {
  log('➡ RegisterClient called with data', data);
  const userInfo = {
    domain: data.domain,
    platform: data.platform,
    user_id: data.user_id,
    first_name: data.first_name,
    role: data.role,
  };

  clientsInfo.set(ws, userInfo);
  log(`✅ Client registered`, userInfo);

  // Send pending messages
  const allPending = loadPendingMessages();
  const [toSend, remaining] = partition(allPending, item =>
    item.user_id === userInfo.user_id &&
    item.domain === userInfo.domain &&
    item.platform === userInfo.platform &&
    item.role === userInfo.role
  );

  log(`📨 Sending ${toSend.length} pending messages to user ${userInfo.user_id}`);

  toSend.forEach(item => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'notification', message: item.message }), (err) => {
        if (err) {
          log(`❌ Send failed for pending message, re-queueing`, item);
          queuePendingMessage(item);
        } else {
          log(`✅ Pending message delivered to user ${userInfo.user_id}`);
        }
      });
    } else {
      log(`❌ WebSocket not open for user ${userInfo.user_id}, re-queueing message`, item);
      queuePendingMessage(item);
    }
  });

  savePendingMessages(remaining);
  ws.send(JSON.stringify({ status: 'registered' }));
}

function SendNotification(filter, message) {
  log(`📢 SendNotification called`, { filter, message });

  let matched = false;

  wss.clients.forEach(client => {
    if (client.readyState !== WebSocket.OPEN || !clientsInfo.has(client)) return;

    const info = clientsInfo.get(client);
    const match = Object.entries(filter).every(([key, val]) => !val || info[key] === val);

    if (match) {
      matched = true;
      client.send(JSON.stringify({ type: 'notification', message }), (err) => {
        if (err) {
          log(`❌ Failed to send notification to user ${info.user_id}, queuing message`, { message });
          queuePendingMessage({ ...filter, message });
        } else {
          log(`✅ Notification sent to user ${info.user_id}`);
        }
      });
    }
  });

  if (!matched) {
    log(`⚠️ No matching client connected, queuing message`, { filter, message });
    queuePendingMessage({ ...filter, message });
  }
}

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  log('🔌 Client connected, total clients: ' + wss.clients.size);

  ws.on('message', message => {
    log('📥 Raw message received', message);

    try {
      const data = JSON.parse(message);
      log('📦 Parsed message', data);

      switch (data.type) {
        case 'register':
          RegisterClient(ws, data.user || {});
          break;
        case 'broadcast':
          SendNotification(data, data.message);
          break;
        default:
          log('❌ Unknown message type received', data);
          ws.send(JSON.stringify({ status: 'error', message: 'Unknown message type' }));
      }
    } catch (err) {
      log('❌ Invalid JSON received', { error: err.message });
      ws.send(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
    }
  });

  ws.on('close', (code, reason) => {
    clientsInfo.delete(ws);
    log(`❌ Client disconnected (code: ${code}, reason: ${reason}), total clients: ${wss.clients.size}`);
  });

  ws.on('error', error => {
    clientsInfo.delete(ws);
    log('❌ Client error occurred', { error: error.message });
  });
});

const interval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) {
      clientsInfo.delete(ws);
      ws.terminate();
      log('🧹 Terminated dead socket, total clients: ' + wss.clients.size);
    } else {
      ws.isAlive = false;
      ws.ping(() => {
        log('🏓 Ping sent to client');
      });
    }
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
  log('🛑 WebSocket server closed');
});

log(`🚀 WebSocket server running on port ${port}`);
