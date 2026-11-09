import { describe, expect, it } from "vitest";
import { buildCvLayout, CV_TEMPLATE } from "../../../src/integrations/cv/layout";

const PROFILE = {
  firstName: "Karim",
  lastName: "Benali",
  birthday: "1990-05-12",
  location: "Bologna",
  email: "karim@example.com",
  workExperience: ["2018 - 2020 Bologna: Magazziniere"],
  educationAndTraining: ["Liceo Ibn Rushd: Diploma"],
  skillsAndCompetences: ["uso del muletto"],
  language: "ar",
  additionalLanguages: ["francese (intermedio)"],
  italianLevel: "intermedio",
  workingPermit: true,
  drivingLicense: false,
  transport: "bicicletta",
  "jobPreferences.preferredJob": "magazziniere",
};

describe("buildCvLayout (D127)", () => {
  it("names the template", () => {
    expect(CV_TEMPLATE).toBe("default-v1");
  });

  it("puts the name first and the contacts under it", () => {
    const layout = buildCvLayout(PROFILE, "+393334445566");

    expect(layout.title).toBe("Karim Benali");
    expect(layout.contacts).toEqual(["Bologna", "+393334445566", "karim@example.com"]);
  });

  it("builds the sections in a fixed order, skipping the empty ones", () => {
    const layout = buildCvLayout(PROFILE, "+393334445566");

    expect(layout.sections.map((s) => s.heading)).toEqual([
      "Profilo",
      "Esperienza lavorativa",
      "Istruzione e formazione",
      "Competenze",
      "Lingue",
      "Informazioni utili",
    ]);
    expect(buildCvLayout({ firstName: "Karim" }, "+39").sections).toEqual([]);
  });

  it("summarises the job aim in the profile and the practical facts as yes/no lines", () => {
    const layout = buildCvLayout(PROFILE, "+39");
    const section = (h: string) => layout.sections.find((s) => s.heading === h)?.lines;

    expect(section("Profilo")).toEqual(["Cerco lavoro come: magazziniere"]);
    expect(section("Lingue")).toEqual(["Italiano: intermedio", "francese (intermedio)"]);
    expect(section("Informazioni utili")).toEqual([
      "Permesso di lavoro: sì",
      "Patente di guida: no",
      "Mezzo di trasporto: bicicletta",
    ]);
  });

  it("falls back to a neutral title when there is no name", () => {
    expect(buildCvLayout({}, "+39").title).toBe("Curriculum vitae");
  });
});
