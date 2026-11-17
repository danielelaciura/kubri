// Modello dati del prototipo. Tutto è finto e vive in memoria nel browser.

export type Availability = "Immediata" | "Entro 2 settimane" | "Entro 1 mese";
export type ItalianLevel = "Base" | "Intermedio" | "Avanzato";
export type ParticipationMode = "integrato" | "appelli";

export interface Association {
  id: string;
  name: string;
  kind: string;
  city: string;
  province: string;
  sectors: string[];
  mode: ParticipationMode;
  contactName: string;
  contactEmail: string;
  responseRate: number; // percentuale
  lastActivity: string; // testo relativo, es. "2 giorni fa"
}

export interface Candidate {
  id: string;
  firstName: string;
  lastName: string;
  age: number;
  city: string;
  associationId: string;
  roles: string[];
  skills: string[];
  experienceYears: number;
  experience: string;
  availability: Availability;
  italian: ItalianLevel;
  languages: string[];
  licenses: string[];
  phone: string;
  email: string;
  source: "Chatbot WhatsApp" | "Caricamento database" | "Inserito a mano";
  addedAt: string; // ISO date
}

export type OfferStatus = "pubblicata" | "chiusa";

export interface Offer {
  id: string;
  clientCompany: string;
  title: string;
  description: string;
  city: string;
  province: string;
  positions: number;
  contract: string;
  schedule: string;
  skills: string[];
  requirements: string;
  italian: ItalianLevel;
  startBy: string;
  status: OfferStatus;
  publishedAt: string; // ISO date
}

export type ApplicationStatus =
  | "proposto"
  | "in_valutazione"
  | "presentato"
  | "colloquio"
  | "assunto"
  | "non_selezionato";

export interface Proposal {
  offerId: string;
  candidateId: string;
  associationId: string;
  status: ApplicationStatus;
  sentAt: string; // ISO date
  addedForAppeal: boolean; // profilo aggiunto dall'associazione apposta per l'appello
}

export type AppealResponseState = "notificata" | "vista" | "ha_risposto";

export interface AppealResponse {
  offerId: string;
  associationId: string;
  state: AppealResponseState;
}

export interface AppNotification {
  id: string;
  audience: "agenzia" | "associazione";
  associationId?: string;
  text: string;
  href: string;
  at: string; // ISO date
  read: boolean;
}

export interface Match {
  candidate: Candidate;
  score: number;
  reasons: string[];
}
