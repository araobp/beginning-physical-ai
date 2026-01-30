<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';

  // For TensorFlow.js

  interface Tool {
    name: string;
    description?: string;
    inputSchema: Record<string, any>;
  }

  let tools = $state<Tool[]>([]);
  let error = $state<string | null>(null);
  let cameraImage = $state<string | null>(null);
  let capturing = $state(false);
  let selectedTool = $state<Tool | null>(null);
  let toolArgs = $state<Record<string, any>>({});
  let executionResult = $state<{ text?: string; image?: string } | null>(null);
  let isExecuting = $state(false);
  let tfReady = $state(false);
  let detectionModel = $state("gemini-2.5-flash");
  let detecting = $state(false);
  let targetMarker = $state<{ x: number, y: number } | null>(null);
  let targetImageCoords = $state<{ u: number, v: number } | null>(null);
  let targetWorldCoords = $state<{ x: number, y: number } | null>(null);
  let detectedObjects = $state<any[]>([]);
  let visualizeAxes = $state(true);

  // Chat / Agent State
  let chatMessages = $state<{ role: 'user' | 'assistant' | 'system' | 'error' | 'tool', content: string, details?: any }[]>([]);
  let chatInput = $state("");
  let agentRunning = $state(false);
  let agentStartTime = $state(0);
  let agentElapsedTime = $state("0.0");
  let agentTimer: any = null;
  let abortController: AbortController | null = null;
  let apiKey = $state("");
  let sessionId = $state<string | null>(null);
  let chatModel = $state("gemini-2.5-flash");
  let chatContainer: HTMLElement;
  
  
  const boxColors = [
    '#FF3838', // Red
    '#18FFFF', // Cyan
    '#FFEA00', // Yellow
    '#76FF03', // Lime
    '#F50057', // Pink
    '#651FFF', // Purple
    '#FF6D00', // Orange
  ];

  function getColorForIndex(index: number) {
    return boxColors[index % boxColors.length];
  }

  function getTextColor(hexcolor: string) {
    const yiq = ((parseInt(hexcolor.substring(1,3),16)*299)+(parseInt(hexcolor.substring(3,5),16)*587)+(parseInt(hexcolor.substring(5,7),16)*114))/1000;
    return (yiq >= 128) ? 'black' : 'white';
  }

  afterUpdate(() => {
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  });

  async function initializeMCP() {
    if (!sessionId) return;
    try {
      // 1. Initialize
      const initRes = await fetch(`/mcp?session_id=${sessionId}`, {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {
                roots: { listChanged: true },
                sampling: {}
            },
            clientInfo: {
              name: "SvelteClient",
              version: "1.0.0"
            }
          },
          id: 0
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      const initData = await initRes.json();
      if (initData.error) {
        console.error("MCP Initialization failed:", initData.error);
        return;
      }

      // 2. Initialized Notification
      await fetch(`/mcp?session_id=${sessionId}`, {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized"
        }),
        headers: { 'Content-Type': 'application/json' }
      });

      // 3. Load Tools
      await loadTools();
    } catch (e) {
      console.error("MCP Setup error:", e);
    }
  }

  async function loadTools() {
    if (!sessionId) return;
    try {
      const res = await fetch(`/mcp?session_id=${sessionId}`, {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.result && data.result.tools) {
        tools = data.result.tools as Tool[];
      } else {
        error = data.error || "Failed to load tools";
      }
    } catch (e: any) {
      error = e.message;
    }
  }

  function startTimer() {
    agentStartTime = Date.now();
    agentElapsedTime = "0.0";
    agentTimer = setInterval(() => {
      const elapsed = (Date.now() - agentStartTime) / 1000;
      agentElapsedTime = elapsed.toFixed(1);
    }, 100);
  }

  function stopTimer() {
    if (agentTimer) clearInterval(agentTimer);
    agentTimer = null;
  }

  async function executeToolByName(name: string, args: any, signal?: AbortSignal): Promise<string> {
      if (!sessionId) return "Error: No MCP session";
      try {
        const res = await fetch(`/mcp?session_id=${sessionId}`, {
            method: 'POST',
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "tools/call",
                params: { name: name, arguments: args },
                id: 7
            }),
            headers: { 'Content-Type': 'application/json' },
            signal
        });
        const result = await res.json();
        if (result.result && result.result.content && Array.isArray(result.result.content)) {
            return result.result.content.map((c: any) => c.text || '').join('\n');
        }
        return JSON.stringify(result);
      } catch (e: any) {
        if (e.name === 'AbortError') throw e;
        return `Error: ${e.message}`;
      }
  }

  async function askGemini(prompt: string, model: string, signal?: AbortSignal): Promise<string> {
    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model, apiKey }),
        signal
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `API Error: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      return data.text || (typeof data.content === 'string' ? data.content : JSON.stringify(data));
    } catch (e: any) {
      if (e.name === 'AbortError') throw e;
      throw new Error(`LLM Call Failed: ${e.message}`);
    }
  }

  function cleanObservation(obs: string): string {
    return obs.replace(/"image_jpeg_base64":\s*"[^"]+"/g, '"image_jpeg_base64": "<image_data_removed>"');
  }

  async function runReACTAgent(goal: string, signal: AbortSignal) {
    const maxSteps = 10;
    let currentStep = 0;
    
    const toolDefs = tools.map(t => `${t.name}: ${t.description || ''}`).join('\n');
    let history = `You are an AI assistant. Tools: ${toolDefs}.
Format: Thought: ... Action: ... Action Input: ... Observation: ... Final Answer: ...
Question: ${goal}`;

    while (currentStep < maxSteps) {
        if (signal.aborted) throw new Error('Aborted');

        let response = await askGemini(history, chatModel, signal);
        
        const thoughtMatch = response.match(/Thought:\s*(.*?)(?=\s*Action:|\s*Final Answer:|$)/s);
        if (thoughtMatch && thoughtMatch[1].trim()) {
            chatMessages = [...chatMessages, { role: 'assistant', content: `Thinking: ${thoughtMatch[1].trim()}` }];
        }

        if (response.includes("Final Answer:")) {
            const finalAnswer = response.split("Final Answer:")[1].trim();
            chatMessages = [...chatMessages, { role: 'assistant', content: finalAnswer }];
            return;
        }

        const actionMatch = response.match(/Action:\s*([a-zA-Z0-9_]+)/);
        if (actionMatch) {
            const actionName = actionMatch[1].trim();
            const inputMatch = response.match(/Action Input:\s*(\{.*?\})/s);
            let actionArgs = {};
            if (inputMatch) {
                try { actionArgs = JSON.parse(inputMatch[1]); } catch (e) {}
            }
            const observation = await executeToolByName(actionName, actionArgs, signal);
            chatMessages = [...chatMessages, { 
                role: 'tool', 
                content: `Executed: ${actionName}`,
                details: {
                    action: actionName,
                    input: actionArgs,
                    output: observation
                }
            }];
            const cleanedObservation = cleanObservation(observation);
            history += `\n${response}\nObservation: ${cleanedObservation}\n`;
        } else {
            chatMessages = [...chatMessages, { role: 'assistant', content: response }];
            return;
        }
        currentStep++;
    }
  }

  async function handleChatSubmit() {
    if (!chatInput.trim() || agentRunning) return;
    const text = chatInput;
    chatInput = "";
    chatMessages = [...chatMessages, { role: 'user', content: text }];
    
    agentRunning = true;
    startTimer();
    abortController = new AbortController();

    try {
        await runReACTAgent(text, abortController.signal);
    } catch (e: any) {
        if (e.message === 'Aborted' || e.name === 'AbortError') {
            chatMessages = [...chatMessages, { role: 'system', content: 'Cancelled.' }];
        } else {
            chatMessages = [...chatMessages, { role: 'error', content: e.message }];
        }
    } finally {
        agentRunning = false;
        stopTimer();
        abortController = null;
    }
  }

  function openToolModal(tool: Tool) {
    selectedTool = tool;
    toolArgs = {};
    executionResult = null;
    if (tool.inputSchema?.properties) {
      for (const key in tool.inputSchema.properties) {
        const prop = tool.inputSchema.properties[key];
        if (prop.default !== undefined) {
          toolArgs[key] = prop.default;
        } else if (prop.type === 'boolean') {
          toolArgs[key] = false;
        } else {
          toolArgs[key] = "";
        }
      }
    }
  }

  async function executeTool() {
    if (!selectedTool || !sessionId) return;
    isExecuting = true;
    executionResult = null;
    try {
      console.log(`Executing tool: ${selectedTool.name}`, toolArgs);
      const res = await fetch(`/mcp?session_id=${sessionId}`, {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: selectedTool.name, arguments: toolArgs },
          id: 2
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await res.json();
      
      let text = "";
      let image = undefined;

      if (result.result && result.result.content && Array.isArray(result.result.content)) {
        for (const content of result.result.content) {
          if (content.type === 'text') {
            try {
              const parsed = JSON.parse(content.text);
              if (parsed.image_jpeg_base64) {
                image = `data:image/jpeg;base64,${parsed.image_jpeg_base64}`;
                // If the response also contains coordinates, add them to the text output
                if (typeof parsed.x === 'number') {
                  text += `Coordinates: x=${parsed.x.toFixed(1)}, y=${parsed.y.toFixed(1)}\n`;
                }
                continue;
              }
            } catch (e) {}
            text += content.text + "\n";
          }
        }
      } else {
        text = JSON.stringify(result, null, 2);
      }
      executionResult = { text: text.trim(), image };
    } catch (e: any) {
      console.error('Tool execution failed:', e);
      executionResult = { text: `Error: ${e.message}` };
    } finally {
      isExecuting = false;
    }
  }

  async function captureImage() {
    if (!sessionId) return;
    capturing = true;
    targetMarker = null;
    targetImageCoords = null;
    targetWorldCoords = null;
    detectedObjects = [];
    try {
      const res = await fetch(`/mcp?session_id=${sessionId}`, {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: 'get_live_image', arguments: { visualize_axes: visualizeAxes } },
          id: 3
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await res.json();
      
      if (result.result && result.result.content && Array.isArray(result.result.content)) {
        for (const content of result.result.content) {
          if (content.type === 'text') {
            try {
              const parsed = JSON.parse(content.text);
              if (parsed.image_jpeg_base64) {
                cameraImage = `data:image/jpeg;base64,${parsed.image_jpeg_base64}`;
                return;
              }
            } catch (e) {
              // Ignore parsing errors, might be plain text error
            }
            if (content.text.startsWith("Error")) {
               alert(content.text);
               return;
            }
          }
        }
      }
      alert(`Unexpected result:\n${JSON.stringify(result, null, 2)}`);
    } catch (e: any) {
      console.error('Capture failed:', e);
      alert(`Error: ${e.message}`);
    } finally {
      capturing = false;
    }
  }

  async function detectObjects() {
    if (detectionModel === 'tensorflow.js') {
      await detectObjectsTF();
    } else {
      await detectObjectsGemini();
    }
  }

  async function detectObjectsGemini() {
    if (!sessionId) return;
    detecting = true;
    targetMarker = null;
    targetImageCoords = null;
    targetWorldCoords = null;
    detectedObjects = [];

    try {
      const res = await fetch(`/mcp?session_id=${sessionId}`, {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: 'detect_objects', arguments: { model_name: detectionModel } },
          id: 4
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await res.json();
      if (result.error) {
        alert(result.error);
        return;
      }
      cameraImage = result.image;
      detectedObjects = result.objects.map((o: any) => ({ ...o, imageCoords: null, worldCoords: null, isTransforming: false }));
    } catch (e: any) {
      console.error('Detection failed:', e);
      alert(`Error: ${e.message}`);
    } finally {
      detecting = false;
    }
  }

  async function detectObjectsTF() {
    if (!tfReady || !cameraImage) {
      alert('TensorFlow.js is not ready or no image has been captured.');
      return;
    }
    detecting = true;
    detectedObjects = [];

    try {
      const imgElement = document.createElement('img');
      imgElement.src = cameraImage;
      await new Promise(resolve => imgElement.onload = resolve);

      // @ts-ignore
      const model = await window.cocoSsd.load();
      const predictions = await model.detect(imgElement);

      detectedObjects = predictions.map((p: any) => ({
        label: p.class,
        box_2d: [
          (p.bbox[1] / imgElement.naturalHeight) * 1000, // ymin
          (p.bbox[0] / imgElement.naturalWidth) * 1000,  // xmin
          ((p.bbox[1] + p.bbox[3]) / imgElement.naturalHeight) * 1000, // ymax
          ((p.bbox[0] + p.bbox[2]) / imgElement.naturalWidth) * 1000,  // xmax
        ]
      })).map((o: any) => ({ ...o, imageCoords: null, worldCoords: null, isTransforming: false }));
    } finally {
      detecting = false;
    }
  }

  async function transformAllObjects() {
    await Promise.all(detectedObjects.map((_, i) => transformObjectCoords(i)));
  }

  async function transformObjectCoords(index: number) {
    const obj = detectedObjects[index];
    if (!obj || !cameraImage || !sessionId) return;

    obj.isTransforming = true;
    detectedObjects = [...detectedObjects];

    try {
        const img = new Image();
        img.src = cameraImage;
        await new Promise(resolve => img.onload = resolve);
        const { naturalWidth: width, naturalHeight: height } = img;

        const groundContactY = obj.ground_contact_point_2d ? obj.ground_contact_point_2d[0] : obj.box_2d[2];
        const groundContactX = obj.ground_contact_point_2d ? obj.ground_contact_point_2d[1] : (obj.box_2d[1] + obj.box_2d[3]) / 2;

        const u = Math.floor(groundContactX * width / 1000);
        const v = Math.floor(groundContactY * height / 1000);
        
        obj.imageCoords = { u, v };

        const res = await fetch(`/mcp?session_id=${sessionId}`, {
            method: 'POST',
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "tools/call",
                params: { name: 'convert_image_coords_to_world', arguments: { u, v } },
                id: 5
            }),
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await res.json();

        if (result.result && result.result.content && Array.isArray(result.result.content)) {
            for (const content of result.result.content) {
                if (content.type === 'text') {
                    try {
                        const coords = JSON.parse(content.text);
                        if (typeof coords.x === 'number') {
                            obj.worldCoords = { x: coords.x, y: coords.y };
                            return;
                        }
                    } catch (e) {}
                    if (content.text.startsWith("Error")) {
                        alert(content.text);
                        return;
                    }
                }
            }
        }
    } catch (e: any) {
        console.error('Conversion failed:', e);
        alert(`Error: ${e.message}`);
    } finally {
        obj.isTransforming = false;
        detectedObjects = [...detectedObjects];
    }
  }

  async function convertImageCoordsToWorld(u: number, v: number) {
    if (!sessionId) return;
    try {
      const res = await fetch(`/mcp?session_id=${sessionId}`, {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: 'convert_image_coords_to_world', arguments: { u, v } },
          id: 6
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await res.json();
      
      if (result.result && result.result.content && Array.isArray(result.result.content)) {
        for (const content of result.result.content) {
          if (content.type === 'text') {
            try {
              const coords = JSON.parse(content.text);
              if (coords.image_jpeg_base64) {
                cameraImage = `data:image/jpeg;base64,${coords.image_jpeg_base64}`;
              }
              if (typeof coords.x === 'number') {
                 targetWorldCoords = coords;
                 return;
              }
            } catch (e) {}
             if (content.text.startsWith("Error")) {
               alert(content.text);
            }
          }
        }
      }
    } catch (e: any) {
      console.error('Conversion failed:', e);
      alert(`Error: ${e.message}`);
    }
  }

  function handleImageClick(event: MouseEvent & { currentTarget: HTMLImageElement }) {
    const img = event.currentTarget;
    const rect = img.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    let u = Math.floor(x * (img.naturalWidth / rect.width));
    let v = Math.floor(y * (img.naturalHeight / rect.height));
    
    // Clamp coordinates to image bounds
    u = Math.max(0, Math.min(u, img.naturalWidth - 1));
    v = Math.max(0, Math.min(v, img.naturalHeight - 1));

    targetMarker = {
        x: x,
        y: y
    };

    targetImageCoords = { u, v };
    targetWorldCoords = null;
    
    convertImageCoordsToWorld(u, v);
  }

  onMount(() => {
    const sse = new EventSource('/mcp');
    sse.addEventListener('endpoint', (e) => {
        const url = new URL(e.data, window.location.href);
        sessionId = url.searchParams.get('session_id');
        console.log("MCP Session ID:", sessionId);
        initializeMCP();
    });
    sse.onmessage = (e) => console.log("SSE Message:", e.data);

    // Load TensorFlow.js and then COCO-SSD model to ensure correct dependency order
    const tfScript = document.createElement('script');
    tfScript.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs';
    tfScript.async = true;

    tfScript.onload = () => {
      const cocoSsdScript = document.createElement('script');
      cocoSsdScript.src = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd';
      cocoSsdScript.async = true;
      cocoSsdScript.onload = () => {
        tfReady = true;
      };
      document.head.appendChild(cocoSsdScript);
    };

    document.head.appendChild(tfScript);

    return () => {
      sse.close();
    };
  });
</script>

<svelte:head>
  <title>おもちゃのロボットアーム向けMCPクライアント</title>
  <link
    href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css"
    rel="stylesheet"
    integrity="sha384-T3c6CoIi6uLrA9TneNEoa7RxnatzjcDSCmG1MXxSR1GAsXEV/Dwwykc2MPK8M2HN"
    crossorigin="anonymous"
  />

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js" integrity="sha384-C6RzsynM9kWDrMNeT87bh95OGNyZPhcTNXj1NW7RuBCsyN/o0jlpcV8Qyq46cDfL" crossorigin="anonymous"></script>
</svelte:head>

<main class="container mt-5">
  <div class="mt-5">
    <h2>おもちゃのロボットアーム向けMCPクライアント</h2>
    <ul class="nav nav-tabs mt-3" id="myTab" role="tablist">
      <li class="nav-item" role="presentation">
        <button
          class="nav-link active"
          id="home-tab"
          data-bs-toggle="tab"
          data-bs-target="#home-tab-pane"
          type="button"
          role="tab"
          aria-controls="home-tab-pane"
          aria-selected="true">MCPツール</button>
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="nav-link"
          id="camera-tab"
          data-bs-toggle="tab"
          data-bs-target="#camera-tab-pane"
          type="button"
          role="tab"
          aria-controls="camera-tab-pane"
          aria-selected="false">ロボットの目</button>
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="nav-link"
          id="chat-tab"
          data-bs-toggle="tab"
          data-bs-target="#chat-tab-pane"
          type="button"
          role="tab"
          aria-controls="chat-tab-pane"
          aria-selected="false">Chat</button>
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="nav-link"
          id="live-tab"
          data-bs-toggle="tab"
          data-bs-target="#live-tab-pane"
          type="button"
          role="tab"
          aria-controls="live-tab-pane"
          aria-selected="false">Live</button>
      </li>
    </ul>
    <div class="tab-content p-3 border border-top-0 rounded-bottom" id="myTabContent">
      <div class="tab-pane fade show active" id="home-tab-pane" role="tabpanel" aria-labelledby="home-tab" tabindex="0">
        {#if error}
          <div class="alert alert-danger" role="alert">Error loading tools: {error}</div>
        {:else if tools.length === 0}
          <p>Loading tools...</p>
        {:else}
          <div class="list-group">
            {#each tools as tool}
              <div class="list-group-item">
                <div class="d-flex w-100 justify-content-between">
                  <h5 class="mb-1">{tool.name}</h5>
                </div>
                <p class="mb-1">{tool.description}</p>
                <small class="text-body-secondary">Schema: {JSON.stringify(tool.inputSchema)}</small>
                <div class="mt-2">
                  <button 
                    class="btn btn-sm btn-primary" 
                    data-bs-toggle="modal" 
                    data-bs-target="#toolModal" 
                    onclick={() => openToolModal(tool)}>Run</button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
      <div class="tab-pane fade" id="camera-tab-pane" role="tabpanel" aria-labelledby="camera-tab" tabindex="0">
        <div class="d-flex flex-column align-items-center mt-3">
          <div class="mb-3 d-flex gap-2 align-items-center">
            <select class="form-select w-auto" bind:value={detectionModel}>
              <option value="gemini-2.5-flash">gemini-2.5-flash</option>
              <option value="gemini-robotics-er-1.5-preview">gemini-robotics-er-1.5-preview</option>
              <option value="tensorflow.js">tensorflow.js</option>
            </select>
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="visualizeAxesCheck" bind:checked={visualizeAxes}>
              <label class="form-check-label" for="visualizeAxesCheck">Axes</label>
            </div>
            <button class="btn btn-primary" onclick={captureImage} disabled={capturing}>
              {capturing ? 'Capturing...' : 'Capture'}
            </button>
            <button
              class="btn btn-primary"
              onclick={detectObjects}
              disabled={detecting || (detectionModel === 'tensorflow.js' && !tfReady)}
            >
              {#if detecting}Detecting...
              {:else if detectionModel === 'tensorflow.js' && !tfReady}Loading TF.js...
              {:else}Detect{/if}
            </button>
            <button class="btn btn-primary" onclick={transformAllObjects} disabled={detectedObjects.length === 0}>
              Transform
            </button>
          </div>
          {#if cameraImage}
            <div class="position-relative d-inline-block">
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <img src={cameraImage} alt="Robot Camera View" class="img-fluid border rounded" style="max-height: 500px; cursor: crosshair;" onclick={handleImageClick} />
              {#each detectedObjects as obj, i}
                {@const color = getColorForIndex(i)}
                <div style="position: absolute; left: {obj.box_2d[1]/10}%; top: {obj.box_2d[0]/10}%; width: {(obj.box_2d[3]-obj.box_2d[1])/10}%; height: {(obj.box_2d[2]-obj.box_2d[0])/10}%; border: 2px solid {color}; pointer-events: none;">
                  <span style="background: {color}; color: {getTextColor(color)}; position: absolute; top: -1.5em; left: 0; padding: 0 2px; font-size: 0.8em; white-space: nowrap;">{obj.label}</span>
                </div>
                {@const groundContactX = obj.ground_contact_point_2d ? obj.ground_contact_point_2d[1] / 10 : (obj.box_2d[1] + obj.box_2d[3]) / 20}
                {@const groundContactY = obj.ground_contact_point_2d ? obj.ground_contact_point_2d[0] / 10 : obj.box_2d[2] / 10}
                <div style="position: absolute; left: {groundContactX}%; top: {groundContactY}%; width: 10px; height: 10px; background-color: {color}; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none;"></div>
                <div style="position: absolute; left: {groundContactX}%; top: {groundContactY}%; transform: translateX(15px) translateY(-50%); pointer-events: auto; display: flex; align-items: center; gap: 5px; z-index: 10;">
                    {#if obj.imageCoords}
                        <div style="background: rgba(0,0,0,0.7); color: white; padding: 2px 5px; border-radius: 3px; font-size: 0.7em; font-family: monospace; white-space: nowrap;">
                            <div>u: {obj.imageCoords.u}, v: {obj.imageCoords.v} (px)</div>
                            {#if obj.worldCoords}
                                <div>x: {obj.worldCoords.x.toFixed(1)}, y: {obj.worldCoords.y.toFixed(1)} (cm)</div>
                            {/if}
                        </div>
                    {/if}
                </div>
              {/each}
              {#if targetMarker}
                <div style="position: absolute; left: {targetMarker.x}px; top: {targetMarker.y}px; width: 0; height: 0; pointer-events: none;">
                  <div style="position: absolute; width: 20px; height: 20px; border: 2px solid red; border-radius: 50%; transform: translate(-50%, -50%);"></div>
                  <span style="position: absolute; left: 15px; top: -12px; color: red; font-weight: bold; text-shadow: 1px 1px 0 rgba(255, 255, 255, 0.5); white-space: nowrap;">TARGET</span>
                </div>
              {/if}
              {#if targetImageCoords}
                <div style="position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,0.7); color: white; padding: 5px 10px; border-radius: 4px; pointer-events: none; font-family: monospace;">
                  <div>u: {targetImageCoords.u}, v: {targetImageCoords.v} (px)</div>
                  {#if targetWorldCoords}
                    <div>x: {targetWorldCoords.x.toFixed(1)}, y: {targetWorldCoords.y.toFixed(1)} (cm)</div>
                  {/if}
                </div>
              {/if}
            </div>
          {:else}
            <div class="text-muted p-5 border rounded bg-light">
              No image captured
            </div>
          {/if}
        </div>
      </div>
      <div class="tab-pane fade" id="chat-tab-pane" role="tabpanel" aria-labelledby="chat-tab" tabindex="0">
        <div class="d-flex flex-column" style="height: 75vh;">
          <!-- Output Pane -->
          <div bind:this={chatContainer} class="flex-grow-1 overflow-auto p-3 bg-light border rounded mb-3 d-flex flex-column gap-2">
            {#each chatMessages as msg}
              {#if msg.role === 'tool'}
                <div class="p-2 rounded shadow-sm" style="max-width: 90%; align-self: center; background-color: #f0f0f0; font-size: 0.85em; width: 100%;">
                   <details>
                      <summary style="cursor: pointer; color: #555;">Tool: <strong>{msg.details?.action}</strong></summary>
                      <div class="mt-2 ps-3 border-start border-3">
                          <div class="mb-1"><strong>Input:</strong> <span class="text-muted">{JSON.stringify(msg.details?.input)}</span></div>
                          <div><strong>Output:</strong></div>
                          <pre class="bg-white p-2 border rounded mt-1 mb-0" style="max-height: 150px; overflow: auto; font-size: 0.8em;">{msg.details?.output}</pre>
                      </div>
                   </details>
                </div>
              {:else}
                {@const isThinking = msg.role === 'assistant' && msg.content.startsWith('Thinking:')}
                <div class="p-2 rounded shadow-sm" 
                     style="max-width: 80%; 
                            align-self: {msg.role === 'user' ? 'flex-end' : (msg.role === 'system' || msg.role === 'error' ? 'center' : 'flex-start')};
                            background-color: {msg.role === 'user' ? '#dcf8c6' : (msg.role === 'error' ? '#ffcccc' : (isThinking ? '#f8f9fa' : '#fff'))};
                            border: {msg.role === 'assistant' ? '1px solid #ddd' : 'none'};
                            font-style: {isThinking ? 'italic' : 'normal'};
                            color: {isThinking ? '#6c757d' : 'inherit'};">
                  <div style="font-size: 0.75em; color: #666; margin-bottom: 2px;">{msg.role}</div>
                  <div style="white-space: pre-wrap;">{msg.content}</div>
                </div>
              {/if}
            {/each}

            <!-- Dynamic Controls -->
            {#if agentRunning}
              <div class="d-flex align-items-center justify-content-center gap-3 mt-2">
                <button class="btn btn-danger btn-sm" onclick={() => abortController?.abort()}>キャンセル</button>
                <span class="fw-bold text-primary">{agentElapsedTime}s</span>
              </div>
            {/if}
          </div>

          <!-- Input Pane -->
          <div class="input-group">
            <textarea class="form-control" rows="1" bind:value={chatInput} placeholder="Type a message..." onkeydown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                handleChatSubmit();
              }
            }}></textarea>
            <button class="btn btn-primary" onclick={handleChatSubmit} disabled={agentRunning}>送信</button>
          </div>
        </div>
      </div>
      <div class="tab-pane fade" id="live-tab-pane" role="tabpanel" aria-labelledby="live-tab" tabindex="0">
        <p>This is the content for the Live tab.</p>
      </div>
    </div>
  </div>

  <!-- Tool Execution Modal -->
  <div class="modal fade" id="toolModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">{selectedTool?.name}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        {#if (selectedTool?.inputSchema?.properties && Object.keys(selectedTool.inputSchema.properties).length > 0) || executionResult}
        <div class="modal-body">
          {#if selectedTool?.inputSchema?.properties && Object.keys(selectedTool.inputSchema.properties).length > 0}
            {#each Object.entries(selectedTool.inputSchema.properties) as [key, prop]}
              <div class="mb-3">
                {#if (prop as any).type === 'boolean'}
                  <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="arg-{key}" bind:checked={toolArgs[key]}>
                    <label class="form-check-label" for="arg-{key}">
                      {key}
                    </label>
                  </div>
                {:else if (prop as any).type === 'integer' || (prop as any).type === 'number'}
                  <label for="arg-{key}" class="form-label">{key}</label>
                  <input type="number" class="form-control" id="arg-{key}" bind:value={toolArgs[key]} placeholder={(prop as any).description || ''}>
                {:else}
                  <label for="arg-{key}" class="form-label">{key}</label>
                  <input type="text" class="form-control" id="arg-{key}" bind:value={toolArgs[key]} placeholder={(prop as any).description || ''}>
                {/if}
              </div>
            {/each}
          {/if}

          {#if executionResult}
            {#if selectedTool?.inputSchema?.properties && Object.keys(selectedTool.inputSchema.properties).length > 0}
              <hr>
            {/if}
            <h6>Result:</h6>
            {#if executionResult.image}
              <img src={executionResult.image} class="img-fluid border rounded" alt="Tool Output" />
            {/if}
            {#if executionResult.text}
              <pre class="bg-light p-2 border rounded mt-2" style="white-space: pre-wrap;">{executionResult.text}</pre>
            {/if}
          {/if}
        </div>
        {/if}
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          <button type="button" class="btn btn-primary" onclick={executeTool} disabled={isExecuting}>
            {isExecuting ? 'Running...' : 'Execute'}
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Settings Modal -->
  <div class="modal fade" id="settingsModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">Settings</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <div class="mb-3">
            <label for="apiKeyInput" class="form-label">Gemini API Key</label>
            <input type="password" class="form-control" id="apiKeyInput" bind:value={apiKey} placeholder="Enter your API Key">
            <div class="form-text">Leave blank if configured on server via GEMINI_API_KEY.</div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        </div>
      </div>
    </div>
  </div>
</main>
