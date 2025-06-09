const WebSocket = require('ws');

// Use Render-provided port, or fallback to 3001 locally
const port = process.env.PORT || 3001;

const wss = new WebSocket.Server({ port });

wss.on('connection', ws => {
  console.log('Client connected');


  ws.on('message', message => {
    console.log('Received from client:', message);

    // Parse JSON safely
    try {
      const data = JSON.parse(message);
      console.log('Parsed data:', data);

      // Example response
      ws.send(JSON.stringify({ status: 'ok', received: data }));
    } catch (e) {
      console.error('Invalid JSON', e);
      ws.send(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

console.log(`WebSocket server running on port ${port}`);
