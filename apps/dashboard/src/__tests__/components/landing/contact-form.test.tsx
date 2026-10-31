import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { ContactForm } from "@/components/landing/contact-form";

const PREFILL = { firstName: "Ahmed", lastName: "", phone: "333 1234567", email: "" };

function setup(showShare = true, busy = false) {
  const onSubmit = vi.fn();
  render(
    <I18nProvider locale="it">
      <ContactForm
        orgName="Coop Sole" prefill={PREFILL} privacyPolicyUrl="https://x.it/p"
        showShare={showShare} busy={busy} onSubmit={onSubmit}
      />
    </I18nProvider>,
  );
  return onSubmit;
}

describe("ContactForm", () => {
  it("prefills from the CV", () => {
    setup();
    expect(screen.getByLabelText("Nome")).toHaveValue("Ahmed");
    expect(screen.getByLabelText("Telefono")).toHaveValue("333 1234567");
  });

  it("blocks submit without last name and consent", () => {
    const onSubmit = setup();
    fireEvent.click(screen.getByRole("button", { name: "Invia candidatura" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText("Campo obbligatorio").length).toBeGreaterThan(0);
    expect(screen.getByText("Serve il consenso per inviare la candidatura")).toBeInTheDocument();
  });

  it("submits the confirmed contact", () => {
    const onSubmit = setup();
    fireEvent.change(screen.getByLabelText("Cognome"), { target: { value: "Benali" } });
    fireEvent.click(screen.getByLabelText(/Ho letto l'informativa/));
    fireEvent.click(screen.getByRole("button", { name: "Invia candidatura" }));
    expect(onSubmit).toHaveBeenCalledWith({
      firstName: "Ahmed", lastName: "Benali", phone: "333 1234567", email: "",
      privacyAccepted: true, shareWithGlobal: false,
    });
  });

  it("hides the sharing checkbox when not applicable", () => {
    setup(false);
    expect(screen.queryByLabelText(/altre organizzazioni/)).toBeNull();
  });

  it("flags only the last name as required", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Invia candidatura" }));
    const last = screen.getByLabelText("Cognome");
    const errorId = last.getAttribute("aria-describedby");
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId as string)).toHaveTextContent("Campo obbligatorio");
    expect(screen.getByLabelText("Nome")).not.toHaveAttribute("aria-describedby");
    expect(screen.getAllByText("Campo obbligatorio")).toHaveLength(1);
    expect(last).toHaveFocus();
  });

  it("rejects an invalid phone", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Telefono"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Invia candidatura" }));
    expect(screen.getByText("Numero di telefono non valido")).toBeInTheDocument();
  });

  it("rejects an invalid email", () => {
    setup();
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Invia candidatura" }));
    expect(screen.getByText("Email non valida")).toBeInTheDocument();
  });

  it("disables submit while busy", () => {
    setup(true, true);
    expect(screen.getByRole("button", { name: "Invio…" })).toBeDisabled();
  });

  it("submits shareWithGlobal when checked and shows it when applicable", () => {
    const onSubmit = setup(true);
    fireEvent.change(screen.getByLabelText("Cognome"), { target: { value: "Benali" } });
    fireEvent.click(screen.getByLabelText(/Ho letto l'informativa/));
    fireEvent.click(screen.getByLabelText(/altre organizzazioni/));
    fireEvent.click(screen.getByRole("button", { name: "Invia candidatura" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ shareWithGlobal: true }));
  });
});
