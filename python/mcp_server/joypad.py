import hid
import threading
import time

class JoypadSubsystem:
    """
    ジョイパッド（ゲームパッド）の入力を監視し、登録されたコールバック関数にイベントを通知するクラス。
    hidapi (hid) ライブラリを使用します。
    """
    def __init__(self):
        self.callbacks = []
        self.running = False
        self.thread = None
        self.decimate_counter = 0
        self.DECIMATE_LIMIT = 2
        self.device = None
        self.prev_report = None

    def register_callback(self, callback_func):
        """
        イベント発生時に呼び出すコールバック関数を登録します。
        
        Args:
            callback_func (callable): (command: str, value: int | None) を引数に取る関数。
        """
        if callback_func not in self.callbacks:
            self.callbacks.append(callback_func)

    def _notify_callbacks(self, cmd, value=None):
        """登録された全てのコールバック関数を実行します。"""
        for cb in self.callbacks:
            try:
                cb(cmd, value)
            except Exception as e:
                print(f"Error in joypad callback: {e}")

    def start(self):
        """ジョイパッドの監視スレッドを開始します。"""
        if self.running:
            return

        # デバイスの検索 (Usage Page 1: Generic Desktop, Usage 4: Joystick / 5: Gamepad)
        target_info = None
        try:
            for info in hid.enumerate():
                if info.get('usage_page') == 1 and info.get('usage') in (4, 5):
                    target_info = info
                    break
            
            # 見つからない場合は製品名で検索（フォールバック）
            if not target_info:
                for info in hid.enumerate():
                    prod = info.get('product_string', '').lower()
                    if 'game' in prod or 'joy' in prod or 'ctrl' in prod:
                        target_info = info
                        break
        except Exception as e:
            print(f"Error enumerating HID devices: {e}")
            return

        if not target_info:
            print("Warning: No gamepad found via hidapi.")
            return

        try:
            self.device = hid.device()
            self.device.open_path(target_info['path'])
            self.device.set_nonblocking(True)
            print(f"Joypad subsystem started: {target_info.get('product_string')}")
            
            self.running = True
            self.thread = threading.Thread(target=self._handle_events, daemon=True)
            self.thread.start()
        except Exception as e:
            print(f"Failed to open HID device: {e}")

    def stop(self):
        """ジョイパッドの監視を停止します。"""
        self.running = False
        if self.device:
            self.device.close()

    def _handle_events(self):
        """イベントループ（別スレッドで実行）"""
        try:
            while self.running:
                # 最大64バイト読み込み
                report = self.device.read(64)
                if report:
                    self._process_report(report)
                else:
                    time.sleep(0.01)
        except Exception as e:
            print(f"Joypad read error: {e}")
        finally:
            self.running = False

    def _process_report(self, report):
        """HIDレポートを解析してイベントを発火"""
        if self.prev_report is None:
            self.prev_report = report
            return

        # レポート長が変わる可能性を考慮
        length = min(len(report), len(self.prev_report))
        
        # --- アナログ軸の処理 (汎用的なマッピング例) ---
        # Byte 0: Left X, Byte 1: Left Y, Byte 2: Right X, Byte 3: Right Y
        # ※コントローラーによって異なるため、必要に応じて調整してください
        axis_map = {0: 'X', 1: 'Y', 2: 'RX', 3: 'RY'}
        
        for i, name in axis_map.items():
            if i < length:
                val = report[i]
                prev_val = self.prev_report[i]
                
                # 値が変化した場合のみ通知
                if val != prev_val:
                    # 0-255 を -128~127 に変換
                    scaled_val = val - 128
                    # デッドゾーン
                    if abs(scaled_val) < 10: scaled_val = 0
                    
                    # 間引き処理 (簡易実装)
                    self._notify_callbacks(name, scaled_val)

        # --- ボタンの処理 (ビットマスク) ---
        # Byte 5 & 6 にボタンがあると仮定
        def check_buttons(byte_idx, mapping):
            if byte_idx < length:
                val = report[byte_idx]
                prev = self.prev_report[byte_idx]
                diff = val ^ prev # 変化したビット
                
                if diff:
                    for mask, cmd in mapping.items():
                        if diff & mask:
                            # ビットがONになった(押された)場合のみ通知
                            if val & mask:
                                self._notify_callbacks(cmd)

        # 汎用的なボタンマッピング例
        btn_map_1 = {
            0x10: 'X', 0x20: 'A', 0x40: 'B', 0x80: 'Y',
            0x01: 'TL', 0x02: 'TR'
        }
        btn_map_2 = {
            0x10: 'BACK', 0x20: 'START'
        }
        
        # Byte 5, 6 をチェック (コントローラーによりオフセットは異なります)
        check_buttons(5, btn_map_1)
        check_buttons(6, btn_map_2)

        self.prev_report = report

# シングルトンインスタンス
_joypad_instance = None

def get_joypad_system():
    global _joypad_instance
    if _joypad_instance is None:
        _joypad_instance = JoypadSubsystem()
    return _joypad_instance

if __name__ == "__main__":
    # 単体テスト用
    def test_callback(cmd, val=None):
        print(f"Callback: cmd={cmd}, val={val}")

    jp = get_joypad_system()
    jp.register_callback(test_callback)
    jp.start()
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        jp.stop()