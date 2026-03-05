import { json } from '@sveltejs/kit';
import { GoogleGenAI } from '@google/genai';

// Geminiに物体検出を指示するためのプロンプト
const visionPrompt = `
Analyze the provided image and identify all objects on the table.
For each object, provide the following information in a JSON array format:
- label: The name of the object (e.g., "red_block", "blue_cup").
- confidence: Your confidence in the detection, from 0.0 to 1.0.
- box_2d: The bounding box of the object on the 2D image, represented as an array of four numbers [ymin, xmin, ymax, xmax]. These values should be normalized to a range of 0 to 1000.
- color_name: The dominant color of the object (e.g., "red", "green", "blue").
- ground_center: The center point of the object's base/contact area with the surface, represented as [y, x] coordinates normalized to 0-1000. This corresponds to the best picking position.

Example of the expected JSON output:
{
  "detections": [
    {
      "label": "red_block",
      "confidence": 0.95,
      "box_2d": [250, 300, 450, 500],
      "color_name": "red",
      "ground_center": [350, 400]
    }
  ]
}

If no objects are found, return an empty "detections" array.
Only output the JSON object. Do not include any other text or markdown formatting.
`;

/**
 * Gemini Visionを使用して画像内の物体を検出するためのPOSTリクエストを処理します。
 */
export async function POST({ request }) {
  // 環境変数からGemini APIキーを取得します。
  const apiKey = process.env.GEMINI_API_KEY;

  // APIキーがサーバーに設定されていない場合、エラーを返します。
  if (!apiKey) {
    return json({ error: 'GEMINI_API_KEY is not set on the server.' }, { status: 500 });
  }

  try {
    // リクエストボディから画像データとモデル名を取得します。
    const { image, model: modelName } = await request.json();

    // 画像データまたはモデル名が不足している場合、エラーを返します。
    if (!image || !modelName) {
      return json({ error: 'Image data and model name are required.' }, { status: 400 });
    }

    // GoogleGenAIクライアントを初期化します。
    const client = new GoogleGenAI({ apiKey });
    // Geminiモデルにコンテンツ生成をリクエストします。
    const result = await client.models.generateContent({
      model: modelName,
      contents: [
        {
          parts: [
            { text: visionPrompt },
            // Base64エンコードされた画像データからヘッダー部分を除去して渡します。
            { inlineData: { mimeType: 'image/jpeg', data: image.split(',')[1] } },
          ]
        }
      ]
    });

    // Gemini APIからのレスポンスのテキスト部分を取得します。
    // @google/genaiのバージョンによってレスポンスの構造が異なる場合に対応します。
    let text = "";
    if (result && typeof (result as any).text !== 'undefined') {
      text = (result as any).text || "";
    } else if ((result as any).response && typeof (result as any).response.text === 'function') {
      text = (result as any).response.text();
    } else {
      throw new Error("Gemini APIからのレスポンス構造が無効です");
    }

    // Geminiからの応答に含まれる可能性のあるMarkdownのコードブロック記法を削除します。
    let cleanText = text.replace(/```json\n?|```/g, '');
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanText = cleanText.substring(firstBrace, lastBrace + 1);
    }

    // 整形されたテキストをJSONとしてパースします。
    const detections = JSON.parse(cleanText);
    return json(detections);
  } catch (error: any) {
    console.error('Gemini API呼び出しでエラーが発生しました:', error);
    return json({ error: error.message || '物体の検出に失敗しました。' }, { status: 500 });
  }
}