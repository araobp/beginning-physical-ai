<script>
	import { GeminiLiveClient } from "$lib/gemini";
	import { onMount } from "svelte";

	// --------------------------------------------------------------------------
	// Architecture Overview
	// --------------------------------------------------------------------------
	// This component bridges three systems:
	// 1. The Browser UI (Svelte): Handles user input (buttons, sliders).
	// 2. The Serial API (Navigator): Communicates directly with the Arduino via USB.
	// 3. Gemini Live API (WebSocket): Processes voice commands and triggers tools.
	//
	// Data Flow:
	// User Voice -> Gemini -> Tool Call (JSON) -> Svelte Function -> Serial Command (Text) -> Arduino
	// Arduino -> Serial Output (Text) -> Svelte Reader -> UI Display
	// --------------------------------------------------------------------------

	/** @type {any} */
	let port;
	/** @type {ReadableStreamDefaultReader<Uint8Array> | undefined} */
	let reader;
	/** @type {WritableStreamDefaultWriter<Uint8Array> | undefined} */
	let writer;
	let output = "";
	let blinking = false;
	let brightness = 5;
	let interval = 200;

	let apiKey = "";
	let liveActive = false;
	/** @type {GeminiLiveClient | null} */
	let geminiClient = null;
	let geminiStatus = "Disconnected";

	onMount(() => {
		// Restore API key from local storage if available
		const storedKey = localStorage.getItem("gemini_api_key");
		if (storedKey) apiKey = storedKey;
	});

	const connect = async () => {
		try {
			// Request the user to select a serial port
			// @ts-ignore - navigator.serial is not in standard lib yet
			port = await navigator.serial.requestPort();
			// Open the port at 9600 baud rate (standard for Arduino)
			await port.open({ baudRate: 9600 });
			writer = port.writable.getWriter();
			startReading();
			output += "Connected to Arduino\n";
		} catch (error) {
			// @ts-ignore
			output += `Error: ${error.message}\n`;
		}
	};

	const startReading = async () => {
		try {
			if (!port || !port.readable) return;
			// Create a reader and lock it to the port.
			// The Serial API requires the readable stream to be "locked" to a reader,
			// preventing other code from reading simultaneously.
			const serialReader = port.readable.getReader();
			// Store reference globally for cleanup/cancellation if needed later.
			reader = serialReader;

			// Constant read loop
			while (true) {
				const { value, done } = await serialReader.read();
				if (done) {
					break;
				}
				const text = new TextDecoder().decode(value);
				output += text;
			}
		} catch (error) {
			// @ts-ignore
			output += `Error reading from serial port: ${error.message}\n`;
		}
	};

	/**
	 * @param {string} command
	 * Sends a command string to the Arduino via the serial port.
	 */
	const sendCommand = async (command) => {
		if (!writer) {
			output += "Not connected to serial\n";
			return;
		}
		// Encode the command string to bytes
		const data = new TextEncoder().encode(command + "\n");
		await writer.write(data);
	};

	// Helpers to send specific commands using current state values
	const updateBlink = () => {
		sendCommand(`blink=${blinking ? 1 : 0}`);
	};

	const updateBrightness = () => {
		// Maps the 0-10 slider value to the 'brightness=X' command expected by the C++ code
		sendCommand(`brightness=${brightness}`);
	};

	const updateInterval = () => {
		sendCommand(`interval=${interval}`);
	};

	const getStatus = () => {
		sendCommand("status");
	};

	/**
	 * Toggles the Gemini Live connection.
	 * If connected, it disconnects.
	 * If disconnected, it initializes the client and connects.
	 */
	const toggleLive = async () => {
		if (liveActive) {
			// Disconnect if currently active
			if (geminiClient) geminiClient.disconnect();
			liveActive = false;
			geminiStatus = "Disconnected";
		} else {
			if (!apiKey) {
				alert("Please enter a Gemini API Key");
				return;
			}
			// Save API key for next time
			localStorage.setItem("gemini_api_key", apiKey);

			// Initialize the Gemini Live Client
			geminiClient = new GeminiLiveClient(apiKey, {
				onConnect: () => {
					geminiStatus = "Connected";
					liveActive = true;
				},
				onDisconnect: () => {
					geminiStatus = "Disconnected";
					liveActive = false;
				},
				onError: (/** @type {any} */ e) => {
					geminiStatus = `Error: ${e.message || e}`;
					liveActive = false;
				},
				onToolCall: async (name, args) => {
					console.log("Tool called:", name, args);
					output += `[Gemini] Calling ${name} with ${JSON.stringify(args)}\n`;

					// Handle tool calls from Gemini and map them to Arduino commands
					if (name === "set_blinking") {
						blinking = args.enabled;
						updateBlink();
						return `Blinking set to ${blinking}`;
					} else if (name === "set_brightness") {
						brightness = args.level;
						updateBrightness();
						return `Brightness set to ${brightness}`;
					} else if (name === "set_interval") {
						interval = args.ms;
						updateInterval();
						return `Interval set to ${interval}`;
					} else if (name === "get_status") {
						getStatus();
						return "Status command sent to Arduino. Please check serial output.";
					}
				},
			});

			await geminiClient.connect();
		}
	};
</script>

<h1>Arduino Software PWM Control + Gemini Live</h1>
<p class="subtitle">
	Controls the on-board LED on an Arduino UNO via Serial commands.
</p>

<!-- Main UI Layout -->
<div class="control-group">
	<button on:click={connect}>Connect Arduino</button>
</div>

<div class="control-group gemini-box">
	<h2>Gemini Live</h2>
	<div class="input-row">
		<label>
			API Key:
			<input
				type="password"
				bind:value={apiKey}
				placeholder="Enter Gemini API Key"
			/>
		</label>
	</div>
	<div class="status-row">
		<span>Status: {geminiStatus}</span>
		<button on:click={toggleLive}
			>{liveActive ? "Stop Live" : "Start Live"}</button
		>
	</div>
	<p class="hint">
		Try saying: "Turn on blinking", "Set brightness to 5", "Set interval to
		100ms"
	</p>
</div>

<div class="control-group">
	<label>
		<input
			type="checkbox"
			bind:checked={blinking}
			on:change={updateBlink}
		/>
		Blinking
	</label>
</div>

<div class="control-group">
	<label>
		Brightness: {brightness}
		<input
			type="range"
			min="0"
			max="10"
			bind:value={brightness}
			on:change={updateBrightness}
		/>
	</label>
</div>

<div class="control-group">
	<label>
		Interval (ms):
		<input type="number" bind:value={interval} on:change={updateInterval} />
	</label>
</div>

<div class="control-group">
	<button on:click={getStatus}>Get Status</button>
</div>

<h2>Serial Output</h2>
<pre>{output}</pre>

<style>
	.control-group {
		margin-bottom: 1.5em;
		padding: 10px;
		background: #fff;
		border: 1px solid #ddd;
		border-radius: 8px;
	}
	.gemini-box {
		background: #f0f7ff;
		border-color: #cce5ff;
	}
	.input-row {
		margin-bottom: 10px;
	}
	.status-row {
		display: flex;
		align-items: center;
		gap: 15px;
	}
	h1 {
		font-family: "Inter", sans-serif;
		color: #333;
	}
	input[type="password"] {
		padding: 5px;
		border-radius: 4px;
		border: 1px solid #ccc;
		width: 250px;
	}
	button {
		padding: 8px 16px;
		border-radius: 4px;
		border: none;
		background: #007bff;
		color: white;
		cursor: pointer;
	}
	button:hover {
		background: #0056b3;
	}
	pre {
		background-color: #222;
		color: #0f0;
		padding: 1em;
		border-radius: 5px;
		white-space: pre-wrap;
		word-wrap: break-word;
		max-height: 300px;
		overflow-y: auto;
	}
	.hint {
		font-size: 0.9em;
		color: #666;
		margin-top: 10px;
		font-style: italic;
	}
	.subtitle {
		text-align: center;
		color: #555;
		margin-bottom: 20px;
	}
</style>
