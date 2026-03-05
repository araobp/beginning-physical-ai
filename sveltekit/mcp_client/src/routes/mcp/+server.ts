import type { RequestHandler } from './$types';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRequire } from 'node:module';

// ESモジュール環境で `require` を使用するために `createRequire` を利用します。
const require = createRequire(import.meta.url);
// MCP SDKがサーバーサイドで依存している可能性がある `eventsource` をロードします。
const EventSource = require('eventsource');

// EventSourceをグローバルスコープに設定し、ポリフィルとして機能させます。
// @ts-ignore
global.EventSource = EventSource;

// MCPクライアントのシングルトンインスタンスを保持する変数。
let client: Client | null = null;

/**
 * MCPクライアントのシングルトンインスタンスを取得または初期化します。
 * 接続エラーが発生した場合、クライアントはリセットされ、次回呼び出し時に再接続が試みられます。
 * @returns {Promise<Client>} 初期化されたMCPクライアントのインスタンス。
 */
async function getClient() {
	// 既にクライアントインスタンスが存在する場合は、それを返します。
	if (client) return client;

	// MCPサーバーへのHTTPトランスポートを作成します。宛先はlocalhost:8888です。
	const transport = new StreamableHTTPClientTransport(new URL("http://localhost:8888/mcp"));
	const newClient = new Client({
		name: "sveltekit-server",
		version: "1.0.0",
	}, {
		capabilities: {}
	});

	// トランスポートを介してMCPサーバーに接続します。
	await newClient.connect(transport);

	// セッションが確立されるのを待つための短い待機時間。
	// 'endpoint' イベントの受信と処理を待機するために使用されます。
	await new Promise(resolve => setTimeout(resolve, 500));

	// 新しく作成したクライアントをシングルトン変数に格納します。
	client = newClient;
	return client;
}

/**
 * GETリクエストを処理します。
 * Server-Sent Events (SSE) ストリームを確立し、接続が開いたことを通知します。
 * 主に接続確認やヘルスチェックに使用される可能性があります。
 */
export const GET: RequestHandler = async () => {
	const stream = new ReadableStream({
		start(controller) {
			// ストリームが開始されたら、'open'イベントをクライアントに送信します。
			controller.enqueue(`event: open\ndata: "connected"\n\n`);
		},
		cancel() {
			// ストリームがキャンセルされた場合のクリーンアップ処理をここに記述します。
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive'
		}
	});
};

/**
 * POSTリクエストを処理します。
 * このエンドポイントは、SvelteKitフロントエンドとバックエンドのMCPサーバー間のプロキシとして機能します。
 * リクエストボディに応じて、ツールのリスト取得やツールの実行などを行います。
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		// MCPクライアントのインスタンスを取得します。
		const mcp = await getClient();
		// リクエストボディをJSONとしてパースします。
		const body = await request.json();

		// リクエストタイプが 'list_tools' の場合
		if (body.type === 'list_tools') {
			// MCPサーバーに登録されているツールのリストを要求します。
			const result = await mcp.listTools();
			// 結果をJSON形式で返します。
			return new Response(JSON.stringify(result));
		}

		// リクエストタイプが 'call_tool' の場合 (汎用ハンドラ)
		if (body.type === 'call_tool') {
			// 指定されたツール名と引数でMCPサーバーのツールを呼び出します。
			const result = await mcp.callTool({
				name: body.name,
				arguments: body.arguments
			});
			// 結果をJSON形式で返します。
			return new Response(JSON.stringify(result));
		}

		// サポートされていないリクエストタイプの場合はエラーを返します。
		return new Response(JSON.stringify({ error: 'Invalid message type' }), { status: 400 });
	} catch (e: any) {
		// エラー処理
		console.error("MCP Server Error:", e);

		// MCPクライアントが投げるエラーオブジェクトは標準のErrorインスタンスではない場合があるため、
		// エラーメッセージを適切に抽出します。
		let errorMessage = e.message || 'An unknown error occurred.';
		if (e.content && Array.isArray(e.content) && e.content.length > 0 && e.content[0].text) {
			errorMessage = e.content[0].text;
		} else if (typeof e === 'object') {
			errorMessage = JSON.stringify(e);
		}

		// エラー発生時にクライアントをリセットし、次回の呼び出しで再接続を強制します。
		if (client) {
			try { await client.close(); } catch {}
			client = null;
		}

		// 500 Internal Server Errorをエラーメッセージと共に返します。
		return new Response(JSON.stringify({ error: errorMessage, isError: true }), { status: 500, headers: { 'Content-Type': 'application/json' } });
	}
};
