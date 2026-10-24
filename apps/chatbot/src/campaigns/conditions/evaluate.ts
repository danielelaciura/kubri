import type { Condition, Scalar } from "../schema/conditions";

export interface ConditionContext {
  /** Profile values keyed by field ref ("firstName", "custom.x"). */
  readonly values: Readonly<Record<string, unknown>>;
  /** Outcome of each completed step, keyed by step id. */
  readonly outcomes: Readonly<Record<string, string>>;
}

export function evaluateCondition(c: Condition, ctx: ConditionContext): boolean {
  if ("all" in c) return c.all.every((inner) => evaluateCondition(inner, ctx));
  if ("any" in c) return c.any.some((inner) => evaluateCondition(inner, ctx));
  if ("not" in c) return !evaluateCondition(c.not, ctx);
  if ("step" in c) return ctx.outcomes[c.step] === c.outcome;

  const value = ctx.values[c.field];
  if ("exists" in c) return isPresent(value);
  if ("notExists" in c) return !isPresent(value);
  if (!isPresent(value)) return "neq" in c || "notIn" in c;
  if ("eq" in c) return matches(value, c.eq);
  if ("neq" in c) return !matches(value, c.neq);
  if ("in" in c) return c.in.some((expected) => matches(value, expected));
  if ("notIn" in c) return !c.notIn.some((expected) => matches(value, expected));
  if ("gt" in c) return typeof value === "number" && value > c.gt;
  return typeof value === "number" && value < c.lt;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
}

function matches(value: unknown, expected: Scalar): boolean {
  return Array.isArray(value) ? value.includes(expected) : value === expected;
}

export interface ConditionRefs {
  fields: string[];
  outcomes: { step: string; outcome: string }[];
}

export function conditionRefs(c: Condition): ConditionRefs {
  const refs: ConditionRefs = { fields: [], outcomes: [] };
  collect(c, refs);
  return refs;
}

function collect(c: Condition, refs: ConditionRefs): void {
  if ("all" in c)
    c.all.forEach((inner) => {
      collect(inner, refs);
    });
  else if ("any" in c)
    c.any.forEach((inner) => {
      collect(inner, refs);
    });
  else if ("not" in c) collect(c.not, refs);
  else if ("step" in c) refs.outcomes.push({ step: c.step, outcome: c.outcome });
  else refs.fields.push(c.field);
}
