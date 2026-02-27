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

export function getColorForObject(obj: any) {
  return colorNameMap[obj.color_name] || colorNameMap.unknown;
}

export function getTextColor(hexcolor: string) {
  if (!hexcolor || hexcolor.length < 7) return "white";
  const yiq =
    (parseInt(hexcolor.substring(1, 3), 16) * 299 +
      parseInt(hexcolor.substring(3, 5), 16) * 587 +
      parseInt(hexcolor.substring(5, 7), 16) * 114) /
    1000;
  return yiq >= 128 ? "black" : "white";
}