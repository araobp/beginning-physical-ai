<script>
	let port;
	let reader;
	let writer;
	let output = '';
	let blinking = false;
	let brightness = 5;
	let interval = 200;

	const connect = async () => {
		try {
			port = await navigator.serial.requestPort();
			await port.open({ baudRate: 9600 });
			writer = port.writable.getWriter();
			startReading();
			output += 'Connected to Arduino\n';
		} catch (error) {
			output += `Error: ${error.message}\n`;
		}
	};

	const startReading = async () => {
		try {
			reader = port.readable.getReader();
			while (true) {
				const { value, done } = await reader.read();
				if (done) {
					break;
				}
				const text = new TextDecoder().decode(value);
				output += text;
			}
		} catch (error) {
			output += `Error reading from serial port: ${error.message}\n`;
		}
	};

	const sendCommand = async (command) => {
		if (!writer) {
			output += 'Not connected\n';
			return;
		}
		const data = new TextEncoder().encode(command + '\n');
		await writer.write(data);
	};

	const updateBlink = () => {
		sendCommand(`blink=${blinking ? 1 : 0}`);
	};

	const updateBrightness = () => {
		sendCommand(`brightness=${brightness}`);
	};

	const updateInterval = () => {
		sendCommand(`interval=${interval}`);
	};

	const getStatus = () => {
		sendCommand('status');
	};
</script>

<h1>Arduino Software PWM Control</h1>

<button on:click={connect}>Connect</button>

<div>
	<label>
		<input type="checkbox" bind:checked={blinking} on:change={updateBlink} />
		Blinking
	</label>
</div>

<div>
	<label>
		Brightness: {brightness}
		<input type="range" min="0" max="10" bind:value={brightness} on:change={updateBrightness} />
	</label>
</div>

<div>
	<label>
		Interval (ms):
		<input type="number" bind:value={interval} on:change={updateInterval} />
	</label>
</div>

<div>
	<button on:click={getStatus}>Get Status</button>
</div>

<h2>Serial Output</h2>
<pre>{output}</pre>

<style>
	div {
		margin-bottom: 1em;
	}
	pre {
		background-color: #f4f4f4;
		padding: 1em;
		border-radius: 5px;
		white-space: pre-wrap;
		word-wrap: break-word;
	}
</style>