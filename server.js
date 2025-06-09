const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 3001 });

wss.on('connection', ws => {
  console.log('Client connected');

  ws.on('message', message => {
    console.log('Received from client:', message);

    // You can parse JSON here
    try {
      const data = JSON.parse(message);
      console.log('Parsed data:', data);
      // Process data as you want
    } catch (e) {
      console.error('Invalid JSON', e);
    }

    // Optionally send response
    ws.send('Data received');
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });

  ws.send('Welcome to the WebSocket server!');
});

console.log('WebSocket server running on ws://localhost:3001');
