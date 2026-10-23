import type { ObjectRow } from './api'

/**
 * A small query language over everything read:
 *   present-value > 55
 *   status-flags has fault or reliability != no-fault-detected
 *   type = analog-input and units = no-units
 *   "(Siemens) Input/Output address [3019]" is set     ([3019] works as a shorthand)
 * and/or/not, parentheses, quotes for names or values with spaces. Case doesn't matter.
 */

export type Op = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | '!contains' | 'has' | 'set' | 'missing' | 'unreadable'
export type Cond = { prop: string; op: Op; value: string }
export type Node = { type: 'and' | 'or'; items: Node[] } | { type: 'not'; item: Node } | { type: 'cond'; cond: Cond }

export const OP_LABEL: Record<Op, string> = {
  '=': '=',
  '!=': '≠',
  '>': '>',
  '>=': '≥',
  '<': '<',
  '<=': '≤',
  contains: 'contains',
  '!contains': 'does not contain',
  has: 'has',
  set: 'is set',
  missing: 'is missing',
  unreadable: 'is unreadable',
}
export const UNARY: Op[] = ['set', 'missing', 'unreadable']

const ALIASES: Record<string, string> = {
  pv: 'present-value',
  value: 'present-value',
  name: 'object-name',
  type: 'Object type',
  instance: 'Instance',
  device: 'Device',
  'device-name': 'Device name',
  desc: 'description',
  flags: 'status-flags',
  oos: 'out-of-service',
  status: 'Read status',
}

export class QueryError extends Error {}

// ---- tokenizer --------------------------------------------------------------------------------

type Tok = { kind: 'word' | 'str' | 'op' | 'lp' | 'rp'; text: string; pos: number }
const OPS = ['>=', '<=', '!=', '<>', '==', '!~', '=', '>', '<', '~']

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '(' || c === ')') {
      out.push({ kind: c === '(' ? 'lp' : 'rp', text: c, pos: i })
      i++
      continue
    }
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1)
      if (end === -1) throw new QueryError(`A quote opened at character ${i + 1} is never closed.`)
      out.push({ kind: 'str', text: src.slice(i + 1, end), pos: i })
      i = end + 1
      continue
    }
    if (c === '&' && src[i + 1] === '&') {
      out.push({ kind: 'word', text: 'and', pos: i })
      i += 2
      continue
    }
    if (c === '|' && src[i + 1] === '|') {
      out.push({ kind: 'word', text: 'or', pos: i })
      i += 2
      continue
    }
    // a value right after an operator runs to the next space, so T=2.3 or B=[11001][0,35] need no quotes
    const prev = out[out.length - 1]
    if (prev && (prev.kind === 'op' || (prev.kind === 'word' && /^(has|contains)$/i.test(prev.text)))) {
      let j = i
      while (j < src.length && !/[\s()]/.test(src[j])) j++
      out.push({ kind: 'word', text: src.slice(i, j), pos: i })
      i = j
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op) {
      out.push({ kind: 'op', text: op, pos: i })
      i += op.length
      continue
    }
    if (c === '[') {
      // vendor shorthand like [3019]
      const end = src.indexOf(']', i)
      if (end === -1) throw new QueryError(`A [ at character ${i + 1} is never closed.`)
      out.push({ kind: 'word', text: src.slice(i, end + 1), pos: i })
      i = end + 1
      continue
    }
    let j = i
    while (j < src.length && !/[\s()"'=<>!~&|]/.test(src[j])) j++
    out.push({ kind: 'word', text: src.slice(i, j), pos: i })
    i = j
  }
  return out
}

// ---- parser -----------------------------------------------------------------------------------

export function parse(src: string, props: string[]): Node | null {
  const toks = tokenize(src)
  if (!toks.length) return null
  let k = 0
  const peek = () => toks[k]
  const word = (t: Tok | undefined, w: string) => !!t && t.kind === 'word' && t.text.toLowerCase() === w

  const resolve = (name: string): string => {
    const lower = name.toLowerCase()
    if (ALIASES[lower]) return ALIASES[lower]
    const exact = props.find((p) => p.toLowerCase() === lower)
    if (exact) return exact
    if (/^\[\d+\]$/.test(name)) {
      const v = props.find((p) => p.endsWith(name))
      if (v) return v
    }
    const partial = props.filter((p) => p.toLowerCase().includes(lower))
    if (partial.length === 1) return partial[0]
    if (partial.length > 1) throw new QueryError(`"${name}" matches ${partial.length} properties, e.g. ${partial.slice(0, 3).join(', ')}. Be more specific.`)
    throw new QueryError(`No property called "${name}" was read.`)
  }

  const value = (): string => {
    const t = toks[k]
    if (!t || t.kind === 'lp' || t.kind === 'rp' || t.kind === 'op') throw new QueryError('A value is missing at the end of a condition.')
    k++
    return t.text
  }

  const cond = (): Node => {
    const t = toks[k]
    if (!t || (t.kind !== 'word' && t.kind !== 'str')) throw new QueryError(t ? `Expected a property at character ${t.pos + 1}.` : 'The query ends early.')
    k++
    const prop = resolve(t.text)
    const o = toks[k]
    if (!o) throw new QueryError(`"${t.text}" needs an operator, like = or > or has.`)
    if (o.kind === 'op') {
      k++
      const map: Record<string, Op> = { '=': '=', '==': '=', '!=': '!=', '<>': '!=', '>': '>', '>=': '>=', '<': '<', '<=': '<=', '~': 'contains', '!~': '!contains' }
      return { type: 'cond', cond: { prop, op: map[o.text], value: value() } }
    }
    const w = o.text.toLowerCase()
    if (w === 'contains' || w === 'has') {
      k++
      return { type: 'cond', cond: { prop, op: w as Op, value: value() } }
    }
    if (w === 'is') {
      k++
      let negate = false
      if (word(peek(), 'not')) {
        negate = true
        k++
      }
      const what = (toks[k]?.text ?? '').toLowerCase()
      k++
      const op: Op | null = what === 'set' ? 'set' : what === 'missing' ? 'missing' : what === 'unreadable' ? 'unreadable' : null
      const node: Node = op ? { type: 'cond', cond: { prop, op, value: '' } } : { type: 'cond', cond: { prop, op: '=', value: toks[k - 1]?.text ?? '' } }
      return negate ? { type: 'not', item: node } : node
    }
    throw new QueryError(`Unknown operator "${o.text}". Use =, !=, >, >=, <, <=, contains, has, or is set / is missing.`)
  }

  const atom = (): Node => {
    if (word(peek(), 'not')) {
      k++
      return { type: 'not', item: atom() }
    }
    if (peek()?.kind === 'lp') {
      k++
      const n = or()
      if (peek()?.kind !== 'rp') throw new QueryError('A bracket is opened but never closed.')
      k++
      return n
    }
    return cond()
  }
  const and = (): Node => {
    const items = [atom()]
    while (word(peek(), 'and')) {
      k++
      items.push(atom())
    }
    return items.length === 1 ? items[0] : { type: 'and', items }
  }
  const or = (): Node => {
    const items = [and()]
    while (word(peek(), 'or')) {
      k++
      items.push(and())
    }
    return items.length === 1 ? items[0] : { type: 'or', items }
  }

  const node = or()
  if (k < toks.length) throw new QueryError(`Unexpected "${toks[k].text}" at character ${toks[k].pos + 1}. Join conditions with and / or.`)
  return node
}

// ---- evaluation -------------------------------------------------------------------------------

export const num = (s: string): number | null => {
  const t = s.trim()
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null
  return Number(t)
}
const BOOL: Record<string, string> = { true: 'true', '1': 'true', active: 'true', false: 'false', '0': 'false', inactive: 'false' }

function test(row: ObjectRow, c: Cond): boolean {
  const raw = row.values[c.prop]
  if (c.op === 'unreadable') return row.errors[c.prop] !== undefined
  if (c.op === 'missing') return raw === undefined && row.errors[c.prop] === undefined
  if (c.op === 'set') return raw !== undefined && raw.trim() !== ''
  if (raw === undefined) return c.op === '!=' || c.op === '!contains'
  const a = raw.trim().toLowerCase()
  const b = c.value.trim().toLowerCase()
  const na = num(a)
  const nb = num(b)
  switch (c.op) {
    case '>':
    case '>=':
    case '<':
    case '<=': {
      if (na === null || nb === null) return false
      return c.op === '>' ? na > nb : c.op === '>=' ? na >= nb : c.op === '<' ? na < nb : na <= nb
    }
    case '=':
    case '!=': {
      let same = na !== null && nb !== null ? na === nb : a === b
      if (!same && BOOL[a] && BOOL[b]) same = BOOL[a] === BOOL[b]
      return c.op === '=' ? same : !same
    }
    case 'contains':
      return a.includes(b)
    case '!contains':
      return !a.includes(b)
    case 'has':
      return a.split(/[;,\s{}]+/).includes(b) || a.includes(b)
  }
  return false
}

export function evaluate(node: Node, row: ObjectRow): boolean {
  if (node.type === 'cond') return test(row, node.cond)
  if (node.type === 'not') return !evaluate(node.item, row)
  return node.type === 'and' ? node.items.every((n) => evaluate(n, row)) : node.items.some((n) => evaluate(n, row))
}

// ---- builder <-> text ---------------------------------------------------------------------------

const quote = (s: string) => (/^[\w.\-+[\]]+$/.test(s) ? s : `"${s.replace(/"/g, "'")}"`)

export function condText(c: Cond): string {
  if (c.op === 'set') return `${quote(c.prop)} is set`
  if (c.op === 'missing') return `${quote(c.prop)} is missing`
  if (c.op === 'unreadable') return `${quote(c.prop)} is unreadable`
  const op = c.op === 'contains' ? 'contains' : c.op === '!contains' ? '!~' : c.op === 'has' ? 'has' : c.op
  return `${quote(c.prop)} ${op} ${quote(c.value)}`
}

export function toText(conds: Cond[], join: 'and' | 'or'): string {
  return conds.map(condText).join(` ${join} `)
}

/** A flat list of conditions, if the query is simple enough to show as chips. */
export function toConds(node: Node | null): { conds: Cond[]; join: 'and' | 'or' } | null {
  if (!node) return { conds: [], join: 'and' }
  if (node.type === 'cond') return { conds: [node.cond], join: 'and' }
  if ((node.type === 'and' || node.type === 'or') && node.items.every((n) => n.type === 'cond')) {
    return { conds: node.items.map((n) => (n as { type: 'cond'; cond: Cond }).cond), join: node.type }
  }
  return null
}

/** Numeric if a fair share of its values are numbers. present-value mixes numbers with active/inactive and text. */
export function isNumericProp(rows: ObjectRow[], prop: string, share = 0.3): boolean {
  let n = 0
  let total = 0
  for (const r of rows) {
    const v = r.values[prop]
    if (v === undefined || v === '') continue
    total++
    if (num(v) !== null) n++
    if (total >= 200) break
  }
  return total > 0 && n / total >= share
}

export function distinctValues(rows: ObjectRow[], prop: string, limit = 12): { value: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const v = r.values[prop]
    if (v === undefined || v === '' || v.length > 60) continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count).slice(0, limit)
}
