import tkinter as tk
from tkinter import messagebox

class CalibrationGUI:
    """
    ロボットアームの逆運動学(IK)キャリブレーションを行うためのGUIクラス。
    2点の既知の座標(Calib 0, Calib 1)におけるサーボパルス値を登録することで、
    アームの物理的な個体差や取り付け誤差を補正します。
    """
    def __init__(self, send_command_callback, offset_x, offset_y):
        """
        GUIの初期化とウィジェットの配置を行います。
        
        Args:
            send_command_callback (callable): ロボットへコマンドを送信する関数。
            offset_x (float): ロボットベースのXオフセット(mm)。
            offset_y (float): ロボットベースのYオフセット(mm)。
        """
        self.send_command = send_command_callback
        self.offset_x = offset_x
        self.offset_y = offset_y
        
        self.root = tk.Tk()
        self.root.title("IK Calibration")
        
        frame = tk.Frame(self.root, padx=20, pady=20)
        frame.pack()

        # --- 座標系の選択 ---
        # 入力する座標が「ArUcoマーカー基準(相対)」か「ロボットベース基準(絶対)」かを選択します。
        self.coord_mode = tk.StringVar(value="marker")
        
        tk.Label(frame, text="Input Coordinate System:", font=('Arial', 10, 'bold')).grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 5))
        tk.Radiobutton(frame, text="ArUco Marker (Relative)", variable=self.coord_mode, value="marker").grid(row=1, column=0, columnspan=2, sticky="w")
        tk.Radiobutton(frame, text="Robot Base (World)", variable=self.coord_mode, value="world").grid(row=2, column=0, columnspan=2, sticky="w")
        
        tk.Frame(frame, height=2, bd=1, relief=tk.SUNKEN).grid(row=3, column=0, columnspan=2, sticky="ew", pady=10)

        # --- Calib 0 (点0) の入力セクション ---
        # 1つ目のキャリブレーション点の座標(cm)を入力します。
        tk.Label(frame, text="Calib 0 (cm)", font=('Arial', 12, 'bold')).grid(row=4, column=0, columnspan=2, pady=(0, 10))
        
        tk.Label(frame, text="X:").grid(row=5, column=0, sticky="e")
        self.c0_x = tk.Entry(frame, width=10)
        self.c0_x.grid(row=5, column=1)
        
        tk.Label(frame, text="Y:").grid(row=6, column=0, sticky="e")
        self.c0_y = tk.Entry(frame, width=10)
        self.c0_y.grid(row=6, column=1)
        
        tk.Label(frame, text="Z:").grid(row=7, column=0, sticky="e")
        self.c0_z = tk.Entry(frame, width=10)
        self.c0_z.grid(row=7, column=1)

        tk.Button(frame, text="Send Calib 0", command=self.send_calib0).grid(row=8, column=0, columnspan=2, pady=10)

        # 区切り線
        tk.Frame(frame, height=2, bd=1, relief=tk.SUNKEN).grid(row=9, column=0, columnspan=2, sticky="ew", pady=10)

        # --- Calib 1 (点1) の入力セクション ---
        # 2つ目のキャリブレーション点の座標(cm)を入力します。
        tk.Label(frame, text="Calib 1 (cm)", font=('Arial', 12, 'bold')).grid(row=10, column=0, columnspan=2, pady=(0, 10))
        
        tk.Label(frame, text="X:").grid(row=11, column=0, sticky="e")
        self.c1_x = tk.Entry(frame, width=10)
        self.c1_x.grid(row=11, column=1)
        
        tk.Label(frame, text="Y:").grid(row=12, column=0, sticky="e")
        self.c1_y = tk.Entry(frame, width=10)
        self.c1_y.grid(row=12, column=1)
        
        tk.Label(frame, text="Z:").grid(row=13, column=0, sticky="e")
        self.c1_z = tk.Entry(frame, width=10)
        self.c1_z.grid(row=13, column=1)

        tk.Button(frame, text="Send Calib 1", command=self.send_calib1).grid(row=14, column=0, columnspan=2, pady=10)

        # 区切り線
        tk.Frame(frame, height=2, bd=1, relief=tk.SUNKEN).grid(row=15, column=0, columnspan=2, sticky="ew", pady=10)

        # --- 保存ボタン ---
        # 現在のキャリブレーション設定をロボットのEEPROMに保存します。
        tk.Button(frame, text="Save Calibration", command=self.send_save, bg="#dddddd").grid(row=16, column=0, columnspan=2, pady=10)

    def _get_coords_mm(self, entry_x, entry_y, entry_z):
        """
        入力フィールドから値を取得し、ミリメートル単位の世界座標(ロボットベース基準)に変換します。
        """
        try:
            # 入力はcm単位なのでmmに変換
            x_mm = float(entry_x.get()) * 10.0
            y_mm = float(entry_y.get()) * 10.0
            z_mm = float(entry_z.get()) * 10.0
            
            if self.coord_mode.get() == "marker":
                # マーカー基準の場合はオフセットを加算して世界座標へ変換
                x_w_mm = x_mm + self.offset_x
                y_w_mm = y_mm + self.offset_y
                z_w_mm = z_mm # Z軸オフセットは無いと仮定
            else:
                # 既に世界座標の場合
                x_w_mm = x_mm
                y_w_mm = y_mm
                z_w_mm = z_mm
            
            return x_w_mm, y_w_mm, z_w_mm
        except ValueError:
            messagebox.showerror("Error", "Invalid numeric input")
            return None

    def _send_calib(self, cmd_name, entry_x, entry_y, entry_z):
        """指定されたキャリブレーションコマンドを送信します。"""
        coords = self._get_coords_mm(entry_x, entry_y, entry_z)
        if coords:
            x, y, z = coords
            cmd = f"{cmd_name} x={x:.2f} y={y:.2f} z={z:.2f}"
            print(f"Sending: {cmd}")
            resp = self.send_command(cmd)
            messagebox.showinfo("Response", f"Sent: {cmd}\nResponse: {resp}")

    def send_calib0(self):
        """Calib 0 (点0) の登録コマンドを送信します。"""
        self._send_calib("calib0", self.c0_x, self.c0_y, self.c0_z)

    def send_calib1(self):
        """Calib 1 (点1) の登録コマンドを送信します。"""
        self._send_calib("calib1", self.c1_x, self.c1_y, self.c1_z)

    def send_save(self):
        """設定保存コマンド(save)を送信します。"""
        cmd = "save"
        print(f"Sending: {cmd}")
        resp = self.send_command(cmd)
        messagebox.showinfo("Response", f"Sent: {cmd}\nResponse: {resp}")

    def run(self):
        """GUIのメインループを開始します。"""
        self.root.mainloop()