import cv2
import numpy as np
import argparse

"""
================================================================================
【汎用3次元計測・AR表示システム：技術解説版】
本プログラムは、単一カメラを用いた「単眼視における姿勢推定」の一般原理を実装しています。

1. 透視投影モデル (Pinhole Camera Model):
   3D空間の点を2D画像平面に投影する際、レンズの焦点距離や中心座標に基づき計算します。
2. 内部パラメータと歪み補正:
   レンズによる直線の歪みを数学的に補正し、理想的なピンホールカメラ状態を再現します。
3. PnP問題 (Perspective-n-Point Problem):
   既知の3Dモデル（マーカー）の4点と、画像上の4点から、カメラの相対的な
   「位置ベクトル(Translation)」と「回転行列(Rotation)」を逆算します。
4. 空間座標の相互変換:
   カメラから見た座標系を、右手座標系（右手親指がX、人差し指がY、中指がZ）に基づく
   世界座標系へ変換することで、現実の物理空間としての数値を算出します。
================================================================================
"""

# --- グローバル変数 ---
# 空間内の特定地点（マーカー平面上）の3D座標を保存する変数
clicked_3d_pos = None  

def mouse_callback(event, x, y, flags, param):
    """
    【逆投影アルゴリズム】 - 歪み補正済み画像対応版
    歪み補正済み画像上の2D座標(x, y)から、現実世界の3D座標を算出する。
    1. 2Dピクセルを正規化画像座標に変換し、方向ベクトル（光線）を作成。
    2. カメラの現在姿勢(R, camera_pos)を用いて、光線を世界座標系へ変換。
    3. 光線と特定平面（本件ではZ=0の地面）との交点を幾何学的に特定。
    """
    global clicked_3d_pos
    mtx, dist, rvec, tvec, R, camera_pos = param

    if event == cv2.EVENT_LBUTTONDOWN and rvec is not None:
        # ステップ1: 歪み補正済みピクセルから正規化画像座標(z=1の平面)への変換
        # u_norm = (x - cx) / fx, v_norm = (y - cy) / fy
        fx, fy = mtx[0, 0], mtx[1, 1]
        cx, cy = mtx[0, 2], mtx[1, 2]
        u_norm = (x - cx) / fx
        v_norm = (y - cy) / fy

        # ステップ2: カメラ座標系での光線ベクトルを定義
        ray_cam = np.array([u_norm, v_norm, 1.0])
        
        # ステップ3: カメラの回転行列(R)を用いて、光線を世界座標系へ回転させる
        # Rは「世界→カメラ」の回転なので、その転置行列 R.T は「カメラ→世界」の回転となる
        ray_world = np.dot(R.T, ray_cam)
        
        # ステップ4: 直線と平面(Z=0)の交点計算
        # カメラ位置 P から ray_world 方向に s 倍進んだ地点のZが0になる条件：
        # camera_pos.z + s * ray_world.z = 0  =>  s = -camera_pos.z / ray_world.z
        if abs(ray_world[2]) > 1e-6:
            s = -camera_pos[2] / ray_world[2]
            intersect_3d = camera_pos + s * ray_world
            # Z=0を保証して保存
            clicked_3d_pos = np.array([intersect_3d[0], intersect_3d[1], 0.0], dtype=np.float32)
            print(f"Target Position: X={clicked_3d_pos[0]:.2f} cm, Y={clicked_3d_pos[1]:.2f} cm, Z={clicked_3d_pos[2]:.2f} cm")

def get_marker_model_cm(size_cm):
    """
    【世界座標系の定義】
    右手座標系を採用：
    - X軸: 前方（マーカーの奥方向）
    - Y軸: 左方
    - Z軸: 上方
    マーカーの右下角を原点(0,0,0)として、反時計回りに各角の座標を定義する。
    """
    return np.array([
        [ size_cm,  size_cm, 0], # 0: 左上
        [ size_cm,  0,       0], # 1: 右上
        [ 0,        0,       0], # 2: 右下 (原点)
        [ 0,        size_cm, 0]  # 3: 左下
    ], dtype=np.float32)

def main():
    global clicked_3d_pos
    parser = argparse.ArgumentParser(description='General Purpose 3D Pose Tracker')
    parser.add_argument('--id', type=int, default=0, help='追跡するID')
    parser.add_argument('--size', type=float, default=5.0, help='マーカーサイズ[cm]')
    parser.add_argument('--params', type=str, default='camera_params.npz')
    parser.add_argument('--cam', type=int, default=0)
    args = parser.parse_args()

    # カメラパラメータの読み込み（事前キャリブレーション必須）
    try:
        with np.load(args.params) as data:
            mtx, dist = data['mtx'], data['dist']
    except:
        print("Error: 指定されたカメラパラメータが見つかりません。")
        return

    # ArUco検出の設定
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    detector = cv2.aruco.ArucoDetector(aruco_dict, cv2.aruco.DetectorParameters())
    obj_points = get_marker_model_cm(args.size)

    cap = cv2.VideoCapture(args.cam)
    win_name = '3D Pose and Target Tracker'
    cv2.namedWindow(win_name)

    # 動的な姿勢情報を保持するリスト（コールバック用）
    pose_data = [mtx, dist, None, None, None, None]

    while True:
        ret, frame = cap.read()
        if not ret: break

        # 最初にフレーム全体の歪みを補正する
        undistorted_frame = cv2.undistort(frame, mtx, dist, None, mtx)

        # 歪み補正後の画像でマーカー検出を行う
        gray = cv2.cvtColor(undistorted_frame, cv2.COLOR_BGR2GRAY)
        corners, ids, _ = detector.detectMarkers(gray)

        if ids is not None and args.id in ids:
            idx = np.where(ids == args.id)[0][0]
            
            # PnPアルゴリズムによるカメラの外部パラメータ(rvec, tvec)の算出
            ret_pnp, rvec, tvec = cv2.solvePnP(obj_points, corners[idx], mtx, np.zeros((5, 1)))

            if ret_pnp:
                # 回転ベクトル(rvec)を回転行列(R)に変換
                R, _ = cv2.Rodrigues(rvec)
                
                # 世界座標系におけるカメラ位置の算出
                # 計算式: C = -R^T * t
                camera_pos = -np.dot(R.T, tvec.flatten())
                
                # 回転角（オイラー角）の抽出
                pitch = np.degrees(np.arctan2(R[2,1], R[2,2]))
                yaw   = np.degrees(np.arctan2(-R[2,0], np.sqrt(R[2,1]**2 + R[2,2]**2)))
                roll  = np.degrees(np.arctan2(R[1,0], R[0,0]))
                
                # コールバック関数への姿勢データの受け渡し
                pose_data[2:6] = [rvec, tvec, R, camera_pos]
                cv2.setMouseCallback(win_name, mouse_callback, param=pose_data)

                # 座標軸の描画
                cv2.drawFrameAxes(undistorted_frame, mtx, np.zeros((5, 1)), rvec, tvec, args.size * 0.8)

                # AR表示: 保存された3D地点を現在のカメラ映像に投影
                target_str = "Target: [Click to set]"
                if clicked_3d_pos is not None:
                    # 3D点を2Dピクセルに再投影
                    img_pts, _ = cv2.projectPoints(clicked_3d_pos.reshape(1,1,3), rvec, tvec, mtx, np.zeros((5, 1)))
                    px, py = img_pts.ravel().astype(int)
                    
                    if 0 <= px < undistorted_frame.shape[1] and 0 <= py < undistorted_frame.shape[0]:
                        cv2.circle(undistorted_frame, (px, py), 15, (0, 0, 255), -1) # 赤いドットを表示
                        cv2.putText(undistorted_frame, "TARGET", (px + 20, py), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
                    
                    target_str = f"Target X:{clicked_3d_pos[0]:.1f} Y:{clicked_3d_pos[1]:.1f} Z:{clicked_3d_pos[2]:.1f} (cm)"

                # --- 画面上への情報表示 (視認性向上のため大きなフォントを使用) ---
                # カメラの位置
                cv2.putText(undistorted_frame, f"x:{camera_pos[0]:.1f}, y:{camera_pos[1]:.1f}, z:{camera_pos[2]:.1f} (cm)", 
                            (30, 60), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)
                # カメラの姿勢角度
                cv2.putText(undistorted_frame, f"Pitch:{pitch:.1f} Roll:{roll:.1f} Yaw:{yaw:.1f} (deg)", 
                            (30, 130), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)
                # クリックしたターゲットのマーカー基準座標
                cv2.putText(undistorted_frame, target_str, (30, 200), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)

        # 最終的に表示するのは、すべての描画が完了した歪み補正済み画像
        cv2.imshow(win_name, undistorted_frame)
        if cv2.waitKey(1) & 0xFF == ord('q'): break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()