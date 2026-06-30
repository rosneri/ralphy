/**
 * Layout and typography constants for the Notion-inspired Markdown → PDF
 * renderer. The styling tracks Notion's defaults loosely: Helvetica body in a
 * dark grey, light-grey backgrounds for code, generous block spacing. No
 * external fonts beyond pdfkit's built-ins, so this works in any Bun
 * environment without a browser or font dependency.
 */

export const PAGE_SIZE = "LETTER" as const;
export const MARGIN = 54; // 0.75in

// Notion-ish palette.
export const COLOR_TEXT = "#37352F";
export const COLOR_MUTED = "#787774";
export const COLOR_RULE = "#E9E9E7";
export const COLOR_CODE_BG = "#F7F6F3";
export const COLOR_INLINE_CODE_FG = "#EB5757";
export const COLOR_QUOTE_RULE = "#37352F";

// Typography.
export const FONT_BODY = "Helvetica";
export const FONT_BOLD = "Helvetica-Bold";
export const FONT_ITALIC = "Helvetica-Oblique";
export const FONT_BOLD_ITALIC = "Helvetica-BoldOblique";
export const FONT_MONO = "Courier";

export const BODY_SIZE = 10.5;
export const CODE_SIZE = 9;
export const HEADING_SIZES: Record<number, number> = {
  1: 24,
  2: 18,
  3: 14,
  4: 12,
  5: 11,
  6: 10.5,
};
export const HEADING_TOP_GAP: Record<number, number> = { 1: 12, 2: 10, 3: 8, 4: 6, 5: 4, 6: 4 };

export const LIST_INDENT = 16;
export const QUOTE_INDENT = 14;
export const QUOTE_RULE_WIDTH = 3;
export const CODE_PADDING_X = 8;
export const CODE_PADDING_Y = 6;
