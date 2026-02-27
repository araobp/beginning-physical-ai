import { env } from "$env/dynamic/public";
import { GeminiLiveClient } from "$lib/gemini";

export interface Tool {
  name: string;
  description?: string;
  inputSchema: Record<string, any>;
}

export type Lang = "ja" | "en";

const translations = {
  ja: {
    title: "最も安い4軸ロボットアーム",
    tab_tools: "MCPツール",
    tab_resources: "MCPリソース",
    tab_camera: "ロボットの目",
    tab_control: "ロボット操縦（手動・半自動）",
    tab_gemini_cli: "ロボット操縦（Gemini CLI）",
    tab_gemini_live: "ロボット操縦（Gemini Live）",
    tab_settings: "設定",
    loading_tools: "ツールを読み込み中...",
    error_tools: "ツールの読み込みエラー: ",
    capture: "撮影",
    loading_resources: "リソースを読み込み中...",
    error_resources: "リソースの読み込みエラー: ",
    read_resource: "読み込み",
    no_resources: "リソースが見つかりません",
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
    gemini_live_placeholder: "Gemini Live VLA評価画面追加予定",
    show_detections: "物体検出",
    interval_ms: "更新間隔(ms)",
    confidence: "信頼度",
    show_trajectory: "軌道表示",
    gemini_monitor_desc: "Gemini CLIによる操作をモニタリングします。",
    gemini_live_monitor_desc: "Gemini Liveによる操作をモニタリングします。",
    theme_settings: "テーマ設定",
    theme_default: "デフォルト",
    theme_spaceship: "宇宙船",
    mjpeg_loading: "ストリームを読み込み中...",
    mjpeg_error: "ストリームが利用できません。",
    gemini_live_reasoning_path_header: "推論パス",
  },
  en: {
    title: "The Cheapest 4-DoF Robot Arm",
    tab_tools: "MCP Tools",
    tab_camera: "Robot Vision",
    tab_control: "Robot Control (Manual/Semi-Auto)",
    tab_gemini_cli: "Robot Control (Gemini CLI)",
    tab_gemini_live: "Robot Control (Gemini Live)",
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
    gemini_live_placeholder: "Gemini Live VLA evaluation screen coming soon",
    show_detections: "Object Detection",
    interval_ms: "Interval (ms)",
    confidence: "Confidence",
    show_trajectory: "Show Trajectory",
    gemini_monitor_desc: "Monitor operations performed by Gemini CLI.",
    gemini_live_monitor_desc: "Monitor operations performed by Gemini Live.",
    theme_settings: "Theme Settings",
    theme_default: "Default",
    theme_spaceship: "Spaceship",
    mjpeg_loading: "Loading stream...",
    mjpeg_error: "Stream unavailable.",
    gemini_live_reasoning_path_header: "Reasoning Path",
  },
};

export class AppState {
  // Tools
  tools = $state<Tool[]>([]);
  error = $state<string | null>(null);
  selectedTool = $state<Tool | null>(null);
  toolArgs = $state<Record<string, any>>({});
  executionResult = $state<{ text?: string; image?: string } | null>(null);
  isExecuting = $state(false);

  // Camera
  cameraImage = $state<string | null>(null);
  capturing = $state(false);
  tfReady = $state(false);
  detectionModel = $state("yolo11n");
  detecting = $state(false);
  targetMarker = $state<{ x: number; y: number } | null>(null);
  targetImageCoords = $state<{ u: number; v: number } | null>(null);
  targetWorldCoords = $state<{ x: number; y: number } | null>(null);
  detectedObjects = $state<any[]>([]);
  visualizeAxes = $state(true);
  detectionConfidence = $state(0.7);

  // Pick & Place
  ppImage = $state<string | null>(null);
  ppCapturing = $state(false);
  ppPickPoint = $state<any>(null);
  ppPlacePoint = $state<any>(null);
  ppExecuting = $state(false);
  ppPickZ = $state(20);
  ppPlaceZ = $state(30);
  ppSafetyZ = $state(70);
  ppLive = $state(false);
  ppShowDetections = $state(false);
  ppDetections = $state<any[]>([]);
  ppDetectionPolling = $state(false);
  ppDetectionTimeout: any = null;
  ppShowTrajectory = $state(false);
  ppHoveredObject = $state<any>(null);
  ppTrajectoryPoints = $state<{ u: number; v: number }[]>([]);
  ppImageDim = $state<{ w: number; h: number } | null>(null);
  joypadLeft = $state({ x: 0, y: 0 });
  joypadRight = $state({ x: 0, y: 0 });
  lastPPMousePosition = $state<{ x: number; y: number } | null>(null);
  
  // Gemini Monitor
  geminiLive = $state(false);
  cliMonitor = $state(false);
  geminiLogs = $state<any[]>([]);
  geminiDetections = $state<any[]>([]);
  geminiTrajectoryPoints = $state<any[]>([]);
  geminiImageDim = $state<{ w: number; h: number } | null>(null);
  geminiClient = $state<GeminiLiveClient | null>(null);
  geminiMicLevel = $state(0);
  geminiSpeakerLevel = $state(0);
  geminiStatus = $state("Disconnected");
  geminiLiveLog = $state<{
    source: "user" | "model" | "tool";
    content?: string;
    toolName?: string;
    toolArgs?: any;
    toolResult?: string;
    timestamp: number;
  }[]>([]);
  geminiInterimTranscript = $state("");
  cliMonitorLoaded = $state(false);
  cliMonitorImageSrc = $state<string | null>(null);
  geminiLiveMonitorLoaded = $state(false);
  geminiLiveMonitorImageSrc = $state<string | null>(null);
  isPollingLogs = false;

  // Settings
  currentTheme = $state((env.PUBLIC_MCP_THEME as string) || "default");
  currentLang = $state<Lang>((env.PUBLIC_MCP_LANGUAGE as Lang) || "ja");

  t = $derived(translations[this.currentLang]);

  constructor() {
    $effect(() => {
      if (typeof window !== "undefined") {
        document.body.classList.remove("theme-default", "theme-spaceship");
        if (this.currentTheme === "spaceship") {
          document.body.classList.add("theme-spaceship");
        } else {
          document.body.classList.add("theme-default");
        }
      }
    });

    $effect(() => {
      // This effect handles trajectory updates.
      // It's wrapped in an async IIFE to handle the async nature of updateTrajectory.
      (async () => {
        if (this.ppShowTrajectory) {
          try {
            await this.updateTrajectory();
          } catch (err) {
            console.error("Failed to update trajectory in effect:", err);
          }
        } else {
          this.ppTrajectoryPoints = [];
        }
      })();
    });

    $effect(() => {
      if (this.geminiLive || this.cliMonitor) {
        if (!this.isPollingLogs) {
          this.pollGeminiLogs();
        }
      } else {
        // Stop polling if both are false
        this.isPollingLogs = false;
        // Clear visuals when monitors are off
        this.geminiDetections = [];
        this.geminiTrajectoryPoints = [];
      }
    });

    $effect(() => {
      if (this.ppShowDetections && this.ppLive) {
        clearTimeout(this.ppDetectionTimeout);
        this.pollDetections();
      } else {
        clearTimeout(this.ppDetectionTimeout);
        this.ppDetections = [];
      }
    });
  }

  async init() {
    await this.loadTools();
    await this.executeSingleCommand("move x=110 y=0 z=70 s=50");
    this.loadTFJS();
    this.startJoypadPolling();
  }

  loadTFJS() {
    if (typeof document === 'undefined') return;
    const tfScript = document.createElement("script");
    tfScript.src = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs";
    tfScript.async = true;
    tfScript.onload = () => {
      const cocoSsdScript = document.createElement("script");
      cocoSsdScript.src = "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd";
      cocoSsdScript.async = true;
      cocoSsdScript.onload = () => {
        this.tfReady = true;
      };
      document.head.appendChild(cocoSsdScript);
    };
    document.head.appendChild(tfScript);
  }

  async loadTools() {
    try {
      const res = await fetch("/mcp", {
        method: "POST",
        body: JSON.stringify({ type: "list_tools" }),
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.tools) {
        this.tools = data.tools as Tool[];
      } else {
        this.error = data.error || "Failed to load tools";
      }
    } catch (e: any) {
      this.error = e.message;
    }
  }

  async executeSingleCommand(cmd: string) {
    try {
      await fetch("/mcp", {
        method: "POST",
        body: JSON.stringify({
          type: "call_tool",
          name: "execute_sequence",
          arguments: { commands: cmd, calling_client: "web_client" },
        }),
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      console.error(`Failed to execute command: ${cmd}`, e);
    }
  }

  async captureImage() {
    this.capturing = true;
    this.targetMarker = null;
    this.targetImageCoords = null;
    this.targetWorldCoords = null;
    this.detectedObjects = [];
    try {
      const res = await fetch("/mcp", {
        method: "POST",
        body: JSON.stringify({
          type: "call_tool",
          name: "get_live_image",
          arguments: {
            visualize_axes: this.visualizeAxes,
            return_image: true,
            calling_client: "web_client",
          },
        }),
        headers: { "Content-Type": "application/json" },
      });
      const result = await res.json();
      this.parseImageResult(result, (img) => this.cameraImage = img);
    } catch (e: any) {
      console.error("Capture failed:", e);
      alert(`Error: ${e.message}`);
    } finally {
      this.capturing = false;
    }
  }

  parseImageResult(result: any, callback: (img: string) => void) {
    if (result.content && Array.isArray(result.content)) {
      for (const content of result.content) {
        if (content.type === "text") {
          try {
            const parsed = JSON.parse(content.text);
            if (parsed.image_jpeg_base64) {
              callback(`data:image/jpeg;base64,${parsed.image_jpeg_base64}`);
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
  }

  async detectObjects() {
    if (this.detectionModel === "tensorflow.js") {
      // TFJS logic (simplified for brevity, assume similar to original)
      if (!this.tfReady || !this.cameraImage) {
        alert("TensorFlow.js is not ready or no image has been captured.");
        return;
      }
      this.detecting = true;
      this.detectedObjects = [];
      try {
        const imgElement = document.createElement("img");
        imgElement.src = this.cameraImage;
        await new Promise((resolve) => (imgElement.onload = resolve));
        // @ts-ignore
        const model = await window.cocoSsd.load();
        const predictions = await model.detect(imgElement);
        this.detectedObjects = predictions.map((p: any) => ({
          label: p.class,
          box_2d: [
            (p.bbox[1] / imgElement.naturalHeight) * 1000,
            (p.bbox[0] / imgElement.naturalWidth) * 1000,
            ((p.bbox[1] + p.bbox[3]) / imgElement.naturalHeight) * 1000,
            ((p.bbox[0] + p.bbox[2]) / imgElement.naturalWidth) * 1000,
          ],
          imageCoords: null,
          worldCoords: null,
          isTransforming: false,
        }));
      } finally {
        this.detecting = false;
      }
    } else if (this.detectionModel === "yolo11n") {
        // YOLO logic
        this.detecting = true;
        this.detectedObjects = [];
        try {
            const res = await fetch("/mcp", {
                method: "POST",
                body: JSON.stringify({
                    type: "call_tool",
                    name: "get_live_image",
                    arguments: {
                        visualize_axes: this.visualizeAxes,
                        detect_objects: true,
                        confidence: Number(this.detectionConfidence),
                        return_image: true,
                        calling_client: "web_client",
                    },
                }),
                headers: { "Content-Type": "application/json" },
            });
            const result = await res.json();
            if (result.content && Array.isArray(result.content)) {
                for (const content of result.content) {
                    if (content.type === "text") {
                        try {
                            const parsed = JSON.parse(content.text);
                            if (parsed.image_jpeg_base64) {
                                this.cameraImage = `data:image/jpeg;base64,${parsed.image_jpeg_base64}`;
                                if (parsed.detections && Array.isArray(parsed.detections)) {
                                    this.detectedObjects = parsed.detections.map((o: any) => ({
                                        ...o,
                                        imageCoords: null,
                                        worldCoords: null,
                                        isTransforming: false,
                                    }));
                                }
                                return;
                            }
                        } catch (e) {}
                    }
                }
            }
        } catch(e: any) {
            alert(`Error: ${e.message}`);
        } finally {
            this.detecting = false;
        }
    } else {
        // Gemini Vision logic
        this.detecting = true;
        this.detectedObjects = [];
        this.targetMarker = null;
        this.targetImageCoords = null;
        this.targetWorldCoords = null;

        try {
            // 1. MCPサーバーから最新画像を取得 (get_live_imageツールを使用)
            const resImg = await fetch("/mcp", {
                method: "POST",
                body: JSON.stringify({
                    type: "call_tool",
                    name: "get_live_image",
                    arguments: {
                        visualize_axes: this.visualizeAxes,
                        return_image: true,
                        calling_client: "web_client",
                    },
                }),
                headers: { "Content-Type": "application/json" },
            });
            const resultImg = await resImg.json();

            let currentImgBase64: string | null = null;
            // MCPのレスポンスから画像を抽出
            if (resultImg.content && Array.isArray(resultImg.content)) {
                for (const content of resultImg.content) {
                    if (content.type === "text") {
                        try {
                            const parsed = JSON.parse(content.text);
                            if (parsed.image_jpeg_base64) {
                                currentImgBase64 = `data:image/jpeg;base64,${parsed.image_jpeg_base64}`;
                                this.cameraImage = currentImgBase64; // UI更新
                            }
                        } catch (e) {}
                    }
                }
            }

            if (!currentImgBase64) {
                throw new Error("Failed to capture image from robot camera.");
            }

            // 2. Node.jsサーバー経由でGemini APIを呼び出し
            const resGemini = await fetch("/api/gemini-proxy", {
                method: "POST",
                body: JSON.stringify({
                    image: currentImgBase64,
                    model: this.detectionModel,
                }),
                headers: { "Content-Type": "application/json" },
            });

            if (!resGemini.ok) {
                const errText = await resGemini.text();
                throw new Error(
                    `Server Error (${resGemini.status}): ${errText.slice(0, 100)}...`,
                );
            }

            const resultGemini = await resGemini.json();

            if (resultGemini.error) {
                throw new Error(resultGemini.error);
            }

            if (resultGemini.detections && Array.isArray(resultGemini.detections)) {
                this.detectedObjects = resultGemini.detections.map((o: any) => ({
                    ...o,
                    imageCoords: null,
                    worldCoords: null,
                    isTransforming: false,
                }));
            }
        } catch (e: any) {
            console.error("Gemini Detection failed:", e);
            alert(`Error: ${e.message}`);
        } finally {
            this.detecting = false;
        }
    }
  }

  async convertImageCoordsToWorld(u: number, v: number) {
    try {
      const res = await fetch("/mcp", {
        method: "POST",
        body: JSON.stringify({
          type: "call_tool",
          name: "convert_coordinates",
          arguments: { x: u, y: v, source: "pixel", target: "world", calling_client: "web_client" },
        }),
        headers: { "Content-Type": "application/json" },
      });
      const result = await res.json();
      if (result.content) {
        const text = result.content.find((c: any) => c.type === "text")?.text;
        if (text) {
            try {
                const coords = JSON.parse(text);
                if (typeof coords.x === "number") this.targetWorldCoords = coords;
            } catch(e) {}
        }
      }
    } catch (e: any) {
      console.error("Conversion failed:", e);
    }
  }

  openToolModal(tool: Tool) {
    this.selectedTool = tool;
    this.toolArgs = {};
    this.executionResult = null;
    if (tool.inputSchema?.properties) {
      for (const key in tool.inputSchema.properties) {
        const prop = tool.inputSchema.properties[key];
        if (prop.default !== undefined) {
          this.toolArgs[key] = prop.default;
        } else if (prop.type === "boolean") {
          this.toolArgs[key] = false;
        } else {
          this.toolArgs[key] = "";
        }
      }
    }
  }

  async executeTool() {
    if (!this.selectedTool) return;
    this.isExecuting = true;
    this.executionResult = null;
    try {
      const res = await fetch("/mcp", {
        method: "POST",
        body: JSON.stringify({
          type: "call_tool",
          name: this.selectedTool.name,
          arguments: { ...this.toolArgs, calling_client: "web_client" },
        }),
        headers: { "Content-Type": "application/json" },
      });
      const result = await res.json();

      let text = "";
      let image: string | undefined = undefined;

      if (result.content && Array.isArray(result.content)) {
        for (const content of result.content) {
          if (content.type === "text") {
            try {
              const parsed = JSON.parse(content.text);
              if (parsed.image_jpeg_base64) {
                image = `data:image/jpeg;base64,${parsed.image_jpeg_base64}`;
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
      this.executionResult = { text: text.trim(), image };
    } catch (e: any) {
      this.executionResult = { text: `Error: ${e.message}` };
    } finally {
      this.isExecuting = false;
    }
  }

  async runPickAndPlace() {
    if (!this.ppPickPoint || !this.ppPlacePoint) return;
    this.ppExecuting = true;

    const pickZ = Number(this.ppPickZ ?? 20);
    const placeZ = Number(this.ppPlaceZ ?? 30);
    const safetyZ = Number(this.ppSafetyZ ?? 70);

    const cmds = [
      "grip open",
      `move z=${safetyZ} s=100`,
      `move x=${this.ppPickPoint.x} y=${this.ppPickPoint.y} z=${safetyZ} s=100`,
      `move z=${pickZ} s=50`,
      "grip close",
      "delay t=1000",
      `move z=${safetyZ} s=100`,
      `move x=${this.ppPlacePoint.x} y=${this.ppPlacePoint.y} z=${safetyZ} s=100`,
      `move z=${placeZ} s=50`,
      "grip open",
      "delay t=1000",
      `move z=${safetyZ} s=100`,
      "move x=110 y=0 z=70 s=50",
    ];

    // Execute commands sequentially
    (async () => {
      try {
        for (const cmd of cmds) {
          await this.executeSingleCommand(cmd);
        }
      } catch (e: any) {
        console.error("P&P Execution failed:", e);
        alert(`Error: ${e.message}`);
      } finally {
        this.ppExecuting = false;
      }
    })();
  }

  clearPPPoints() {
    this.ppPickPoint = null;
    this.ppPlacePoint = null;
  }

  handlePPMouseMove(event: MouseEvent) {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Normalize to 0-1000 for hover detection
    const mx = (x / rect.width) * 1000;
    const my = (y / rect.height) * 1000;

    this.lastPPMousePosition = { x: mx, y: my };
    this.updatePPHover();
  }

  handlePPMouseLeave() {
    this.lastPPMousePosition = null;
    this.ppHoveredObject = null;
  }

  // Pick & Place Logic
  async toggleLive() {
    this.ppLive = !this.ppLive;
    if (this.ppLive) {
      this.ppDetections = [];
      this.ppImage = `http://${window.location.hostname}:8000/stream.mjpg?t=${Date.now()}`;
    } else {
      this.ppImage = null;
      this.ppDetections = [];
    }
  }

  async pollDetections() {
    if (!this.ppLive || !this.ppShowDetections || this.ppDetectionPolling) return;
    this.ppDetectionPolling = true;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const res = await fetch("/mcp", {
            method: "POST",
            body: JSON.stringify({
                type: "call_tool",
                name: "get_live_image",
                arguments: { detect_objects: true, return_image: false, confidence: Number(this.detectionConfidence), calling_client: "web_client" },
            }),
            headers: { "Content-Type": "application/json" },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const result = await res.json();
        if (!this.ppLive) return;
        // Parse result and update ppDetections
        if (result.content) {
            const text = result.content.find((c: any) => c.type === "text")?.text;
            if (text) {
                const parsed = JSON.parse(text);
                if (parsed.detections) {
                  this.ppDetections = parsed.detections;
                  this.updatePPHover();
                }
            }
        }
    } catch (e) { console.error(e); }
    finally {
        this.ppDetectionPolling = false;
        if (this.ppLive && this.ppShowDetections) {
          this.ppDetectionTimeout = setTimeout(() => this.pollDetections(), 0);
        }
    }
  }

  updatePPHover() {
    if (!this.lastPPMousePosition || !this.ppShowDetections) {
      this.ppHoveredObject = null;
      return;
    }
    const { x: mx, y: my } = this.lastPPMousePosition;
    let found = null;
    // Iterate backwards to find the top-most object
    for (let i = this.ppDetections.length - 1; i >= 0; i--) {
      const obj = this.ppDetections[i];
      const [ymin, xmin, ymax, xmax] = obj.box_2d;
      if (mx >= xmin && mx <= xmax && my >= ymin && my <= ymax) {
        found = obj;
        break;
      }
    }
    this.ppHoveredObject = found;
  }

  async updateTrajectory() {
    if (!this.ppPickPoint || !this.ppPlacePoint) {
        this.ppTrajectoryPoints = [];
        return;
    }
    const hasTool = this.tools.some((t) => t.name === "convert_coordinates");
    if (!hasTool) {
      this.ppTrajectoryPoints = [
        { u: this.ppPickPoint.u, v: this.ppPickPoint.v },
        { u: this.ppPlacePoint.u, v: this.ppPlacePoint.v },
      ];
      return;
    }

    const home = { x: 110, y: 0, z: 70 };
    const pZ = Math.max(0, this.ppPickZ);
    const plZ = Math.max(0, this.ppPlaceZ);
    const sZ = Math.max(0, this.ppSafetyZ);

    const path = [
      home,
      { x: home.x, y: home.y, z: sZ },
      { x: this.ppPickPoint.x, y: this.ppPickPoint.y, z: sZ },
      { x: this.ppPickPoint.x, y: this.ppPickPoint.y, z: pZ },
      { x: this.ppPickPoint.x, y: this.ppPickPoint.y, z: sZ },
      { x: this.ppPlacePoint.x, y: this.ppPlacePoint.y, z: sZ },
      { x: this.ppPlacePoint.x, y: this.ppPlacePoint.y, z: plZ },
      { x: this.ppPlacePoint.x, y: this.ppPlacePoint.y, z: sZ },
      home,
    ];

    const pointCache = new Map<string, { u: number, v: number } | null>();
    const points2D = [];

    for (const p of path) {
      const key = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;
      let uv: { u: number, v: number } | null;

      if (pointCache.has(key)) {
        uv = pointCache.get(key)!;
      } else {
        uv = await this.convertWorldToImage(p.x, p.y, p.z);
        pointCache.set(key, uv);
      }

      if (uv) {
        points2D.push(uv);
      } else {
        if (this.ppPickPoint && p.x === this.ppPickPoint.x && p.y === this.ppPickPoint.y) {
          points2D.push({ u: this.ppPickPoint.u, v: this.ppPickPoint.v });
        } else if (this.ppPlacePoint && p.x === this.ppPlacePoint.x && p.y === this.ppPlacePoint.y) {
          points2D.push({ u: this.ppPlacePoint.u, v: this.ppPlacePoint.v });
        }
      }
    }
    this.ppTrajectoryPoints = points2D;
  }

  async handlePPImageClick(event: MouseEvent) {
    if (this.ppExecuting) return;

    const img = event.target as HTMLImageElement;
    const rect = img.getBoundingClientRect();

    let u: number;
    let v: number;
    let u_norm: number;
    let v_norm: number;

    if (this.ppHoveredObject && this.ppHoveredObject.ground_center) {
      u_norm = this.ppHoveredObject.ground_center.u_norm / 1000.0;
      v_norm = this.ppHoveredObject.ground_center.v_norm / 1000.0;
      u = Math.round(u_norm * img.naturalWidth);
      v = Math.round(v_norm * img.naturalHeight);
    } else {
      const x_click = event.clientX - rect.left;
      const y_click = event.clientY - rect.top;
      u = Math.floor(x_click * (img.naturalWidth / rect.width));
      v = Math.floor(y_click * (img.naturalHeight / rect.height));
      u = Math.max(0, Math.min(u, img.naturalWidth - 1));
      v = Math.max(0, Math.min(v, img.naturalHeight - 1));
      u_norm = u / img.naturalWidth;
      v_norm = v / img.naturalHeight;
    }

    try {
      // Step 1: Convert pixel coordinates to marker coordinates
      const markerCoords = await this.convertCoordinates(u, v, "pixel", "marker");

      // Step 2: Convert marker coordinates to world coordinates
      const worldCoords = await this.convertCoordinates(markerCoords.xm, markerCoords.ym, "marker", "world", markerCoords.zm);

      // If both conversions succeed, create the point
      const pt = { u, v, u_norm, v_norm, ...markerCoords, ...worldCoords };

      if (!this.ppPickPoint) {
        this.ppPickPoint = pt;
      } else if (!this.ppPlacePoint) {
        this.ppPlacePoint = pt;
      } else {
        this.ppPickPoint = pt;
        this.ppPlacePoint = null;
      }
    } catch (e: any) {
      console.error("PP Point selection failed:", e.message);
      alert(`ポイント設定エラー: ${e.message}`);
    }
  }

  async convertCoordinates(x: number, y: number, source: string, target: string, z: number = 0): Promise<any> {
    const args: any = { x, y, source, target, calling_client: "web_client" };
    if (source === 'marker' || source === 'world') {
      args.z = z;
    }

    const response = await fetch("/mcp", {
      method: "POST",
      body: JSON.stringify({ type: "call_tool", name: "convert_coordinates", arguments: args }),
      headers: { "Content-Type": "application/json" }
    });

    const responseText = await response.text();

    if (!response.ok) {
      if (responseText.includes("Could not find ArUco markers")) {
        throw new Error("基準となるArUcoマーカーが認識できませんでした。");
      }
      throw new Error(`サーバーエラー (${response.status}): ${responseText}`);
    }

    try {
      const result = JSON.parse(responseText);
      if (result.isError) {
        const errorMessage = result.error || (result.content && result.content[0]?.text) || "不明なツールエラー";
        if (errorMessage.includes("Could not find ArUco markers")) {
          throw new Error("基準となるArUcoマーカーが認識できませんでした。");
        }
        throw new Error(errorMessage);
      }
      const dataText = result.content?.find((c: any) => c.type === "text")?.text;
      if (!dataText) {
        throw new Error("ツールからの応答に座標データが含まれていません。");
      }
      return JSON.parse(dataText);
    } catch (e: any) {
      // Catch JSON parsing errors or errors thrown from above
      if (e.message.includes("ArUco")) throw e; // re-throw specific error
      console.error("Failed to process coordinate conversion response:", responseText);
      throw new Error(`座標変換の応答処理に失敗しました: ${e.message}`);
    }
  }

  async convertWorldToImage(x: number, y: number, z: number): Promise<{u: number, v: number} | null> {
    try {
      // We use the new robust convertCoordinates function, but we don't want to throw errors here,
      // as a failing point should not stop the entire trajectory from being calculated.
      // Instead, we return null and log a warning.
      const coords = await this.convertCoordinates(x, y, "world", "pixel", z);
      if (typeof coords.u === "number") {
        return coords;
      }
      return null;
    } catch (e: any) {
      console.warn(`Could not convert world point to image for trajectory: ${e.message}`);
      return null;
    }
  }

  async pollGeminiLogs() {
    if (!this.geminiLive && !this.cliMonitor) {
      this.isPollingLogs = false;
      return;
    }

    this.isPollingLogs = true;
    try {
      const res = await fetch("/mcp", {
        method: "POST",
        body: JSON.stringify({ type: "call_tool", name: "get_tool_logs", arguments: { calling_client: "web_client" }, }),
        headers: { "Content-Type": "application/json" },
      });
      const result = await res.json();

      if (!this.geminiLive && !this.cliMonitor) return;

      if (result.content && Array.isArray(result.content)) {
        const text = result.content.find((c: any) => c.type === "text")?.text;
        if (text) {
          const logs = JSON.parse(text);
          this.geminiLogs = logs.reverse();

          if (this.geminiLogs.length > 0) {
            this.parseGeminiVisuals(this.geminiLogs);
          }
        }
      }
    } catch (e) {
      console.error("Gemini log polling failed:", e);
    }

    if (this.isPollingLogs) {
      setTimeout(() => this.pollGeminiLogs(), 1000);
    }
  }

  async parseGeminiVisuals(logs: any[]) {
    // Detections
    const latestLog = logs.length > 0 ? logs[0] : null;
    if (latestLog && latestLog.tool === "get_live_image" && latestLog.args?.detect_objects) {
      if (latestLog.result) {
        try {
          const res = JSON.parse(latestLog.result);
          this.geminiDetections = res.detections || [];
        } catch (e) {
          this.geminiDetections = [];
        }
      }
    } else {
      this.geminiDetections = [];
    }

    // Trajectory
    const moveLog = logs.find((l: any) => l.tool === "execute_sequence");
    if (moveLog && moveLog.args?.commands) {
      const cmds = moveLog.args.commands.split(";");
      const points3D = [];
      const home = { x: 110, y: 0, z: 70, type: "home" };
      points3D.push(home);

      for (const cmd of cmds) {
        const c = cmd.trim();
        if (c.toLowerCase().startsWith("move")) {
          const xMatch = c.match(/x\s*=\s*([-+]?\d*\.?\d+)/i);
          const yMatch = c.match(/y\s*=\s*([-+]?\d*\.?\d+)/i);
          const zMatch = c.match(/z\s*=\s*([-+]?\d*\.?\d+)/i);
          if (xMatch && yMatch && zMatch) {
            points3D.push({ x: parseFloat(xMatch[1]), y: parseFloat(yMatch[1]), z: parseFloat(zMatch[1]), type: "waypoint" });
          }
        }
      }
      points3D.push({ ...home, type: "home" });

      const points2D = [];
      for (const p of points3D) {
        const uv = await this.convertWorldToImage(p.x, p.y, p.z);
        if (uv) {
          points2D.push({ ...uv, ...p });
        }
      }
      this.geminiTrajectoryPoints = points2D;
    } else {
      this.geminiTrajectoryPoints = [];
    }
  }

  toggleCliMonitor() {
    this.cliMonitor = !this.cliMonitor;
    if (this.cliMonitor) {
      this.cliMonitorImageSrc = `http://${window.location.hostname}:8000/stream.mjpg?t=${Date.now()}`;
      this.cliMonitorLoaded = false;
    } else {
      this.cliMonitorImageSrc = null;
      this.geminiDetections = [];
      this.geminiTrajectoryPoints = [];
    }
  }

  startJoypadPolling() {
    const loop = async () => {
        if (!this.ppExecuting) {
            try {
                const res = await fetch("/mcp", {
                    method: "POST",
                    body: JSON.stringify({ type: "call_tool", name: "get_joypad_status", arguments: {} }),
                    headers: { "Content-Type": "application/json" },
                });
                if (res.ok) {
                    const result = await res.json();
                    const text = result.content?.find((c: any) => c.type === "text")?.text;
                    if (text) {
                        const state = JSON.parse(text);
                        const scale = 10 / 128;
                        this.joypadLeft = { x: (state.X ?? 0) * scale, y: (state.Y ?? 0) * scale };
                        this.joypadRight = { x: (state.RX ?? 0) * scale, y: (state.RY ?? 0) * scale };
                    }
                }
            } catch (e) {}
        }
        setTimeout(loop, 100);
    };
    loop();
  }

  playConnectedSound() {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {}
  }
  // Gemini Live
  async toggleGeminiLive() {
    this.geminiLive = !this.geminiLive;
    if (this.geminiLive) {
      this.geminiLiveMonitorImageSrc = `http://${window.location.hostname}:8000/stream.mjpg?t=${Date.now()}`;
      this.geminiLiveMonitorLoaded = false;
      this.geminiLiveLog = [];
      this.geminiInterimTranscript = "";
      
      this.geminiClient = new GeminiLiveClient({
        onConnect: () => { this.geminiStatus = "Connected"; this.playConnectedSound(); },
        onDisconnect: () => { this.geminiStatus = "Disconnected"; this.geminiMicLevel = 0; this.geminiSpeakerLevel = 0; },
        onError: (e) => { this.geminiStatus = `Error: ${e.message || e}`; if (this.geminiLive) this.toggleGeminiLive(); },
        onVolume: (mic, speaker) => { this.geminiMicLevel = mic; this.geminiSpeakerLevel = speaker; },
        onUserQuery: (text, isFinal) => {
            if (isFinal) {
                // 最終結果が空でなければログに追加
                if (text) {
                    this.geminiLiveLog.push({ source: "user", content: text, timestamp: Date.now() });
                }
                this.geminiInterimTranscript = "";
            } else {
                // 中間結果を更新
                this.geminiInterimTranscript = text;
            }
        },
        onModelResponse: (text) => {
            const lastLog = this.geminiLiveLog[this.geminiLiveLog.length - 1];
            if (lastLog && lastLog.source === "model") lastLog.content += text;
            else this.geminiLiveLog.push({ source: "model", content: text, timestamp: Date.now() });
        },
        onToolCall: async (name, args) => {
            const timestamp = Date.now();
            const entry = { source: "tool" as const, toolName: name, toolArgs: args, timestamp, toolResult: undefined as string | undefined };
            this.geminiLiveLog.push(entry);

            try {
                const res = await fetch("/mcp", {
                    method: "POST",
                    body: JSON.stringify({ type: "call_tool", name, arguments: { ...args, calling_client: "gemini_live" } }),
                    headers: { "Content-Type": "application/json" },
                });
                const result = await res.json();
                const resultStr = JSON.stringify(result);
                const targetEntry = this.geminiLiveLog.find(e => e.timestamp === timestamp && e.toolName === name);
                if (targetEntry) targetEntry.toolResult = resultStr;
                return resultStr;
            } catch (e: any) {
                const errStr = `Error: ${e.message}`;
                const targetEntry = this.geminiLiveLog.find(e => e.timestamp === timestamp && e.toolName === name);
                if (targetEntry) targetEntry.toolResult = errStr;
                return errStr;
            }
        }
      });
      await this.geminiClient.connect(this.tools);
    } else {
        this.geminiLiveMonitorImageSrc = null;
        this.geminiDetections = [];
        this.geminiTrajectoryPoints = [];
        if (this.geminiClient) {
          this.geminiClient.disconnect();
          // Manually reset state to ensure UI consistency,
          // in case the onDisconnect callback doesn't fire immediately.
          this.geminiClient = null;
          this.geminiStatus = "Disconnected";
          this.geminiMicLevel = 0;
          this.geminiSpeakerLevel = 0;
        }
    }
  }
}