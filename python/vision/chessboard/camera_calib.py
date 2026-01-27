import numpy as np
import cv2
import argparse

def run_calibration(chessboard_size=(9, 6), square_size=25.0, output_filename="calibration_data.npz", camera_source=0):
    """
    チェスボードパターンを使用してカメラキャリブレーションを実行します。

    Args:
        chessboard_size (tuple): チェスボードの行と列ごとの内部コーナーの数 (corners_x, corners_y)。
        square_size (float): 正方形の1辺のサイズ（ミリメートル単位）。
        output_filename (str): キャリブレーション結果を保存するパス（.npzファイル）。
        camera_source (int or str): cv2.VideoCapture用のカメラインデックス(int)またはデバイスパス(str)。
    """
    # オブジェクトポイントを準備します。(0,0,0), (1,0,0), (2,0,0) ....,(6,5,0) のような形式です。
    objp = np.zeros((chessboard_size[0] * chessboard_size[1], 3), np.float32)
    objp[:, :2] = np.mgrid[0:chessboard_size[0], 0:chessboard_size[1]].T.reshape(-1, 2) * square_size

    # 全画像のオブジェクトポイントと画像ポイントを格納する配列。
    objpoints, imgpoints = [], []
    # カメラを初期化
    cap = cv2.VideoCapture(camera_source)

    print("'s'キーで20枚の画像を撮影してください。撮影ごとにボードの角度や距離を変えてください。'q'で終了します。")
    count = 0
    gray = None
    last_captured_frame = None
    while count < 20:
        ret, frame = cap.read()
        if not ret: break
        original_frame = frame.copy()
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        # チェスボードのコーナーを検出
        ret_found, corners = cv2.findChessboardCorners(gray, chessboard_size, None)
        if ret_found:
            cv2.drawChessboardCorners(frame, chessboard_size, corners, ret_found)
        cv2.imshow('Calibration', frame)
        key = cv2.waitKey(1) & 0xFF
        # 's'キーでキャリブレーション用に現在のフレームを保存
        if key == ord('s') and ret_found:
            objpoints.append(objp)
            imgpoints.append(corners)
            last_captured_frame = original_frame
            count += 1
            print(f"撮影完了 {count}/20。ボードを動かしてください。")
        elif key == ord('q'): break

    cap.release()
    cv2.destroyAllWindows()

    # 十分なデータがある場合、キャリブレーションを実行
    if len(objpoints) > 0 and gray is not None:
        ret, mtx, dist, rvecs, tvecs = cv2.calibrateCamera(objpoints, imgpoints, gray.shape[::-1], None, None)
        # カメラ行列と歪み係数を保存
        np.savez(output_filename, mtx=mtx, dist=dist)
        print(f"{output_filename} を保存しました")

        # 最後に撮影したフレームで結果を可視化
        if last_captured_frame is not None:
            h, w = last_captured_frame.shape[:2]
            # 画像サイズに基づいてカメラ行列を調整
            newcameramtx, roi = cv2.getOptimalNewCameraMatrix(mtx, dist, (w, h), 1, (w, h))
            # 歪み補正
            dst = cv2.undistort(last_captured_frame, mtx, dist, None, newcameramtx)
            cv2.imshow('Original', last_captured_frame)
            cv2.imshow('Undistorted', dst)
            cv2.waitKey(0)
            cv2.destroyAllWindows()

def run_view_mode(calibration_file="calibration_data.npz", camera_source=0):
    """
    キャリブレーションデータを読み込み、歪み補正されたライブ映像を表示します。
    """
    try:
        data = np.load(calibration_file)
        mtx = data['mtx']
        dist = data['dist']
        print(f"{calibration_file} からキャリブレーションデータを読み込みました")
    except FileNotFoundError:
        print(f"エラー: キャリブレーションファイル '{calibration_file}' が見つかりません。先にキャリブレーションを実行してください。")
        return
    except Exception as e:
        print(f"キャリブレーションデータの読み込みエラー: {e}")
        return

    cap = cv2.VideoCapture(camera_source)
    if not cap.isOpened():
        print(f"エラー: カメラソース {camera_source} を開けませんでした")
        return

    print("'q'キーを押して終了します。")
    newcameramtx = None

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        h, w = frame.shape[:2]
        if newcameramtx is None:
            newcameramtx, roi = cv2.getOptimalNewCameraMatrix(mtx, dist, (w, h), 1, (w, h))

        dst = cv2.undistort(frame, mtx, dist, None, newcameramtx)
        
        # 横に並べて結合
        combined = np.hstack((frame, dst))
        
        cv2.imshow('Original (Left) vs Undistorted (Right)', combined)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="チェスボードパターンを使用したカメラキャリブレーション。")
    parser.add_argument("--corners-x", type=int, default=9, help="X軸方向の内部コーナーの数（デフォルト: 9）。")
    parser.add_argument("--corners-y", type=int, default=6, help="Y軸方向の内部コーナーの数（デフォルト: 6）。")
    parser.add_argument("--size", type=float, default=25.0, help="正方形の1辺のサイズ（ミリメートル単位、デフォルト: 25.0）。")
    parser.add_argument("--output", type=str, default="calibration_data.npz", help="キャリブレーションデータの出力ファイル（デフォルト: calibration_data.npz）。")
    parser.add_argument("--source", default="0", help="カメラソース（インデックスまたはデバイスパス、デフォルト: 0）。")
    parser.add_argument("--view", action="store_true", help="ビューモード: キャリブレーションデータを読み込み、歪み補正されたライブ映像を表示します。")
    args = parser.parse_args()

    chessboard_size = (args.corners_x, args.corners_y)
    
    # source引数が数字の場合はintに変換（インデックス用）、それ以外は文字列のまま（パス用）
    source = int(args.source) if args.source.isdigit() else args.source

    if args.view:
        run_view_mode(calibration_file=args.output, camera_source=source)
    else:
        print(f"{chessboard_size[0]}x{chessboard_size[1]} のコーナーパターンを探しています。")
        run_calibration(
            chessboard_size=chessboard_size,
            square_size=args.size,
            output_filename=args.output,
            camera_source=source
        )
