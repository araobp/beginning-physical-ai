import type { RequestHandler } from './$types';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const EventSource = require('eventsource');

// @ts-ignore
global.EventSource = EventSource;

let client: Client | null = null;

async function getClient() {
	if (client) return client;

	const transport = new StreamableHTTPClientTransport(new URL("http://localhost:8888/mcp"));
	const newClient = new Client({
		name: "sveltekit-server",
		version: "1.0.0",
	}, {
		capabilities: {}
	});

	await newClient.connect(transport);

	// Wait for the 'endpoint' event to be received and processed to establish the session
	await new Promise(resolve => setTimeout(resolve, 500));

	client = newClient;
	return client;
}

export const GET: RequestHandler = async () => {
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(`event: open\ndata: "connected"\n\n`);
		},
		cancel() {
			// cleanup
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

export const POST: RequestHandler = async ({ request }) => {
	try {
		const mcp = await getClient();
		const body = await request.json();

		if (body.type === 'list_tools') {
			const result = await mcp.listTools();
			return new Response(JSON.stringify(result));
		}

		if (body.type === 'call_tool' && body.name === 'detect_objects') {
			const modelName = body.arguments.model_name || 'gemini-2.5-flash';
			const apiKey = process.env.GEMINI_API_KEY;
			if (!apiKey) {
				return new Response(JSON.stringify({ error: 'GEMINI_API_KEY environment variable is not set on the server.' }), { status: 500 });
			}

			// 1. Get a clean image from the robot (without axis labels)
			const imgResult = await mcp.callTool({
				name: 'get_live_image',
				arguments: { visualize_axes: true }
			});

			// Parse the result from get_live_image
			// @ts-ignore
			if (imgResult.isError) {
				// @ts-ignore
				return new Response(JSON.stringify({ error: imgResult.content[0]?.text || 'Unknown error from get_live_image' }), { status: 500 });
			}

			// @ts-ignore
			const contentText = imgResult.content[0].text;
			let parsedImg;
			try {
				parsedImg = JSON.parse(contentText);
			} catch (e) {
				return new Response(JSON.stringify({ error: `Invalid JSON from get_live_image: ${contentText}` }), { status: 500 });
			}
			const base64Image = parsedImg.image_jpeg_base64;

			// 2. Call Gemini API
			const prompt = "Detect objects in this image. Return a JSON list of objects. Each object should have a 'box_2d' array [ymin, xmin, ymax, xmax] with coordinates normalized to 1000, and a 'label' string. Also, estimate the ground contact point for each object and return it as 'ground_contact_point_2d' [y, x], also normalized to 1000. The ground contact point is the center of the area where the object touches the ground.";
			
			const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					contents: [{
						parts: [
							{ text: prompt },
							{ inline_data: { mime_type: "image/jpeg", data: base64Image } }
						]
					}],
					generationConfig: { response_mime_type: "application/json" }
				})
			});
			const geminiData = await geminiRes.json();
			const objects = JSON.parse(geminiData.candidates[0].content.parts[0].text);

			return new Response(JSON.stringify({ image: `data:image/jpeg;base64,${base64Image}`, objects }));
		}

		if (body.type === 'call_tool') {
			const result = await mcp.callTool({
				name: body.name,
				arguments: body.arguments
			});
			return new Response(JSON.stringify(result));
		}

		return new Response(JSON.stringify({ error: 'Invalid message type' }), { status: 400 });
	} catch (e: any) {
		console.error("MCP Server Error:", e);

		// The MCP client might throw an error object that is not a standard Error instance.
		// It often contains the actual error message in `e.content[0].text`.
		let errorMessage = e.message || 'An unknown error occurred.';
		if (e.content && Array.isArray(e.content) && e.content.length > 0 && e.content[0].text) {
			errorMessage = e.content[0].text;
		} else if (typeof e === 'object') {
			errorMessage = JSON.stringify(e);
		}

		// Reset client on error to force reconnection
		if (client) {
			try { await client.close(); } catch {}
			client = null;
		}

		return new Response(JSON.stringify({ error: errorMessage, isError: true }), { status: 500, headers: { 'Content-Type': 'application/json' } });
	}
};
