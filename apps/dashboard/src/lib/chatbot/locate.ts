import type { ChatbotCandidateData } from "@kubri/contracts";
import { geocodeFreeText } from "@/lib/geo/geocode-text";
import type { ChatbotCandidateGeo } from "@/lib/chatbot/normalize";

/** What the dashboard already stored for this candidate. */
export interface StoredChatbotPlace {
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  /** The previous payload, to read the address and location the candidate declared. */
  rawPayload: unknown;
}

function declaredText(raw: unknown, field: "address" | "location"): string | null {
  if (!raw || typeof raw !== "object") return null;
  const data = (raw as Record<string, unknown>)["data"];
  if (!data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

/**
 * Where the candidate lives. The stored coordinates are reused when the declared address and
 * location did not change (no Google call on every profile update); otherwise
 * "<address>, <location>" is geocoded (Google, ISTAT fallback). Null when there is nothing to
 * geocode or nothing matches: the candidate is written anyway, without coordinates.
 */
export async function locateChatbotCandidate(
  data: Pick<ChatbotCandidateData, "address" | "location">,
  stored: StoredChatbotPlace | null,
): Promise<ChatbotCandidateGeo | null> {
  const address = data.address ?? null;
  const location = data.location ?? null;
  if (!address && !location) return null;

  if (
    stored &&
    stored.latitude != null &&
    stored.longitude != null &&
    declaredText(stored.rawPayload, "address") === address &&
    declaredText(stored.rawPayload, "location") === location
  ) {
    return { latitude: stored.latitude, longitude: stored.longitude, location: stored.location };
  }

  const place = await geocodeFreeText([address, location].filter(Boolean).join(", "));
  return place
    ? { latitude: place.latitude, longitude: place.longitude, location: place.location || null }
    : null;
}
