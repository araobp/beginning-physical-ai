import cv2
import numpy as np
import base64
import time

class VisionSystem:
    """
    カメラを用いた姿勢推定と座標変換を管理するクラス。
    """
    def __init__(self, camera_params_path, marker_id, marker_size_cm, cam_id=0):
        """
        VisionSystemを初期化します。

        Args:
            camera_params_path (str): カメラパラメータファイル(.npz)へのパス。
            marker_id (int): 追跡するArUcoマーカーのID。
            marker_size_cm (float): ArUcoマーカーのサイズ(cm)。
            cam_id (int): 使用するカメラのID。
        """
        self.marker_id = marker_id
        self.marker_size_cm = marker_size_cm

        # カメラパラメータの読み込み
        try:
            with np.load(camera_params_path) as data:
                self.mtx, self.dist = data['mtx'], data['dist']
        except Exception as e:
            raise IOError(f"カメラパラメータの読み込みエラー {camera_params_path}: {e}")

        # ArUco検出器のセットアップ
        self.aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
        self.detector = cv2.aruco.ArucoDetector(self.aruco_dict, cv2.aruco.DetectorParameters())
        self.obj_points = self._get_marker_model_cm(marker_size_cm)

        # カメラキャプチャのセットアップ
        self.cap = cv2.VideoCapture(cam_id)
        if not self.cap.isOpened():
            raise IOError(f"カメラ {cam_id} を開けません。")

        # 姿勢データ (update_pose()で更新)
        self.rvec = None
        self.tvec = None
        self.R = None
        self.camera_pos = None
        self.last_pose_update_time = 0
        self.pose_cache_duration = 0.1  # 秒

    def _get_marker_model_cm(self, size_cm):
        """マーカーの3Dモデル座標を定義（右手座標系、原点は右下）"""
        return np.array([
            [size_cm, size_cm, 0],  # 0: 左上
            [size_cm, 0, 0],        # 1: 右上
            [0, 0, 0],              # 2: 右下 (原点)
            [0, size_cm, 0]         # 3: 左下
        ], dtype=np.float32)

    def update_pose(self, force_update=False):
        """
        ArUcoマーカーを検出し、カメラの姿勢(rvec, tvec, R, camera_pos)を更新する。
        姿勢が正常に更新された場合はTrue、それ以外はFalseを返す。
        計算負荷を減らすため、短期間は姿勢をキャッシュする。
        """
        if not force_update and time.time() - self.last_pose_update_time < self.pose_cache_duration:
            return self.rvec is not None

        ret, frame = self.cap.read()
        if not ret:
            self.rvec, self.tvec, self.R, self.camera_pos = None, None, None, None
            return False

        undistorted_frame = cv2.undistort(frame, self.mtx, self.dist, None, self.mtx)
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

    def get_undistorted_image_base64(self):
        """
        フレームをキャプチャして歪み補正を行い、Base64エンコードされたJPEG文字列として返す。
        """
        ret, frame = self.cap.read()
        if not ret:
            return None
        
        undistorted_frame = cv2.undistort(frame, self.mtx, self.dist, None, self.mtx)
        
        # 姿勢が既知であれば座標軸を描画
        if self.rvec is not None and self.tvec is not None:
            cv2.drawFrameAxes(undistorted_frame, self.mtx, np.zeros((5, 1)), self.rvec, self.tvec, self.marker_size_cm * 0.8)

        _, buffer = cv2.imencode('.jpg', undistorted_frame)
        return base64.b64encode(buffer).decode('utf-8')

    def convert_2d_to_3d(self, u, v):
        """
        歪み補正済み画像の2Dピクセル座標(u, v)を、3D世界座標(x, y, z=0)に変換する。
        カメラの姿勢が既知である必要がある。{x, y, z}の辞書またはNoneを返す。
        """
        if not self.update_pose(force_update=False) and (self.R is None or self.camera_pos is None):
            return None

        fx, fy, cx, cy = self.mtx[0, 0], self.mtx[1, 1], self.mtx[0, 2], self.mtx[1, 2]
        ray_cam = np.array([(u - cx) / fx, (v - cy) / fy, 1.0])
        ray_world = np.dot(self.R.T, ray_cam)

        if abs(ray_world[2]) > 1e-6:
            s = -self.camera_pos[2] / ray_world[2]
            intersect_3d = self.camera_pos + s * ray_world
            return {"x": intersect_3d[0], "y": intersect_3d[1], "z": 0.0}
        
        return None

    def release(self):
        """カメラリソースを解放する。"""
        self.cap.release()