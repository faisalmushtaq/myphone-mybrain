/**
 * Unicode code points present in both AtkinsonHyperlegibleNext-*.ttf files
 * (generated with fontTools when the fonts were assembled; see README.md).
 * Used to notice names the PDF typeface cannot show.
 */
export const ranges: [number, number][] = [[32, 126], [160, 172], [174, 180], [182, 263], [266, 275], [278, 283], [286, 291], [294, 295], [298, 299], [302, 307], [310, 311], [313, 318], [321, 328], [336, 341], [344, 347], [350, 357], [362, 363], [366, 382], [402, 402], [536, 539], [567, 567], [710, 711], [713, 713], [730, 730], [732, 733], [768, 769], [771, 772], [776, 776], [7808, 7813], [7838, 7838], [7922, 7923], [8201, 8201], [8211, 8212], [8216, 8218], [8220, 8222], [8224, 8224], [8226, 8226], [8230, 8230], [8249, 8250], [8260, 8260], [8364, 8364], [8377, 8377], [8467, 8467], [8482, 8482], [8722, 8722], [8725, 8725]];

export function covered(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return ranges.some(([a, b]) => c >= a && c <= b);
}
