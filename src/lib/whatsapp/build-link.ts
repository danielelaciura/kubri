export type PoolForWaLink = {
  isGlobal: boolean;
  externalKey: string | null;
  slug: string;
};

export function buildWaMessage(
  pool: PoolForWaLink,
  template: string,
): string {
  const prefix = pool.isGlobal ? "" : `[${pool.externalKey ?? pool.slug}] `;
  return `${prefix}${template}`;
}

export function buildWaLink(
  pool: PoolForWaLink,
  number: string,
  template: string,
): string {
  const text = buildWaMessage(pool, template);
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
