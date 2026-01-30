import type { RequestHandler } from './$types';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const EventSource = require('eventsource');

// @ts-ignore
global.EventSource = EventSource;

let client: Client | null = null;
const imageCache = new Map<string, string>();

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

		if (body.type === 'chat') { // Modified to implement ReAct loop
			const modelName = body.model || 'gemini-2.5-flash';
			const apiKey = process.env.GEMINI_API_KEY;
			if (!apiKey) {
				return new Response(JSON.stringify({ error: 'GEMINI_API_KEY environment variable is not set on the server.' }), { status: 500 });
			}

			// 1. Get available tools from MCP server
			const toolList = await mcp.listTools();
			const geminiTools = [{
				functionDeclarations: toolList.tools.map(t => ({
					name: t.name,
					description: t.description, // Corrected property name
					parameters: t.inputSchema,
				}))
			}];

			// 2. Prepare message history for Gemini
			const capturedImages: { id: string, data: string }[] = [];
			const messages = body.messages || [];
			
			// Find the last image ID in the history to send only the latest image context
			let lastImageId: string | undefined;
			for (let i = messages.length - 1; i >= 0; i--) {
				if (messages[i].imageId) {
					lastImageId = messages[i].imageId;
					break;
				}
			}

			const contents = messages.map((msg: any) => {
				const parts: any[] = [{ text: msg.text }];
				if (msg.imageId && msg.imageId === lastImageId && imageCache.has(msg.imageId)) {
					parts.push({ inline_data: { mime_type: "image/jpeg", data: imageCache.get(msg.imageId) } });
				}
				return {
					role: msg.role === 'assistant' ? 'model' : 'user',
					parts
				};
			});

			// 3. ReAct loop
			for (let i = 0; i < 5; i++) { // Limit to 5 turns to prevent infinite loops
				const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						contents,
						tools: geminiTools
					})
				});

				const geminiData = await geminiRes.json();

				if (geminiData.error || !geminiData.candidates || geminiData.candidates.length === 0) {
					console.error("Gemini API Error:", geminiData.error || "No candidates returned");
					return new Response(JSON.stringify({ error: geminiData.error?.message || "Error calling Gemini API" }), { status: 500 });
				}

				const candidate = geminiData.candidates[0];
				const part = candidate.content.parts[0];

				if (part.text) {
					return new Response(JSON.stringify({ text: part.text, images: capturedImages }));
				}

				if (part.functionCall) {
					const { name, args } = part.functionCall;
					console.log(`[ReAct] Gemini wants to call tool: ${name} with args:`, args);

					contents.push({ role: 'model', parts: [part] });
					const toolResult = await mcp.callTool({ name, arguments: args });
					console.log(`[ReAct] Tool ${name} result:`, toolResult);

					// Capture images from tool result
					if (toolResult.content && Array.isArray(toolResult.content)) {
						for (const content of toolResult.content) {
							if (content.type === 'text') {
								try {
									const parsed = JSON.parse(content.text);
									if (parsed.image_jpeg_base64) {
										const imageId = randomUUID();
										imageCache.set(imageId, parsed.image_jpeg_base64);
										capturedImages.push({ id: imageId, data: `data:image/jpeg;base64,${parsed.image_jpeg_base64}` });
									}
								} catch (e) {}
							}
						}
					}

					contents.push({ role: 'tool', parts: [{ functionResponse: { name, response: toolResult } }] });
				} else {
					return new Response(JSON.stringify({ text: `Unexpected response from model: ${JSON.stringify(candidate.content)}` }));
				}
			}

			return new Response(JSON.stringify({ error: "Model did not produce a text response after 5 tool calls." }), { status: 500 });
		}

		return new Response(JSON.stringify({ error: 'Invalid message type' }), { status: 400 });
	} catch (e: any) {
		console.error("MCP Error:", e);
		// Reset client on error to force reconnection
		if (client) {
			try { await client.close(); } catch {}
			client = null;
		}
		return new Response(JSON.stringify({ error: e.message }), { status: 500 });
	}
};
