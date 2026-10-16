// SHARED MovieScript 3269 `NuewLists`: newspaper issues, dates and stack positions.
export const G_AYEARS = [1880, 1881, 1887, 1888, 1890, 1893, 1894, 1909, 1914, 1915, 1917, 1919];
/** issue year -> [month, day] */
export const G_ADATE: Record<number, [number, number]> = {
  1880: [8, 1], 1881: [9, 20], 1887: [2, 5], 1888: [8, 1], 1890: [7, 15], 1893: [9, 17],
  1894: [5, 15], 1909: [4, 8], 1914: [8, 5], 1915: [6, 1], 1917: [4, 6], 1919: [1, 7],
};
/** town talk -> issue index (1-based) shown on the bench */
export const G_WHATN: Record<number, number> = { 102: 1, 105: 2, 107: 3, 109: 4, 111: 6, 112: 7, 115: 8, 116: 9, 117: 11, 119: 12 };
export const G_XNEWS = [313, 286, 272, 258, 244, 209, 209, 186, 356, 186, 273, 186];
export const G_YNEWS = [232, 55, 40, 25, 10, 65, 79, 116, 116, 208, 208, 307];
