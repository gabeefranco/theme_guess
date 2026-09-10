// Layout/animation constants shared by the game renderer, the game
// controller, and the pre-game theme preview.

import type { RGB } from '../types';

export const FONT_STACK = "'JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Consolas,monospace";

export const FONT_SIZE = 17;
export const LINE_HEIGHT = 26;
export const GUTTER = 46;
export const PAD = 24;

export const UNSET_BG_RGB: RGB = { r: 48, g: 44, b: 42 };
export const UNSET_FG_RGB: RGB = { r: 168, g: 153, b: 132 };

export const TRANSITION_MS = 550;
export const METER_BLOCKS = 20;
