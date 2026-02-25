import { json } from '@sveltejs/kit';
import { GoogleGenAI, Modality } from '@google/genai';

export async function POST({ request }) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return json({ error: 'GEMINI_API_KEY is not set on the server.' }, { status: 500 });
  }

  try {
    const { tools } = await request.json();
    const client = new GoogleGenAI({ apiKey });
    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const response = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime: expireTime,
        liveConnectConstraints: {
          model: 'gemini-2.5-flash-native-audio-preview-12-2025',
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: 'Charon'
                }
              },
            },
            systemInstruction: {
              parts: [{
                text: "You are a helpful assistant with access to tools. Please use the available tools to answer the user's requests when appropriate. "
              }]
            },
            tools: tools,
          }
        },
        httpOptions: {
          apiVersion: 'v1alpha'
        }
      }
    });

    return json(response);
  } catch (error: any) {
    console.error('Error creating ephemeral token:', error);
    return json({ error: error.message || 'Failed to create token' }, { status: 500 });
  }
}