import { DOMAIN_LABELS, type AssessmentReport, type DomainId } from "@kubri/contracts";

/** Map canvas (matches the SVG viewBox used by the PDF component). */
export const CANVAS_W = 720;
export const CANVAS_H = 360;
export const MAX_LEAVES_PER_DOMAIN = 6;

const CENTER = { x: CANVAS_W / 2, y: CANVAS_H / 2 };
const DOMAIN_RADIUS = 130; // distance center → domain node
const LEAF_RADIUS = 70; // distance domain node → its leaves

export type LeafNode = { name: string; x: number; y: number };
export type DomainNode = { id: DomainId; label: string; x: number; y: number; leaves: LeafNode[] };
export type Edge = { x1: number; y1: number; x2: number; y2: number };
export type ReportLayout = {
  center: { x: number; y: number };
  domains: DomainNode[];
  edges: Edge[];
};

/**
 * Radial layout: domains evenly around the center; each domain's leaves fanned
 * on a short outward arc. Pure — no I/O. Leaves beyond MAX_LEAVES_PER_DOMAIN are
 * dropped from the map (they still appear in the table).
 */
export function computeReportLayout(domains: AssessmentReport["domains"]): ReportLayout {
  const n = domains.length;
  const out: DomainNode[] = [];
  const edges: Edge[] = [];

  domains.forEach((d, i) => {
    // Spread domains around the circle, starting at the top (-90°).
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const dx = CENTER.x + DOMAIN_RADIUS * Math.cos(angle);
    const dy = CENTER.y + DOMAIN_RADIUS * Math.sin(angle);
    edges.push({ x1: CENTER.x, y1: CENTER.y, x2: dx, y2: dy });

    const shown = d.competences.slice(0, MAX_LEAVES_PER_DOMAIN);
    const leaves: LeafNode[] = shown.map((c, j) => {
      // Fan leaves outward around the domain's own angle.
      const spread = Math.PI / 3; // 60° fan
      const t = shown.length === 1 ? 0 : (j / (shown.length - 1) - 0.5) * spread;
      const a = angle + t;
      return { name: c.name, x: dx + LEAF_RADIUS * Math.cos(a), y: dy + LEAF_RADIUS * Math.sin(a) };
    });

    out.push({ id: d.id, label: DOMAIN_LABELS[d.id], x: dx, y: dy, leaves });
  });

  return { center: { ...CENTER }, domains: out, edges };
}
