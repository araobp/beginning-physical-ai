import { handler } from './build/handler.js';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';

// Optional: Load .env file if dotenv is available
// import 'dotenv/config'; 

const GEMINI_API_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent";

const server = createServer(handler);

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/gemini-live') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }
});

wss.on('connection', (clientWs) => {
  console.log('Client connected to Node.js /gemini-live proxy (Production).');
  let googleWs = null;

  clientWs.on('message', async (message) => {
    const msgStr = message.toString();
    let msg;
    try {
        msg = JSON.parse(msgStr);
    } catch (e) {
        console.error("Error parsing message:", e);
        return;
    }

    if (msg.setup) {
      const apiKey = process.env.GEMINI_API_KEY;
      
      if (!apiKey) {
        console.error("GEMINI_API_KEY not set in server environment for Gemini Live.");
        clientWs.close();
        return;
      }

      const setupMessageForGoogle = { setup: msg.setup };

      if (googleWs) googleWs.close();

      const googleApiUrl = `${GEMINI_API_URL}?key=${apiKey}`;
      
      try {
        googleWs = new WebSocket(googleApiUrl);

        googleWs.on('open', () => {
          console.log('Proxy successfully connected to Google Gemini API.');
          googleWs.send(JSON.stringify(setupMessageForGoogle));
        });

        googleWs.on('message', (googleMsg) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(googleMsg.toString());
          }
        });

        googleWs.on('close', () => {
          console.log('Google WebSocket connection closed.');
          if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        });

        googleWs.on('error', (err) => {
          console.error('Google WebSocket error:', err);
          if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        });

      } catch (e) {
        console.error('Failed to connect to Google WebSocket:', e);
        clientWs.close();
      }
    } else {
      if (googleWs && googleWs.readyState === WebSocket.OPEN) {
        googleWs.send(msgStr);
      }
    }
  });

  clientWs.on('close', () => {
    console.log('Client disconnected from proxy.');
    if (googleWs && googleWs.readyState === WebSocket.OPEN) googleWs.close();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});