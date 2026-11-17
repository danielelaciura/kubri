"use client";

// Stato della demo: tutto in memoria, salvato in sessionStorage per sopravvivere
// a un ricaricamento della pagina. "Ricomincia la demo" riporta ai dati iniziali.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  ASSOCIATIONS,
  DEMO_ASSOCIATION_ID,
  DEMO_OFFER_TEMPLATE,
  SEED_APPEAL_RESPONSES,
  SEED_CANDIDATES,
  SEED_NOTIFICATIONS,
  SEED_OFFERS,
  SEED_PROPOSALS,
} from "./data";
import { sectorOf } from "./format";
import { associationsFor, matchesFor } from "./matching";
import type {
  AppNotification,
  AppealResponse,
  ApplicationStatus,
  Candidate,
  Offer,
  Proposal,
} from "./types";

interface DemoState {
  offers: Offer[];
  candidates: Candidate[];
  proposals: Proposal[];
  appealResponses: AppealResponse[];
  notifications: AppNotification[];
  tourStep: number | null;
}

const initialState = (): DemoState => ({
  offers: SEED_OFFERS,
  candidates: SEED_CANDIDATES,
  proposals: SEED_PROPOSALS,
  appealResponses: SEED_APPEAL_RESPONSES,
  notifications: SEED_NOTIFICATIONS,
  tourStep: null,
});

const STORAGE_KEY = "kubri-apl-demo-v2";

export type OfferDraft = Omit<Offer, "id" | "status" | "publishedAt">;

interface DemoApi extends DemoState {
  publishOffer: (draft: OfferDraft) => string;
  markAppealSeen: (offerId: string, associationId: string) => void;
  sendCandidates: (offerId: string, associationId: string, candidateIds: string[], addedIds: string[]) => void;
  addCandidate: (c: Omit<Candidate, "id" | "addedAt">) => string;
  setStatus: (offerId: string, candidateId: string, status: ApplicationStatus) => void;
  markNotificationsRead: (audience: AppNotification["audience"]) => void;
  setTourStep: (step: number | null) => void;
  ensureDemoOffer: () => string;
  ensureDemoProposals: (offerId: string) => void;
  reset: () => void;
}

const DemoContext = createContext<DemoApi | null>(null);

let counter = 0;
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DemoState>(initialState);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw) as DemoState);
    } catch {
      // storage non disponibile: si parte dai dati iniziali
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignorato: la demo funziona anche senza persistenza
    }
  }, [state, ready]);

  const publishOffer = useCallback((draft: OfferDraft) => {
    const offer: Offer = { ...draft, id: newId("o"), status: "pubblicata", publishedAt: new Date().toISOString() };
    setState((s) => {
      const matches = matchesFor(offer, s.candidates);
      const involved = associationsFor(offer, matches, ASSOCIATIONS, sectorOf(offer.skills));
      const now = new Date().toISOString();
      return {
        ...s,
        offers: [offer, ...s.offers],
        appealResponses: [
          ...s.appealResponses,
          ...involved.map((x) => ({ offerId: offer.id, associationId: x.association.id, state: "notificata" as const })),
        ],
        notifications: [
          ...involved.map((x) => ({
            id: newId("n"),
            audience: "associazione" as const,
            associationId: x.association.id,
            text:
              x.compatible > 0
                ? `Nuovo appello: ${offer.positions} × ${offer.title} a ${offer.city}. Hai ${x.compatible} candidati compatibili.`
                : `Nuovo appello: ${offer.positions} × ${offer.title} a ${offer.city}. Hai profili adatti?`,
            href: `/associazione/appello?id=${offer.id}`,
            at: now,
            read: false,
          })),
          ...s.notifications,
        ],
      };
    });
    return offer.id;
  }, []);

  const markAppealSeen = useCallback((offerId: string, associationId: string) => {
    setState((s) => ({
      ...s,
      appealResponses: s.appealResponses.map((r) =>
        r.offerId === offerId && r.associationId === associationId && r.state === "notificata"
          ? { ...r, state: "vista" }
          : r,
      ),
    }));
  }, []);

  const sendCandidates = useCallback(
    (offerId: string, associationId: string, candidateIds: string[], addedIds: string[]) => {
      setState((s) => {
        const offer = s.offers.find((o) => o.id === offerId);
        const assoc = ASSOCIATIONS.find((a) => a.id === associationId);
        const fresh = candidateIds.filter(
          (id) => !s.proposals.some((p) => p.offerId === offerId && p.candidateId === id),
        );
        if (fresh.length === 0) return s;
        const now = new Date().toISOString();
        const hasResponse = s.appealResponses.some((r) => r.offerId === offerId && r.associationId === associationId);
        return {
          ...s,
          proposals: [
            ...s.proposals,
            ...fresh.map((candidateId) => ({
              offerId,
              candidateId,
              associationId,
              status: "proposto" as const,
              sentAt: now,
              addedForAppeal: addedIds.includes(candidateId),
            })),
          ],
          appealResponses: hasResponse
            ? s.appealResponses.map((r) =>
                r.offerId === offerId && r.associationId === associationId ? { ...r, state: "ha_risposto" } : r,
              )
            : [...s.appealResponses, { offerId, associationId, state: "ha_risposto" }],
          notifications: [
            {
              id: newId("n"),
              audience: "agenzia",
              text: `${assoc?.name ?? "Un'associazione"} ha proposto ${fresh.length} ${fresh.length === 1 ? "candidato" : "candidati"} per «${offer?.title ?? "l'offerta"}»`,
              href: `/agenzia/offerta?id=${offerId}&tab=proposti`,
              at: now,
              read: false,
            },
            ...s.notifications,
          ],
        };
      });
    },
    [],
  );

  const addCandidate = useCallback((c: Omit<Candidate, "id" | "addedAt">) => {
    const id = newId("c");
    setState((s) => ({ ...s, candidates: [...s.candidates, { ...c, id, addedAt: new Date().toISOString() }] }));
    return id;
  }, []);

  const setStatus = useCallback((offerId: string, candidateId: string, status: ApplicationStatus) => {
    setState((s) => ({
      ...s,
      proposals: s.proposals.map((p) =>
        p.offerId === offerId && p.candidateId === candidateId ? { ...p, status } : p,
      ),
    }));
  }, []);

  const markNotificationsRead = useCallback((audience: AppNotification["audience"]) => {
    setState((s) => ({
      ...s,
      notifications: s.notifications.map((n) => (n.audience === audience ? { ...n, read: true } : n)),
    }));
  }, []);

  const setTourStep = useCallback((tourStep: number | null) => setState((s) => ({ ...s, tourStep })), []);

  const ensureDemoOffer = useCallback((): string => {
    const existing = state.offers.find(
      (o) => o.title === DEMO_OFFER_TEMPLATE.title && o.clientCompany === DEMO_OFFER_TEMPLATE.clientCompany,
    );
    return existing ? existing.id : publishOffer(DEMO_OFFER_TEMPLATE);
  }, [state.offers, publishOffer]);

  const ensureDemoProposals = useCallback(
    (offerId: string) => {
      if (state.proposals.some((p) => p.offerId === offerId && p.associationId === DEMO_ASSOCIATION_ID)) return;
      const offer = state.offers.find((o) => o.id === offerId);
      if (!offer) return;
      const own = state.candidates.filter((c) => c.associationId === DEMO_ASSOCIATION_ID);
      const top = matchesFor(offer, own).slice(0, 2).map((m) => m.candidate.id);
      sendCandidates(offerId, DEMO_ASSOCIATION_ID, top, []);
    },
    [state.proposals, state.offers, state.candidates, sendCandidates],
  );

  const reset = useCallback(() => setState(initialState()), []);

  const api = useMemo<DemoApi>(
    () => ({
      ...state,
      publishOffer,
      markAppealSeen,
      sendCandidates,
      addCandidate,
      setStatus,
      markNotificationsRead,
      setTourStep,
      ensureDemoOffer,
      ensureDemoProposals,
      reset,
    }),
    [state, publishOffer, markAppealSeen, sendCandidates, addCandidate, setStatus, markNotificationsRead, setTourStep, ensureDemoOffer, ensureDemoProposals, reset],
  );

  // Si rende solo dopo aver letto lo stato salvato: evita differenze tra HTML
  // statico e browser (date relative, parametri dell'URL).
  if (!ready) return <div className="min-h-dvh bg-[var(--surface)]" />;
  return <DemoContext.Provider value={api}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoApi {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemo deve stare dentro <DemoProvider>");
  return ctx;
}

/** Il profilo è visibile per intero all'agenzia solo se un'associazione l'ha inviato. */
export function useIsShared() {
  const { proposals } = useDemo();
  return useCallback((candidateId: string) => proposals.some((p) => p.candidateId === candidateId), [proposals]);
}
