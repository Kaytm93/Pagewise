import { LIMITS, RenderError } from '../errors';

/**
 * Ausdrücke für Funktionsgraphen, ohne `eval` und ohne `new Function`: ein kleiner Parser (rekursiver
 * Abstieg) baut einen Baum, daraus entsteht eine gewöhnliche Funktion. Erlaubt sind Zahlen, `x`, `pi`, `e`,
 * `+ - * / ^`, Klammern, die Funktionen aus `FUNCTIONS` und das Malzeichen darf entfallen (`2x`, `2(x+1)`).
 * Grenzen für Länge, Tiefe und Knotenzahl verhindern, dass ein Ausdruck unbegrenzt Zeit braucht.
 */
const MAX_NODES = 200;
const MAX_DEPTH = 40;

// Maps statt einfacher Objekte: Ein Name wie `constructor` oder `toString` darf nie etwas aus dem Prototyp treffen.
const FUNCTIONS = new Map<string, (value: number) => number>(
  Object.entries({
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    sinh: Math.sinh,
    cosh: Math.cosh,
    tanh: Math.tanh,
    sqrt: Math.sqrt,
    cbrt: Math.cbrt,
    abs: Math.abs,
    ln: Math.log,
    log: Math.log10,
    exp: Math.exp,
    floor: Math.floor,
    ceil: Math.ceil,
    sign: Math.sign,
  }),
);

const CONSTANTS = new Map<string, number>([
  ['pi', Math.PI],
  ['e', Math.E],
]);

type Node =
  | { t: 'num'; v: number }
  | { t: 'x' }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { t: 'fn'; f: (value: number) => number; a: Node };

type Token =
  | { k: 'num'; v: number }
  | { k: 'id'; v: string }
  | { k: 'op'; v: '+' | '-' | '*' | '/' | '^' | '(' | ')' };

/** Schreibweisen, die Modelle gern benutzen, auf die einfache Form bringen. */
function normalize(source: string): string {
  return source
    .replace(/[−–]/g, '-')
    .replace(/[·×⋅]/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\*\*/g, '^')
    .replace(/,/g, '.');
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i] as string;
    if (/\s/.test(c)) {
      i += 1;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i));
      if (!m) throw new RenderError('invalid_expression', String(i));
      const value = Number(m[0]);
      if (!Number.isFinite(value)) throw new RenderError('invalid_expression', String(i));
      tokens.push({ k: 'num', v: value });
      i += m[0].length;
    } else if (/[a-zA-Z]/.test(c)) {
      const m = /^[a-zA-Z]+/.exec(source.slice(i)) as RegExpExecArray;
      tokens.push({ k: 'id', v: m[0].toLowerCase() });
      i += m[0].length;
    } else if ('+-*/^()'.includes(c)) {
      tokens.push({ k: 'op', v: c as '+' });
      i += 1;
    } else {
      throw new RenderError('invalid_expression', String(i));
    }
  }
  return tokens;
}

class Parser {
  private pos = 0;
  private nodes = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.sum();
    if (this.pos < this.tokens.length)
      throw new RenderError('invalid_expression', String(this.pos));
    return node;
  }

  private count(): void {
    this.nodes += 1;
    if (this.nodes > MAX_NODES) throw new RenderError('too_complex');
  }

  private enter(): void {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) throw new RenderError('too_complex');
  }

  private leave(): void {
    this.depth -= 1;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isOp(value: string): boolean {
    const token = this.peek();
    return token?.k === 'op' && token.v === value;
  }

  private sum(): Node {
    this.enter();
    let left = this.product();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.tokens[this.pos++] as { v: '+' | '-' }).v;
      this.count();
      left = { t: 'bin', op, a: left, b: this.product() };
    }
    this.leave();
    return left;
  }

  /** Punkt vor Strich, Malzeichen darf fehlen, wenn ein Faktor beginnt. */
  private product(): Node {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (token?.k === 'op' && (token.v === '*' || token.v === '/')) {
        this.pos += 1;
        this.count();
        left = { t: 'bin', op: token.v, a: left, b: this.unary() };
      } else if (
        token &&
        (token.k === 'num' || token.k === 'id' || (token.k === 'op' && token.v === '('))
      ) {
        this.count();
        left = { t: 'bin', op: '*', a: left, b: this.unary() };
      } else {
        return left;
      }
    }
  }

  private unary(): Node {
    if (this.isOp('-')) {
      this.pos += 1;
      this.count();
      this.enter();
      const node: Node = { t: 'neg', a: this.unary() };
      this.leave();
      return node;
    }
    if (this.isOp('+')) {
      this.pos += 1;
      return this.unary();
    }
    return this.power();
  }

  /** `^` bindet stärker als Punkt und rechts herum: `2^3^2` ist `2^(3^2)`; `x^-2` ist erlaubt. */
  private power(): Node {
    const base = this.atom();
    if (this.isOp('^')) {
      this.pos += 1;
      this.count();
      this.enter();
      const node: Node = { t: 'bin', op: '^', a: base, b: this.unary() };
      this.leave();
      return node;
    }
    return base;
  }

  private atom(): Node {
    const token = this.peek();
    if (!token) throw new RenderError('invalid_expression', String(this.pos));
    this.pos += 1;
    this.count();
    if (token.k === 'num') return { t: 'num', v: token.v };
    if (token.k === 'op' && token.v === '(') {
      const inner = this.sum();
      if (!this.isOp(')')) throw new RenderError('invalid_expression', String(this.pos));
      this.pos += 1;
      return inner;
    }
    if (token.k === 'id') {
      if (token.v === 'x') return { t: 'x' };
      const constant = CONSTANTS.get(token.v);
      if (constant !== undefined) return { t: 'num', v: constant };
      const f = FUNCTIONS.get(token.v);
      if (f) {
        if (!this.isOp('(')) throw new RenderError('invalid_expression', String(this.pos));
        this.pos += 1;
        const arg = this.sum();
        if (!this.isOp(')')) throw new RenderError('invalid_expression', String(this.pos));
        this.pos += 1;
        return { t: 'fn', f, a: arg };
      }
    }
    throw new RenderError('invalid_expression', String(this.pos - 1));
  }
}

function evaluate(node: Node, x: number): number {
  switch (node.t) {
    case 'num':
      return node.v;
    case 'x':
      return x;
    case 'neg':
      return -evaluate(node.a, x);
    case 'fn':
      return node.f(evaluate(node.a, x));
    case 'bin': {
      const a = evaluate(node.a, x);
      const b = evaluate(node.b, x);
      switch (node.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return a / b;
        case '^':
          return a ** b;
      }
    }
  }
}

export type CompiledExpression = (x: number) => number;

/** Wirft `RenderError` (`empty`, `too_large`, `invalid_expression`, `too_complex`). */
export function compileExpression(source: string): CompiledExpression {
  const text = normalize(
    source
      .trim()
      .replace(/^[a-zA-Z]\w*\s*\(\s*x\s*\)\s*=\s*/, '')
      .replace(/^y\s*=\s*/i, ''),
  );
  if (text === '') throw new RenderError('empty');
  if (text.length > LIMITS.expression) throw new RenderError('too_large');
  const tree = new Parser(tokenize(text)).parse();
  return (x) => evaluate(tree, x);
}
