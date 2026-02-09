import cv2
import numpy as np
import base64
import time
import threading

class VisionSystem:
    """
    カメラを用いた姿勢推定と座標変換を管理するクラス。
    """
    def __init__(self, camera_params_path, marker_id, marker_size_mm, cam_id=0, width=1920, height=1080, display_width=None, robot_offset_x_mm=0.0, robot_offset_y_mm=0.0, lang='ja'):
        """
        VisionSystemを初期化します。

        Args:
            camera_params_path (str): カメラパラメータファイル(.npz)へのパス。
            marker_id (int): 追跡するArUcoマーカーのID。
            marker_size_mm (float): ArUcoマーカーのサイズ(mm)。
            cam_id (int): 使用するカメラのID。
            width (int): カメラの横解像度。
            height (int): カメラの縦解像度。
            display_width (int, optional): 表示ウィンドウの横幅。Noneの場合はリサイズしない。
            robot_offset_x_mm (float): ロボットベースのXオフセット(mm)。
            robot_offset_y_mm (float): ロボットベースのYオフセット(mm)。
            lang (str): 言語設定 ('ja' or 'en')。
        """
        self.marker_id = marker_id
        self.marker_size_mm = marker_size_mm
        self.display_width = display_width
        self.robot_offset_x = robot_offset_x_mm
        self.robot_offset_y = robot_offset_y_mm
        self.lang = lang

        # UI Text Resources
        self.text = {
            'ja': {'quit': '終了', 'clear': 'クリア', 'capture': '撮影', 'run': '実行', 'pick': 'Pick', 'place': 'Place'},
            'en': {'quit': 'Quit', 'clear': 'Clear', 'capture': 'Capture', 'run': 'Run P&P', 'pick': 'Pick', 'place': 'Place'}
        }
        self.t = self.text.get(lang, self.text['ja'])

        # カメラパラメータの読み込み
        try:
            with np.load(camera_params_path) as data:
                self.mtx, self.dist = data['mtx'], data['dist']
        except Exception as e:
            raise IOError(f"カメラパラメータの読み込みエラー {camera_params_path}: {e}")

        # ArUco検出器のセットアップ
        self.aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
        self.detector = cv2.aruco.ArucoDetector(self.aruco_dict, cv2.aruco.DetectorParameters())
        self.obj_points = self._get_marker_model_mm(marker_size_mm)

        # カメラキャプチャのセットアップ
        self.cap = cv2.VideoCapture(cam_id)
        if not self.cap.isOpened():
            raise IOError(f"カメラ {cam_id} を開けません。")
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self.cap_lock = threading.Lock()

        # 姿勢データ (update_pose()で更新)
        self.rvec = None
        self.tvec = None
        self.R = None
        self.camera_pos = None
        self.visualize_axes = False
        self.last_pose_update_time = 0
        self.pose_cache_duration = 0.1  # 秒
        self.last_processed_frame = None
        self.last_frame_capture_time = 0
        
        # インタラクティブモード用の状態
        self.pick_point = None
        self.place_point = None
        self.window_name = "Robot Camera View"
        self.pick_z = 20.0
        self.place_z = 30.0
        self.safety_z = 90.0
        self.need_capture = False
        self.should_exit = False

        # 静止画モード用の保持データ
        self.static_rvec = None
        self.static_tvec = None

    def _get_marker_model_mm(self, size_mm):
        """マーカーの3Dモデル座標を定義（右手座標系、原点は右下）"""
        return np.array([
            [size_mm, size_mm, 0],  # 0: 左上
            [size_mm, 0, 0],        # 1: 右上
            [0, 0, 0],              # 2: 右下 (原点)
            [0, size_mm, 0]         # 3: 左下
        ], dtype=np.float32)

    def update_pose(self, force_update=False, visualize_axes=False):
        """
        ArUcoマーカーを検出し、カメラの姿勢(rvec, tvec, R, camera_pos)を更新する。
        姿勢が正常に更新された場合はTrue、それ以外はFalseを返す。
        計算負荷を減らすため、短期間は姿勢をキャッシュする。
        """
        self.visualize_axes = visualize_axes

        if not force_update and time.time() - self.last_pose_update_time < self.pose_cache_duration:
            return self.rvec is not None

        with self.cap_lock:
            ret, frame = self.cap.read()
        if not ret:
            self.rvec, self.tvec, self.R, self.camera_pos = None, None, None, None
            return False

        undistorted_frame = cv2.undistort(frame, self.mtx, self.dist, None, self.mtx)
        self.last_processed_frame = undistorted_frame
        self.last_frame_capture_time = time.time()
        gray = cv2.cvtColor(undistorted_frame, cv2.COLOR_BGR2GRAY)
        corners, ids, _ = self.detector.detectMarkers(gray)

        if ids is not None and self.marker_id in ids:
            idx = np.where(ids == self.marker_id)[0][0]
            # solvePnPは歪み補正済みの画像座標と歪み係数=0で使うのが望ましい
            ret_pnp, rvec, tvec = cv2.solvePnP(self.obj_points, corners[idx], self.mtx, np.zeros((5, 1)))

            if ret_pnp:
                self.rvec, self.tvec = rvec, tvec
                self.R, _ = cv2.Rodrigues(rvec)
                self.camera_pos = -np.dot(self.R.T, tvec.flatten())
                self.last_pose_update_time = time.time()
                return True

        # マーカーが見つからない場合は姿勢を無効化
        self.rvec, self.tvec, self.R, self.camera_pos = None, None, None, None
        return False

    def _draw_trajectory(self, frame):
        """Pick & Placeの軌道を描画する"""
        if self.pick_point and self.place_point and self.rvec is not None and self.tvec is not None:
             # Z heights (mm) - use instance attributes
             z_pick = self.pick_z
             z_place = self.place_z
             z_safe = self.safety_z
             
             points_3d = np.array([
                 [self.pick_point['x'], self.pick_point['y'], z_pick],      # 0: Pick Low
                 [self.pick_point['x'], self.pick_point['y'], z_safe],      # 1: Pick Safe
                 [self.place_point['x'], self.place_point['y'], z_safe],    # 2: Place Safe
                 [self.place_point['x'], self.place_point['y'], z_place]    # 3: Place Low
             ], dtype=np.float32)
             
             # 3D座標を2D画像座標に投影
             points_2d, _ = cv2.projectPoints(points_3d, self.rvec, self.tvec, self.mtx, np.zeros((5, 1)))
             pts = points_2d.reshape(-1, 2).astype(int)
             
             # 線を描画
             cv2.line(frame, tuple(pts[0]), tuple(pts[1]), (255, 0, 255), 2) # Pick Low -> Safe (Purple)
             cv2.line(frame, tuple(pts[1]), tuple(pts[2]), (0, 255, 255), 2) # Safe -> Safe (Yellow)
             cv2.line(frame, tuple(pts[2]), tuple(pts[3]), (255, 0, 0), 2)   # Safe -> Place Low (Blue)
             
             # ポイントを描画
             cv2.circle(frame, tuple(pts[0]), 5, (255, 0, 255), -1) # Pick
             cv2.circle(frame, tuple(pts[3]), 5, (255, 0, 0), -1)   # Place

    def get_undistorted_image_base64(self, display=False):
        """
        フレームをキャプチャして歪み補正を行い、Base64エンコードされたJPEG文字列として返す。
        """
        # 直近に処理されたフレームがあればそれを使用する（描画と検出の同期のため）
        if self.last_processed_frame is not None and (time.time() - self.last_frame_capture_time < 0.5):
            undistorted_frame = self.last_processed_frame.copy()
        else:
            with self.cap_lock:
                ret, frame = self.cap.read()
            if not ret: return None
            undistorted_frame = cv2.undistort(frame, self.mtx, self.dist, None, self.mtx)
        
        # 姿勢が既知であれば座標軸を描画
        if self.rvec is not None and self.tvec is not None and self.visualize_axes:
            length = self.marker_size_mm * 0.8
            cv2.drawFrameAxes(undistorted_frame, self.mtx, np.zeros((5, 1)), self.rvec, self.tvec, length)

            # 3D軸のラベル位置座標を定義 (軸より少し外側)
            label_len = length * 1.1
            axis_points_3d = np.float32([[label_len, 0, 0], [0, label_len, 0], [0, 0, label_len]]).reshape(-1, 3)
            # 3D座標を2D画像座標に投影
            axis_points_2d, _ = cv2.projectPoints(axis_points_3d, self.rvec, self.tvec, self.mtx, np.zeros((5, 1)))
            # 各軸のラベルを描画
            font = cv2.FONT_HERSHEY_SIMPLEX
            cv2.putText(undistorted_frame, 'X', tuple(axis_points_2d[0].ravel().astype(int)), font, 0.7, (0, 0, 255), 2)
            cv2.putText(undistorted_frame, 'Y', tuple(axis_points_2d[1].ravel().astype(int)), font, 0.7, (0, 255, 0), 2)
            cv2.putText(undistorted_frame, 'Z', tuple(axis_points_2d[2].ravel().astype(int)), font, 0.7, (255, 0, 0), 2)

            # 軌道の描画
            self._draw_trajectory(undistorted_frame)

        if display:
            if self.display_width:
                h, w = undistorted_frame.shape[:2]
                display_height = int(h * (self.display_width / w))
                cv2.imshow("Robot Camera View", cv2.resize(undistorted_frame, (self.display_width, display_height)))
            else:
                cv2.imshow("Robot Camera View", undistorted_frame)
            cv2.waitKey(1)

        _, buffer = cv2.imencode('.jpg', undistorted_frame)
        return base64.b64encode(buffer).decode('utf-8')

    def get_jpeg_bytes(self):
        """MJPEG配信用のJPEGバイト列を取得"""
        # 最新フレームで姿勢更新を行う
        self.update_pose(force_update=True, visualize_axes=True)
        
        if self.last_processed_frame is None:
            return None
            
        frame = self.last_processed_frame.copy()
        
        # 軸の描画
        if self.rvec is not None and self.tvec is not None and self.visualize_axes:
             length = self.marker_size_mm * 0.8
             cv2.drawFrameAxes(frame, self.mtx, np.zeros((5, 1)), self.rvec, self.tvec, length)

             # 3D軸のラベル位置座標を定義 (軸より少し外側)
             label_len = length * 1.1
             axis_points_3d = np.float32([[label_len, 0, 0], [0, label_len, 0], [0, 0, label_len]]).reshape(-1, 3)
             # 3D座標を2D画像座標に投影
             axis_points_2d, _ = cv2.projectPoints(axis_points_3d, self.rvec, self.tvec, self.mtx, np.zeros((5, 1)))
             # 各軸のラベルを描画
             font = cv2.FONT_HERSHEY_SIMPLEX
             cv2.putText(frame, 'X', tuple(axis_points_2d[0].ravel().astype(int)), font, 0.7, (0, 0, 255), 2)
             cv2.putText(frame, 'Y', tuple(axis_points_2d[1].ravel().astype(int)), font, 0.7, (0, 255, 0), 2)
             cv2.putText(frame, 'Z', tuple(axis_points_2d[2].ravel().astype(int)), font, 0.7, (255, 0, 0), 2)
             
             # 軌道の描画
             self._draw_trajectory(frame)
             
        _, buffer = cv2.imencode('.jpg', frame)
        return buffer.tobytes()

    def detect_objects(self, model, confidence=0.5):
        """
        YOLOモデルを使用して、現在のフレームから物体検出を行います。
        
        Args:
            model: YOLOモデルインスタンス (ultralytics.YOLO)
            confidence (float): 信頼度しきい値
            
        Returns:
            list: 検出結果のリスト [{"label": str, "confidence": float, "box_2d": [...]}, ...]
        """
        if self.last_processed_frame is None:
            return []

        frame = self.last_processed_frame
        h, w = frame.shape[:2]

        # 推論実行
        results = model.predict(frame, conf=confidence, verbose=False)
        result = results[0]
        
        detections = []
        for box in result.boxes:
            # box.xyxy is [x1, y1, x2, y2] in pixels
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            cls_id = int(box.cls[0])
            label = result.names[cls_id]
            conf = float(box.conf[0])
            
            # VisionSystem.draw_detections 用に 0-1000 スケールに正規化
            norm_box = [
                (y1 / h) * 1000,
                (x1 / w) * 1000,
                (y2 / h) * 1000,
                (x2 / w) * 1000
            ]
            detections.append({"label": label, "confidence": conf, "box_2d": norm_box})
            
        return detections

    def _draw_detections_overlay(self, frame, detections):
        """フレームに検出結果を描画する（内部ヘルパー）"""
        h, w = frame.shape[:2]
        for det in detections:
            label = str(det.get("label", "Object"))
            conf = det.get("confidence", None)
            box = det.get("box_2d")
            
            # バウンディングボックスの描画
            if box and len(box) == 4:
                ymin, xmin, ymax, xmax = box
                # 0-1000 scale to pixel
                x1 = int(xmin * w / 1000)
                y1 = int(ymin * h / 1000)
                x2 = int(xmax * w / 1000)
                y2 = int(ymax * h / 1000)
                
                color = (0, 255, 0) # Green
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                
                text = label
                if conf is not None:
                    text += f" {conf:.2f}"
                cv2.putText(frame, text, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

            # 把持ポイント/接地点の描画
            point = det.get("ground_contact_point_2d")
            if point and len(point) == 2:
                py, px = point
                cx = int(px * w / 1000)
                cy = int(py * h / 1000)
                cv2.circle(frame, (cx, cy), 5, (0, 0, 255), -1) # Red dot

    def draw_detections(self, detections):
        """
        キャッシュされた最新フレームに検出結果（バウンディングボックス、ラベル、把持点）を描画してBase64画像を返す。
        
        Args:
            detections (list): 検出オブジェクトのリスト。
                各要素は {"label": str, "box_2d": [ymin, xmin, ymax, xmax], "ground_contact_point_2d": [y, x]} などを想定。
                座標は 0-1000 の正規化座標。
        """
        if self.last_processed_frame is None:
            return None

        frame = self.last_processed_frame.copy()
        self._draw_detections_overlay(frame, detections)
        _, buffer = cv2.imencode('.jpg', frame)
        return base64.b64encode(buffer).decode('utf-8')

    def convert_2d_to_3d(self, u, v, draw_target=False, rvec=None, tvec=None):
        """
        歪み補正済み画像の2Dピクセル座標(u, v)を、3D世界座標(x, y, z=0) [mm] に変換する。
        カメラの姿勢が既知である必要がある。
        戻り値: (座標辞書, 描画済みフレーム) または (None, None)
        """
        if rvec is not None and tvec is not None:
            # 指定された姿勢を使用（静止画モードなど）
            current_rvec, current_tvec = rvec, tvec
            R, _ = cv2.Rodrigues(rvec)
            camera_pos = -np.dot(R.T, tvec.flatten())
        else:
            # 現在のシステム姿勢を使用
            if not self.update_pose(force_update=False) and (self.R is None or self.camera_pos is None):
                return None, None
            current_rvec, current_tvec = self.rvec, self.tvec
            R, camera_pos = self.R, self.camera_pos

        fx, fy, cx, cy = self.mtx[0, 0], self.mtx[1, 1], self.mtx[0, 2], self.mtx[1, 2]
        ray_cam = np.array([(u - cx) / fx, (v - cy) / fy, 1.0])
        ray_world = np.dot(R.T, ray_cam)

        annotated_frame = None
        if draw_target and self.last_processed_frame is not None:
            annotated_frame = self.last_processed_frame.copy()
            # ターゲット位置に円を描画
            cv2.circle(annotated_frame, (u, v), 10, (0, 255, 255), 2)
            # 座標軸も描画
            if current_rvec is not None and current_tvec is not None:
                 cv2.drawFrameAxes(annotated_frame, self.mtx, np.zeros((5, 1)), current_rvec, current_tvec, self.marker_size_mm * 0.8)

        if abs(ray_world[2]) > 1e-6:
            s = -camera_pos[2] / ray_world[2]
            intersect_3d = camera_pos + s * ray_world
            return {"x": intersect_3d[0], "y": intersect_3d[1], "z": 0.0}, annotated_frame
        
        return None, annotated_frame

    def _execute_pick_place_sequence(self):
        """Pick & Placeシーケンスを実行する"""
        if not self.pick_point or not self.place_point or not self.command_callback:
            print("Cannot execute P&P: Missing points or callback.")
            return

        # 世界座標の計算
        pick_xw = self.pick_point['x'] + self.robot_offset_x
        pick_yw = self.pick_point['y'] + self.robot_offset_y
        place_xw = self.place_point['x'] + self.robot_offset_x
        place_yw = self.place_point['y'] + self.robot_offset_y

        # コマンドシーケンスの構築
        # 安全高さ: 90mm, Pick高さ: 20mm, Place高さ: 30mm
        cmds = [
            "grip open",
            "move z=90 s=100",  # 安全高さへ移動
            f"move x={pick_xw:.1f} y={pick_yw:.1f} z=90 s=100", # Pick位置上空
            "move z=20 s=50",   # Pick位置へ下降
            "grip close",
            "delay t=1000",
            "move z=90 s=100",  # 安全高さへ上昇
            f"move x={place_xw:.1f} y={place_yw:.1f} z=90 s=100", # Place位置上空
            "move z=30 s=50",   # Place位置へ下降（落下させるため少し高い位置）
            "grip open",
            "delay t=1000",
            "move z=90 s=100"   # 安全高さへ退避
        ]
        full_cmd = ";".join(cmds)
        print(f"Executing P&P Sequence: {full_cmd}")
        self.command_callback(full_cmd)

    def _mouse_callback(self, event, x, y, flags, param):
        """マウスイベントのコールバック関数"""
        if event == cv2.EVENT_LBUTTONDOWN:
            # Clearボタンの判定 (右上の領域)
            if self.last_processed_frame is not None:
                h, w = self.last_processed_frame.shape[:2]
                
                # ボタン配置設定
                margin = 10
                btn_h = 50
                gap = 10
                quit_w = 100
                clear_w = 110
                capture_w = 140
                run_w = 160
                
                # Quitボタン: 右上
                quit_x1 = w - margin - quit_w
                quit_x2 = w - margin
                if (quit_x1 <= x <= quit_x2) and (margin <= y <= margin + btn_h):
                    self.should_exit = True
                    print("Quit requested.")
                    return

                # Clearボタン: Quitの左
                clear_x1 = quit_x1 - gap - clear_w
                clear_x2 = quit_x1 - gap
                if (clear_x1 <= x <= clear_x2) and (margin <= y <= margin + btn_h):
                    self.pick_point = None
                    self.place_point = None
                    print("Points cleared.")
                    return
                
                # Captureボタン: Clearの左
                cap_x1 = clear_x1 - gap - capture_w
                cap_x2 = clear_x1 - gap
                if (cap_x1 <= x <= cap_x2) and (margin <= y <= margin + btn_h):
                    self.need_capture = True
                    print("Capture requested.")
                    return
                
                # Run P&Pボタン: Captureの左
                run_x1 = cap_x1 - gap - run_w
                run_x2 = cap_x1 - gap
                if (run_x1 <= x <= run_x2) and (margin <= y <= margin + btn_h):
                    if self.pick_point and self.place_point:
                        threading.Thread(target=self._execute_pick_place_sequence).start()
                    else:
                        print("Please set both Pick and Place points first.")
                    return

            # 座標変換とポイント設定
            # 静止画モードの場合は、その時点の姿勢(static_rvec/tvec)を使用する
            coords, _ = self.convert_2d_to_3d(x, y, draw_target=False, rvec=self.static_rvec, tvec=self.static_tvec)
            if coords:
                pt = {'u': x, 'v': y, 'x': coords['x'], 'y': coords['y']}
                if self.pick_point is None:
                    self.pick_point = pt
                    print(f"Pick point set: {pt}")
                elif self.place_point is None:
                    self.place_point = pt
                    print(f"Place point set: {pt}")
                else:
                    # 両方設定済みの場合はPickから再設定（Placeはクリア）
                    self.pick_point = pt
                    self.place_point = None
                    print(f"Pick point updated: {pt}")

    def run_interactive_mode(self, command_callback=None):
        """
        GUIウィンドウを表示し、インタラクティブな操作（Pick & Place位置指定）を行うモード。
        静止画キャプチャベースで動作します。
        """
        cv2.namedWindow(self.window_name)
        cv2.setMouseCallback(self.window_name, self._mouse_callback)
        self.command_callback = command_callback
        
        print("Interactive mode started. Press 'q' to exit.")
        
        self.need_capture = True # 最初はキャプチャする
        self.should_exit = False
        
        # 表示用の静止画データ
        display_frame = None

        try:
            while not self.should_exit:
                # キャプチャ要求があれば更新
                if self.need_capture:
                    self.update_pose(force_update=True, visualize_axes=False)
                    if self.last_processed_frame is not None:
                        display_frame = self.last_processed_frame.copy()
                        self.static_rvec = self.rvec.copy() if self.rvec is not None else None
                        self.static_tvec = self.tvec.copy() if self.tvec is not None else None
                    self.need_capture = False
                
                if display_frame is None:
                    # フレームがない場合でも終了できるようにキー入力をチェック
                    if cv2.waitKey(100) & 0xFF == ord('q'):
                        break
                    time.sleep(0.01)
                    continue

                # 描画用にコピーを作成（ボタンなどを毎回描画するため）
                frame_to_show = display_frame.copy()
                
                # 軸の描画
                if self.static_rvec is not None and self.static_tvec is not None:
                    length = self.marker_size_mm * 0.8
                    cv2.drawFrameAxes(frame_to_show, self.mtx, np.zeros((5, 1)), self.static_rvec, self.static_tvec, length)
                
                # Pick & Place ポイントの描画
                for pt, color, label_key in [(self.pick_point, (128, 0, 128), "pick"), (self.place_point, (128, 0, 0), "place")]:
                    if pt:
                        label = self.t[label_key]
                        # ポイント描画
                        cv2.circle(frame_to_show, (pt['u'], pt['v']), 10, color, -1)
                        
                        # フォント設定
                        font = cv2.FONT_HERSHEY_SIMPLEX
                        font_scale = 0.9
                        thickness = 2
                        
                        # ラベル描画
                        label_size, _ = cv2.getTextSize(label, font, font_scale, thickness)
                        label_x = pt['u'] + 15
                        label_y = pt['v'] + label_size[1] // 2
                        cv2.putText(frame_to_show, label, (label_x, label_y), font, font_scale, color, thickness)
                        
                        # 座標テキスト作成
                        uv_text = f"u: {pt['u']}, v: {pt['v']} (px)"
                        xy_text = f"x: {pt['x']:.1f}, y: {pt['y']:.1f} (mm)"
                        xw = pt['x'] + self.robot_offset_x
                        yw = pt['y'] + self.robot_offset_y
                        xwyw_text = f"xw: {xw:.1f}, yw: {yw:.1f} (mm)"
                        
                        # テキストサイズと枠の計算
                        uv_size, _ = cv2.getTextSize(uv_text, font, font_scale, thickness)
                        xy_size, _ = cv2.getTextSize(xy_text, font, font_scale, thickness)
                        xwyw_size, _ = cv2.getTextSize(xwyw_text, font, font_scale, thickness)
                        
                        box_pad = 10
                        line_gap = 15
                        box_w = max(uv_size[0], xy_size[0], xwyw_size[0]) + box_pad * 2
                        box_h = uv_size[1] + xy_size[1] + xwyw_size[1] + line_gap * 2 + box_pad * 2
                        
                        box_x = label_x + label_size[0] + 15
                        box_y = pt['v'] - box_h // 2
                        
                        # 枠の描画 (半透明の白背景 + 色枠)
                        overlay = frame_to_show.copy()
                        cv2.rectangle(overlay, (box_x, box_y), (box_x + box_w, box_y + box_h), (255, 255, 255), -1)
                        alpha = 0.6
                        cv2.addWeighted(overlay, alpha, frame_to_show, 1 - alpha, 0, frame_to_show)
                        cv2.rectangle(frame_to_show, (box_x, box_y), (box_x + box_w, box_y + box_h), color, thickness)
                        
                        # テキスト描画
                        cv2.putText(frame_to_show, uv_text, (box_x + box_pad, box_y + box_pad + uv_size[1]), font, font_scale, color, thickness)
                        cv2.putText(frame_to_show, xy_text, (box_x + box_pad, box_y + box_pad + uv_size[1] + line_gap + xy_size[1]), font, font_scale, color, thickness)
                        cv2.putText(frame_to_show, xwyw_text, (box_x + box_pad, box_y + box_pad + uv_size[1] + line_gap + xy_size[1] + line_gap + xwyw_size[1]), font, font_scale, color, thickness)

                # ボタン配置設定
                margin = 10
                btn_h = 50
                gap = 10
                quit_w = 100
                clear_w = 110
                capture_w = 140
                run_w = 160
                btn_font_scale = 1.05
                btn_thickness = 3

                h, w = frame_to_show.shape[:2]

                # Quitボタンの描画
                quit_x1 = w - margin - quit_w
                quit_y1 = margin
                cv2.rectangle(frame_to_show, (quit_x1, quit_y1), (quit_x1 + quit_w, quit_y1 + btn_h), (220, 220, 220), -1)
                cv2.rectangle(frame_to_show, (quit_x1, quit_y1), (quit_x1 + quit_w, quit_y1 + btn_h), (100, 100, 100), 2)
                text_size, _ = cv2.getTextSize(self.t['quit'], cv2.FONT_HERSHEY_SIMPLEX, btn_font_scale, btn_thickness)
                cv2.putText(frame_to_show, self.t['quit'], (quit_x1 + (quit_w - text_size[0]) // 2, quit_y1 + (btn_h + text_size[1]) // 2), cv2.FONT_HERSHEY_SIMPLEX, btn_font_scale, (0, 0, 0), btn_thickness)

                # Clearボタンの描画
                clear_x1 = quit_x1 - gap - clear_w
                clear_y1 = margin
                cv2.rectangle(frame_to_show, (clear_x1, clear_y1), (clear_x1 + clear_w, clear_y1 + btn_h), (220, 220, 220), -1)
                cv2.rectangle(frame_to_show, (clear_x1, clear_y1), (clear_x1 + clear_w, clear_y1 + btn_h), (100, 100, 100), 2)
                text_size, _ = cv2.getTextSize(self.t['clear'], cv2.FONT_HERSHEY_SIMPLEX, btn_font_scale, btn_thickness)
                cv2.putText(frame_to_show, self.t['clear'], (clear_x1 + (clear_w - text_size[0]) // 2, clear_y1 + (btn_h + text_size[1]) // 2), cv2.FONT_HERSHEY_SIMPLEX, btn_font_scale, (0, 0, 0), btn_thickness)

                # Captureボタンの描画
                cap_x1 = clear_x1 - gap - capture_w
                cap_y1 = margin
                cv2.rectangle(frame_to_show, (cap_x1, cap_y1), (cap_x1 + capture_w, cap_y1 + btn_h), (220, 220, 220), -1)
                cv2.rectangle(frame_to_show, (cap_x1, cap_y1), (cap_x1 + capture_w, cap_y1 + btn_h), (100, 100, 100), 2)
                text_size, _ = cv2.getTextSize(self.t['capture'], cv2.FONT_HERSHEY_SIMPLEX, btn_font_scale, btn_thickness)
                cv2.putText(frame_to_show, self.t['capture'], (cap_x1 + (capture_w - text_size[0]) // 2, cap_y1 + (btn_h + text_size[1]) // 2), cv2.FONT_HERSHEY_SIMPLEX, btn_font_scale, (0, 0, 0), btn_thickness)

                # Run P&Pボタンの描画
                run_x1 = cap_x1 - gap - run_w
                run_y1 = margin
                
                if self.pick_point and self.place_point:
                    bg_color = (200, 255, 200) # 有効時は薄緑
                    txt_color = (0, 0, 0)
                else:
                    bg_color = (220, 220, 220) # 無効時はグレー
                    txt_color = (150, 150, 150)

                cv2.rectangle(frame_to_show, (run_x1, run_y1), (run_x1 + run_w, run_y1 + btn_h), bg_color, -1)
                cv2.rectangle(frame_to_show, (run_x1, run_y1), (run_x1 + run_w, run_y1 + btn_h), (100, 100, 100), 2)
                text_size, _ = cv2.getTextSize(self.t['run'], cv2.FONT_HERSHEY_SIMPLEX, btn_font_scale, btn_thickness)
                cv2.putText(frame_to_show, self.t['run'], (run_x1 + (run_w - text_size[0]) // 2, run_y1 + (btn_h + text_size[1]) // 2), cv2.FONT_HERSHEY_SIMPLEX, btn_font_scale, txt_color, btn_thickness)

                # 表示
                if self.display_width:
                    dh = int(h * (self.display_width / w))
                    cv2.imshow(self.window_name, cv2.resize(frame_to_show, (self.display_width, dh)))
                else:
                    cv2.imshow(self.window_name, frame_to_show)

                if cv2.waitKey(100) & 0xFF == ord('q'):
                    break
        finally:
            cv2.destroyAllWindows()
            cv2.waitKey(1)

    def release(self):
        """カメラリソースを解放する。"""
        self.cap.release()