import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';

const GEMINI_API_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent";

/**
 * A Vite plugin to proxy Gemini Live WebSocket connections during development.
 * @type {import('vite').Plugin}
 */
const webSocketProxy = {
  name: 'webSocketProxy',
  configureServer(server) {
    const wss = new WebSocketServer({ noServer: true });

    // Hook into the upgrade event of the underlying HTTP server
    if (server.httpServer) {
      server.httpServer.on('upgrade', (req, socket, head) => {
        if (req.url === '/gemini-live') {
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
          });
        }
      });
    }

    wss.on('connection', (clientWs) => {
      console.log('Client connected to Node.js /gemini-live proxy.');
      /** @type {WebSocket | null} */
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

        // 1. The first message from the client contains the setup info
        if (msg.setup) {
          // Load env vars for the current mode
          const env = loadEnv(server.config.mode, process.cwd(), '');
          const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
          
          if (!apiKey) {
            console.error("GEMINI_API_KEY not set in server environment for Gemini Live. Please set it in a .env file.");
            clientWs.close();
            return;
          }

          // The API key is stripped and used here; only the setup object is forwarded
          const setupMessageForGoogle = { setup: msg.setup };

          if (googleWs) googleWs.close();

          const googleApiUrl = `${GEMINI_API_URL}?key=${apiKey}`;
          
          try {
            googleWs = new WebSocket(googleApiUrl);

            googleWs?.on('open', () => {
              console.log('Proxy successfully connected to Google Gemini API.');
              googleWs?.send(JSON.stringify(setupMessageForGoogle));
             });

            googleWs.on('message', (googleMsg) => {
              // Relay messages from Google back to the client
              console.log('Relaying message from Google to client:', googleMsg.toString());
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
          // 2. Relay subsequent audio chunks and other messages to Google
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
  }
};

export default defineConfig({
	plugins: [sveltekit(), webSocketProxy]

});
