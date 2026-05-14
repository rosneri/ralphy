/**
 * Minimal template engine: variables, if/endif, for/endfor, and a `join` filter.
 *   {{ var.path }}
 *   {{ list | join(", ") }}
 *   {% if cond %}…{% endif %}
 *   {% for x in list %}…{% endfor %}
 *
 * Missing variables render as the empty string. Conditionals treat
 * undefined/null/false/0/empty as falsy.
 */

type Ctx = Record<string, unknown>;

function lookup(ctx: Ctx, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function isTruthy(v: unknown): boolean {
  if (v == null) return false;
  if (v === false || v === 0 || v === "") return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

function applyJoin(value: unknown, sep: string): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(sep);
  return value == null ? "" : String(value);
}

/** Evaluate a simple expression: identifier, comparison, or join filter. */
function evalExpr(expr: string, ctx: Ctx): unknown {
  const trimmed = expr.trim();
  // `a | join(", ")` filter
  const pipe = trimmed.match(/^(.+?)\s*\|\s*join\((["'])(.*?)\2\)\s*$/);
  if (pipe) {
    const inner = evalExpr(pipe[1]!, ctx);
    return applyJoin(inner, pipe[3]!);
  }
  // Comparisons
  const cmp = trimmed.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (cmp) {
    const lhs = evalExpr(cmp[1]!, ctx);
    const rhs = evalExpr(cmp[3]!, ctx);
    const a = lhs as number;
    const b = rhs as number;
    switch (cmp[2]) {
      case "==":
        return lhs === rhs;
      case "!=":
        return lhs !== rhs;
      case ">":
        return a > b;
      case "<":
        return a < b;
      case ">=":
        return a >= b;
      case "<=":
        return a <= b;
    }
  }
  // String literal
  const str = trimmed.match(/^(["'])(.*)\1$/);
  if (str) return str[2];
  // Number literal
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  // Boolean / null
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  // Variable lookup
  return lookup(ctx, trimmed);
}

type Node =
  | { kind: "text"; text: string }
  | { kind: "var"; expr: string }
  | { kind: "if"; expr: string; body: Node[]; elseBody?: Node[] }
  | { kind: "for"; varName: string; expr: string; body: Node[] };

interface TokenText {
  kind: "text";
  text: string;
}
interface TokenTag {
  kind: "tag";
  inner: string;
}
interface TokenVar {
  kind: "var";
  inner: string;
}
type Token = TokenText | TokenTag | TokenVar;

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const re = /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})/g;
  let last = 0;
  for (const m of src.matchAll(re)) {
    const start = m.index!;
    if (start > last) tokens.push({ kind: "text", text: src.slice(last, start) });
    const chunk = m[0]!;
    if (chunk.startsWith("{{")) {
      tokens.push({ kind: "var", inner: chunk.slice(2, -2).trim() });
    } else {
      tokens.push({ kind: "tag", inner: chunk.slice(2, -2).trim() });
    }
    last = start + chunk.length;
  }
  if (last < src.length) tokens.push({ kind: "text", text: src.slice(last) });
  return tokens;
}

function parse(tokens: Token[]): Node[] {
  let i = 0;
  function parseBlock(stopAt: (inner: string) => boolean): Node[] {
    const nodes: Node[] = [];
    while (i < tokens.length) {
      const t = tokens[i]!;
      if (t.kind === "text") {
        nodes.push({ kind: "text", text: t.text });
        i++;
      } else if (t.kind === "var") {
        nodes.push({ kind: "var", expr: t.inner });
        i++;
      } else {
        const inner = t.inner;
        if (stopAt(inner)) return nodes;
        if (inner.startsWith("if ")) {
          i++;
          const expr = inner.slice(3).trim();
          const body = parseBlock((x) => x === "endif" || x === "else");
          let elseBody: Node[] | undefined;
          const closing = tokens[i];
          if (closing && closing.kind === "tag" && closing.inner === "else") {
            i++;
            elseBody = parseBlock((x) => x === "endif");
          }
          i++; // consume endif
          const node: Node = { kind: "if", expr, body };
          if (elseBody !== undefined) node.elseBody = elseBody;
          nodes.push(node);
        } else if (inner.startsWith("for ")) {
          i++;
          const m = inner.match(/^for\s+(\w+)\s+in\s+(.+)$/);
          if (!m) throw new Error(`Bad for-tag: {% ${inner} %}`);
          const body = parseBlock((x) => x === "endfor");
          i++; // consume endfor
          nodes.push({ kind: "for", varName: m[1]!, expr: m[2]!.trim(), body });
        } else {
          throw new Error(`Unknown tag: {% ${inner} %}`);
        }
      }
    }
    return nodes;
  }
  return parseBlock(() => false);
}

function renderNodes(nodes: Node[], ctx: Ctx): string {
  let out = "";
  for (const n of nodes) {
    if (n.kind === "text") {
      out += n.text;
    } else if (n.kind === "var") {
      const v = evalExpr(n.expr, ctx);
      out += v == null ? "" : String(v);
    } else if (n.kind === "if") {
      const cond = evalExpr(n.expr, ctx);
      if (isTruthy(cond)) out += renderNodes(n.body, ctx);
      else if (n.elseBody) out += renderNodes(n.elseBody, ctx);
    } else if (n.kind === "for") {
      const list = evalExpr(n.expr, ctx);
      if (Array.isArray(list)) {
        for (const item of list) {
          out += renderNodes(n.body, { ...ctx, [n.varName]: item });
        }
      }
    }
  }
  return out;
}

export function renderTemplate(src: string, ctx: Ctx): string {
  const tokens = tokenize(src);
  const tree = parse(tokens);
  return renderNodes(tree, ctx);
}
