"use client";

import { DEMO_ASSOCIATION_ID } from "./data";
import { matchesFor } from "./matching";
import { useDemo } from "./store";
import type { AppealResponse, Match, Offer } from "./types";

export interface AppealView {
  offer: Offer;
  response: AppealResponse;
  suggestions: Match[];
  sent: number;
}

/** Gli appelli ricevuti dall'associazione della demo, con i suoi candidati compatibili. */
export function useMyAppeals(): AppealView[] {
  const { offers, candidates, proposals, appealResponses } = useDemo();
  const own = candidates.filter((c) => c.associationId === DEMO_ASSOCIATION_ID);
  return appealResponses
    .filter((r) => r.associationId === DEMO_ASSOCIATION_ID)
    .map((response) => {
      const offer = offers.find((o) => o.id === response.offerId);
      if (!offer) return null;
      return {
        offer,
        response,
        suggestions: matchesFor(offer, own),
        sent: proposals.filter((p) => p.offerId === offer.id && p.associationId === DEMO_ASSOCIATION_ID).length,
      };
    })
    .filter((x): x is AppealView => x !== null)
    .sort((a, b) => b.offer.publishedAt.localeCompare(a.offer.publishedAt));
}
