import numpy as np

# 1. ファイルの読み込み
file_path = 'calibration_data.npz' # 保存したファイル名に合わせて変更
try:
    with np.load(file_path) as data:
        # キーが存在するか確認しながら抽出
        mtx = data['mtx']
        dist = data['dist']
        
    # 2. テキスト表示（見やすく整形）
    print("="*50)
    print(f"  Calibration Parameters: {file_path}")
    print("="*50)

    print("\n[ Camera Matrix (mtx) ]")
    print(f"焦点距離 (fx, fy): ({mtx[0,0]:.2f}, {mtx[1,1]:.2f})")
    print(f"光学中心 (cx, cy): ({mtx[0,2]:.2f}, {mtx[1,2]:.2f})")
    print("\n行列データ:")
    print(mtx)

    print("\n" + "-"*50)
    print("[ Distortion Coefficients (dist) ]")
    print("係数 (k1, k2, p1, p2, k3):")
    print(dist.flatten()) # 1次元に平坦化して表示

    print("\n" + "="*50)
    print("これらの値を使って solvePnP による姿勢推定が可能です。")

except KeyError as e:
    print(f"エラー: ファイル内にキー {e} が見つかりませんでした。")
except FileNotFoundError:
    print(f"エラー: {file_path} が見つかりません。パスを確認してください。")

