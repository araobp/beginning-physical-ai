import { GoogleGenAI } from "@google/genai";

/**
 * Gemini Live APIとの通信を管理するための設定インターフェース。
 */
export interface GeminiLiveConfig {
    onConnect?: () => void;
    onDisconnect?: () => void;
    onError?: (error: any) => void;
    onVolume?: (micLevel: number, speakerLevel: number) => void;
    onModelResponse?: (text: string) => void;
    onToolCall?: (name: string, args: any) => Promise<any>;
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
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioContextClass({
            sampleRate: 16000
        });
        await this.audioContext.resume();
        console.log("AudioContext state:", this.audioContext.state);

        // ツール定義をセッション構成に変換
        const toolDefinitions: any[] | undefined = tools.length > 0 ? [{
            functionDeclarations: tools.map(tool => {
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
            const ephemeralToken = tokenData.name;
            console.log("Fetched ephemeral token: ", ephemeralToken);

            this.client = new GoogleGenAI({
                apiKey: ephemeralToken,
                httpOptions: { apiVersion: "v1alpha" }
            });

            const session = await this.client.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                callbacks: {
                    onopen: () => {
                        console.log("Gemini Live WebSocket Connected");
                        this.isConnected = true;
                        this.config.onConnect?.();
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

        this.inputAnalyser = this.audioContext.createAnalyser();
        this.outputAnalyser = this.audioContext.createAnalyser();
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
        await this.audioContext.audioWorklet.addModule(
            "data:text/javascript;base64," + btoa(this.getAudioWorkletCode())
        );

        const source = this.audioContext.createMediaStreamSource(this.mediaStream);
        this.audioProcessor = new AudioWorkletNode(this.audioContext, "pcm-processor");

        // AudioWorkletからのメッセージ（PCMデータ）を処理
        // WebSocketが接続されている場合、データを送信
        this.audioProcessor.port.onmessage = (event) => {
            const pcmData = event.data;

            // @ts-ignore
            if (this.session) {
                const buffer = pcmData.buffer;
                const base64 = this.arrayBufferToBase64(buffer);

                // @ts-ignore
                this.session.sendRealtimeInput({
                    media: {
                        mimeType: "audio/pcm;rate=16000",
                        data: base64
                    }
                });
            }
        };

        source.connect(this.inputAnalyser);
        source.connect(this.audioProcessor);

        this.startVolumeReporting();
        // Workletをdestinationに接続してプロセスを維持（音声は出力しないが処理は回る）
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
            if (serverContent.interrupted) {
                console.log("Interrupted!");
                this.stopAudioPlayback();
            }

            const modelTurn = serverContent.modelTurn;
            if (modelTurn) {
                const parts = modelTurn.parts;
                for (const part of parts) {
                    if (part.text) {
                        console.log("Geminiのセリフ（文字起こし）:", part.text);
                        if (this.config.onModelResponse) {
                            this.config.onModelResponse(part.text);
                        }
                    }

                    const inlineData = part.inlineData;
                    if (inlineData && inlineData.mimeType?.startsWith("audio/pcm")) {
                        this.playAudio(inlineData.data);
                    }
                }
            }
        } else if (msg.toolCall) {
            this.handleToolCall(msg.toolCall);
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
            // @ts-ignore
            this.session.sendToolResponse({
                functionResponses: toolResponses
            });
        }
    }

    /**
     * 受信したBase64形式の音声データをデコードし、再生します。
     */
    private playAudio(base64Data: string) {
        if (!this.audioContext) return;
        console.log("playAudio: start");

        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        // Base64データをデコードしてPCMデータに変換
        const binaryString = window.atob(base64Data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const int16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
            float32[i] = int16[i] / 32768.0;
        }

        // AudioBufferを作成して再生
        const buffer = this.audioContext.createBuffer(1, float32.length, 24000);
        buffer.copyToChannel(float32, 0);

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;

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
        if (this.nextStartTime < this.audioContext.currentTime) {
            this.nextStartTime = this.audioContext.currentTime;
        }

        source.start(this.nextStartTime);
        this.nextStartTime += buffer.duration;

        this.audioSources.add(source);
    }
}