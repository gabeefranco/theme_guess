// Minimal hand-rolled JS-ish lexer. It doesn't need to be a real parser —
// just consistent enough to bucket every word in the sample into the
// same "kind" categories a syntax theme would color.

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'of', 'in', 'new', 'class', 'extends', 'constructor', 'import', 'from',
  'export', 'default', 'static', 'async', 'await', 'try', 'catch', 'finally',
  'throw', 'typeof', 'instanceof', 'break', 'continue', 'switch', 'case',
  'yield', 'super', 'do',
]);

const CONSTANTS = new Set(['true', 'false', 'null', 'undefined', 'this']);

const OPS3 = ['===', '!==', '**='];
const OPS2 = ['=>', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '++', '--'];
const PUNCT = '{}()[];,.';
const OP_CHARS = '+-*/%=<>!?:&|^~';

function scan(src) {
  const raw = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '\n') { raw.push({ type: 'newline', text: '\n' }); i++; continue; }
    if (ch === ' ' || ch === '\t') {
      let j = i;
      while (j < n && (src[j] === ' ' || src[j] === '\t')) j++;
      raw.push({ type: 'whitespace', text: src.slice(i, j) }); i = j; continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      raw.push({ type: 'comment', text: src.slice(i, j) }); i = j; continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      j = Math.min(j + 2, n);
      raw.push({ type: 'comment', text: src.slice(i, j) }); i = j; continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < n && src[j] !== quote) { if (src[j] === '\\') j++; j++; }
      j = Math.min(j + 1, n);
      raw.push({ type: 'string', text: src.slice(i, j) }); i = j; continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9.]/.test(src[j])) j++;
      raw.push({ type: 'number', text: src.slice(i, j) }); i = j; continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      raw.push({ type: 'identifier', text: src.slice(i, j) }); i = j; continue;
    }
    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    if (OPS3.includes(three)) { raw.push({ type: 'operator', text: three }); i += 3; continue; }
    if (OPS2.includes(two)) { raw.push({ type: 'operator', text: two }); i += 2; continue; }
    if (PUNCT.includes(ch)) { raw.push({ type: 'punctuation', text: ch }); i++; continue; }
    if (OP_CHARS.includes(ch)) { raw.push({ type: 'operator', text: ch }); i++; continue; }
    raw.push({ type: 'punctuation', text: ch }); i++;
  }
  return raw;
}

// Defensive: split any token that smuggled in a newline (block comments,
// multi-line strings) so layout math stays a simple line/col grid.
function expandNewlines(raw) {
  const tokens = [];
  for (const t of raw) {
    if (t.type !== 'newline' && t.text.includes('\n')) {
      const parts = t.text.split('\n');
      parts.forEach((p, idx) => {
        if (p.length) tokens.push({ type: t.type, text: p });
        if (idx < parts.length - 1) tokens.push({ type: 'newline', text: '\n' });
      });
    } else {
      tokens.push(t);
    }
  }
  return tokens;
}

function classify(tokens) {
  let line = 0;
  let col = 0;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === 'newline') { line++; col = 0; continue; }

    if (t.type === 'identifier') {
      const word = t.text;
      let p = k - 1;
      while (p >= 0 && (tokens[p].type === 'whitespace' || tokens[p].type === 'newline')) p--;
      let nx = k + 1;
      while (nx < tokens.length && (tokens[nx].type === 'whitespace' || tokens[nx].type === 'newline')) nx++;
      const prev = p >= 0 ? tokens[p] : null;
      const next = nx < tokens.length ? tokens[nx] : null;
      const isCall = !!next && next.type === 'punctuation' && next.text === '(';
      const isProp = !!prev && prev.type === 'punctuation' && prev.text === '.';
      const isClassCtx = !!prev && prev.type === 'keyword' && ['class', 'new', 'extends'].includes(prev.text);

      if (KEYWORDS.has(word)) t.type = 'keyword';
      else if (CONSTANTS.has(word)) t.type = 'constant';
      else if (/^[A-Z]/.test(word) && (isClassCtx || !isCall)) t.type = 'type';
      else if (isCall) t.type = 'function';
      else if (isProp) t.type = 'property';
      else t.type = 'variable';
    }

    t.line = line;
    t.col = col;
    col += t.text.length;
  }
  return tokens;
}

export function tokenize(source) {
  return classify(expandNewlines(scan(source)));
}
