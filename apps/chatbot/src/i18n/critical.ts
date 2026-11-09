import type { CampaignDefinition } from "../campaigns/schema/campaign";
import type { ConsentStep } from "../campaigns/schema/steps";
import type { TextRef } from "../engine/text-ref";

/** The consent step whose text `ref` is (D74), inline or through the campaign's texts. */
export function consentStepOf(ref: TextRef, campaign: CampaignDefinition): ConsentStep | undefined {
  return campaign.flow.find(
    (step): step is ConsentStep =>
      step.type === "consent" &&
      ((ref.kind === "step" && ref.path === step.id) ||
        (ref.kind === "campaign" && "ref" in step.text && step.text.ref === ref.key)),
  );
}

/** Where the official text is: the step's link, else the data controller's privacy page. */
export function officialLink(step: ConsentStep, campaign: CampaignDefinition): string {
  return step.link ?? campaign.dataController.privacyUrl;
}
