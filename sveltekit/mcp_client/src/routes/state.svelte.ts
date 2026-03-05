import { env } from "$env/dynamic/public";
import { GeminiLiveClient } from "$lib/gemini";

// MCPサーバーが提供するツールのインターフェース定義
export interface Tool {
  name: string;
  description?: string;
  inputSchema: Record<string, any>;
}

// 対応言語の型定義
export type Lang = "ja" | "en";

// UIの多言語対応用の翻訳テキスト
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

// アプリケーション全体の状態を管理するクラス
export class AppState {
  // --- ツール関連の状態 ---
  tools = $state<Tool[]>([]); // 利用可能なツールの一覧
  error = $state<string | null>(null); // ツール読み込み時のエラーメッセージ
  selectedTool = $state<Tool | null>(null); // 現在選択されているツール
  toolArgs = $state<Record<string, any>>({}); // 選択されたツールの引数
  executionResult = $state<{ text?: string; image?: string } | null>(null); // ツールの実行結果
  isExecuting = $state(false); // ツールが実行中かどうかのフラグ

  // --- カメラ・画像認識関連の状態 ---
  cameraImage = $state<string | null>(null); // カメラから取得した静止画像（Base64）
  capturing = $state(false); // 静止画をキャプチャ中かどうかのフラグ
  tfReady = $state(false); // TensorFlow.jsが利用可能かどうかのフラグ
  detectionModel = $state("yolo11n"); // 使用する物体検出モデル
  detecting = $state(false); // 物体検出中かどうかのフラグ
  targetMarker = $state<{ x: number; y: number } | null>(null); // ユーザーがクリックした位置のマーカー（UI用）
  targetImageCoords = $state<{ u: number; v: number } | null>(null); // クリックされた画像のピクセル座標
  targetWorldCoords = $state<{ x: number; y: number } | null>(null); // ピクセル座標から変換されたロボットのワールド座標
  detectedObjects = $state<any[]>([]); // 静止画上で検出されたオブジェクトのリスト
  visualizeAxes = $state(true); // 画像に座標軸を可視化するかのフラグ
  detectionConfidence = $state(0.7); // 物体検出の信頼度の閾値

  // --- Pick & Placeタブ関連の状態 ---
  ppImage = $state<string | null>(null); // Pick & Place用のライブストリーム画像URLまたは静止画
  ppCapturing = $state(false); // (未使用の可能性)
  ppPickPoint = $state<any>(null); // ピックアップする地点の座標情報
  ppPlacePoint = $state<any>(null); // プレースする地点の座標情報
  ppExecuting = $state(false); // Pick & Placeシーケンスが実行中かどうかのフラグ
  ppPickZ = $state(10); // ピックアップ時のZ座標 (mm)
  ppPlaceZ = $state(30); // プレース時のZ座標 (mm)
  ppSafetyZ = $state(70); // 安全な高さのZ座標 (mm)
  ppLive = $state(false); // ライブストリーム表示中かどうかのフラグ
  ppShowDetections = $state(false); // ライブストリーム上で物体検出を有効にするかのフラグ
  ppDetections = $state<any[]>([]); // ライブストリーム上で検出されたオブジェクト
  ppDetectionPolling = $state(false); // 物体検出のポーリング中かどうかのフラグ
  ppDetectionTimeout: any = null; // 物体検出ポーリングのタイマーID
  ppShowTrajectory = $state(false); // Pick & Placeの軌道を表示するかのフラグ
  ppHoveredObject = $state<any>(null); // マウスがホバーしているオブジェクト
  ppTrajectoryPoints = $state<{ u: number; v: number }[]>([]); // 表示用の軌道（2D画像座標）
  ppImageDim = $state<{ w: number; h: number } | null>(null); // (未使用の可能性)
  joypadLeft = $state({ x: 0, y: 0 }); // 左ジョイパッドの状態
  joypadRight = $state({ x: 0, y: 0 }); // 右ジョイパッドの状態
  lastPPMousePosition = $state<{ x: number; y: number } | null>(null); // Pick & Place画像上での最後のマウス位置
  robotStatus = $state<any>(null); // ロボットのステータス (TCP, Joints)
  
  // --- Geminiモニター関連の状態 ---
  geminiLive = $state(false); // Gemini Liveが有効かどうかのフラグ
  cliMonitor = $state(false); // Gemini CLIモニターが有効かどうかのフラグ
  geminiLogs = $state<any[]>([]); // MCPサーバーから取得したツール実行ログ
  geminiDetections = $state<any[]>([]); // Geminiモニターで表示する検出オブジェクト
  geminiTrajectoryPoints = $state<any[]>([]); // Geminiモニターで表示する軌道
  geminiImageDim = $state<{ w: number; h: number } | null>(null); // (未使用の可能性)
  geminiClient = $state<GeminiLiveClient | null>(null); // Gemini Liveクライアントのインスタンス
  geminiMicLevel = $state(0); // マイクの音量レベル
  geminiSpeakerLevel = $state(0); // スピーカーの音量レベル
  geminiStatus = $state("Disconnected"); // Gemini Liveの接続状態
  geminiLiveLog = $state<any[]>([]); // Gemini Liveの対話ログ
  geminiInterimTranscript = $state(""); // Gemini Liveの音声認識の中間結果
  cliMonitorLoaded = $state(false); // CLIモニターの画像が読み込まれたかのフラグ
  cliMonitorImageSrc = $state<string | null>(null); // CLIモニターの画像ソースURL
  geminiLiveMonitorLoaded = $state(false); // Gemini Liveモニターの画像が読み込まれたかのフラグ
  geminiLiveMonitorImageSrc = $state<string | null>(null); // Gemini Liveモニターの画像ソースURL
  isPollingLogs = $state(false); // ログのポーリング中かどうかのフラグ

  // --- 設定関連の状態 ---
  currentTheme = $state((env.PUBLIC_MCP_THEME as string) || "spaceship"); // 現在のUIテーマ
  currentLang = $state<Lang>((env.PUBLIC_MCP_LANGUAGE as Lang) || "ja"); // 現在の言語

  // 派生状態: 現在の言語に応じた翻訳テキスト
  t = $derived(translations[this.currentLang]);

  constructor() {
    // $effect: currentThemeが変更されたときにテーマクラスを<body>に適用する
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

    // $effect: 軌道表示が有効になったときに軌道を更新する
    $effect(() => {
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

    // $effect: Geminiモニターが有効になったときにログのポーリングを開始/停止する
    $effect(() => {
      if (this.geminiLive || this.cliMonitor) {
        if (!this.isPollingLogs) {
          this.pollGeminiLogs();
        }
      } else {
        // 両方のモニターがオフになったらポーリングを停止し、表示をクリアする
        this.isPollingLogs = false;
        this.geminiDetections = [];
        this.geminiTrajectoryPoints = [];
      }
    });

    // $effect: Pick & Placeのライブ検出が有効になったときに検出のポーリングを開始/停止する
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

  // アプリケーションの初期化処理
  async init() {
    await this.loadTools(); // ツール一覧を読み込む
    await this.executeSingleCommand("move x=110 y=0 z=70 s=50"); // ロボットを初期位置に移動
    this.loadTFJS(); // TensorFlow.jsをロード
    this.startJoypadPolling(); // ジョイパッドの状態ポーリングを開始
    this.startRobotStatusPolling(); // ロボットステータスのポーリングを開始
  }

  // TensorFlow.jsとCOCO-SSDモデルを動的にロードする
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
        this.tfReady = true; // ロード完了フラグを立てる
      };
      document.head.appendChild(cocoSsdScript);
    };
    document.head.appendChild(tfScript);
  }

  // MCPサーバーから利用可能なツールの一覧を読み込む
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

  // 単一のコマンド文字列をMCPサーバーに送信して実行する
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

  // カメラから静止画をキャプチャする
  async captureImage() {
    this.capturing = true;
    // 関連する状態をリセット
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

  // MCPサーバーからの画像を含むレスポンスをパースして画像データを抽出する
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

  // 選択されたモデルを使用して物体検出を実行する
  async detectObjects() {
    if (this.detectionModel === "tensorflow.js") {
      // TensorFlow.jsを使用したクライアントサイドでの検出
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
        // 検出結果をアプリの状態に保存
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
        // YOLOv11n (MCPサーバーサイド) を使用した検出
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
            // レスポンスから画像と検出結果をパース
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
        // Gemini Vision (サーバーサイド) を使用した検出
        this.detecting = true;
        this.detectedObjects = [];
        this.targetMarker = null;
        this.targetImageCoords = null;
        this.targetWorldCoords = null;

        try {
            // 1. MCPサーバーから最新画像を取得
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

            // 2. SvelteKitのサーバーエンドポイント経由でGemini APIを呼び出し
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

            // 検出結果を状態に保存
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

  // 画像のピクセル座標をワールド座標に変換する
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

  // ツール実行用のモーダルを開く
  openToolModal(tool: Tool) {
    this.selectedTool = tool;
    this.toolArgs = {};
    this.executionResult = null;
    // ツールの入力スキーマから引数の初期値を設定
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

  // 選択されたツールを実行する
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

      // 既存の汎用的なレスポンスパース処理
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

  // Pick & Placeシーケンスを実行する
  async runPickAndPlace() {
    if (!this.ppPickPoint || !this.ppPlacePoint) return;
    this.ppExecuting = true;

    const pickZ = Number(this.ppPickZ ?? 20);
    const placeZ = Number(this.ppPlaceZ ?? 30);
    const safetyZ = Number(this.ppSafetyZ ?? 70);

    // 実行するコマンドのシーケンスを定義
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
      "move x=110 y=0 z=70 s=50", // ホームポジションに戻る
    ];

    // コマンドを順次実行
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

  // Pick & Placeのポイントをクリアする
  clearPPPoints() {
    this.ppPickPoint = null;
    this.ppPlacePoint = null;
  }

  // 検出結果や追跡情報など、関連する視覚情報をクリアする
  clearDetectionsAndTracking() {
    this.detectedObjects = [];
    this.targetMarker = null;
    this.targetImageCoords = null;
    this.targetWorldCoords = null;
    this.ppDetections = [];
    this.ppHoveredObject = null;
    this.ppTrajectoryPoints = [];
    this.geminiDetections = [];
    this.geminiTrajectoryPoints = [];
    this.geminiLogs = [];
    this.geminiInterimTranscript = "";
    this.cliMonitorImageSrc = null;
    this.geminiLiveMonitorImageSrc = null;
  }

  // Pick & Place画像上でのマウス移動イベントを処理する
  handlePPMouseMove(event: MouseEvent) {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // 座標を0-1000の範囲に正規化してホバー検出に使用
    const mx = (x / rect.width) * 1000;
    const my = (y / rect.height) * 1000;

    this.lastPPMousePosition = { x: mx, y: my };
    this.updatePPHover();
  }

  // マウスがPick & Place画像から離れたときの処理
  handlePPMouseLeave() {
    this.lastPPMousePosition = null;
    this.ppHoveredObject = null;
  }

  // Pick & Placeのライブストリーム表示を切り替える
  async toggleLive() {
    this.ppLive = !this.ppLive;
    if (this.ppLive) {
      this.clearDetectionsAndTracking();
      this.ppDetections = [];
      // MJPEGストリームのURLを設定（キャッシュを避けるためにタイムスタンプを追加）
      this.ppImage = `http://${window.location.hostname}:8000/stream.mjpg?t=${Date.now()}`;
    } else {
      this.ppImage = null;
      this.clearDetectionsAndTracking();
    }
  }

  // ライブストリーム上で物体検出を定期的に実行（ポーリング）
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
        if (!this.ppLive) return; // ポーリング中にライブが停止された場合

        // レスポンスから検出結果をパース
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
        // ライブ検出が有効な限り、次のポーリングをスケジュール
        if (this.ppLive && this.ppShowDetections) {
          this.ppDetectionTimeout = setTimeout(() => this.pollDetections(), 0); // 可能な限り早く次のリクエストを送る
        }
    }
  }

  // マウスカーソルがどの検出オブジェクト上にあるかを更新する
  updatePPHover() {
    if (!this.lastPPMousePosition || !this.ppShowDetections) {
      this.ppHoveredObject = null;
      return;
    }
    const { x: mx, y: my } = this.lastPPMousePosition;
    let found = null;

    // 配列を逆順にループして、最も手前（描画順で上）のオブジェクトを見つける
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

  // Pick & Placeの軌道を計算して更新する
  async updateTrajectory() {
    if (!this.ppPickPoint || !this.ppPlacePoint) {
        this.ppTrajectoryPoints = [];
        return;
    }
    const hasTool = this.tools.some((t) => t.name === "convert_coordinates");
    if (!hasTool) {
      // 座標変換ツールがない場合は、単純に2点を結ぶ線を描画
      this.ppTrajectoryPoints = [
        { u: this.ppPickPoint.u, v: this.ppPickPoint.v },
        { u: this.ppPlacePoint.u, v: this.ppPlacePoint.v },
      ];
      return;
    }

    // 軌道の経由点を3Dワールド座標で定義
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

    // API呼び出しを減らすために、重複する座標をまとめる
    const uniquePointsMap = new Map<string, typeof path[0]>();
    path.forEach(p => {
      const key = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;
      if (!uniquePointsMap.has(key)) {
        uniquePointsMap.set(key, p);
      }
    });

    // 各ユニークな3D座標を2D画像座標に並行して変換
    const conversionPromises = Array.from(uniquePointsMap.entries()).map(async ([key, p]) => {
      const uv = await this.convertWorldToImage(p.x, p.y, p.z);
      return { key, uv };
    });

    const conversions = await Promise.all(conversionPromises);
    const conversionMap = new Map(conversions.map(c => [c.key, c.uv]));

    // 元の軌道パスを2D画像座標で再構築
    const points2D = [];
    for (const p of path) {
      const key = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;
      const uv = conversionMap.get(key);

      // 変換に成功した点を追加
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

  // Pick & Place画像がクリックされたときの処理
  async handlePPImageClick(event: MouseEvent) {
    if (this.ppExecuting) return;

    const img = event.target as HTMLImageElement;
    const rect = img.getBoundingClientRect();

    let u: number;
    let v: number;
    let u_norm: number;
    let v_norm: number;

    // ホバー中のオブジェクトがあれば、その中心をクリック位置とする
    if (this.ppHoveredObject && this.ppHoveredObject.ground_center) {
      u_norm = this.ppHoveredObject.ground_center.u_norm / 1000.0;
      v_norm = this.ppHoveredObject.ground_center.v_norm / 1000.0;
      u = Math.round(u_norm * img.naturalWidth);
      v = Math.round(v_norm * img.naturalHeight);
    } else {
      // なければ、クリックされた位置をそのまま使用
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
      // 座標変換を段階的に実行: pixel -> marker -> world
      const markerCoords = await this.convertCoordinates(u, v, "pixel", "marker");
      const worldCoords = await this.convertCoordinates(markerCoords.xm, markerCoords.ym, "marker", "world", markerCoords.zm);

      // 変換が成功したら、すべての座標情報を含むポイントオブジェクトを作成
      const pt = { u, v, u_norm, v_norm, ...markerCoords, ...worldCoords };

      // ピック/プレースポイントを設定
      if (!this.ppPickPoint) {
        this.ppPickPoint = pt;
      } else if (!this.ppPlacePoint) {
        this.ppPlacePoint = pt;
      } else {
        // 3回目のクリックでリセット
        this.ppPickPoint = pt;
        this.ppPlacePoint = null;
      }
    } catch (e: any) {
      console.error("PP Point selection failed:", e.message);
      alert(`ポイント設定エラー: ${e.message}`);
    }
  }

  // 汎用的な座標変換関数。pixel, marker, world座標系間の変換を行う。
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
      // ArUcoエラーはそのままスローし、それ以外のパースエラーなどは汎用的なメッセージでラップする
      if (e.message.includes("ArUco")) throw e;
      console.error("Failed to process coordinate conversion response:", responseText);
      throw new Error(`座標変換の応答処理に失敗しました: ${e.message}`);
    }
  }

  // ワールド座標を画像座標に変換する（軌道計算用）。エラー時はnullを返す。
  async convertWorldToImage(x: number, y: number, z: number): Promise<{u: number, v: number} | null> {
    try {
      // 堅牢なconvertCoordinates関数を使用するが、ここではエラーをスローしない。
      // 1点の変換失敗で軌道計算全体が停止するのを防ぐため、nullを返して警告をログに出力する。
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

  // Geminiのツール実行ログを定期的にポーリングする
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
          this.geminiLogs = logs.reverse(); // 最新のログが上に来るように逆順にする

          if (this.geminiLogs.length > 0) {
            this.parseGeminiVisuals(this.geminiLogs); // ログから視覚情報をパース
          }
        }
      }
    } catch (e) {
      console.error("Gemini log polling failed:", e);
    }

    if (this.isPollingLogs) {
      setTimeout(() => this.pollGeminiLogs(), 1000); // 1秒後に再度ポーリング
    }
  }

  // Geminiによって実行されたコマンドから軌道を更新する
  async updateGeminiTrajectory(commands: string) {
    const cmds = commands.split(";");
    const points3D = [];
    // サーバー側の初期位置設定(130, 0, 70)に合わせる
    const home = { x: 130, y: 0, z: 70, type: "home" };
    
    // 現在位置を追跡するための変数。初期値はホームポジション。
    let current = { ...home };
    points3D.push({ ...current, type: "home" });

    // "move"コマンドをパースして経由点を抽出
    for (const cmd of cmds) {
      const c = cmd.trim();
      if (c.toLowerCase().startsWith("move")) {
        const xMatch = c.match(/x\s*=\s*([-+]?\d*\.?\d+)/i);
        const yMatch = c.match(/y\s*=\s*([-+]?\d*\.?\d+)/i);
        const zMatch = c.match(/z\s*=\s*([-+]?\d*\.?\d+)/i);
        
        let updated = false;
        if (xMatch) { current.x = parseFloat(xMatch[1]); updated = true; }
        if (yMatch) { current.y = parseFloat(yMatch[1]); updated = true; }
        if (zMatch) { current.z = parseFloat(zMatch[1]); updated = true; }
        
        if (updated) {
          points3D.push({ ...current, type: "waypoint" });
        }
      }
    }

    // 3D座標を2D画像座標に変換
    const promises = points3D.map(async (p) => {
      const uv = await this.convertWorldToImage(p.x, p.y, p.z);
      return uv ? { ...uv, ...p } : null;
    });
    
    const results = await Promise.all(promises);
    this.geminiTrajectoryPoints = results.filter((p) => p !== null);
  }

  // Geminiのログから検出結果や軌道などの視覚情報をパースして状態を更新する
  async parseGeminiVisuals(logs: any[]) {
    // 最新のget_live_imageログから検出結果を取得
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

    // CLIモニターの場合、execute_sequenceログから軌道を取得
    if (this.geminiLive) return;

    const moveLog = logs.find((l: any) => l.tool === "execute_sequence");
    if (moveLog && moveLog.args?.commands) {
      await this.updateGeminiTrajectory(moveLog.args.commands);
    } else {
      this.geminiTrajectoryPoints = [];
    }
  }

  // Gemini CLIモニターの表示を切り替える
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

  // ジョイパッドの状態を定期的にポーリングする
  startJoypadPolling() {
    const loop = async () => {
        if (!this.ppExecuting) { // Pick&Place実行中はポーリングしない
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
                        const scale = 10 / 128; // 値をスケーリング
                        this.joypadLeft = { x: (state.X ?? 0) * scale, y: (state.Y ?? 0) * scale };
                        this.joypadRight = { x: (state.RX ?? 0) * scale, y: (state.RY ?? 0) * scale };
                    }
                }
            } catch (e) {}
        }
        setTimeout(loop, 100); // 100msごとにポーリング
    };
    loop();
  }

  // ロボットのステータスを定期的にポーリングする
  startRobotStatusPolling() {
    const loop = async () => {
        // Pick & Place実行中や他の重い処理中はポーリングしない
        if (!this.ppExecuting && !this.capturing && !this.detecting && !this.isExecuting) {
            try {
                const res = await fetch("/mcp", {
                    method: "POST",
                    body: JSON.stringify({ type: "call_tool", name: "dump", arguments: { calling_client: "web_client" } }),
                    headers: { "Content-Type": "application/json" },
                });
                if (res.ok) {
                    const result = await res.json();
                    const text = result.content?.find((c: any) => c.type === "text")?.text;
                    if (text) {
                        try {
                            this.robotStatus = JSON.parse(text);
                        } catch (e) {}
                    }
                }
            } catch (e) {}
        }
        setTimeout(loop, 1000); // 1秒ごとにポーリング
    };
    loop();
  }

  // 接続成功時に効果音を再生する
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

  // Gemini Liveの接続/切断を切り替える
  async toggleGeminiLive() {
    this.geminiLive = !this.geminiLive;
    if (this.geminiLive) {
      // 接続時の初期化処理
      this.clearDetectionsAndTracking();
      this.geminiLiveMonitorLoaded = false;
      this.geminiLiveLog = [];
      this.geminiInterimTranscript = "";
      this.geminiLiveMonitorImageSrc = `http://${window.location.hostname}:8000/stream.mjpg?t=${Date.now()}`;

      // GeminiLiveClientをインスタンス化し、コールバックを設定
      this.geminiClient = new GeminiLiveClient({
        onConnect: () => { this.geminiStatus = "Connected"; this.playConnectedSound(); console.log('Gemini Status:', this.geminiStatus); this.geminiLiveMonitorLoaded = true; },
        onDisconnect: () => { this.geminiStatus = "Disconnected"; this.geminiMicLevel = 0; this.geminiSpeakerLevel = 0; },
        onError: (e) => { this.geminiStatus = `Error: ${e.message || e}`; if (this.geminiLive) this.toggleGeminiLive(); },
        onVolume: (mic, speaker) => { this.geminiMicLevel = mic; this.geminiSpeakerLevel = speaker; },
        onUserQuery: (text, isFinal) => {
            if (isFinal) {
                // 最終的な音声認識結果をログに追加
                if (text) {
                    this.geminiLiveLog.push({ source: "user", content: text, timestamp: Date.now() });
                }
                this.geminiInterimTranscript = "";
            } else {
                // 中間結果をUIに表示
                this.geminiInterimTranscript = text;
            }
        },
        onModelResponse: (text) => {
            // モデルからの応答をストリーミングでログに追加
            const lastLog = this.geminiLiveLog[this.geminiLiveLog.length - 1];
            if (lastLog && lastLog.source === "model") lastLog.content += text;
            else this.geminiLiveLog.push({ source: "model", content: text, timestamp: Date.now() });
        },
        onToolCall: async (name, args) => {
            // ツール呼び出しをログに記録
            const timestamp = Date.now();
            const entry = { source: "tool" as const, toolName: name, toolArgs: args, timestamp, toolResult: undefined as string | undefined };
            this.geminiLiveLog.push(entry);

            // コマンドに応じて軌道を描画
            if (name === "execute_sequence" && args.commands) {
                await this.updateGeminiTrajectory(args.commands);
            }

            try {
                // MCPサーバーにツール実行をリクエスト
                const res = await fetch("/mcp", {
                    method: "POST",
                    body: JSON.stringify({ type: "call_tool", name, arguments: { ...args, calling_client: "gemini_live" } }),
                    headers: { "Content-Type": "application/json" },
                });
                const result = await res.json();

                // 実行後は軌道をクリア
                if (name === "execute_sequence") {
                    this.geminiTrajectoryPoints = [];
                }

                // ログには生のレスポンスを保存
                const resultStr = JSON.stringify(result);
                const targetEntry = this.geminiLiveLog.find(e => e.timestamp === timestamp && e.toolName === name);
                if (targetEntry) targetEntry.toolResult = resultStr;

                // Geminiに返す結果を整形
                if (result.content && Array.isArray(result.content)) {
                    const textPart = result.content.find((c: any) => c.type === "text" && c.text)?.text;
                    if (textPart) {
                        try {
                            // JSONならパースして返す
                            return JSON.parse(textPart);
                        } catch (e) {
                            // JSONでなければテキストとして返す
                            return { result: textPart };
                        }
                    }
                }
                // 汎用的な成功応答
                return { result: "Tool executed successfully." };
            } catch (e: any) {
                if (name === "execute_sequence") {
                    this.geminiTrajectoryPoints = [];
                }

                const errStr = `Error: ${e.message}`;
                const targetEntry = this.geminiLiveLog.find(e => e.timestamp === timestamp && e.toolName === name);
                if (targetEntry) targetEntry.toolResult = errStr;
                return { error: errStr }; // エラーを返す
            }
        }
      });
      await this.geminiClient.connect(this.tools); // 接続を開始
    } else {
        // 切断時の処理
        this.clearDetectionsAndTracking();
        if (this.geminiClient) {
          this.geminiClient.disconnect();
          // onDisconnectコールバックが即座に発火しない場合に備え、手動で状態をリセット
          this.geminiClient = null;
          this.geminiStatus = "Disconnected";
          this.geminiMicLevel = 0;
          this.geminiSpeakerLevel = 0;
        }
    }
  }
}