/**
 * 物体の色名とHEXカラーコードのマッピング定義。
 * UI上で検出された物体を描画する際に使用されます。
 */
export const colorNameMap: Record<string, string> = {
  red: "#FF3838",
  orange: "#FF6D00",
  yellow: "#FFEA00",
  green: "#76FF03",
  blue: "#2979FF",
  purple: "#651FFF",
  pink: "#F50057",
  black: "#000000",
  white: "#FFFFFF",
  gray: "#9E9E9E",
  unknown: "#9E9E9E",
};

/**
 * 検出されたオブジェクト情報から、表示用の色（HEXコード）を取得します。
 * オブジェクトに `color_name` プロパティがある場合、対応する色を返します。
 * 未知の色名の場合はデフォルト色（グレー）を返します。
 * @param obj 検出されたオブジェクト
 * @returns HEXカラーコード
 */
export function getColorForObject(obj: any) {
  return colorNameMap[obj.color_name] || colorNameMap.unknown;
}

/**
 * 背景色（HEXコード）に基づいて、視認性の高いテキスト色（黒または白）を決定します。
 * YIQ色空間変換を使用して輝度を計算し、判定します。
 * @param hexcolor 背景色のHEXコード（例: "#FF0000"）
 * @returns "black" または "white"
 */
export function getTextColor(hexcolor: string) {
  if (!hexcolor || hexcolor.length < 7) return "white";
  const yiq =
    (parseInt(hexcolor.substring(1, 3), 16) * 299 +
      parseInt(hexcolor.substring(3, 5), 16) * 587 +
      parseInt(hexcolor.substring(5, 7), 16) * 114) /
    1000;
  return yiq >= 128 ? "black" : "white";
}