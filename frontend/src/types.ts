// Shared domain types for the tokenizer, theme data, and game engine.

/** Every lexical bucket the tokenizer can assign, including the two
 * layout-only kinds ('whitespace', 'newline') and the transient
 * pre-classification kind ('identifier') that never survives past
 * `tokenize()`. */
export type TokenType =
  | 'keyword'
  | 'string'
  | 'number'
  | 'constant'
  | 'function'
  | 'variable'
  | 'property'
  | 'type'
  | 'operator'
  | 'punctuation'
  | 'comment'
  | 'whitespace'
  | 'newline'
  | 'identifier';

export interface Token {
  type: TokenType;
  text: string;
  /** 0-indexed source line, assigned during tokenization. */
  line: number;
  /** 0-indexed character column within its line. */
  col: number;
}

/** The token kinds the player can actually paint a color onto. Mirrors
 * `TokenType` minus the layout-only and transient members, plus
 * 'background', which isn't a token at all but is themed the same way. */
export type CategoryId =
  | 'background'
  | 'keyword'
  | 'string'
  | 'number'
  | 'constant'
  | 'function'
  | 'variable'
  | 'property'
  | 'type'
  | 'operator'
  | 'punctuation'
  | 'comment';

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  icon: string;
}

export type ThemeColors = Record<CategoryId, string>;

export interface ThemeDefinition {
  name: string;
  colors: ThemeColors;
}

export type ThemeId = string;
export type Themes = Record<ThemeId, ThemeDefinition>;

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Runtime state for one paintable category: its real target color, the
 * player's guess, and the animated color currently on screen. */
export interface CategoryState extends CategoryMeta {
  actualHex: string;
  /** Scoring weight, derived from how often this kind appears in the code. */
  weight: number;
  count: number;
  assignedHex: string | null;
  currentRgb: RGB;
  fromRgb: RGB;
  toRgb: RGB;
  /** `performance.now()` timestamp a color transition started, or 0 when idle. */
  transitionStart: number;
  /** Per-category phase offset so "unset" pulse animations don't sync up. */
  pulsePhase: number;
}

export type CategoryStateMap = Record<CategoryId, CategoryState>;

export interface MatchResultRow extends CategoryMeta {
  guess: string | null;
  actualHex: string;
  sim: number;
}

export interface MatchResult {
  overall: number;
  rows: MatchResultRow[];
}
