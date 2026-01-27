import cv2
import numpy as np
import argparse
import sys

if __name__ == "__main__":
    """
    ArUcoマーカー画像を生成します。
    Args:
        --id (int): マーカーID（デフォルト: 10）。
        --size (int): マーカーサイズ（デフォルト: 300）。
        --darkness (int): 暗さレベル（ピクセル値 0-255、デフォルト: 0）。
    """
    parser = argparse.ArgumentParser(description="ArUcoマーカー画像を生成します")
    parser.add_argument("--id", type=int, default=10, help="マーカーID（デフォルト: 10）")
    parser.add_argument("--size", type=int, default=300, help="マーカーサイズ（デフォルト: 300）")
    parser.add_argument("--darkness", type=int, default=0, help="暗さレベル（ピクセル値 0-255、デフォルト: 0）")

    if len(sys.argv) == 1:
        parser.print_help(sys.stderr)
        sys.exit(1)

    args = parser.parse_args()

    marker_id = args.id
    marker_size = args.size

    # 定義済みの辞書を読み込みます（4x4ビット、50マーカー）
    # OpenCV 4.7.0以降のAPI変更に対応
    try:
        aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    except AttributeError:
        # 古いOpenCVバージョンの場合
        aruco_dict = cv2.aruco.Dictionary_get(cv2.aruco.DICT_4X4_50)

    # レガシーサポート用に画像を初期化（古いOpenCVバージョンではdrawMarkerに事前に割り当てられた画像が必要です）
    img = np.zeros((marker_size, marker_size, 1), dtype="uint8")

    # マーカーを生成
    # OpenCV 4.7.0以降はgenerateImageMarkerを使用し、古いバージョンはdrawMarkerを使用します
    try:
        img = cv2.aruco.generateImageMarker(aruco_dict, marker_id, marker_size)
    except AttributeError:
        # 古いOpenCVバージョンの場合
        img = cv2.aruco.drawMarker(aruco_dict, marker_id, marker_size, img, 1)

    # 暗さレベルを設定
    darkness = args.darkness
    img[img == 0] = darkness

    # 生成されたマーカー画像を保存
    output_filename = f"marker_ID_{marker_id}.png"
    cv2.imwrite(output_filename, img)

    print(f"ID {marker_id} のArUcoマーカーを生成し、{output_filename} として保存しました")
