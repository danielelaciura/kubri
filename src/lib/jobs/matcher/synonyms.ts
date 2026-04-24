import { stem } from "./tokens";

const RAW_GROUPS: string[][] = [
  ["cameriere", "cameriera", "waiter", "waitress", "server"],
  ["barista", "bartender", "barman", "barwoman"],
  ["cuoco", "cuoca", "chef", "cook", "kitchen"],
  ["lavapiatti", "dishwasher"],
  ["pulizie", "pulizia", "pulire", "cleaning", "cleaner", "addetto", "addetta"],
  ["magazziniere", "magazziniera", "warehouse", "magazzino", "stockroom"],
  ["mulettista", "forklift"],
  ["receptionist", "reception", "accoglienza"],
  ["autista", "driver", "conducente"],
  ["operatore", "operator", "staff", "personale"],
  ["vendita", "sales", "commesso", "commessa", "shop"],
  ["manutenzione", "maintenance"],
  ["edile", "edilizia", "construction", "muratore"],
  ["giardinaggio", "giardiniere", "gardening", "gardener"],
  ["badante", "caregiver"],
  ["infermiere", "infermiera", "nurse", "nursing"],
  ["sicurezza", "security", "vigilante", "guardia"],
  ["logistica", "logistics"],
  ["cucina", "cucinare", "cooking"],
];

const groups: Set<string>[] = RAW_GROUPS.map((g) => new Set(g.map(stem)));
const stemToGroup = new Map<string, Set<string>>();
for (const g of groups) {
  for (const s of g) stemToGroup.set(s, g);
}

export function expandTokens(stems: Set<string>): Set<string> {
  const out = new Set(stems);
  for (const s of stems) {
    const g = stemToGroup.get(s);
    if (g) for (const t of g) out.add(t);
  }
  return out;
}
