/** One autocomplete option: an opaque place id and the text shown to the user. */
export interface PlaceSuggestion {
  placeId: string;
  label: string;
}

export type PlaceSource = "google" | "istat";

/** A place resolved server-side, ready to be written on a Candidate. */
export interface ResolvedPlace {
  placeId: string;
  source: PlaceSource;
  /** Full address (Google formatted address, or "Comune (PROV)" for ISTAT). */
  address: string;
  /** "Comune (PROV)". */
  location: string;
  latitude: number;
  longitude: number;
}
