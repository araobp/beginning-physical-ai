import cv2
import numpy as np
import argparse

def generate_chessboard(cols=9, rows=6, square_size_px=100, margin_px=100, darkness=0):
    """
    指定されたパラメータでチェスボード画像を生成します。
    :param cols: 列数（正方形の数）。
    :param rows: 行数（正方形の数）。
    :param square_size_px: 1つの正方形のサイズ（ピクセル単位）。
    :param margin_px: 外側の余白（ピクセル単位）。
    :param darkness: 暗い正方形のピクセル値 (0-255)。
    :return: NumPy配列としてのチェスボード画像。
    """
    # 余白を含む画像の合計サイズを計算
    width = cols * square_size_px + 2 * margin_px
    height = rows * square_size_px + 2 * margin_px
    image = np.ones((height, width), dtype=np.uint8) * 255

    # 黒い正方形を描画
    for r in range(rows):
        for c in range(cols):
            # (行 + 列) が奇数の場合、正方形を黒く塗る
            if (r + c) % 2 == 1:
                y1 = margin_px + r * square_size_px
                y2 = y1 + square_size_px
                x1 = margin_px + c * square_size_px
                x2 = x1 + square_size_px
                image[y1:y2, x1:x2] = darkness
    return image

def main():
    """
    引数を解析してチェスボードを生成するメイン関数。
    """
    parser = argparse.ArgumentParser(description="カメラキャリブレーション用のチェスボードパターン画像を生成します。", formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument("--cols", type=int, default=10, help="列数（正方形の数）。")
    parser.add_argument("--rows", type=int, default=7, help="行数（正方形の数）。")
    parser.add_argument("--size", type=int, default=150, help="各正方形のサイズ（ピクセル単位）。")
    parser.add_argument("--margin", type=int, default=100, help="ボード周囲の余白（ピクセル単位）。")
    parser.add_argument("--darkness", type=int, default=0, help="黒い正方形の暗さレベル (0-255)。")
    parser.add_argument("--output", type=str, help="出力ファイル名。デフォルトは 'chessboard_{cols}x{rows}.png'")
    parser.add_argument("--no-display", action="store_true", help="生成された画像を表示しません。")

    args = parser.parse_args()

    # 出力ファイル名を決定
    if args.output:
        file_name = args.output
    else:
        file_name = f"chessboard_{args.cols}x{args.rows}.png"

    # キャリブレーションパターンのサイズに関するユーザーへの注記
    print(f"{args.cols}x{args.rows} の正方形ボードを生成しています。")
    print(f"注: OpenCVのキャリブレーションでは、パターンサイズは ({args.cols - 1}, {args.rows - 1}) になります。")

    # 画像を生成
    chessboard_img = generate_chessboard(
        cols=args.cols,
        rows=args.rows,
        square_size_px=args.size,
        margin_px=args.margin,
        darkness=args.darkness
    )

    # 画像を保存
    cv2.imwrite(file_name, chessboard_img)
    print(f"チェスボードを正常に保存しました: {file_name}")

    # 抑制されていない限り画像を表示
    if not args.no_display:
        cv2.imshow("Chessboard Pattern", chessboard_img)
        print("ウィンドウを閉じるには何かキーを押してください。")
        cv2.waitKey(0)
        cv2.destroyAllWindows()

if __name__ == '__main__':
    main()
