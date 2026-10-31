import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { getDictionary } from "@/lib/i18n";
import { searchLandingPlacesAction } from "@/app/(public)/candidati/[slug]/actions";
import { PlaceField, newSessionToken, type PlaceSelection } from "@/components/landing/place-field";

vi.mock("@/app/(public)/candidati/[slug]/actions", () => ({ searchLandingPlacesAction: vi.fn() }));

const t = getDictionary("it").landing;
const OPTIONS = [
  { placeId: "p1", label: "Via Roma, Milano, MI, Italia" },
  { placeId: "p2", label: "Via Roma, Torino, TO, Italia" },
];

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type SearchResult = Awaited<ReturnType<typeof searchLandingPlacesAction>>;

function deferred() {
  let resolve!: (r: SearchResult) => void;
  const promise = new Promise<SearchResult>((r) => (resolve = r));
  return { promise, resolve };
}

const tokenOf = (call: number) =>
  (vi.mocked(searchLandingPlacesAction).mock.calls[call]![1] as { sessionToken: string }).sessionToken;

function setup(value: PlaceSelection | null = null) {
  const onChange = vi.fn();
  render(
    <I18nProvider locale="it">
      <PlaceField slug="coop-sole" value={value} onChange={onChange} describedBy="hint" />
    </I18nProvider>,
  );
  return { onChange, input: screen.getByRole("combobox") };
}

async function typeAndWait(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(searchLandingPlacesAction).mockResolvedValue({ ok: true, data: OPTIONS });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("PlaceField", () => {
  it("shows the prefilled label", () => {
    const { input } = setup({ placeId: "p1", label: "Via Roma, Milano, MI, Italia" });
    expect(input).toHaveValue("Via Roma, Milano, MI, Italia");
  });

  it("searches after the debounce with a session token and selects with the mouse", async () => {
    const { input, onChange } = setup();
    await typeAndWait(input, "via roma");
    expect(searchLandingPlacesAction).toHaveBeenCalledTimes(1);
    const [slug, arg] = vi.mocked(searchLandingPlacesAction).mock.calls[0]!;
    expect(slug).toBe("coop-sole");
    expect(arg).toMatchObject({ query: "via roma" });
    expect((arg as { sessionToken: string }).sessionToken).toMatch(/^[0-9a-f-]{36}$/);
    fireEvent.mouseDown(screen.getByRole("option", { name: OPTIONS[1]!.label }));
    expect(onChange).toHaveBeenLastCalledWith({ ...OPTIONS[1], sessionToken: (arg as { sessionToken: string }).sessionToken });
    expect(input).toHaveValue(OPTIONS[1]!.label);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("supports keyboard selection", async () => {
    const { input, onChange } = setup();
    await typeAndWait(input, "via roma");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", "landing-place-option-0");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", "landing-place-option-1");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ placeId: "p2" }));
  });

  it("does not search under 3 characters and clears a selection when the text changes", async () => {
    const { input, onChange } = setup({ placeId: "p1", label: "Milano" });
    await typeAndWait(input, "mi");
    expect(searchLandingPlacesAction).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows a no-results hint and an error message", async () => {
    vi.mocked(searchLandingPlacesAction).mockResolvedValueOnce({ ok: true, data: [] });
    const { input } = setup();
    await typeAndWait(input, "zzzz");
    expect(screen.getByText(t.placeNoResults)).toBeInTheDocument();
    vi.mocked(searchLandingPlacesAction).mockResolvedValueOnce({ ok: false, error: "RATE_LIMITED" });
    await typeAndWait(input, "zzzzz");
    expect(screen.getByText(t.errors.busy)).toBeInTheDocument();
  });

  it("tells the candidate the session expired instead of 'busy'", async () => {
    vi.mocked(searchLandingPlacesAction).mockResolvedValueOnce({ ok: false, error: "SESSION_EXPIRED" });
    const { input } = setup();
    await typeAndWait(input, "zzzz");
    expect(screen.getByText(t.errors.expired)).toBeInTheDocument();
    expect(screen.queryByText(t.errors.busy)).not.toBeInTheDocument();
  });

  it("wraps with ArrowUp and closes with Escape", async () => {
    const { input } = setup();
    await typeAndWait(input, "via roma");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveAttribute("aria-activedescendant", "landing-place-option-1");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
    // ArrowDown reopens the loaded options on the first one.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-activedescendant", "landing-place-option-0");
  });

  it("closes the no-results hint with Escape", async () => {
    vi.mocked(searchLandingPlacesAction).mockResolvedValueOnce({ ok: true, data: [] });
    const { input } = setup();
    await typeAndWait(input, "zzzz");
    expect(screen.getByRole("status")).toHaveTextContent(t.placeNoResults);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByText(t.placeNoResults)).not.toBeInTheDocument();
  });

  it("ignores a stale response that arrives after a newer one", async () => {
    const first = deferred();
    vi.mocked(searchLandingPlacesAction)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ok: true, data: OPTIONS });
    const { input } = setup();
    await typeAndWait(input, "via rom");
    await typeAndWait(input, "via roma");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await act(async () => {
      first.resolve({ ok: true, data: [{ placeId: "stale", label: "Stale result" }] });
    });
    expect(screen.queryByText("Stale result")).not.toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("does not reopen the list when a response arrives after blur", async () => {
    const pending = deferred();
    vi.mocked(searchLandingPlacesAction).mockReturnValueOnce(pending.promise);
    const { input } = setup();
    await typeAndWait(input, "via roma");
    fireEvent.blur(input);
    await act(async () => {
      pending.resolve({ ok: true, data: OPTIONS });
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("does not search again when selecting while a debounce is pending", async () => {
    const { input, onChange } = setup();
    await typeAndWait(input, "via roma");
    fireEvent.change(input, { target: { value: "via roma 1" } });
    fireEvent.mouseDown(screen.getByRole("option", { name: OPTIONS[0]!.label }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(searchLandingPlacesAction).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ placeId: "p1" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("starts a new session token after a selection", async () => {
    const { input } = setup();
    await typeAndWait(input, "via roma");
    await typeAndWait(input, "via roma 1");
    expect(tokenOf(1)).toBe(tokenOf(0));
    fireEvent.mouseDown(screen.getByRole("option", { name: OPTIONS[0]!.label }));
    await typeAndWait(input, "via milano");
    expect(tokenOf(2)).toMatch(UUID_V4);
    expect(tokenOf(2)).not.toBe(tokenOf(0));
  });
});

describe("newSessionToken", () => {
  it("returns a v4 UUID", () => {
    expect(newSessionToken()).toMatch(UUID_V4);
  });

  it("falls back to getRandomValues without crypto.randomUUID", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true, writable: true });
    try {
      const a = newSessionToken();
      expect(a).toMatch(UUID_V4);
      expect(newSessionToken()).not.toBe(a);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true, writable: true });
    }
  });
});
