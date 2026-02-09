import cv2
import argparse
import numpy as np
from ultralytics import YOLO

class YOLOApp:
    def __init__(self, args):
        self.args = args
        
        # 1. モデルの読み込み
        print(f"Loading model: {args.model} on {args.device}...")
        self.model = YOLO(args.model)

        # 2. USBカメラの設定
        camera_index = args.cam
        self.cap = cv2.VideoCapture(camera_index)

        if not self.cap.isOpened():
            print(f"警告: 指定されたカメラ(Index {camera_index})が見つかりません。")
            alt_index = 0 if camera_index != 0 else 1
            print(f"再試行中: カメラ(Index {alt_index}) を試しています...")
            self.cap = cv2.VideoCapture(alt_index)
            if self.cap.isOpened():
                camera_index = alt_index
                print(f"接続成功: カメラ(Index {camera_index}) を使用します。")
            else:
                raise RuntimeError(f"エラー: カメラ（Index {camera_index} および {alt_index}）が見つかりません。")

        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)

        print("--- 起動成功 ---")
        print(f"USBカメラ(Index:{camera_index}) を使用中")
        print(f"Device: {args.device}, Confidence: {args.conf}")
        
        self.running = True
        self.paused = False
        self.buttons = {}
        self.footer_h = 60
        self.display_frame = None

    def draw_gui(self, img):
        h, w = img.shape[:2]
        footer = np.zeros((self.footer_h, w, 3), dtype=np.uint8)
        footer[:] = (50, 50, 50)

        btns = [
            ("Live: ON" if not self.paused else "Live: OFF", (100, 200, 100) if not self.paused else (100, 100, 200)),
            ("Quit", (100, 100, 100))
        ]

        btn_w, btn_h = 120, 40
        y_off = (self.footer_h - btn_h) // 2
        x_off = 20
        self.buttons = {}

        for label, color in btns:
            cv2.rectangle(footer, (x_off, y_off), (x_off+btn_w, y_off+btn_h), color, -1)
            cv2.putText(footer, label, (x_off+10, y_off+25), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
            self.buttons[label] = (x_off, h+y_off, x_off+btn_w, h+y_off+btn_h)
            x_off += btn_w + 20
            
        return np.vstack((img, footer))

    def mouse_callback(self, event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN:
            for label, (x1, y1, x2, y2) in self.buttons.items():
                if x1 <= x <= x2 and y1 <= y <= y2:
                    if "Live" in label:
                        self.paused = not self.paused
                    elif label == "Quit":
                        self.running = False

    def run(self):
        window_name = "USB Camera - YOLO11 Analysis"
        cv2.namedWindow(window_name)
        cv2.setMouseCallback(window_name, self.mouse_callback)

        while self.running:
            if not self.paused:
                ret, frame = self.cap.read()
                if not ret:
                    print("フレームの取得に失敗しました。")
                    break

                results = self.model.predict(source=frame, device=self.args.device, conf=self.args.conf, verbose=False)
                annotated_frame = results[0].plot()

                h, w = annotated_frame.shape[:2]
                self.display_frame = cv2.resize(annotated_frame, (w // 2, h // 2))

            if self.display_frame is not None:
                final_img = self.draw_gui(self.display_frame)
                cv2.imshow(window_name, final_img)

            key = cv2.waitKey(1) & 0xFF
            if key == ord('q'):
                self.running = False

        self.cap.release()
        cv2.destroyAllWindows()

def main():
    parser = argparse.ArgumentParser(description="YOLO11 Real-time Object Detection/Segmentation")
    parser.add_argument("--cam", type=int, default=0, help="Camera Index (default: 1)")
    parser.add_argument("--model", type=str, default="best.pt", help="YOLO model path")
    parser.add_argument("--width", type=int, default=1280, help="Frame width")
    parser.add_argument("--height", type=int, default=720, help="Frame height")
    parser.add_argument("--device", type=str, default="mps", help="Device (mps, cpu, cuda)")
    parser.add_argument("--conf", type=float, default=0.5, help="Confidence threshold")
    args = parser.parse_args()

    try:
        app = YOLOApp(args)
        app.run()
    except Exception as e:
        print(f"エラー: {e}")

if __name__ == "__main__":
    main()