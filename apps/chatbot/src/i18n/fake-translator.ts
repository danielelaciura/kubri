import type { Translation, TranslationRequest, Translator } from "./translator";

/** For tests and the simulator: "[en] <Italian text>", placeholders untouched. */
export class FakeTranslator implements Translator {
  readonly requests: TranslationRequest[] = [];

  translate(request: TranslationRequest): Promise<Translation> {
    this.requests.push(request);
    return Promise.resolve({
      text: `[${request.targetLanguage}] ${request.text}`,
      provider: "fake",
      model: "fake",
    });
  }
}
