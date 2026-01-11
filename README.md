# 4 DoF ロボット

まだ開始したばかりのプロジェクト。

## ゴール

- Amazonで購入中の[4軸ロボット](https://www.amazon.co.jp/dp/B0CX8QZVFQ?ref=ppx_yo2ov_dt_b_fed_asin_title)を制御
- Arduino UNO R4をロボットコントローラとする
- Arduino UNO R4をUSBシリアル経由でPC上のSvelteKitアプリやUnityアプリと接続させる
- SvelteKitでGemini Liveアプリをつくり、ロボットを音声で制御する
- Unity上にロボットのデジタルツインをつくり、ロボットと動作を同期させる

## 最初の第一歩

- ArduinoでLチカ、シリアルモニターから"1"を送信すると点滅、"0"を送信すると停止　＝＞　[コード](test/sketch_apr8a)

## My Arduino board

[Arduino UNO R3](https://docs.arduino.cc/hardware/uno-rev3/)
