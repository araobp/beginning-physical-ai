# MCPサーバ

ロボットコントローラとのインタフェース、および、ビジョンシステム（USBカメラ接続）を、MCPツールとして他のMCPクライアントへ公開

想定するMCPクライアント
- Gemini CLI
- https://github.com/araobp/beginning-physical-ai/tree/main/sveltekit/mcp_client

注）ロボット無し、USBカメラだけでも結構遊べる。

## MCPサーバのサブシステム

- [Vision System：ロボットの目](vision_system.py)
- [Joypad：ジョイパッドとのインタフェース](joypad.py)
- [Caliblation：ロボットキャリブレーション用GUI](calibration_gui.py)

## MCPサーバが参照するデータ

- [物体検出：ファインチューニングされたYOLO11nモデルのウエイト](best_20260208.pt)
- [物体カタログ](workpieces.csv)

## Helpメッセージ出力

```
$ python mcp_server.py --help
```
