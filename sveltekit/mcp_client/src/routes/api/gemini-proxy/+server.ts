import { json } from '@sveltejs/kit';
import { GoogleGenAI } from '@google/genai';

// The prompt for object detection with Gemini
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
 * Handles POST requests to detect objects in an image using Gemini Vision.
 */
export async function POST({ request }) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return json({ error: 'GEMINI_API_KEY is not set on the server.' }, { status: 500 });
  }

  try {
    const { image, model: modelName } = await request.json();

    if (!image || !modelName) {
      return json({ error: 'Image data and model name are required.' }, { status: 400 });
    }

    const client = new GoogleGenAI({ apiKey });
    const result = await client.models.generateContent({
      model: modelName,
      contents: [
        {
          parts: [
            { text: visionPrompt },
            { inlineData: { mimeType: 'image/jpeg', data: image.split(',')[1] } }
          ]
        }
      ]
    });

    // @google/genai では result が直接レスポンス情報を持つ場合があるため、
    // result.text() が存在すればそれを使い、なければ result.response.text() を試みる
    let text = "";
    if (result && typeof (result as any).text !== 'undefined') {
      text = (result as any).text || "";
    } else if ((result as any).response && typeof (result as any).response.text === 'function') {
      text = (result as any).response.text();
    } else {
      throw new Error("Invalid response structure from Gemini API");
    }

    // Markdownのコードブロック記法を削除し、JSON部分のみを抽出する
    let cleanText = text.replace(/```json\n?|```/g, '');
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanText = cleanText.substring(firstBrace, lastBrace + 1);
    }

    const detections = JSON.parse(cleanText);
    return json(detections);
  } catch (error: any) {
    console.error('Error in Gemini API call:', error);
    return json({ error: error.message || 'Failed to detect objects.' }, { status: 500 });
  }
}