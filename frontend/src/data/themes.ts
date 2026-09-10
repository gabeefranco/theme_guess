// Token "kinds" the player can paint (order drives the panel layout),
// and a handful of real syntax-theme palettes mapped onto those kinds.
// Hex values are sourced from each project's own theme definitions:
// Gruvbox (morhetz/gruvbox accent palette), VS Code Dark+ (dark_vs.json /
// dark_plus.json), GitHub Dark (primer/github-vscode-theme tokenColors),
// Tokyo Night (enkia/tokyo-night-vscode palette), Dracula and Catppuccin
// Mocha (official published palettes).

import type { CategoryMeta, Themes } from '../types';

export const CATEGORY_META: CategoryMeta[] = [
  { id: 'background', label: 'Background', icon: '🌑' },
  { id: 'keyword', label: 'Keywords', icon: '🔑' },
  { id: 'string', label: 'Strings', icon: '🧵' },
  { id: 'number', label: 'Numbers', icon: '🔢' },
  { id: 'constant', label: 'Constants', icon: '⭐' },
  { id: 'function', label: 'Functions', icon: '🛠️' },
  { id: 'variable', label: 'Variables', icon: '📦' },
  { id: 'property', label: 'Properties', icon: '🏷️' },
  { id: 'type', label: 'Types / Classes', icon: '🧩' },
  { id: 'operator', label: 'Operators', icon: '➕' },
  { id: 'punctuation', label: 'Punctuation', icon: '•' },
  { id: 'comment', label: 'Comments', icon: '💬' },
];

export const THEMES: Themes = {
  gruvbox: {
    name: 'Gruvbox Dark',
    colors: {
      background: '#282828', keyword: '#fb4934', string: '#b8bb26', number: '#d3869b',
      constant: '#d3869b', function: '#fabd2f', variable: '#83a598', property: '#8ec07c',
      type: '#fe8019', operator: '#ebdbb2', punctuation: '#a89984', comment: '#928374',
    },
  },
  tokyoNight: {
    name: 'Tokyo Night',
    colors: {
      background: '#1a1b26', keyword: '#bb9af7', string: '#9ece6a', number: '#ff9e64',
      constant: '#ff9e64', function: '#7aa2f7', variable: '#c0caf5', property: '#73daca',
      type: '#2ac3de', operator: '#89ddff', punctuation: '#a9b1d6', comment: '#565f89',
    },
  },
  vscode: {
    name: 'VS Code Dark+',
    colors: {
      background: '#1e1e1e', keyword: '#569cd6', string: '#ce9178', number: '#b5cea8',
      constant: '#569cd6', function: '#dcdcaa', variable: '#9cdcfe', property: '#9cdcfe',
      type: '#4ec9b0', operator: '#d4d4d4', punctuation: '#d4d4d4', comment: '#6a9955',
    },
  },
  github: {
    name: 'GitHub Dark',
    colors: {
      background: '#0d1117', keyword: '#ff7b72', string: '#a5d6ff', number: '#79c0ff',
      constant: '#79c0ff', function: '#d2a8ff', variable: '#ffa657', property: '#79c0ff',
      type: '#ffa657', operator: '#c9d1d9', punctuation: '#c9d1d9', comment: '#8b949e',
    },
  },
  dracula: {
    name: 'Dracula',
    colors: {
      background: '#282a36', keyword: '#ff79c6', string: '#f1fa8c', number: '#bd93f9',
      constant: '#bd93f9', function: '#50fa7b', variable: '#f8f8f2', property: '#ffb86c',
      type: '#8be9fd', operator: '#ff79c6', punctuation: '#f8f8f2', comment: '#6272a4',
    },
  },
  catppuccin: {
    name: 'Catppuccin Mocha',
    colors: {
      background: '#1e1e2e', keyword: '#cba6f7', string: '#a6e3a1', number: '#fab387',
      constant: '#fab387', function: '#89b4fa', variable: '#cdd6f4', property: '#b4befe',
      type: '#f9e2af', operator: '#89dceb', punctuation: '#9399b2', comment: '#6c7086',
    },
  },
};

export const CODE_SAMPLE = `// Theme Guess demo file
class ColorMixer {
  constructor(name, hue) {
    this.name = name;
    this.hue = hue;
    this.locked = false;
  }

  blend(other, amount = 0.5) {
    const mixed = this.hue * (1 - amount) + other.hue * amount;
    return new ColorMixer(\`\${this.name}+\${other.name}\`, mixed);
  }
}

function buildPalette(seed) {
  const colors = [];
  for (let i = 0; i < 8; i++) {
    const hue = (seed + i * 45) % 360;
    colors.push(new ColorMixer(\`swatch-\${i}\`, hue));
  }
  return colors;
}

const palette = buildPalette(20);
const primary = palette[0];
const accent = palette[palette.length - 1];

if (accent.hue > 180 && !primary.locked) {
  primary.locked = true;
  console.log(\`Locked \${primary.name} at hue \${primary.hue}\`);
}

export default palette;
`;

// A short, different snippet used for the pre-game theme reveal. It's
// deliberately missing some token kinds the real game asks about (no
// numeric literals, no true/false/null/undefined/this) so the preview
// doesn't hand the player every answer up front.
export const PREVIEW_SAMPLE = `// Rendering theme preview...
import { formatName } from "./utils";

function greetUser(user) {
  const label = formatName(user.first, user.last);
  return \`Hello, \${label}!\`;
}

class Notifier {
  send(message) {
    console.log(message.body);
  }
}

export function broadcast(list) {
  list.forEach(item => item.send());
}
`;
