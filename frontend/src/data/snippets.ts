// The pool of code samples the game tokenizes and asks the player to
// theme. One entry is picked per match (see `pickRandomSnippetIndex`)
// so repeat play doesn't always show the same file.
//
// INVARIANT: this array is append-only and indices are stable across
// releases. Multiplayer matches reference a snippet by its numeric
// index over the wire (so both players in a match render the exact
// same source), so an existing entry must never be removed, reordered,
// or have its meaning changed once shipped — only append new entries
// at the end.
//
// Each sample exercises every CategoryId the tokenizer/theme panel
// cares about (keyword, string, number, constant, function, variable,
// property, type, operator, punctuation, comment; 'background' isn't
// a token and is always themed regardless of source).

export const SNIPPETS: string[] = [
  // 0: original Theme Guess demo file.
  `// Theme Guess demo file
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
`,
  // 1: inventory tracker.
  `// Inventory tracking demo
class InventoryTracker {
  constructor(label) {
    this.label = label;
    this.items = [];
    this.total = 0;
  }

  add(item, quantity = 1) {
    const cost = item.price * quantity;
    this.total += cost;
    this.items.push(item.name);
    return cost;
  }

  isEmpty() {
    return this.items.length === 0;
  }
}

function createItem(name, price) {
  return { name, price };
}

const tracker = new InventoryTracker('Warehouse A');
const apple = createItem('apple', 2.5);
const banana = createItem('banana', 1.25);

tracker.add(apple, 10);
tracker.add(banana, 6);

if (tracker.isEmpty() || tracker.total > 100) {
  console.log(\`Alert for \${tracker.label}: total is \${tracker.total}\`);
} else {
  console.log('Inventory nominal');
}

export default tracker;
`,
  // 2: 2D vector math.
  `// Vector math utilities
class Vector2 {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  add(other) {
    return new Vector2(this.x + other.x, this.y + other.y);
  }

  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  normalize() {
    const len = this.length();
    if (len === 0) {
      return new Vector2(0, 0);
    }
    return new Vector2(this.x / len, this.y / len);
  }
}

function lerpVector(a, b, t) {
  const clamped = Math.min(Math.max(t, 0), 1);
  return new Vector2(a.x + (b.x - a.x) * clamped, a.y + (b.y - a.y) * clamped);
}

const origin = new Vector2(0, 0);
const target = lerpVector(origin, new Vector2(10, 20), 0.75);
const isZero = target.length() === 0;

if (!isZero && target.x !== undefined) {
  console.log(\`Reached \${target.x}, \${target.y}\`);
}

export { Vector2, lerpVector };
`,
  // 3: publish/subscribe event bus.
  `// Simple publish/subscribe event bus
class EventBus {
  constructor() {
    this.listeners = {};
  }

  on(eventName, handler) {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }
    this.listeners[eventName].push(handler);
    return this;
  }

  emit(eventName, payload) {
    const handlers = this.listeners[eventName] || [];
    for (const handler of handlers) {
      handler(payload);
    }
  }
}

function logHandler(payload) {
  console.log(\`[log] \${payload.type}: \${payload.message}\`);
}

const bus = new EventBus();
bus.on('error', logHandler);

const failureCount = 3;
let attempts = 0;

while (attempts < failureCount) {
  bus.emit('error', { type: 'retry', message: \`attempt \${attempts}\`, fatal: false });
  attempts++;
}

if (attempts === failureCount && bus.listeners.error != null) {
  console.log('Done retrying');
}
`,
  // 4: descriptive statistics helpers.
  `// Basic descriptive statistics helpers
class StatsCalculator {
  constructor(values) {
    this.values = values;
  }

  mean() {
    const sum = this.values.reduce((acc, v) => acc + v, 0);
    return sum / this.values.length;
  }

  max() {
    return Math.max(...this.values);
  }
}

function isNumericArray(list) {
  return list.every((v) => typeof v === 'number');
}

const samples = [4, 8, 15, 16, 23, 42];
const calc = new StatsCalculator(samples);
const average = calc.mean();
const peak = calc.max();

let label = null;
if (isNumericArray(samples) && average > 0) {
  label = \`avg=\${average.toFixed(2)}, peak=\${peak}\`;
} else {
  label = 'invalid dataset';
}

console.log(label);
export { StatsCalculator, isNumericArray };
`,
  // 5: shape hierarchy with inheritance.
  `/* Grid renderer with basic collision helpers */
class Shape {
  constructor(kind) {
    this.kind = kind;
  }

  describe() {
    return \`\${this.kind} shape\`;
  }
}

class Rectangle extends Shape {
  constructor(width, height) {
    super('rectangle');
    this.width = width;
    this.height = height;
  }

  area() {
    return this.width * this.height;
  }

  contains(px, py) {
    return px >= 0 && px <= this.width && py >= 0 && py <= this.height;
  }
}

function makeGrid(count) {
  const shapes = [];
  for (let i = 0; i < count; i++) {
    shapes.push(new Rectangle(i + 1, i + 2));
  }
  return shapes;
}

const grid = makeGrid(5);
const first = grid[0];
const hit = first.contains(1, 1);

if (hit === true || first.area() === 0) {
  console.log(first.describe());
} else {
  console.log('no hit');
}
`,
];

/** Picks a uniformly random index into `SNIPPETS`, used as the default
 * snippet selection for a solo match. */
export function pickRandomSnippetIndex(): number {
  return Math.floor(Math.random() * SNIPPETS.length);
}
