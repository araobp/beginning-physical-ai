export interface GeminiLiveConfig {
    onConnect?: () => void;
    onDisconnect?: () => void;
    onError?: (error: any) => void;
    onVolume?: (micLevel: number, speakerLevel: number) => void;
    onTranscript?: (text: string, isFinal: boolean) => void;
    onModelResponse?: (text: string) => void;
    onToolCall?: (name: string, args: any) => Promise<any>;
}

export class GeminiLiveClient {
    private config: GeminiLiveConfig;
    private ws: WebSocket | null = null;
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private audioProcessor: AudioWorkletNode | null = null;
    private inputAnalyser: AnalyserNode | null = null;
    private outputAnalyser: AnalyserNode | null = null;
    private volumeInterval: any = null;
    private nextStartTime: number = 0;
    private isConnected: boolean = false;

    constructor(config: GeminiLiveConfig) {
        this.config = config;
    }

    async connect(tools: any[] = []) {
        if (this.isConnected) return;

        // Initialize AudioContext here to capture user gesture
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioContextClass({
            sampleRate: 24000
        });
        await this.audioContext.resume();
        console.log("AudioContext state:", this.audioContext.state);

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${window.location.host}/gemini-live`;

        try {
            this.ws = new WebSocket(url);
        } catch (e) {
            this.config.onError?.(e);
            this.audioContext.close();
            this.audioContext = null;
            return;
        }

        this.ws.binaryType = 'blob';
        this.ws.onopen = () => {
            console.log("Gemini Live WebSocket Connected");
            this.isConnected = true;
            this.config.onConnect?.();
            this.sendSetup(tools);
            this.startAudioStream();
        };

        this.ws.onmessage = async (event) => {

            const data = event.data;
            if (data instanceof Blob) {
                const text = await data.text();
                try {
                    const msg = JSON.parse(text);
                    this.handleMessage(msg);
                } catch (e) {
                    console.error("Error parsing JSON message", e);
                }
            } else {
                console.log("Received non-blob message:", data);
                this.handleMessage(JSON.parse(data));
            }
        };

        this.ws.onclose = () => {
            console.log("Gemini Live WebSocket Closed");
            this.disconnect();
        };

        this.ws.onerror = (error) => {
            console.error("Gemini Live WebSocket Error:", error, this.ws);// WebSocketインスタンスの状態をログに出力
            this.config.onError?.(error);
            this.disconnect();
        };
    }

    disconnect() {
        if (!this.isConnected && !this.ws) return;

        this.isConnected = false;
        this.stopAudioStream();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.config.onDisconnect?.();
    }

    private sendSetup(tools: any[]) {
        const functionDeclarations = tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema
        }));

        const setupMsg = {
            setup: {
                model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: "Charon"
                            }
                        }
                    }
                },
                tools: functionDeclarations.length > 0 ? [{ functionDeclarations: functionDeclarations }] : undefined
            }
        };

        if (this.ws) {
            this.ws.send(JSON.stringify(setupMsg));
        }
    }

    private async startAudioStream() {
        if (!this.audioContext) return;
        console.log("Starting audio stream...");

        this.inputAnalyser = this.audioContext.createAnalyser();
        this.outputAnalyser = this.audioContext.createAnalyser();
        this.outputAnalyser.connect(this.audioContext.destination);

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        } catch (e) {
            console.error("getUserMedia error:", e);
            console.error("Microphone access denied", e);
            this.config.onError?.(e);
            return;
        }


        await this.audioContext.audioWorklet.addModule(
            "data:text/javascript;base64," + btoa(this.getAudioWorkletCode())
        );

        const source = this.audioContext.createMediaStreamSource(this.mediaStream);
        this.audioProcessor = new AudioWorkletNode(this.audioContext, "pcm-processor");

        this.audioProcessor.port.onmessage = (event) => {
            const pcmData = event.data;

            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                const buffer = pcmData.buffer;
                const base64 = this.arrayBufferToBase64(buffer);

                const msg = {
                    realtimeInput: {
                        mediaChunks: [
                            {
                                mimeType: "audio/pcm;rate=24000",
                                data: base64
                            }
                        ]
                    }
                };
                this.ws.send(JSON.stringify(msg));
            }
        };

        source.connect(this.inputAnalyser);
        source.connect(this.audioProcessor);

        this.startVolumeReporting();
    }

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

    private stopVolumeReporting() {
        if (this.volumeInterval) clearInterval(this.volumeInterval);
        this.volumeInterval = null;
    }

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

    private arrayBufferToBase64(buffer: ArrayBuffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    private handleMessage(msg: any) {
        console.log("GeminiLiveClient: handleMessage", msg);
        const serverContent = msg.serverContent;
        if (serverContent) {
            console.log(
                "GeminiLiveClient: handleMessage - serverContent.modelTurn:",
                serverContent.modelTurn
            );
            const modelTurn = serverContent.modelTurn;
            if (modelTurn) {
                const parts = modelTurn.parts;
                for (const part of parts) {
                    console.log(
                        "GeminiLiveClient: handleMessage - part:",
                        part
                    );

                    const inlineData = part.inlineData;

                    if (part.text && this.config.onModelResponse) {
                        this.config.onModelResponse(part.text);
                    }

                    console.log(
                        "GeminiLiveClient: handleMessage - part.inlineData:",
                        part.inlineData
                    );
                    console.log("GeminiLiveClient: handleMessage - mime type check:", inlineData?.mimeType?.startsWith("audio/pcm"));

                    if (inlineData && inlineData.mimeType?.startsWith("audio/pcm")) {
                        console.log("GeminiLiveClient: Calling playAudio from handleMessage");
                        console.log("Received audio chunk, length:", inlineData.data.length);
                        this.playAudio(part.inlineData.data);
                    }

                }
            }
        } else if (msg.toolCall) {
            this.handleToolCall(msg.toolCall);
        }
    }

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

        const responseMsg = {
            toolResponse: {
                functionResponses: toolResponses
            }
        };
        if (this.ws) this.ws.send(JSON.stringify(responseMsg));
    }

    private playAudio(base64Data: string) {
        if (!this.audioContext) return;
        console.log("playAudio: start");

        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

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

        const startTime = Math.max(this.audioContext.currentTime, this.nextStartTime);
        source.start(startTime);
        this.nextStartTime = startTime + buffer.duration;
        source.onended = () => {
            console.log("playAudio: done");
        }
        source.addEventListener('error', (e) => {
            console.error("playAudio: error", e);
        });
    }
}