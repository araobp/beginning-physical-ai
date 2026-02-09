import { GoogleGenerativeAI } from '@google/generative-ai';
import { json } from '@sveltejs/kit';

export async function POST({ request }) {
  try {
    const { image, model: modelName } = await request.json();
    // 環境変数からAPIキーを取得 (.envファイルにGEMINI_API_KEYを設定してください)
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return json({ error: 'GEMINI_API_KEY is not set on the server.' }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName || 'gemini-1.5-flash' });

    // imageは "data:image/jpeg;base64,..." 形式を想定
    // ヘッダー部分を除去
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    const prompt = `
    Detect objects in this image.
    Return a JSON list where each item has:
    - "label": string
    - "box_2d": [ymin, xmin, ymax, xmax] (integers, normalized 0-1000)
    - "confidence": float (0.0 to 1.0, estimate)
    
    Only return the JSON.
    `;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: "image/jpeg",
        },
      },
    ]);

    const response = await result.response;
    let text = response.text();
    
    // Markdownのコードブロックを除去
    text = text.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    
    const detections = JSON.parse(text);
    return json({ detections });
  } catch (error: any) {
    console.error('Gemini API Error:', error);
    return json({ error: error.message || 'Failed to process with Gemini' }, { status: 500 });
  }
}