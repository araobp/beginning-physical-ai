import { GoogleGenAI } from "@google/genai";

/**
 * Gemini Liveで使用するモデル名
 */
export const GEMINI_LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

/**
 * Gemini Live APIとの通信を管理するための設定インターフェース。
 */
export interface GeminiLiveConfig {
    onConnect?: () => void; // 接続確立時に呼び出されるコールバック
    onDisconnect?: () => void; // 切断時に呼び出されるコールバック
    onError?: (error: any) => void; // エラー発生時に呼び出されるコールバック
    onVolume?: (micLevel: number, speakerLevel: number) => void; // 音量レベル更新時に呼び出されるコールバック (0.0 - 1.0)
    onUserQuery?: (text: string, isFinal: boolean) => void; // ユーザーの音声認識結果（中間・最終）受信時に呼び出されるコールバック
    onModelResponse?: (text: string) => void; // モデルからのテキスト応答受信時に呼び出されるコールバック
    onToolCall?: (name: string, args: any) => Promise<any>; // ツール呼び出し要求時に呼び出されるコールバック
}

/**
 * Gemini Live APIとのWebSocket通信、音声ストリーミング、およびメッセージ処理を管理するクライアントクラス。
 * 音声の入出力、WebSocket接続の確立と維持、およびサーバーからのメッセージのハンドリングを行います。
 */
export class GeminiLiveClient {
    private config: GeminiLiveConfig;
    private client: GoogleGenAI | null = null;
    private session: any = null;
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private audioProcessor: AudioWorkletNode | null = null;
    private inputAnalyser: AnalyserNode | null = null;
    private outputAnalyser: AnalyserNode | null = null;
    private volumeInterval: any = null;
    private nextStartTime: number = 0;
    private isConnected: boolean = false;
    private audioSources: Set<AudioBufferSourceNode> = new Set();

    constructor(config: GeminiLiveConfig) {
        this.config = config;
    }

    /**
     * Gemini Live APIへの接続を開始します。
     * AudioContextの初期化、WebSocket接続の確立、および音声ストリームの開始を行います。
     *
     * @param tools - 使用可能なツールの定義配列。
     */
    async connect(tools: any[] = []) {
        console.log("GeminiLiveClient: connect called with tools:", tools);
        if (this.isConnected) return;

        // Initialize AudioContext here to capture user gesture
        // ユーザーのジェスチャー（クリックなど）内でAudioContextを初期化または再開する必要があります。
        // ブラウザの自動再生ポリシーにより、ユーザー操作なしでの音声再生はブロックされるためです。
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioContextClass({
            sampleRate: 16000 // Gemini Live APIは16kHzまたは24kHzを推奨
        });
        await this.audioContext.resume();
        console.log("AudioContext state:", this.audioContext.state);

        // ツール定義をセッション構成に変換
        // ツール定義をGemini APIが期待する形式に変換
        const toolDefinitions: any[] | undefined = tools.length > 0 ? [{
            functionDeclarations: tools.map(tool => {
                // inputSchemaから$schemaプロパティを除外してパラメータ定義のみを抽出
                const { $schema, ...parameters } = tool.inputSchema;
                return {
                    name: tool.name,
                    description: tool.description,
                    parameters: parameters
                };
            })
        }] : undefined;
        console.log("Function declarations for tools:", toolDefinitions);

        try {
            // エフェメラルトークンを取得
            // サーバーサイドのエンドポイントからエフェメラルトークンを取得
            // クライアントサイドでAPIキーを直接使用しないためのセキュリティ対策
            const tokenRes = await fetch('/api/gemini-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tools: toolDefinitions })
            });
            if (!tokenRes.ok) {
                const errText = await tokenRes.text();
                throw new Error(`Failed to fetch ephemeral token: ${tokenRes.status} ${errText}`);
            }
            const tokenData = await tokenRes.json();
            console.log("Token response data:", tokenData);
            const ephemeralToken = tokenData.name; // トークン文字列ではなくリソース名が返る場合があるが、SDKが処理する
            console.log("Fetched ephemeral token: ", ephemeralToken);

            // GoogleGenAIクライアントの初期化
            this.client = new GoogleGenAI({
                apiKey: ephemeralToken,
                httpOptions: { apiVersion: "v1alpha" }
            });

            // WebSocket接続の確立
            const session = await this.client.live.connect({
                model: GEMINI_LIVE_MODEL,
                callbacks: {
                    onopen: () => {
                        console.log("Gemini Live WebSocket Connected");
                        this.isConnected = true;
                        this.config.onConnect?.();
                        // 接続確立後にマイク入力のストリーミングを開始
                        this.startAudioStream();
                    },
                    onmessage: (msg: any) => {
                        this.handleMessage(msg);
                    },
                    onclose: () => {
                        console.log("Gemini Live WebSocket Closed");
                        this.disconnect();
                    },
                    onerror: (err: any) => {
                        console.error("Gemini Live WebSocket Error:", err);
                        this.config.onError?.(err);
                    }
                }
            });

            // @ts-ignore
            this.session = session;

        } catch (e) {
            console.error("Connection failed:", e);
            this.config.onError?.(e);
            // 接続失敗時はAudioContextをクリーンアップ
            this.audioContext.close();
            this.audioContext = null;
            return;
        }
    }

    /**
     * Gemini Live APIとの接続を切断し、リソースを解放します。
     */
    disconnect() {
        if (!this.isConnected && !this.session) return;

        this.isConnected = false;
        this.stopAudioStream();

        if (this.session) {
            this.session.close();
            this.session = null;
        }
        this.config.onDisconnect?.();
    }

    /**
     * マイクからの音声ストリームを開始し、AudioWorkletを使用してPCMデータを処理します。
     * 処理された音声データはWebSocketを通じてサーバーに送信されます。
     */
    private async startAudioStream() {
        if (!this.audioContext) return;
        console.log("Starting audio stream...");

        // 入力（マイク）と出力（スピーカー）の音量分析用ノードを作成
        this.inputAnalyser = this.audioContext.createAnalyser();
        this.outputAnalyser = this.audioContext.createAnalyser();
        // 出力アナライザーを最終的な出力先（スピーカー）に接続
        this.outputAnalyser.connect(this.audioContext.destination);

        // マイクへのアクセスを要求
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        } catch (e) {
            console.error("getUserMedia error:", e);
            console.error("Microphone access denied", e);
            this.config.onError?.(e);
            return;
        }

        // AudioWorkletモジュールを追加
        // AudioWorkletモジュールをインラインコードから追加
        // 別ファイルにせずData URLを使用することで、単一ファイルでの配布を容易にしています
        await this.audioContext.audioWorklet.addModule(
            "data:text/javascript;base64," + btoa(this.getAudioWorkletCode())
        );

        const source = this.audioContext.createMediaStreamSource(this.mediaStream);
        // "pcm-processor" は getAudioWorkletCode 内で登録されたプロセッサ名
        this.audioProcessor = new AudioWorkletNode(this.audioContext, "pcm-processor");

        // AudioWorkletからのメッセージ（PCMデータ）を処理
        // WebSocketが接続されている場合、データを送信
        this.audioProcessor.port.onmessage = (event) => {
            const pcmData = event.data;

            // @ts-ignore
            if (this.session) {
                const buffer = pcmData.buffer;
                const base64 = this.arrayBufferToBase64(buffer);

                // Gemini Live APIへ音声データを送信
                // @ts-ignore
                this.session.sendRealtimeInput({
                    media: {
                        mimeType: "audio/pcm;rate=16000",
                        data: base64
                    }
                });
            }
        };

        // マイクソース -> アナライザー（可視化用）
        source.connect(this.inputAnalyser);
        // マイクソース -> プロセッサー（PCM変換・送信）
        source.connect(this.audioProcessor);

        this.startVolumeReporting();
        // Workletをdestinationに接続してプロセスを維持（音声は出力しないが処理は回る）
        // これを行わないと、一部のブラウザでAudioWorkletが停止する可能性があります
        this.audioProcessor.connect(this.audioContext.destination);
    }

    /**
     * 音声ストリームを停止し、関連するリソース（MediaStream, AudioContextなど）を解放します。
     */
    private stopAudioStream() {
        this.stopVolumeReporting();
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        if (this.audioProcessor) {
            this.audioProcessor.disconnect();
            this.audioProcessor = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        this.inputAnalyser = null;
        this.outputAnalyser = null;
    }

    /**
     * 現在再生中の音声を停止し、再生キューをクリアします。
     */
    private stopAudioPlayback() {
        this.audioSources.forEach(source => {
            try {
                source.stop();
            } catch (e) { }
        });
        this.audioSources.clear();
        this.nextStartTime = 0;
    }

    /**
     * 入力および出力の音量レベルを定期的に監視し、コールバックを通じて通知します。
     */
    private startVolumeReporting() {
        if (this.volumeInterval) clearInterval(this.volumeInterval);
        this.volumeInterval = setInterval(() => {
            if (this.config.onVolume) {
                const getRMS = (analyser: AnalyserNode | null) => {
                    if (!analyser) return 0;
                    const bufferLength = analyser.fftSize;
                    const dataArray = new Uint8Array(bufferLength);
                    analyser.getByteTimeDomainData(dataArray);
                    let sum = 0;
                    for (let i = 0; i < bufferLength; i++) {
                        const x = (dataArray[i] - 128) / 128.0;
                        sum += x * x;
                    }
                    return Math.sqrt(sum / bufferLength);
                };
                const inputVol = Math.min(1, getRMS(this.inputAnalyser) * 2);
                const outputVol = Math.min(1, getRMS(this.outputAnalyser) * 2);
                this.config.onVolume(inputVol, outputVol);
            }
        }, 50);
    }

    /**
     * 音量レベルの監視を停止します。
     */
    private stopVolumeReporting() {
        if (this.volumeInterval) clearInterval(this.volumeInterval);
        this.volumeInterval = null;
    }

    /**
     * AudioWorkletProcessorのコードを文字列として返します。
     * このプロセッサは、入力された浮動小数点オーディオデータを16ビット整数（PCM）に変換し、
     * バッファリングしてメインスレッドに送信します。
     */
    private getAudioWorkletCode() {
        return `
            class PCMProcessor extends AudioWorkletProcessor {
                constructor() {
                    super();
                    this.bufferSize = 2048;
                    this.buffer = new Float32Array(this.bufferSize);
                    this.bufferIndex = 0;
                }

                process(inputs, outputs, parameters) {
                    const input = inputs[0];
                    if (input.length > 0) {
                        const inputChannel = input[0];
                        for (let i = 0; i < inputChannel.length; i++) {
                            this.buffer[this.bufferIndex++] = inputChannel[i];
                            if (this.bufferIndex === this.bufferSize) {
                                this.flush();
                            }
                        }
                    }
                    return true;
                }

                flush() {
                    const pcmData = new Int16Array(this.bufferSize);
                    for (let i = 0; i < this.bufferSize; i++) {
                        const s = Math.max(-1, Math.min(1, this.buffer[i]));
                        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                    }
                    this.port.postMessage(pcmData);
                    this.bufferIndex = 0;
                }
            }
            registerProcessor("pcm-processor", PCMProcessor);
        `;
    }

    /**
     * ArrayBufferをBase64文字列に変換します。
     */
    private arrayBufferToBase64(buffer: ArrayBuffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    /**
     * サーバーからのメッセージを処理し、適切なアクション（音声再生、テキスト表示、ツール呼び出しなど）を実行します。
     */
    private handleMessage(msg: any) {
        console.log("GeminiLiveClient: handleMessage", msg);
        const serverContent = msg.serverContent;

        if (serverContent) {
            // ユーザーが割り込んだ場合（発話中にユーザーが話し始めた場合など）
            if (serverContent.interrupted) {
                console.log("Interrupted!");
                this.stopAudioPlayback(); // 現在の再生を即座に停止
            }

            const modelTurn = serverContent.modelTurn;
            if (modelTurn) {
                const parts = modelTurn.parts;
                for (const part of parts) {
                    // テキスト部分の処理（字幕やログ表示用）
                    if (part.text) {
                        console.log("Gemini text:", part.text);
                        if (this.config.onModelResponse) {
                            this.config.onModelResponse(part.text);
                        }
                    }

                    // 音声データ部分の処理
                    const inlineData = part.inlineData;
                    if (inlineData && inlineData.mimeType?.startsWith("audio/pcm")) {
                        this.playAudio(inlineData.data);
                    }
                }
            }
        } else if (msg.toolCall) {
            // ツール呼び出し要求の処理
            this.handleToolCall(msg.toolCall);
        } else if (msg.userQuery) {
            // ユーザーの音声認識結果を処理
            this.handleUserQuery(msg.userQuery);
        }
    }

    /**
     * ユーザーの音声認識結果（中間および最終）を処理します。
     * @param userQuery - サーバーから受信したuserQueryオブジェクト。
     */
    private handleUserQuery(userQuery: any) {
        const text = userQuery.parts?.map((p: any) => p.text).join('') || '';
        if (this.config.onUserQuery) {
            // isFinalフラグと共にテキストをコールバックで通知
            this.config.onUserQuery(text, userQuery.isFinal);
        }
    }

    /**
     * サーバーからのツール呼び出し要求を処理し、結果をサーバーに返送します。
     */
    private async handleToolCall(toolCall: any) {
        const functionCalls = toolCall.functionCalls;
        const toolResponses = [];

        for (const call of functionCalls) {
            console.log("Tool call:", call.name, call.args);
            let result = {};

            // クライアント側で定義されたツール実行関数を呼び出し
            // +page.svelteなどで定義されたコールバックが実行されます
            if (this.config.onToolCall) {
                result = await this.config.onToolCall(call.name, call.args);
            }

            if (result === undefined) result = { result: "ok" };

            toolResponses.push({
                id: call.id,
                name: call.name,
                response: {
                    result: result
                }
            });
        }

        // @ts-ignore
        if (this.session) {
            // ツールの実行結果をサーバーに送信
            // @ts-ignore
            this.session.sendToolResponse({
                functionResponses: toolResponses
            });
        }
    }

    /**
     * 受信したBase64形式の音声データをデコードし、再生します。
     * 連続した音声ストリームとして再生するために、再生時間をスケジューリングします。
     */
    private playAudio(base64Data: string) {
        if (!this.audioContext) return;
        console.log("playAudio: start");

        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        // Base64データをデコードしてPCMデータに変換
        // Base64データをデコードしてバイナリ文字列に変換
        const binaryString = window.atob(base64Data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        // PCMデータ (Int16) として解釈
        const int16 = new Int16Array(bytes.buffer);
        // Web Audio API用に Float32 (-1.0 ~ 1.0) に変換
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
            float32[i] = int16[i] / 32768.0;
        }

        // AudioBufferを作成して再生
        // AudioBufferを作成 (モノラル, サンプル数, サンプリングレート24kHz)
        // Gemini Live APIの出力は通常24kHz
        const buffer = this.audioContext.createBuffer(1, float32.length, 24000);
        buffer.copyToChannel(float32, 0);

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;

        // 出力アナライザーに接続して波形表示などを可能にする
        if (this.outputAnalyser) {
            try {
                source.connect(this.outputAnalyser);
            } catch (e) {
                console.error("outputAnalyser connect error", e)
            }
        } else {
            source.connect(this.audioContext.destination);
        }

        source.onended = () => {
            this.audioSources.delete(source);
        };

        // 途切れのない再生のために時間を同期
        // 次の再生開始時間が現在時刻より過去の場合は、現在時刻から再生
        if (this.nextStartTime < this.audioContext.currentTime) {
            this.nextStartTime = this.audioContext.currentTime;
        }

        source.start(this.nextStartTime);
        // 次のバッファの再生開始時間を更新
        this.nextStartTime += buffer.duration;

        this.audioSources.add(source);
    }
}