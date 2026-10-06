/**
 * The $filter subset the contract promises: eq ne gt ge lt le, and, parentheses;
 * literals 'text' (with '' escapes), datetimeoffset'...', datetime'...', numbers,
 * true, false, null. Evaluated against internal values (dates as epoch ms).
 */

import { EdmError, type Entity, type Fields, parseDate } from "./edm.js";

type Literal = string | number | boolean | null;
type Node =
  | { kind: "cmp"; field: string; op: string; value: Literal }
  | { kind: "and"; left: Node; right: Node };

const TOKEN =
  /\s*(?:(\()|(\))|(datetimeoffset|datetime)'([^']*)'|'((?:[^']|'')*)'|(-?\d+(?:\.\d+)?)(?![\w.])|([A-Za-z_][\w/]*))/y;

function tokenize(text: string): Array<{ type: string; value: string }> {
  const tokens: Array<{ type: string; value: string }> = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < text.length) {
    if (/^\s*$/.test(text.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(text);
    if (!m) throw new EdmError(`cannot parse $filter near: ${text.slice(pos, pos + 20)}`);
    pos = TOKEN.lastIndex;
    if (m[1]) tokens.push({ type: "(", value: "(" });
    else if (m[2]) tokens.push({ type: ")", value: ")" });
    else if (m[3]) tokens.push({ type: "date", value: m[4]! });
    else if (m[5] !== undefined) tokens.push({ type: "string", value: m[5].replaceAll("''", "'") });
    else if (m[6]) tokens.push({ type: "number", value: m[6] });
    else tokens.push({ type: "word", value: m[7]! });
  }
  return tokens;
}

const OPS = new Set(["eq", "ne", "gt", "ge", "lt", "le"]);

export function parseFilter(text: string): Node {
  const tokens = tokenize(text);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => {
    const t = tokens[i++];
    if (!t) throw new EdmError("unexpected end of $filter");
    return t;
  };

  function literal(): Literal {
    const t = next();
    if (t.type === "string") return t.value;
    if (t.type === "number") return Number(t.value);
    if (t.type === "date") return parseDate(t.value);
    if (t.type === "word" && t.value === "true") return true;
    if (t.type === "word" && t.value === "false") return false;
    if (t.type === "word" && t.value === "null") return null;
    throw new EdmError(`expected a literal, got ${t.value}`);
  }

  function primary(): Node {
    if (peek()?.type === "(") {
      next();
      const node = expr();
      if (next().type !== ")") throw new EdmError("missing )");
      return node;
    }
    const field = next();
    if (field.type !== "word") throw new EdmError(`expected a property, got ${field.value}`);
    const op = next();
    if (op.type !== "word" || !OPS.has(op.value)) throw new EdmError(`unsupported operator ${op.value}`);
    return { kind: "cmp", field: field.value, op: op.value, value: literal() };
  }

  function expr(): Node {
    let node = primary();
    while (peek()?.type === "word" && peek()!.value === "and") {
      next();
      node = { kind: "and", left: node, right: primary() };
    }
    return node;
  }

  const node = expr();
  if (i !== tokens.length) throw new EdmError(`unexpected ${tokens[i]!.value} in $filter`);
  return node;
}

export function matches(node: Node, entity: Entity, fields: Fields): boolean {
  if (node.kind === "and") return matches(node.left, entity, fields) && matches(node.right, entity, fields);
  if (!(node.field in fields)) throw new EdmError(`unknown property ${node.field}`);
  const actual = entity[node.field] ?? null;
  const want = node.value;
  if (node.op === "eq") return actual === want;
  if (node.op === "ne") return actual !== want;
  if (actual === null || want === null) return false;
  const a = actual as number | string;
  const b = want as number | string;
  switch (node.op) {
    case "gt":
      return a > b;
    case "ge":
      return a >= b;
    case "lt":
      return a < b;
    default:
      return a <= b;
  }
}
