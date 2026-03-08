import { json } from '@sveltejs/kit';
import { GoogleGenAI, Modality } from '@google/genai';
import { GEMINI_LIVE_MODEL } from '$lib/geminiLive';

/**
 * Gemini Liveセッション用の一時的な認証トークンを生成するAPIエンドポイント。
 * POSTリクエストを受け取り、ツール定義を含めてトークンを作成して返します。
 * 
 * この処理は以下のステップで行われます:
 * 1. クライアントからツール定義を受け取る
 * 2. 物理学の知識(physics.md)を含むコンテキストキャッシュを作成
 * 3. キャッシュされたコンテンツとツールを使用できる一時トークンを発行
 * 4. トークンとキャッシュ名をクライアントに返す
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
    // GoogleGenAIクライアントを初期化 (v1alphaを使用してプレビュー機能にアクセス)
    const client = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: 'v1alpha' },
    });
    // トークンとキャッシュの有効期限（分）
    const DURATION_MINUTES = 30;
    // トークンの有効期限を設定
    const expireTime = new Date(Date.now() + DURATION_MINUTES * 60 * 1000).toISOString();

    // 一時的な認証トークンを作成
    // クライアントはこのトークンを使用してGemini APIに直接接続します。
    const response = await client.authTokens.create({
      config: {
        uses: 1, // トークンの使用回数を1回に制限
        expireTime: expireTime, // 有効期限を設定
        // Gemini Live接続に関する制約と設定
        liveConnectConstraints: {
          model: GEMINI_LIVE_MODEL, // キャッシュを使用せず直接モデルを指定
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
                text: "You are a helpful assistant with access to tools. Please use the available tools to answer the user's requests when appropriate."
              }]
            },
            tools: tools, // 使用可能なツールのリスト
          }
        }
      }
    });

    // 作成されたトークン情報をJSON形式で返す
    // クライアントが接続すべきモデル名を返す
    return json({ ...response, model: GEMINI_LIVE_MODEL });
  } catch (error: any) {
    // エラーが発生した場合はコンソールに出力し、500エラーを返す
    console.error('Error creating ephemeral token:', error);
    return json({ error: error.message || 'Failed to create token' }, { status: 500 });
  }
}