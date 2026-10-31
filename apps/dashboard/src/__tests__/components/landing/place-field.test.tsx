import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { getDictionary } from "@/lib/i18n";
import { searchLandingPlacesAction } from "@/app/(public)/candidati/[slug]/actions";
import { PlaceField, type PlaceSelection } from "@/components/landing/place-field";

vi.mock("@/app/(public)/candidati/[slug]/actions", () => ({ searchLandingPlacesAction: vi.fn() }));

const t = getDictionary("it").landing;
const OPTIONS = [
  { placeId: "p1", label: "Via Roma, Milano, MI, Italia" },
  { placeId: "p2", label: "Via Roma, Torino, TO, Italia" },
];

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
});
