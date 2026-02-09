import cv2
import os
import argparse
import glob
import re
import numpy as np
import subprocess

def get_next_save_path(output_dir, prefix="img_", ext=".jpg"):
    """
    指定フォルダ内のファイルをスキャンし、次の連番ファイルパスを生成します。
    例: img_001.jpg があれば img_002.jpg を返します。
    """
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        return os.path.join(output_dir, f"{prefix}001{ext}")

    # フォルダ内の指定形式のファイルを検索
    files = glob.glob(os.path.join(output_dir, f"{prefix}*{ext}"))
    max_num = 0
    
    # 正規表現で数値部分を抽出 (例: img_005.jpg -> 5)
    pattern = re.compile(rf"{re.escape(prefix)}(\d+){re.escape(ext)}")

    for file_path in files:
        filename = os.path.basename(file_path)
        match = pattern.match(filename)
        if match:
            try:
                num = int(match.group(1))
                if num > max_num:
                    max_num = num
            except ValueError:
                continue

    next_num = max_num + 1
    return os.path.join(output_dir, f"{prefix}{next_num:03d}{ext}")

def load_calibration_data(calib_file):
    """
    キャリブレーションデータ(.npz)を読み込みます。
    ファイルがない場合はダミーデータを返します（動作確認用）。
    """
    # パスの展開（~など）と絶対パス化を行い、どこを探しているか明確にする
    calib_file = os.path.abspath(os.path.expanduser(calib_file))

    if not os.path.exists(calib_file):
        print(f"警告: キャリブレーションファイル '{calib_file}' が見つかりません。")
        print("ダミーパラメータで動作します（実際の歪み補正は行われません）。")
        # ダミーデータ (単位行列とゼロ歪み)
        mtx = np.array([[1000, 0, 320], [0, 1000, 240], [0, 0, 1]], dtype=np.float32)
        dist = np.zeros(5, dtype=np.float32)
        return mtx, dist

    try:
        with np.load(calib_file) as data:
            mtx = data['mtx']
            dist = data['dist']
            print(f"キャリブレーションデータを読み込みました: {calib_file}")
            return mtx, dist
    except Exception as e:
        print(f"エラー: キャリブレーションデータの読み込みに失敗しました: {e}")
        return None, None

class CameraApp:
    def __init__(self, args):
        self.args = args
        self.cap = cv2.VideoCapture(args.cam)
        if not self.cap.isOpened():
            raise ValueError(f"エラー: カメラ(ID: {args.cam})を開けませんでした。")
            
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)
        
        self.mtx, self.dist = load_calibration_data(args.calib)
        
        self.newcameramtx = None
        self.roi = None
        
        self.running = True
        self.show_focus = False
        self.view_mode = False
        self.image_files = []
        self.view_index = 0
        self.current_undistorted = None
        self.status_msg = ""
        self.status_timer = 0
        
        # GUI設定
        self.footer_h = 60
        self.buttons = {} # label -> (x1, y1, x2, y2)

    def get_undistorted_frame(self, frame):
        if self.mtx is None:
            return frame
            
        h, w = frame.shape[:2]
        if self.newcameramtx is None:
            self.newcameramtx, self.roi = cv2.getOptimalNewCameraMatrix(
                self.mtx, self.dist, (w, h), 1, (w, h)
            )
            
        dst = cv2.undistort(frame, self.mtx, self.dist, None, self.newcameramtx)
        x, y, w_roi, h_roi = self.roi
        dst = dst[y:y+h_roi, x:x+w_roi]
        return dst

    def draw_focus_assist(self, img):
        h, w = img.shape[:2]
        rows, cols = 3, 4
        dy, dx = h // rows, w // cols
        
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        for r in range(rows):
            for c in range(cols):
                y1, y2 = r*dy, (r+1)*dy
                x1, x2 = c*dx, (c+1)*dx
                
                roi = gray[y1:y2, x1:x2]
                score = cv2.Laplacian(roi, cv2.CV_64F).var()
                
                # 色とインジケーターの決定 (BGR)
                if score < 200:
                    color = (0, 0, 255)     # 赤 (ピンボケ)
                elif score < 1500:
                    color = (0, 255, 255)   # 黄 (惜しい)
                elif score < 2300:
                    color = (255, 0, 0)     # 青 (合焦)
                else:
                    color = (255, 255, 0)   # 水色 (非常にシャープ)
                
                cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
                cv2.putText(img, f"{score:.0f}", (x1+10, y1+30), 
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

    def refresh_gallery(self):
        self.image_files = []
        # jpg, pngなどを検索
        for ext in ["*.jpg", "*.jpeg", "*.png"]:
            self.image_files.extend(glob.glob(os.path.join(self.args.output_dir, ext)))
        self.image_files.sort()
        # 最新を表示
        self.view_index = max(0, len(self.image_files) - 1)

    def draw_gui(self, img):
        h, w = img.shape[:2]
        footer = np.zeros((self.footer_h, w, 3), dtype=np.uint8)
        footer[:] = (50, 50, 50)
        
        if self.view_mode:
            btns = [
                ("< Prev", (100, 100, 100)),
                ("Next >", (100, 100, 100)),
                ("Back", (100, 100, 200))
            ]
        else:
            btns = [
                ("Save", (100, 200, 100)),
                ("Focus: " + ("ON" if self.show_focus else "OFF"), (200, 100, 100)),
                ("Gallery", (150, 100, 150)),
                ("Folder", (150, 150, 50)),
                ("Quit", (100, 100, 100))
            ]
        
        btn_w, btn_h = 120, 40
        y_off = (self.footer_h - btn_h) // 2
        x_off = 10
        self.buttons = {}
        
        for label, color in btns:
            cv2.rectangle(footer, (x_off, y_off), (x_off+btn_w, y_off+btn_h), color, -1)
            cv2.putText(footer, label, (x_off+10, y_off+25), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
            self.buttons[label] = (x_off, h+y_off, x_off+btn_w, h+y_off+btn_h)
            x_off += btn_w + 5
            
        if self.status_timer > 0:
            # ポップアップ表示
            text = self.status_msg
            font = cv2.FONT_HERSHEY_SIMPLEX
            scale = 0.8
            thickness = 2
            (text_w, text_h), _ = cv2.getTextSize(text, font, scale, thickness)
            
            cx, cy = w // 2, h // 2
            pad = 20
            cv2.rectangle(img, (cx - text_w//2 - pad, cy - text_h//2 - pad), (cx + text_w//2 + pad, cy + text_h//2 + pad), (50, 50, 50), -1)
            cv2.rectangle(img, (cx - text_w//2 - pad, cy - text_h//2 - pad), (cx + text_w//2 + pad, cy + text_h//2 + pad), (255, 255, 255), 1)
            cv2.putText(img, text, (cx - text_w//2, cy + text_h//2), font, scale, (255, 255, 255), thickness)
            self.status_timer -= 1
            
        return np.vstack((img, footer))

    def mouse_callback(self, event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN:
            for label, (x1, y1, x2, y2) in self.buttons.items():
                if x1 <= x <= x2 and y1 <= y <= y2:
                    if label == "Save":
                        img = self.current_undistorted
                        path = get_next_save_path(self.args.output_dir)
                        cv2.imwrite(path, img)
                        self.status_msg = f"Saved: {os.path.basename(path)}"
                        self.status_timer = 30
                    elif "Focus" in label:
                        self.show_focus = not self.show_focus
                    elif label == "Gallery":
                        self.view_mode = True
                        self.refresh_gallery()
                    elif label == "Back":
                        self.view_mode = False
                    elif label == "< Prev":
                        self.view_index = max(0, self.view_index - 1)
                    elif label == "Next >":
                        self.view_index = min(len(self.image_files) - 1, self.view_index + 1)
                    elif label == "Folder":
                        # Mac用のopenコマンド (Windowsならstart, Linuxならxdg-open等)
                        if os.path.exists(self.args.output_dir):
                            subprocess.Popen(["open", self.args.output_dir])
                    elif label == "Quit":
                        self.running = False

    def run(self):
        cv2.namedWindow("Camera App")
        cv2.setMouseCallback("Camera App", self.mouse_callback)
        
        while self.running:
            # カメラ読み込み（バッファ滞留防止のため常に行う）
            ret, frame = self.cap.read()
            if not ret: break
            
            if not self.view_mode:
                # --- カメラモード ---
                self.current_undistorted = self.get_undistorted_frame(frame)
                high_res_img = self.current_undistorted.copy()
            else:
                # --- ギャラリーモード ---
                if not self.image_files:
                    # 画像がない場合
                    high_res_img = np.zeros((self.args.height, self.args.width, 3), dtype=np.uint8)
                    cv2.putText(high_res_img, "No Images", (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
                else:
                    # 画像読み込み
                    path = self.image_files[self.view_index]
                    loaded_img = cv2.imread(path)
                    if loaded_img is None:
                        high_res_img = np.zeros((self.args.height, self.args.width, 3), dtype=np.uint8)
                        cv2.putText(high_res_img, "Load Error", (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
                    else:
                        high_res_img = loaded_img
                        # ファイル名表示
                        fname = os.path.basename(path)
                        cv2.putText(high_res_img, f"{self.view_index+1}/{len(self.image_files)}: {fname}", 
                                    (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
            
            # GUI表示用にリサイズ (幅640pxに合わせる)
            h, w = high_res_img.shape[:2]
            display_w = 640
            scale = display_w / w
            display_h = int(h * scale)
            display_img = cv2.resize(high_res_img, (display_w, display_h))
            
            if not self.view_mode and self.show_focus:
                self.draw_focus_assist(display_img)
            
            final_img = self.draw_gui(display_img)
            cv2.imshow("Camera App", final_img)
            
            key = cv2.waitKey(1) & 0xFF
            if key == ord('q'): break
            elif key == ord('s') and not self.view_mode: 
                # キーボードショートカット用 (高解像度画像を保存)
                path = get_next_save_path(self.args.output_dir)
                cv2.imwrite(path, high_res_img)
                print(f"Saved: {path}")

        self.cap.release()
        cv2.destroyAllWindows()

def main():
    # 引数の設定
    parser = argparse.ArgumentParser(
        description="カメラ映像の歪みを除去し、連番で画像を保存するツール"
    )
    parser.add_argument("output_dir", type=str, help="画像の保存先フォルダパス")
    parser.add_argument("--calib", type=str, default="calib.npz", help="キャリブレーションデータファイル(.npz)のパス")
    parser.add_argument("--cam", type=int, default=0, help="カメラデバイスID (デフォルト: 0)")
    parser.add_argument("--width", type=int, default=1280, help="キャプチャ幅")
    parser.add_argument("--height", type=int, default=720, help="キャプチャ高さ")

    args = parser.parse_args()

    # ユーザーが引数の順序を間違えている可能性をチェック
    if args.output_dir.endswith('.npz'):
        print(f"警告: 保存先フォルダとして '{args.output_dir}' が指定されています。")
        print("ヒント: キャリブレーションファイルを指定する場合は --calib オプションを使用してください。")
        print(f"例: python3 capture_undistorted.py my_images --calib {args.output_dir}")

    try:
        app = CameraApp(args)
        app.run()
    except Exception as e:
        print(f"エラーが発生しました: {e}")

if __name__ == "__main__":
    main()