import { json } from '@sveltejs/kit';
import { GoogleGenAI, Modality } from '@google/genai';
import { GEMINI_LIVE_MODEL } from '$lib/gemini';

/**
 * Gemini Liveセッション用の一時的な認証トークンを生成するAPIエンドポイント。
 * POSTリクエストを受け取り、ツール定義を含めてトークンを作成して返します。
 */
export async function POST({ request }) {
  // サーバー環境変数からGemini APIキーを取得
  const apiKey = process.env.GEMINI_API_KEY;

  // APIキーが設定されていない場合はエラーを返す
  if (!apiKey) {
    return json({ error: 'GEMINI_API_KEY is not set on the server.' }, { status: 500 });
  }

  try {
    // リクエストボディからツールの定義を取得
    const { tools } = await request.json();
    // GoogleGenAIクライアントを初期化
    const client = new GoogleGenAI({ apiKey });
    // トークンの有効期限を現在から30分後に設定
    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    // 一時的な認証トークンを作成
    const response = await client.authTokens.create({
      config: {
        uses: 1, // トークンの使用回数を1回に制限
        expireTime: expireTime, // 有効期限を設定
        // Gemini Live接続に関する制約と設定
        liveConnectConstraints: {
          model: GEMINI_LIVE_MODEL, // 使用するモデル
          config: {
            responseModalities: [Modality.AUDIO], // モデルの応答形式を音声に指定
            // 音声合成に関する設定
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: 'Charon' // 使用する声の種類
                }
              },
            },
            // システムへの指示（プロンプト）
            systemInstruction: {
              parts: [{
                text: "You are a helpful assistant with access to tools. Please use the available tools to answer the user's requests when appropriate. "
              }]
            },
            tools: tools, // 使用可能なツールのリスト
          }
        },
        // HTTPリクエストのオプション
        httpOptions: {
          apiVersion: 'v1alpha' // 使用するAPIのバージョン
        }
      }
    });

    // 作成されたトークン情報をJSON形式で返す
    return json(response);
  } catch (error: any) {
    // エラーが発生した場合はコンソールに出力し、500エラーを返す
    console.error('Error creating ephemeral token:', error);
    return json({ error: error.message || 'Failed to create token' }, { status: 500 });
  }
}