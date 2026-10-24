import { resolveTransition, stepOutcomes } from "../flow";
import { issue, type CampaignIssue } from "../issues";
import type { CampaignDefinition } from "../schema/campaign";

/** Edges between step ids. Special targets (@stop, @end) and self-loops are left out. */
export function flowEdges(c: CampaignDefinition): Map<string, Set<string>> {
  const ids = new Set(c.flow.map((step) => step.id));
  const edges = new Map<string, Set<string>>();

  c.flow.forEach((step, i) => {
    const nextId = c.flow[i + 1]?.id;
    const targets = new Set<string>();
    for (const outcome of stepOutcomes(step)) {
      targets.add(resolveTransition(step, outcome, nextId).target);
    }
    // A step whose `when` is false is skipped: the next step is reachable from here too.
    if (step.when && nextId) targets.add(nextId);
    targets.delete(step.id);
    edges.set(step.id, new Set([...targets].filter((t) => ids.has(t))));
  });

  return edges;
}

export function checkGraph(c: CampaignDefinition): CampaignIssue[] {
  const first = c.flow[0];
  if (!first) return [];
  const edges = flowEdges(c);
  const indexOf = new Map(c.flow.map((step, i) => [step.id, i]));
  const issues: CampaignIssue[] = [];

  // Reachability (breadth-first from the first step).
  const reached = new Set([first.id]);
  const queue = [first.id];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const next of edges.get(id) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  c.flow.forEach((step, i) => {
    if (!reached.has(step.id)) {
      issues.push(
        issue(`flow[${i}]`, "unreachable_step", `Step "${step.id}" can never be reached`),
      );
    }
  });

  // Cycles (depth-first; an edge to a step still on the current path closes a cycle).
  const onPath = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string): void => {
    onPath.add(id);
    for (const next of edges.get(id) ?? []) {
      if (onPath.has(next)) {
        issues.push(
          issue(
            `flow[${indexOf.get(id) ?? -1}].on`,
            "cycle",
            `Step "${id}" leads back to "${next}": cycles are not allowed (use @repeat)`,
          ),
        );
      } else if (!done.has(next)) {
        visit(next);
      }
    }
    onPath.delete(id);
    done.add(id);
  };
  visit(first.id);

  return issues;
}
