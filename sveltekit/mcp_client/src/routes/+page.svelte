<script lang="ts">
  import { onMount } from 'svelte';

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
  let detectionModel = $state("yolo11n");
  let detecting = $state(false);
  let targetMarker = $state<{ x: number, y: number } | null>(null);
  let targetImageCoords = $state<{ u: number, v: number } | null>(null);
  let targetWorldCoords = $state<{ x: number, y: number } | null>(null);
  let detectedObjects = $state<any[]>([]);
  let visualizeAxes = $state(true);
  let detectionConfidence = $state(0.7);

  // Pick & Place State
  let ppImage = $state<string | null>(null);
  let ppCapturing = $state(false);
  let ppPickPoint = $state<{ u: number, v: number, x: number, y: number, xw: number, yw: number, u_norm: number, v_norm: number } | null>(null);
  let ppPlacePoint = $state<{ u: number, v: number, x: number, y: number, xw: number, yw: number, u_norm: number, v_norm: number } | null>(null);
  let ppExecuting = $state(false);
  let ppPickZ = $state(20);
  let ppPlaceZ = $state(30);
  let ppSafetyZ = $state(70);
  let ppLive = $state(false);
  let liveInterval: any = null;
  let ppShowDetections = $state(false);
  let ppDetectionInterval = $state(500); // ms
  let ppDetections = $state<any[]>([]);
  let ppDetectionPolling = $state(false);
  let ppShowTrajectory = $state(false);
  let ppTrajectoryPoints = $state<{u: number, v: number}[]>([]);
  let ppImageDim = $state<{w: number, h: number} | null>(null);
  let joypadLeft = $state({ x: 0, y: 0 });
  let joypadRight = $state({ x: 0, y: 0 });
  let currentRobotPos = $state({ x: 0, y: 0, z: 0 });
  let lastJoypadState = $state<Record<string, any>>({});

  let ppDetectionTimeout: any = null;
  $effect(() => {
    if (ppShowDetections && ppLive) {
      // Start polling
      clearTimeout(ppDetectionTimeout); // Clear any existing timer
      pollDetections();
    } else {
      // Stop polling
      clearTimeout(ppDetectionTimeout);
      ppDetections = [];
    }
    return () => clearTimeout(ppDetectionTimeout);
  });

  $effect(() => {
    if (ppPickPoint && ppPlacePoint && ppShowTrajectory) {
        updateTrajectory(ppPickPoint, ppPlacePoint, ppPickZ, ppPlaceZ, ppSafetyZ);
    } else {
        ppTrajectoryPoints = [];
    }
  });

  // Language Settings
  type Lang = 'ja' | 'en';
  let currentLang = $state<Lang>('ja');
  
  const translations = {
    ja: {
      title: "最も安い4軸ロボットアーム",
      tab_tools: "MCPツール",
      tab_camera: "ロボットの目",
      tab_control: "ロボット操縦（手動・半自動）",
      tab_gemini: "ロボット操縦（Gemini）",
      tab_settings: "設定",
      loading_tools: "ツールを読み込み中...",
      error_tools: "ツールの読み込みエラー: ",
      capture: "撮影",
      capturing: "撮影中...",
      detect: "検出",
      detecting: "検出中...",
      transform: "座標変換",
      live: "ライブ",
      stop_live: "ライブ停止",
      clear: "クリア",
      pick_place: "Pick & Place",
      running: "実行中...",
      pick_z: "Pick Z (mm)",
      place_z: "Place Z (mm)",
      safety_z: "Safety Z (mm)",
      no_image: "画像がありません",
      click_live: "'ライブ'をクリックしてPick & Place操作を開始してください",
      settings_lang: "言語設定",
      joypad_left: "左",
      joypad_right: "右",
      gemini_placeholder: "Gemini Robotics-ER や Gemini Live によるVLA評価画面追加予定",
      show_detections: "物体検出",
      interval_ms: "更新間隔(ms)",
      confidence: "信頼度",
      show_trajectory: "軌道表示",
    },
    en: {
      title: "The Cheapest 4-DoF Robot Arm",
      tab_tools: "MCP Tools",
      tab_camera: "Robot Vision",
      tab_control: "Robot Control (Manual/Semi-Auto)",
      tab_gemini: "Robot Control (Gemini)",
      tab_settings: "Settings",
      loading_tools: "Loading tools...",
      error_tools: "Error loading tools: ",
      capture: "Capture",
      capturing: "Capturing...",
      detect: "Detect",
      detecting: "Detecting...",
      transform: "Transform",
      live: "Live",
      stop_live: "Stop Live",
      clear: "Clear",
      pick_place: "Pick & Place",
      running: "Running...",
      pick_z: "Pick Z (mm)",
      place_z: "Place Z (mm)",
      safety_z: "Safety Z (mm)",
      no_image: "No image captured",
      click_live: "Click 'Live' to start Pick & Place operation",
      settings_lang: "Language",
      joypad_left: "Left",
      joypad_right: "Right",
      gemini_placeholder: "Gemini Robotics-ER or Gemini Live VLA evaluation screen coming soon",
      show_detections: "Object Detection",
      interval_ms: "Interval (ms)",
      confidence: "Confidence",
      show_trajectory: "Show Trajectory",
    }
  };

  let t = $derived(translations[currentLang]);
  
  const boxColors = [
    '#FF3838', // Red
    '#18FFFF', // Cyan
    '#FFEA00', // Yellow
    '#76FF03', // Lime
    '#F50057', // Pink
    '#651FFF', // Purple
    '#FF6D00', // Orange
  ];

  function getColorForLabel(label: string) {
    let hash = 0;
    for (let i = 0; i < label.length; i++) {
      hash = label.charCodeAt(i) + ((hash << 5) - hash);
    }
    return boxColors[Math.abs(hash) % boxColors.length];
  }

  function getTextColor(hexcolor: string) {
    const yiq = ((parseInt(hexcolor.substring(1,3),16)*299)+(parseInt(hexcolor.substring(3,5),16)*587)+(parseInt(hexcolor.substring(5,7),16)*114))/1000;
    return (yiq >= 128) ? 'black' : 'white';
  }

  async function loadTools() {
    try {
      const res = await fetch('/mcp', {
        method: 'POST',
        body: JSON.stringify({ type: 'list_tools' }),
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.tools) {
        tools = data.tools as Tool[];
      } else {
        error = data.error || "Failed to load tools";
      }
    } catch (e: any) {
      error = e.message;
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
    if (!selectedTool) return;
    isExecuting = true;
    executionResult = null;
    try {
      console.log(`Executing tool: ${selectedTool.name}`, toolArgs);
      const res = await fetch('/mcp', {
        method: 'POST',
        body: JSON.stringify({
          type: 'call_tool',
          name: selectedTool.name,
          arguments: toolArgs
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await res.json();
      
      let text = "";
      let image = undefined;

      if (result.content && Array.isArray(result.content)) {
        for (const content of result.content) {
          if (content.type === 'text') {
            try {
              const parsed = JSON.parse(content.text);
              if (parsed.image_jpeg_base64) {
                image = `data:image/jpeg;base64,${parsed.image_jpeg_base64}`;
                // 画像以外のデータをJSONテキストとして表示
                const { image_jpeg_base64, ...rest } = parsed;
                if (Object.keys(rest).length > 0) {
                  text += JSON.stringify(rest, null, 2) + "\n";
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
    capturing = true;
    targetMarker = null;
    targetImageCoords = null;
    targetWorldCoords = null;
    detectedObjects = [];
    try {
      const res = await fetch('/mcp', {
        method: 'POST',
        body: JSON.stringify({
          type: 'call_tool',
          name: 'get_live_image',
          arguments: { visualize_axes: visualizeAxes }
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await res.json();
      
      if (result.content && Array.isArray(result.content)) {
        for (const content of result.content) {
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
    } else if (detectionModel === 'yolo11n') {
      await detectObjectsYolo();
    } else {
      await detectObjectsGemini();
    }
  }

  async function detectObjectsYolo() {
    detecting = true;
    targetMarker = null;
    targetImageCoords = null;
    targetWorldCoords = null;
    detectedObjects = [];

    try {
      const res = await fetch('/mcp', {
        method: 'POST',
        body: JSON.stringify({
          type: 'call_tool',
          name: 'get_live_image',
          arguments: { 
            visualize_axes: visualizeAxes,
            detect_objects: true,
            confidence: Number(detectionConfidence)
          }
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await res.json();
      
      if (result.content && Array.isArray(result.content)) {
        for (const content of result.content) {
          if (content.type === 'text') {
            try {
              const parsed = JSON.parse(content.text);
              if (parsed.image_jpeg_base64) {
                cameraImage = `data:image/jpeg;base64,${parsed.image_jpeg_base64}`;
                if (parsed.detections && Array.isArray(parsed.detections)) {
                  console.log("Detections received:", parsed.detections);
                  detectedObjects = parsed.detections.map((o: any) => ({
                    label: o.label,
                    confidence: o.confidence,
                    box_2d: o.box_2d,
                    ground_center: o.ground_center,
                    imageCoords: null,
                    worldCoords: null,
                    isTransforming: false
                  }));
                }
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
      console.error('Detection failed:', e);
      alert(`Error: ${e.message}`);
    } finally {
      detecting = false;
    }
  }

  async function detectObjectsGemini() {
    detecting = true;
    targetMarker = null;
    targetImageCoords = null;
    targetWorldCoords = null;
    detectedObjects = [];

    try {
      // 1. MCPサーバーから最新画像を取得 (get_live_imageツールを使用)
      const resImg = await fetch('/mcp', {
        method: 'POST',
        body: JSON.stringify({
          type: 'call_tool',
          name: 'get_live_image',
          arguments: { visualize_axes: visualizeAxes }
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      const resultImg = await resImg.json();
      
      let currentImgBase64 = null;
      // MCPのレスポンスから画像を抽出
      if (resultImg.content && Array.isArray(resultImg.content)) {
        for (const content of resultImg.content) {
          if (content.type === 'text') {
            try {
              const parsed = JSON.parse(content.text);
              if (parsed.image_jpeg_base64) {
                currentImgBase64 = `data:image/jpeg;base64,${parsed.image_jpeg_base64}`;
                cameraImage = currentImgBase64; // UI更新
              }
            } catch (e) {}
          }
        }
      }

      if (!currentImgBase64) {
        throw new Error("Failed to capture image from robot camera.");
      }

      // 2. Node.jsサーバー経由でGemini APIを呼び出し
      const resGemini = await fetch('/api/gemini', {
        method: 'POST',
        body: JSON.stringify({
          image: currentImgBase64,
          model: detectionModel
        }),
        headers: { 'Content-Type': 'application/json' }
      });

      if (!resGemini.ok) {
        const errText = await resGemini.text();
        throw new Error(`Server Error (${resGemini.status}): ${errText.slice(0, 100)}...`);
      }

      const resultGemini = await resGemini.json();
      
      if (resultGemini.error) {
        throw new Error(resultGemini.error);
      }

      if (resultGemini.detections && Array.isArray(resultGemini.detections)) {
        console.log("Gemini Detections:", resultGemini.detections);
        detectedObjects = resultGemini.detections.map((o: any) => ({
          label: o.label,
          confidence: o.confidence,
          box_2d: o.box_2d,
          ground_center: o.ground_center,
          imageCoords: null,
          worldCoords: null,
          isTransforming: false
        }));
      }

    } catch (e: any) {
      console.error('Gemini Detection failed:', e);
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
    if (!obj || !cameraImage) return;

    obj.isTransforming = true;
    detectedObjects = [...detectedObjects];

    try {
        const img = new Image();
        img.src = cameraImage;
        await new Promise(resolve => img.onload = resolve);
        const { naturalWidth: width, naturalHeight: height } = img;

        const groundContactY = obj.ground_center ? obj.ground_center.v_norm : obj.box_2d[2];
        const groundContactX = obj.ground_center ? obj.ground_center.u_norm : (obj.box_2d[1] + obj.box_2d[3]) / 2;

        const u = Math.floor(groundContactX * width / 1000);
        const v = Math.floor(groundContactY * height / 1000);
        
        obj.imageCoords = { u, v };

        const res = await fetch('/mcp', {
            method: 'POST',
            body: JSON.stringify({
                type: 'call_tool',
                name: 'convert_coordinates',
                arguments: { x: u, y: v, source: 'pixel', target: 'world' }
            }),
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await res.json();

        if (result.content && Array.isArray(result.content)) {
            for (const content of result.content) {
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
    try {
      const res = await fetch('/mcp', {
        method: 'POST',
        body: JSON.stringify({
          type: 'call_tool',
          name: 'convert_coordinates',
          arguments: { x: u, y: v, source: 'pixel', target: 'world' }
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await res.json();
      
      if (result.content && Array.isArray(result.content)) {
        for (const content of result.content) {
          if (content.type === 'text') {
            try {
              const coords = JSON.parse(content.text);
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

  async function convertWorldToImage(x: number, y: number, z: number) {
    try {
      const res = await fetch('/mcp', {
        method: 'POST',
        body: JSON.stringify({
          type: 'call_tool',
          name: 'convert_coordinates',
          arguments: { x, y, z, source: 'world', target: 'pixel' }
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await res.json();
      if (result.content && Array.isArray(result.content)) {
        for (const content of result.content) {
            if (content.type === 'text') {
                try {
                    const coords = JSON.parse(content.text);
                    if (typeof coords.u === 'number' && typeof coords.v === 'number') {
                        return { u: coords.u, v: coords.v };
                    }
                } catch (e) {}
            }
        }
      }
    } catch (e: any) {
      console.warn("convert_coordinates failed (tool might be missing on server):", e.message);
    }
    return null;
  }

  async function updateTrajectory(pickPt: any, placePt: any, pickZ: number, placeZ: number, safetyZ: number) {
    // Check if the conversion tool is available
    const hasTool = tools.some(t => t.name === 'convert_coordinates');
    if (!hasTool) {
        // Fallback: just draw a line between Pick and Place
        ppTrajectoryPoints = [
            { u: pickPt.u, v: pickPt.v },
            { u: placePt.u, v: placePt.v }
        ];
        return;
    }

    const home = { x: 110, y: 0, z: 70 };
    const pZ = Math.max(0, pickZ);
    const plZ = Math.max(0, placeZ);
    const sZ = Math.max(0, safetyZ);

    const path = [
        home,
        { x: home.x, y: home.y, z: sZ },
        { x: pickPt.xw, y: pickPt.yw, z: sZ },
        { x: pickPt.xw, y: pickPt.yw, z: pZ },
        { x: pickPt.xw, y: pickPt.yw, z: sZ },
        { x: placePt.xw, y: placePt.yw, z: sZ },
        { x: placePt.xw, y: placePt.yw, z: plZ },
        { x: placePt.xw, y: placePt.yw, z: sZ },
        home
    ];
    
    const points2D = [];
    for (const p of path) {
        const uv = await convertWorldToImage(p.x, p.y, p.z);
        if (uv) {
            points2D.push(uv);
        } else {
            // Fallback: use known image coords for Pick/Place locations
            // This ignores Z visual difference if tool is missing, but keeps lines connected
            if (p.x === pickPt.xw && p.y === pickPt.yw) {
                points2D.push({ u: pickPt.u, v: pickPt.v });
            } else if (p.x === placePt.xw && p.y === placePt.yw) {
                points2D.push({ u: placePt.u, v: placePt.v });
            }
            // Skip Home if conversion fails
        }
    }
    ppTrajectoryPoints = points2D;
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

  async function capturePPImage(keepPoints = false) {
    ppCapturing = true;
    if (!keepPoints) {
        ppPickPoint = null;
        ppPlacePoint = null;
    }
    try {
      const res = await fetch('/mcp', {
        method: 'POST',
        body: JSON.stringify({
          type: 'call_tool',
          name: 'get_live_image',
          arguments: { visualize_axes: true }
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await res.json();
      
      if (result.content && Array.isArray(result.content)) {
        for (const content of result.content) {
          if (content.type === 'text') {
            try {
              const parsed = JSON.parse(content.text);
              if (parsed.image_jpeg_base64) {
                ppImage = `data:image/jpeg;base64,${parsed.image_jpeg_base64}`;
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
      console.error('PP Capture failed:', e);
      alert(`Error: ${e.message}`);
    } finally {
      ppCapturing = false;
    }
  }

  async function handlePPImageClick(event: MouseEvent & { currentTarget: HTMLImageElement }) {
    if (ppExecuting) return;
    
    const img = event.currentTarget;
    const rect = img.getBoundingClientRect();
    const x_click = event.clientX - rect.left;
    const y_click = event.clientY - rect.top;
    
    let u = Math.floor(x_click * (img.naturalWidth / rect.width));
    let v = Math.floor(y_click * (img.naturalHeight / rect.height));
    
    u = Math.max(0, Math.min(u, img.naturalWidth - 1));
    v = Math.max(0, Math.min(v, img.naturalHeight - 1));

    const u_norm = u / img.naturalWidth;
    const v_norm = v / img.naturalHeight;

    try {
        const res = await fetch('/mcp', {
            method: 'POST',
            body: JSON.stringify({
                type: 'call_tool',
                name: 'convert_coordinates',
                arguments: { x: u, y: v, source: 'pixel', target: 'marker' }
            }),
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await res.json();

        if (result.content && Array.isArray(result.content)) {
            for (const content of result.content) {
                if (content.type === 'text') {
                    try {
                        const coords = JSON.parse(content.text);
                        if (typeof coords.x === 'number') {
                            // Get World Coordinates from Marker Coordinates
                            let worldCoords = { x: coords.x, y: coords.y };
                            try {
                                const resWorld = await fetch('/mcp', {
                                    method: 'POST',
                                    body: JSON.stringify({
                                        type: 'call_tool',
                                        name: 'convert_coordinates',
                                        arguments: { x: coords.x, y: coords.y, z: coords.z || 0, source: 'marker', target: 'world' }
                                    }),
                                    headers: { 'Content-Type': 'application/json' }
                                });
                                const resultWorld = await resWorld.json();
                                if (resultWorld.content) {
                                    for (const c of resultWorld.content) {
                                        if (c.type === 'text') {
                                            const wc = JSON.parse(c.text);
                                            if (typeof wc.x === 'number') worldCoords = wc;
                                        }
                                    }
                                }
                            } catch (e) { console.error("Failed to convert to world coords", e); }

                            const pt = { 
                                u, v, 
                                x: coords.x, y: coords.y, // Marker coords
                                xw: worldCoords.x, yw: worldCoords.y, // World coords
                                u_norm, v_norm
                            };
                            
                            if (!ppPickPoint) {
                                ppPickPoint = pt;
                            } else if (!ppPlacePoint) {
                                ppPlacePoint = pt;
                            } else {
                                ppPickPoint = pt;
                                ppPlacePoint = null;
                            }
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
        console.error('PP Conversion failed:', e);
        alert(`Error: ${e.message}`);
    }
  }

  async function pollDetections() {
    if (!ppLive || !ppShowDetections || ppDetectionPolling) {
        return;
    }
    ppDetectionPolling = true;
    try {
        const res = await fetch('/mcp', {
            method: 'POST',
            body: JSON.stringify({
                type: 'call_tool',
                name: 'get_live_image',
                arguments: { 
                    detect_objects: true,
                    return_image: false, // Only get detections
                    confidence: Number(detectionConfidence) 
                }
            }),
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await res.json();
        if (result.content && Array.isArray(result.content)) {
            for (const content of result.content) {
                if (content.type === 'text') {
                    try {
                        const parsed = JSON.parse(content.text);
                        if (parsed.detections && Array.isArray(parsed.detections)) {
                            ppDetections = parsed.detections;
                        }
                    } catch (e) {
                        console.error("Error parsing detection poll response:", e);
                    }
                }
            }
        }
    } catch (e) {
        console.error("Detection polling failed:", e);
    } finally {
        ppDetectionPolling = false;
        // Schedule next poll
        if (ppLive && ppShowDetections) {
            ppDetectionTimeout = setTimeout(pollDetections, ppDetectionInterval);
        }
    }
  }

  function clearPPPoints() {
    ppPickPoint = null;
    ppPlacePoint = null;
  }

  function toggleLive() {
    ppLive = !ppLive;
    if (ppLive) {
        // ストリーミングURLを設定 (ポート8000)
        ppImage = `http://${window.location.hostname}:8000/stream.mjpg?t=${Date.now()}`;
        if (ppShowDetections) {
            pollDetections();
        }
    } else {
        ppImage = null;
        if (liveInterval) {
            clearInterval(liveInterval);
            liveInterval = null;
        }
        clearTimeout(ppDetectionTimeout);
        ppDetections = [];
    }
  }

  async function runPickAndPlace() {
    if (!ppPickPoint || !ppPlacePoint) return;
    ppExecuting = true;
    currentRobotPos = { x: 0, y: 0, z: 0 };
    
    const pickZ = Number(ppPickZ ?? 20);
    const placeZ = Number(ppPlaceZ ?? 30);
    const safetyZ = Number(ppSafetyZ ?? 70);

    // Sequence from mcp_server.py vision_system.py
    const cmds = [
        "grip open",
        `move z=${safetyZ} s=100`,
        `move x=${ppPickPoint.xw} y=${ppPickPoint.yw} z=${safetyZ} s=100`,
        `move z=${pickZ} s=50`,
        "grip close",
        "delay t=1000",
        `move z=${safetyZ} s=100`,
        `move x=${ppPlacePoint.xw} y=${ppPlacePoint.yw} z=${safetyZ} s=100`,
        `move z=${placeZ} s=50`,
        "grip open",
        "delay t=1000",
        `move z=${safetyZ} s=100`,
        "move x=110 y=0 z=70 s=50"
    ];

    try {
        for (const cmd of cmds) {
            const res = await fetch('/mcp', {
                method: 'POST',
                body: JSON.stringify({
                    type: 'call_tool',
                    name: 'execute_sequence',
                    arguments: { commands: cmd }
                }),
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await res.json();
            console.log(`Cmd: ${cmd}, Result:`, result);
            
        }
    } catch (e: any) {
        console.error('P&P Execution failed:', e);
        alert(`Error: ${e.message}`);
    } finally {
        ppExecuting = false;
        joypadLeft = { x: 0, y: 0 };
        joypadRight = { x: 0, y: 0 };
    }
  }

  async function executeSingleCommand(cmd: string) {
    try {
      await fetch('/mcp', {
          method: 'POST',
          body: JSON.stringify({
              type: 'call_tool',
              name: 'execute_sequence',
              arguments: { commands: cmd }
          }),
          headers: { 'Content-Type': 'application/json' }
      });
    } catch (e) {
      console.error(`Failed to execute command: ${cmd}`, e);
    }
  }

  onMount(() => {
    const sse = new EventSource('/mcp');
    sse.onmessage = (e) => console.log("SSE:", e.data);
    
    (async () => {
      await loadTools();
      await executeSingleCommand("move x=110 y=0 z=70 s=50");

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
    })();

    const joypadInterval = setInterval(async () => {
      if (ppExecuting) return;
      try {
        const res = await fetch('/mcp', {
          method: 'POST',
          body: JSON.stringify({
            type: 'call_tool',
            name: 'get_joypad_state',
            arguments: {}
          }),
          headers: { 'Content-Type': 'application/json' }
        });
        const result = await res.json();
        if (result.content && Array.isArray(result.content)) {
          const text = result.content.find((c: any) => c.type === 'text')?.text;
          if (text) {
            const state = JSON.parse(text);
            const scale = 15 / 128; // UI scale factor
            joypadLeft = { x: (state.X ?? 0) * scale, y: (state.Y ?? 0) * scale };
            joypadRight = { x: (state.RX ?? 0) * scale, y: (state.RY ?? 0) * scale };
          }
        }
      } catch (e) {}
    }, 100);

    return () => {
      sse.close();
      clearInterval(joypadInterval);
    };
  });
</script>

<svelte:head>
  <title>{t.title}</title>
  <link
    href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css"
    rel="stylesheet"
    integrity="sha384-T3c6CoIi6uLrA9TneNEoa7RxnatzjcDSCmG1MXxSR1GAsXEV/Dwwykc2MPK8M2HN"
    crossorigin="anonymous"
  />

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js" integrity="sha384-C6RzsynM9kWDrMNeT87bh95OGNyZPhcTNXj1NW7RuBCsyN/o0jlpcV8Qyq46cDfL" crossorigin="anonymous"></script>
</svelte:head>

<main class="container mt-3">
  <div>
    <h2>{t.title}</h2>
    <ul class="nav nav-tabs mt-3" id="myTab" role="tablist">
      <li class="nav-item" role="presentation">
        <button
          class="nav-link active"
          id="camera-tab"
          data-bs-toggle="tab"
          data-bs-target="#camera-tab-pane"
          type="button"
          role="tab"
          aria-controls="camera-tab-pane"
          aria-selected="true">{t.tab_camera}</button>
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="nav-link"
          id="pp-tab"
          data-bs-toggle="tab"
          data-bs-target="#pp-tab-pane"
          type="button"
          role="tab"
          aria-controls="pp-tab-pane"
          aria-selected="false">{t.tab_control}</button>
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="nav-link"
          id="gemini-tab"
          data-bs-toggle="tab"
          data-bs-target="#gemini-tab-pane"
          type="button"
          role="tab"
          aria-controls="gemini-tab-pane"
          aria-selected="false">{t.tab_gemini}</button>
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="nav-link"
          id="home-tab"
          data-bs-toggle="tab"
          data-bs-target="#home-tab-pane"
          type="button"
          role="tab"
          aria-controls="home-tab-pane"
          aria-selected="false">{t.tab_tools}</button>
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="nav-link"
          id="settings-tab"
          data-bs-toggle="tab"
          data-bs-target="#settings-tab-pane"
          type="button"
          role="tab"
          aria-controls="settings-tab-pane"
          aria-selected="false">{t.tab_settings}</button>
      </li>
    </ul>
    <div class="tab-content p-3 border border-top-0 rounded-bottom" id="myTabContent">
      <div class="tab-pane fade show active" id="camera-tab-pane" role="tabpanel" aria-labelledby="camera-tab" tabindex="0">
        <div class="d-flex flex-column align-items-center mt-3">
          <div class="mb-3 d-flex gap-2 align-items-center">
            <select class="form-select w-auto" bind:value={detectionModel}>
              <option value="yolo11n">yolo11n</option>
              <option value="tensorflow.js">tensorflow.js</option>
              <option value="gemini-2.5-flash">gemini-2.5-flash</option>
              <option value="gemini-robotics-er-1.5-preview">gemini-robotics-er-1.5-preview</option>
            </select>
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="visualizeAxesCheck" bind:checked={visualizeAxes}>
              <label class="form-check-label" for="visualizeAxesCheck">Axes</label>
            </div>
            <div class="input-group input-group-sm" style="width: auto;">
              <span class="input-group-text">{t.confidence}</span>
              <input type="number" class="form-control" style="width: 60px;" bind:value={detectionConfidence} min="0.1" max="1.0" step="0.1">
            </div>
            <button class="btn btn-primary" onclick={captureImage} disabled={capturing}>
              {capturing ? t.capturing : t.capture}
            </button>
            <button
              class="btn btn-primary"
              onclick={detectObjects}
              disabled={detecting || (detectionModel === 'tensorflow.js' && !tfReady)}
            >
              {#if detecting}{t.detecting}
              {:else if detectionModel === 'tensorflow.js' && !tfReady}Loading TF.js...
              {:else}{t.detect}{/if}
            </button>
            <button class="btn btn-primary" onclick={transformAllObjects} disabled={detectedObjects.length === 0}>
              {t.transform}
            </button>
          </div>
          {#if cameraImage}
            <div class="position-relative d-inline-block">
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <img src={cameraImage} alt="Robot Camera View" class="img-fluid border rounded" style="max-height: 500px; cursor: crosshair;" onclick={handleImageClick} />
              {#each detectedObjects as obj, i}
                {@const color = getColorForLabel(obj.label)}
                {#if obj.ground_center}
                    {@const groundContactX = obj.ground_center.u_norm / 10}
                    {@const groundContactY = obj.ground_center.v_norm / 10}
                    {#if obj.label.endsWith('_ok') && obj.ground_center.radius_u_norm}
                        <div style="position: absolute; left: {groundContactX}%; top: {groundContactY}%; width: {(obj.ground_center.radius_u_norm / 10) * 2}%; height: {(obj.ground_center.radius_v_norm / 10) * 2}%; border: 1px dashed {color}; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; opacity: 0.7; z-index: 5;"></div>
                    {/if}
                    {#if obj.ground_center.u_top_norm !== undefined}
                        {@const topX = obj.ground_center.u_top_norm / 10}
                        {@const topY = obj.ground_center.v_top_norm / 10}
                        <svg style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5;">
                          <line x1="{groundContactX}%" y1="{groundContactY}%" x2="{topX}%" y2="{topY}%" stroke="{color}" stroke-width="2" stroke-dasharray="4" />
                        </svg>
                        <div style="position: absolute; left: {topX}%; top: {topY}%; width: 6px; height: 6px; background-color: {color}; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; z-index: 5;"></div>
                    {/if}
                    <div style="position: absolute; left: {groundContactX}%; top: {groundContactY}%; width: 10px; height: 10px; background-color: {color}; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; z-index: 5;"></div>
                {/if}
                <div style="position: absolute; left: {obj.box_2d[1]/10}%; top: {obj.box_2d[0]/10}%; width: {(obj.box_2d[3]-obj.box_2d[1])/10}%; height: {(obj.box_2d[2]-obj.box_2d[0])/10}%; border: 2px solid {color}; pointer-events: none; z-index: 5;">
                  <span style="background: {color}; color: {getTextColor(color)}; position: absolute; top: -1.5em; left: 0; padding: 0 2px; font-size: 0.8em; white-space: nowrap;">{obj.label}</span>
                </div>
                {#if obj.ground_center}
                    <div style="position: absolute; left: {obj.ground_center.u_norm / 10}%; top: {obj.ground_center.v_norm / 10}%; transform: translateX(15px) translateY(-50%); pointer-events: auto; display: flex; align-items: center; gap: 5px; z-index: 5;">
                        {#if obj.imageCoords}
                            <div style="background: rgba(0,0,0,0.7); color: white; padding: 2px 5px; border-radius: 3px; font-size: 0.7em; font-family: monospace; white-space: nowrap;">
                                <div>u: {obj.imageCoords.u}, v: {obj.imageCoords.v} (px)</div>
                                {#if obj.worldCoords}
                                    <div>x: {obj.worldCoords.x.toFixed(1)}, y: {obj.worldCoords.y.toFixed(1)} (mm)</div>
                                {/if}
                            </div>
                        {/if}
                    </div>
                {/if}
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
                    <div>x: {targetWorldCoords.x.toFixed(1)}, y: {targetWorldCoords.y.toFixed(1)} (mm)</div>
                  {/if}
                </div>
              {/if}
            </div>
          {:else}
            <div class="text-muted p-5 border rounded bg-light">
              {t.no_image}
            </div>
          {/if}
        </div>
      </div>
      <div class="tab-pane fade" id="pp-tab-pane" role="tabpanel" aria-labelledby="pp-tab" tabindex="0">
        <div class="d-flex flex-column align-items-center mt-3">
          <div class="mb-3 d-flex gap-2 align-items-center flex-wrap justify-content-center">
            <button class="btn {ppLive ? 'btn-danger' : 'btn-outline-danger'}" onclick={toggleLive}>
              {ppLive ? t.stop_live : t.live}
            </button>
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" role="switch" id="ppShowDetectionsSwitch" bind:checked={ppShowDetections}>
              <label class="form-check-label" for="ppShowDetectionsSwitch">{t.show_detections}</label>
            </div>
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" role="switch" id="ppShowTrajectorySwitch" bind:checked={ppShowTrajectory}>
              <label class="form-check-label" for="ppShowTrajectorySwitch">{t.show_trajectory}</label>
            </div>
            <div class="input-group input-group-sm" style="width: auto;">
                <span class="input-group-text">{t.interval_ms}</span>
                <input type="text" class="form-control" style="width: 60px;" bind:value={ppDetectionInterval} disabled={!ppShowDetections}>
            </div>
            <div class="input-group input-group-sm" style="width: auto;">
                <span class="input-group-text">{t.confidence}</span>
                <input type="number" class="form-control" style="width: 60px;" bind:value={detectionConfidence} min="0.1" max="1.0" step="0.1" disabled={!ppShowDetections}>
            </div>
            <button class="btn btn-secondary" onclick={clearPPPoints} disabled={ppExecuting}>
              {t.clear}
            </button>
            <button class="btn btn-success" onclick={runPickAndPlace} disabled={!ppPickPoint || !ppPlacePoint || ppExecuting}>
              {ppExecuting ? t.running : t.pick_place}
            </button>

            <div class="input-group input-group-sm" style="width: auto;">
                <span class="input-group-text px-1">Pick</span>
                <input type="number" class="form-control px-1" style="width: 55px;" bind:value={ppPickZ}>
                <span class="input-group-text px-1">Place</span>
                <input type="number" class="form-control px-1" style="width: 55px;" bind:value={ppPlaceZ}>
                <span class="input-group-text px-1">Safe</span>
                <input type="number" class="form-control px-1" style="width: 55px;" bind:value={ppSafetyZ}>
            </div>
          </div>
          
          {#if ppImage}
            <div class="position-relative d-inline-block">
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <img 
                src={ppImage} 
                alt="Pick & Place View" 
                class="img-fluid border rounded" 
                style="max-height: 500px; cursor: crosshair;" 
                onclick={handlePPImageClick}
                onload={(e) => { const img = e.currentTarget as HTMLImageElement; ppImageDim = { w: img.naturalWidth, h: img.naturalHeight }; }} 
              />
              
              {#if ppShowDetections}
                {#each ppDetections as obj}
                  {@const color = getColorForLabel(obj.label)}
                  {#if obj.ground_center}
                      {@const groundContactX = obj.ground_center.u_norm / 10}
                      {@const groundContactY = obj.ground_center.v_norm / 10}
                      {#if obj.label.endsWith('_ok') && obj.ground_center.radius_u_norm}
                          <div style="position: absolute; left: {groundContactX}%; top: {groundContactY}%; width: {(obj.ground_center.radius_u_norm / 10) * 2}%; height: {(obj.ground_center.radius_v_norm / 10) * 2}%; border: 1px dashed {color}; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; z-index: 5; opacity: 0.7;"></div>
                      {/if}
                      {#if obj.ground_center.u_top_norm !== undefined}
                          {@const topX = obj.ground_center.u_top_norm / 10}
                          {@const topY = obj.ground_center.v_top_norm / 10}
                          <svg style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5;">
                            <line x1="{groundContactX}%" y1="{groundContactY}%" x2="{topX}%" y2="{topY}%" stroke="{color}" stroke-width="2" stroke-dasharray="4" />
                          </svg>
                          <div style="position: absolute; left: {topX}%; top: {topY}%; width: 6px; height: 6px; background-color: {color}; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; z-index: 5;"></div>
                      {/if}
                      <div style="position: absolute; left: {groundContactX}%; top: {groundContactY}%; width: 10px; height: 10px; background-color: {color}; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; z-index: 5;"></div>
                  {/if}
                  <div style="position: absolute; left: {obj.box_2d[1]/10}%; top: {obj.box_2d[0]/10}%; width: {(obj.box_2d[3]-obj.box_2d[1])/10}%; height: {(obj.box_2d[2]-obj.box_2d[0])/10}%; border: 2px solid {color}; pointer-events: none; z-index: 5;">
                    <span style="background: {color}; color: {getTextColor(color)}; position: absolute; top: -1.5em; left: 0; padding: 0 2px; font-size: 0.8em; white-space: nowrap;">{obj.label}</span>
                  </div>
                {/each}
              {/if}

              {#if ppShowTrajectory && ppTrajectoryPoints.length > 0 && ppImageDim}
                <svg viewBox="0 0 {ppImageDim.w} {ppImageDim.h}" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; z-index: 4;">
                  <polyline 
                    points={ppTrajectoryPoints.map(p => `${p.u},${p.v}`).join(' ')}
                    fill="none"
                    stroke="deeppink" 
                    stroke-width="3" 
                    stroke-dasharray="5,5"
                  />
                  {#each ppTrajectoryPoints as p}
                    <circle cx="{p.u}" cy="{p.v}" r="3" fill="deeppink" />
                  {/each}
                </svg>
              {/if}

              {#if ppPickPoint}
                {@const pt = ppPickPoint}
                <div style="position: absolute; left: {pt.u_norm * 100}%; top: {pt.v_norm * 100}%; transform: translate(-50%, -50%); pointer-events: none;">
                    <div style="width: 10px; height: 10px; background: purple; border-radius: 50%;"></div>
                    <div style="position: absolute; top: -10px; left: 15px; background: rgba(0,0,0,0.5); color: white; padding: 4px; border-radius: 4px; font-size: 0.8em; white-space: nowrap;">
                        <div style="font-weight: bold; color: #d0a0ff;">Pick</div>
                        <div>u:{pt.u}, v:{pt.v}</div>
                        <div>x:{pt.x.toFixed(1)}, y:{pt.y.toFixed(1)}</div>
                        <div>xw:{pt.xw.toFixed(1)}, yw:{pt.yw.toFixed(1)}</div>
                    </div>
                </div>
              {/if}

              {#if ppPlacePoint}
                {@const pt = ppPlacePoint}
                <div style="position: absolute; left: {pt.u_norm * 100}%; top: {pt.v_norm * 100}%; transform: translate(-50%, -50%); pointer-events: none;">
                    <div style="width: 10px; height: 10px; background: blue; border-radius: 50%;"></div>
                    <div style="position: absolute; top: -10px; left: 15px; background: rgba(0,0,0,0.5); color: white; padding: 4px; border-radius: 4px; font-size: 0.8em; white-space: nowrap;">
                        <div style="font-weight: bold; color: #a0a0ff;">Place</div>
                        <div>u:{pt.u}, v:{pt.v}</div>
                        <div>x:{pt.x.toFixed(1)}, y:{pt.y.toFixed(1)}</div>
                        <div>xw:{pt.xw.toFixed(1)}, yw:{pt.yw.toFixed(1)}</div>
                    </div>
                </div>
              {/if}
            </div>
          {:else}
            <div class="text-muted p-5 border rounded bg-light">
              {t.click_live}
            </div>
          {/if}
          
          <!-- Joypad Visualization -->
          <div class="d-flex flex-column align-items-center mt-3 mb-3 p-2 border rounded bg-light">
            <div class="d-flex gap-4 justify-content-center">
                <div class="joypad-stick">
                    <div class="stick-label">{t.joypad_left}</div>
                    <div class="stick-base">
                        <div class="stick-knob" style="transform: translate({joypadLeft.x}px, {joypadLeft.y}px)"></div>
                    </div>
                </div>
                <div class="joypad-stick">
                    <div class="stick-label">{t.joypad_right}</div>
                    <div class="stick-base">
                        <div class="stick-knob" style="transform: translate({joypadRight.x}px, {joypadRight.y}px)"></div>
                    </div>
                </div>
            </div>
          </div>
        </div>
      </div>
      <div class="tab-pane fade" id="gemini-tab-pane" role="tabpanel" aria-labelledby="gemini-tab" tabindex="0">
        <div class="p-5 text-center text-muted">
          <h4>{t.gemini_placeholder}</h4>
        </div>
      </div>
      <div class="tab-pane fade" id="home-tab-pane" role="tabpanel" aria-labelledby="home-tab" tabindex="0">
        {#if error}
          <div class="alert alert-danger" role="alert">{t.error_tools}{error}</div>
        {:else if tools.length === 0}
          <div class="d-flex align-items-center gap-2">
            <p class="mb-0">{t.loading_tools}</p>
            <button class="btn btn-sm btn-outline-primary" onclick={loadTools}>Refresh</button>
          </div>
        {:else}
          <div class="d-flex justify-content-end mb-2">
            <button class="btn btn-sm btn-outline-secondary" onclick={loadTools}>Refresh Tools</button>
          </div>
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
      <div class="tab-pane fade" id="settings-tab-pane" role="tabpanel" aria-labelledby="settings-tab" tabindex="0">
        <div class="p-3">
          <div class="mb-3">
            <label for="langSelect" class="form-label">{t.settings_lang}</label>
            <select class="form-select w-auto" id="langSelect" bind:value={currentLang}>
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
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
</main>

<style>
    .joypad-stick {
        display: flex;
        flex-direction: column;
        align-items: center;
    }
    .stick-label {
        font-size: 0.8rem;
        margin-bottom: 5px;
        font-weight: bold;
    }
    .stick-base {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background-color: #ddd;
        border: 2px solid #bbb;
        position: relative;
        display: flex;
        justify-content: center;
        align-items: center;
    }
    .stick-knob {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        background-color: #555;
        transition: transform 0.2s ease;
    }
</style>
