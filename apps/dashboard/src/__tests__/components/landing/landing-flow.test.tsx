import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { getDictionary } from "@/lib/i18n";
import {
  confirmLandingImportAction,
  registerLandingUploadAction,
  requestLandingUploadAction,
  runLandingExtractionAction,
} from "@/app/(public)/candidati/[slug]/actions";
import { LandingFlow } from "@/components/landing/landing-flow";

vi.mock("@/app/(public)/candidati/[slug]/actions", () => ({
  requestLandingUploadAction: vi.fn(),
  registerLandingUploadAction: vi.fn(),
  runLandingExtractionAction: vi.fn(),
  confirmLandingImportAction: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    storage: { from: () => ({ uploadToSignedUrl: () => Promise.resolve({ error: null }) }) },
  }),
}));

vi.mock("@/components/landing/turnstile-widget", () => ({
  TurnstileWidget: ({
    onToken,
    onError,
    onInteractive,
  }: {
    onToken: (t: string) => void;
    onError?: () => void;
    onInteractive?: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onToken("tok")}>stub-token</button>
      <button type="button" onClick={() => onToken("")}>stub-expire</button>
      <button type="button" onClick={() => onError?.()}>stub-error</button>
      <button type="button" onClick={() => onInteractive?.()}>stub-interactive</button>
    </div>
  ),
}));

const t = getDictionary("it").landing;
const PREFILL = { firstName: "Ahmed", lastName: "", phone: "333 1234567", email: "" };

function setup(siteKey = "") {
  const view = render(
    <I18nProvider locale="it">
      <LandingFlow
        slug="coop-sole" locale="it" orgName="Coop Sole" waLink={null}
        privacyPolicyUrl="https://x.it/p" showShare={false} turnstileSiteKey={siteKey}
      />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: t.uploadCta }));
  return view;
}

function chooseFile(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error("file input missing");
  const file = new File(["%PDF"], "cv.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  vi.mocked(requestLandingUploadAction).mockResolvedValue({ ok: true, data: { storagePath: "p", token: "s" } });
  vi.mocked(registerLandingUploadAction).mockResolvedValue({ ok: true, data: null });
  vi.mocked(runLandingExtractionAction).mockResolvedValue({ ok: true, data: PREFILL });
  vi.mocked(confirmLandingImportAction).mockResolvedValue({ ok: true, data: null });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("LandingFlow", () => {
  it("shows the verification step before the upload and moves on with a token", () => {
    setup("site-key");
    expect(screen.getByText(t.verifyTitle)).toBeVisible();
    expect(screen.queryByRole("button", { name: t.chooseFile })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("stub-token"));
    expect(screen.getByRole("button", { name: t.chooseFile })).toBeEnabled();
    expect(screen.getByText(t.verifyTitle)).not.toBeVisible();
  });

  it("goes back to the verification step when the token expires", () => {
    setup("site-key");
    fireEvent.click(screen.getByText("stub-token"));
    expect(screen.getByRole("button", { name: t.chooseFile })).toBeInTheDocument();
    fireEvent.click(screen.getByText("stub-expire"));
    expect(screen.queryByRole("button", { name: t.chooseFile })).not.toBeInTheDocument();
    expect(screen.getByText(t.verifyTitle)).toBeVisible();
  });

  it("shows the verification error with a retry when Turnstile fails", () => {
    setup("site-key");
    fireEvent.click(screen.getByText("stub-error"));
    expect(screen.getByRole("alert")).toHaveTextContent(t.errors.verifyFailed);
    expect(screen.queryByRole("button", { name: t.chooseFile })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.verifyRetry }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the verification error when no Turnstile token arrives in 15 s", () => {
    vi.useFakeTimers();
    setup("site-key");
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(t.errors.verifyFailed);
  });

  it("does not time out while Turnstile shows an interactive challenge", () => {
    vi.useFakeTimers();
    setup("site-key");
    fireEvent.click(screen.getByText("stub-interactive"));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("stub-token"));
    expect(screen.getByRole("button", { name: t.chooseFile })).toBeEnabled();
  });

  it("clears the timeout alert when a token arrives late", () => {
    vi.useFakeTimers();
    setup("site-key");
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(t.errors.verifyFailed);
    fireEvent.click(screen.getByText("stub-token"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.chooseFile })).toBeEnabled();
  });

  it("re-arms the captcha timeout when the verification step is entered again", () => {
    vi.useFakeTimers();
    setup("site-key");
    fireEvent.click(screen.getByText("stub-error"));
    expect(screen.getByRole("alert")).toHaveTextContent(t.errors.verifyFailed);
    fireEvent.click(screen.getByRole("button", { name: t.back }));
    fireEvent.click(screen.getByRole("button", { name: t.uploadCta }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(t.verifyTitle)).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(t.errors.verifyFailed);
  });

  it("skips the verification step without a site key (local dev)", () => {
    setup();
    expect(screen.getByRole("button", { name: t.chooseFile })).toBeEnabled();
  });

  it("offers Retry after an extraction LLM_ERROR", async () => {
    vi.mocked(runLandingExtractionAction).mockResolvedValue({ ok: false, error: "LLM_ERROR" });
    const { container } = setup();
    chooseFile(container);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.retry })).toBeInTheDocument();
  });

  it("does not offer Retry after a register error", async () => {
    vi.mocked(registerLandingUploadAction).mockResolvedValue({ ok: false, error: "INTERNAL_ERROR" });
    const { container } = setup();
    chooseFile(container);
    expect(await screen.findByRole("alert")).toHaveTextContent(t.errors.generic);
    expect(screen.queryByRole("button", { name: t.retry })).not.toBeInTheDocument();
    expect(runLandingExtractionAction).not.toHaveBeenCalled();
  });

  it("keeps the typed values when confirmation fails", async () => {
    vi.mocked(confirmLandingImportAction).mockResolvedValue({ ok: false, error: "INTERNAL_ERROR" });
    const { container } = setup();
    chooseFile(container);
    const lastName = await screen.findByLabelText(t.lastName);
    fireEvent.change(lastName, { target: { value: "Benali" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: t.submit }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t.errors.generic);
    expect(confirmLandingImportAction).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(t.lastName)).toHaveValue("Benali");
    expect(screen.queryByRole("button", { name: t.retry })).not.toBeInTheDocument();
  });

  it("gives up polling IN_PROGRESS after 15 more attempts", async () => {
    vi.useFakeTimers();
    vi.mocked(runLandingExtractionAction).mockResolvedValue({ ok: false, error: "IN_PROGRESS" });
    const { container } = setup();
    chooseFile(container);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000 * 16);
    });
    expect(runLandingExtractionAction).toHaveBeenCalledTimes(16);
    expect(screen.getByRole("alert")).toHaveTextContent(t.errors.generic);
    expect(screen.getByRole("button", { name: t.retry })).toBeInTheDocument();
  });
});
