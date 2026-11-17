// Dati dimostrativi. Nomi, aziende, associazioni e contatti sono inventati.
import type {
  AppNotification,
  AppealResponse,
  Association,
  Availability,
  Candidate,
  ItalianLevel,
  Offer,
  Proposal,
} from "./types";

export const AGENCY = {
  name: "Agenzia Demo",
  city: "Torino",
  userName: "Giulia Ferraris",
  userRole: "Recruiter",
};

/** L'associazione con cui si "entra" nella demo lato associazione. */
export const DEMO_ASSOCIATION_ID = "a1";

export const ASSOCIATIONS: Association[] = [
  {
    id: "a1",
    name: "Cooperativa Il Ponte",
    kind: "Cooperativa sociale",
    city: "Torino",
    province: "TO",
    sectors: ["Logistica", "Pulizie"],
    mode: "integrato",
    contactName: "Marco Bellini",
    contactEmail: "m.bellini@example.org",
    responseRate: 92,
    lastActivity: "oggi",
  },
  {
    id: "a2",
    name: "Associazione Lavoro e Dignità",
    kind: "Accompagnamento al lavoro",
    city: "Torino",
    province: "TO",
    sectors: ["Retail", "Logistica"],
    mode: "integrato",
    contactName: "Sara Conti",
    contactEmail: "s.conti@example.org",
    responseRate: 85,
    lastActivity: "ieri",
  },
  {
    id: "a3",
    name: "Cooperativa Nuovi Orizzonti",
    kind: "Cooperativa sociale",
    city: "Moncalieri",
    province: "TO",
    sectors: ["Ristorazione", "Pulizie"],
    mode: "integrato",
    contactName: "Luca Rinaldi",
    contactEmail: "l.rinaldi@example.org",
    responseRate: 78,
    lastActivity: "3 giorni fa",
  },
  {
    id: "a4",
    name: "Casa dell'Accoglienza",
    kind: "Centro di accoglienza",
    city: "Settimo Torinese",
    province: "TO",
    sectors: ["Logistica", "Ristorazione"],
    mode: "appelli",
    contactName: "Fatima Benali",
    contactEmail: "f.benali@example.org",
    responseRate: 70,
    lastActivity: "1 settimana fa",
  },
  {
    id: "a5",
    name: "Seconda Chance",
    kind: "Reinserimento persone detenute",
    city: "Torino",
    province: "TO",
    sectors: ["Logistica", "Front office"],
    mode: "appelli",
    contactName: "Paolo Gatti",
    contactEmail: "p.gatti@example.org",
    responseRate: 64,
    lastActivity: "2 giorni fa",
  },
  {
    id: "a6",
    name: "Rete Donne al Lavoro",
    kind: "Associazione di promozione sociale",
    city: "Collegno",
    province: "TO",
    sectors: ["Assistenza", "Pulizie", "Retail"],
    mode: "integrato",
    contactName: "Elena Moretti",
    contactEmail: "e.moretti@example.org",
    responseRate: 88,
    lastActivity: "oggi",
  },
];

interface SectorProfile {
  roles: string[];
  skills: string[];
  experience: string[];
}

export const SECTORS: Record<string, SectorProfile> = {
  Logistica: {
    roles: ["Addetto/a magazzino", "Mulettista", "Addetto/a carico e scarico"],
    skills: [
      "Carico e scarico merci",
      "Preparazione ordini",
      "Uso del transpallet",
      "Patentino muletto",
      "Lettore barcode",
      "Inventario",
    ],
    experience: [
      "Magazziniere in un centro di distribuzione alimentare",
      "Carico e scarico per un corriere espresso",
      "Preparazione ordini in un magazzino e-commerce",
      "Lavoro stagionale in un hub logistico",
    ],
  },
  Pulizie: {
    roles: ["Addetto/a pulizie"],
    skills: ["Pulizia uffici", "Sanificazione", "Uso macchinari pulizia", "Pulizie industriali"],
    experience: [
      "Pulizie di uffici per un'impresa di servizi",
      "Sanificazione di ambienti sanitari",
      "Pulizie in strutture ricettive",
    ],
  },
  Ristorazione: {
    roles: ["Aiuto cuoco", "Addetto/a sala", "Lavapiatti"],
    skills: ["Preparazione cibi", "Servizio ai tavoli", "HACCP", "Lavaggio stoviglie"],
    experience: [
      "Aiuto cuoco in una mensa aziendale",
      "Cameriere in un ristorante del centro",
      "Lavapiatti in un hotel",
    ],
  },
  Retail: {
    roles: ["Addetto/a vendite", "Scaffalista", "Cassiere/a"],
    skills: ["Rifornimento scaffali", "Cassa", "Assistenza clienti", "Inventario"],
    experience: [
      "Scaffalista in un supermercato",
      "Addetta alle vendite in un negozio di abbigliamento",
      "Cassiere in un discount",
    ],
  },
  "Front office": {
    roles: ["Addetto/a front office", "Receptionist"],
    skills: ["Accoglienza", "Pacchetto Office", "Gestione telefonate", "Archiviazione"],
    experience: ["Receptionist in un poliambulatorio", "Accoglienza in uno sportello comunale"],
  },
  Assistenza: {
    roles: ["Assistente familiare", "Operatore/trice socio-sanitario"],
    skills: ["Assistenza anziani", "Igiene della persona", "Preparazione pasti"],
    experience: ["Assistente familiare per una persona anziana", "Supporto in una RSA"],
  },
};

// --- Generatore deterministico: gli stessi candidati ad ogni caricamento ---

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261117);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
const pickSome = <T,>(list: readonly T[], min: number, max: number): T[] => {
  const n = Math.min(list.length, min + Math.floor(rand() * (max - min + 1)));
  return [...list].sort(() => rand() - 0.5).slice(0, n);
};

const FIRST_NAMES = [
  "Mohamed", "Aminata", "Ioana", "Oleksandr", "Rosa", "Karim", "Fatou", "Andrei", "Lucia", "Ibrahim",
  "Mariana", "Youssef", "Elena", "Samuel", "Nadia", "Bilal", "Grace", "Marco", "Svetlana", "Omar",
  "Joy", "Adrian", "Khadija", "Luis", "Anna", "Moussa", "Irina", "Hassan", "Blessing", "Giorgio",
  "Daniela", "Rahim", "Aisha", "Florin", "Carmen", "Abdou",
];
const LAST_NAMES = [
  "Diallo", "Popescu", "El Amrani", "Kovalenko", "Ferrari", "Traoré", "Ionescu", "Okafor", "Russo",
  "Benali", "Quispe", "Hossain", "Sarr", "Shevchenko", "Esposito", "Mensah", "Hoxha", "Rossi",
  "Mendoza", "Ndiaye", "Moldovan", "Rahman", "Bianchi", "Kone",
];
const CITIES = [
  "Torino", "Torino", "Torino", "Moncalieri", "Settimo Torinese", "Collegno", "Nichelino",
  "Rivoli", "Grugliasco", "Venaria Reale", "Chieri",
];
const LANGUAGES = ["Arabo", "Francese", "Inglese", "Rumeno", "Ucraino", "Spagnolo", "Wolof", "Bengalese", "Albanese"];
const AVAILABILITY: Availability[] = ["Immediata", "Immediata", "Entro 2 settimane", "Entro 1 mese"];
const ITALIAN: ItalianLevel[] = ["Base", "Base", "Intermedio", "Intermedio", "Avanzato"];
const LICENSES = ["Patente B", "Patentino muletto", "Attestato HACCP", "Attestato sicurezza base"];
const SOURCES: Candidate["source"][] = ["Chatbot WhatsApp", "Chatbot WhatsApp", "Caricamento database", "Inserito a mano"];

const PER_ASSOCIATION: Record<string, number> = { a1: 16, a2: 14, a3: 12, a4: 8, a5: 6, a6: 12 };

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function buildCandidates(): Candidate[] {
  const out: Candidate[] = [];
  const usedNames = new Set<string>();
  let i = 0;
  for (const assoc of ASSOCIATIONS) {
    const count = PER_ASSOCIATION[assoc.id] ?? 0;
    for (let k = 0; k < count; k++) {
      i++;
      const sectorName = assoc.sectors[k % assoc.sectors.length] as string;
      const sector = SECTORS[sectorName] as SectorProfile;
      let firstName = pick(FIRST_NAMES);
      let lastName = pick(LAST_NAMES);
      while (usedNames.has(`${firstName} ${lastName}`)) {
        firstName = pick(FIRST_NAMES);
        lastName = pick(LAST_NAMES);
      }
      usedNames.add(`${firstName} ${lastName}`);
      const years = Math.floor(rand() * 9);
      const licenses = pickSome(LICENSES, 0, 2);
      out.push({
        id: `c${i}`,
        firstName,
        lastName,
        age: 20 + Math.floor(rand() * 34),
        city: rand() < 0.45 ? assoc.city : pick(CITIES),
        associationId: assoc.id,
        roles: pickSome(sector.roles, 1, 2),
        skills: pickSome(sector.skills, 2, 4),
        experienceYears: years,
        experience: years === 0 ? "Nessuna esperienza formale; lavori informali e volontariato" : pick(sector.experience),
        availability: pick(AVAILABILITY),
        italian: pick(ITALIAN),
        languages: pickSome(LANGUAGES, 1, 2),
        licenses,
        phone: `+39 3${Math.floor(rand() * 90 + 10)} ${Math.floor(rand() * 900 + 100)} ${Math.floor(rand() * 9000 + 1000)}`,
        email: `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, "") + "@example.org",
        source: pick(SOURCES),
        addedAt: daysAgo(Math.floor(rand() * 90)),
      });
    }
  }
  return out;
}

export const SEED_CANDIDATES: Candidate[] = buildCandidates();

export const SEED_OFFERS: Offer[] = [
  {
    id: "o1",
    clientCompany: "Clean Service S.r.l.",
    title: "Addetto/a pulizie",
    description:
      "Pulizia e sanificazione di uffici e spazi comuni per clienti aziendali dell'area sud di Torino.",
    city: "Moncalieri",
    province: "TO",
    positions: 4,
    contract: "Tempo determinato, 3 mesi rinnovabili",
    schedule: "Part time, 6:00–10:00",
    skills: ["Pulizia uffici", "Sanificazione", "Uso macchinari pulizia"],
    requirements: "Puntualità, autonomia negli spostamenti.",
    italian: "Base",
    startBy: "Immediata",
    status: "pubblicata",
    publishedAt: daysAgo(5),
  },
  {
    id: "o2",
    clientCompany: "Mensa Gruppo Sole",
    title: "Aiuto cuoco",
    description: "Supporto alla cucina di una mensa aziendale da 400 pasti al giorno.",
    city: "Torino",
    province: "TO",
    positions: 2,
    contract: "Tempo indeterminato",
    schedule: "Full time, 7:00–15:00",
    skills: ["Preparazione cibi", "HACCP", "Lavaggio stoviglie"],
    requirements: "Attestato HACCP gradito.",
    italian: "Intermedio",
    startBy: "Entro 1 mese",
    status: "pubblicata",
    publishedAt: daysAgo(12),
  },
];

/** Offerta precompilata per la demo: l'agenzia la inserisce dal form "Nuova offerta". */
export const DEMO_OFFER_TEMPLATE: Omit<Offer, "id" | "status" | "publishedAt"> = {
  clientCompany: "LogiNord S.p.A.",
  title: "Addetto/a magazzino",
  description:
    "Ricevimento merci, preparazione degli ordini e organizzazione del magazzino in un polo logistico della grande distribuzione.",
  city: "Settimo Torinese",
  province: "TO",
  positions: 3,
  contract: "Tempo determinato, 6 mesi",
  schedule: "Full time su turni, 6:00–14:00 / 14:00–22:00",
  skills: ["Carico e scarico merci", "Preparazione ordini", "Uso del transpallet", "Lettore barcode"],
  requirements: "Disponibilità ai turni. Patentino muletto gradito.",
  italian: "Base",
  startBy: "Entro 2 settimane",
};

function seedProposals(): Proposal[] {
  const ofAssoc = (id: string, sector: string, n: number) =>
    SEED_CANDIDATES.filter(
      (c) => c.associationId === id && c.skills.some((s) => (SECTORS[sector]?.skills ?? []).includes(s)),
    ).slice(0, n);
  const list: Proposal[] = [];
  const add = (offerId: string, cands: Candidate[], statuses: Proposal["status"][], days: number) =>
    cands.forEach((c, idx) =>
      list.push({
        offerId,
        candidateId: c.id,
        associationId: c.associationId,
        status: statuses[idx % statuses.length] as Proposal["status"],
        sentAt: daysAgo(days),
        addedForAppeal: false,
      }),
    );
  add("o1", ofAssoc("a1", "Pulizie", 2), ["in_valutazione", "proposto"], 3);
  add("o1", ofAssoc("a3", "Pulizie", 2), ["presentato", "proposto"], 4);
  add("o1", ofAssoc("a6", "Pulizie", 1), ["proposto"], 1);
  add("o2", ofAssoc("a3", "Ristorazione", 3), ["assunto", "colloquio", "non_selezionato"], 10);
  add("o2", ofAssoc("a4", "Ristorazione", 1), ["presentato"], 9);
  return list;
}

export const SEED_PROPOSALS: Proposal[] = seedProposals();

export const SEED_APPEAL_RESPONSES: AppealResponse[] = [
  { offerId: "o1", associationId: "a1", state: "ha_risposto" },
  { offerId: "o1", associationId: "a3", state: "ha_risposto" },
  { offerId: "o1", associationId: "a6", state: "ha_risposto" },
  { offerId: "o1", associationId: "a2", state: "vista" },
  { offerId: "o2", associationId: "a3", state: "ha_risposto" },
  { offerId: "o2", associationId: "a4", state: "ha_risposto" },
  { offerId: "o2", associationId: "a5", state: "notificata" },
];

export const SEED_NOTIFICATIONS: AppNotification[] = [
  {
    id: "n1",
    audience: "agenzia",
    text: "Rete Donne al Lavoro ha proposto 1 candidato per «Addetto/a pulizie»",
    href: "/agenzia/offerta?id=o1&tab=proposti",
    at: daysAgo(1),
    read: false,
  },
  {
    id: "n2",
    audience: "agenzia",
    text: "Cooperativa Il Ponte ha proposto 2 candidati per «Addetto/a pulizie»",
    href: "/agenzia/offerta?id=o1&tab=proposti",
    at: daysAgo(3),
    read: true,
  },
  {
    id: "n3",
    audience: "associazione",
    associationId: "a1",
    text: "Un tuo candidato per «Addetto/a pulizie» è in valutazione dall'agenzia",
    href: "/associazione/appello?id=o1",
    at: daysAgo(2),
    read: true,
  },
];
