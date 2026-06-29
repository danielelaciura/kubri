# Product

## Register

product

## Users

Entry-level job seekers reached through Kubri's channels (the WhatsApp/Telegram chatbot,
shared links from social cooperatives and employment agencies). They're looking for work as
waiters, warehouse and logistics operators, cleaners, kitchen staff, and similar roles. Many
have a **language barrier**, **informal or undocumented work history**, and **low digital
confidence**. They almost always arrive on a **phone**, often with limited time and patience,
hoping to be seen by an employer. The interface meets a person who may feel their experience
"doesn't count" and is wary of being judged.

## Product Purpose

A public, mobile-first **skills self-assessment** that turns a candidate's answers into a
structured competence profile and a downloadable competence report, and — on explicit opt-in —
into a `Candidate` record for Kubri's client organizations (social cooperatives, employment
agencies, public employment centers).

The product exists to **get the person through the questionnaire and leave them with something
of value**. **Completion is the guiding metric**: every screen is measured by whether it keeps
the candidate moving to the end. Abandonment is the enemy. A completed assessment that produces
a profile and a report — ideally followed by joining the community — is success.

## Brand Personality

**Caloroso · Umano · Valorizzante** (warm · human · valuing).

The voice is plain, encouraging, second-person Italian that speaks *to the person* and
recognizes their experience — including informal and unpaid work — as real. It reassures rather
than tests. Warmth comes from tone and generosity, not from loud decoration. The brand is a
companion that helps the candidate see what they're capable of, never an examiner that measures
them.

## Anti-references

- **A clinical exam / test.** No grades, no "you are being evaluated" framing, no test-anxiety,
  no punitive progress. The candidate is never scored to their face.
- **A noisy gamified quiz.** No confetti, no badges, no garish colors, no over-animation or
  bouncy/elastic motion. Encouragement is not infantilization.
- **A generic SaaS dashboard.** No identical card grids, no tracked-uppercase eyebrows over
  every section, no gradients, no hero-metric template, no "AI-generated default" look.

## Design Principles

1. **Completion is the metric.** Judge every screen by whether it keeps the person moving to
   the end. Cut friction and cognitive load; never block the flow on optional data; make the
   next step always obvious.
2. **Recognize, don't grade.** Reflect the person's strengths back to them; never present a
   verdict. There are no wrong answers — only a profile that honors what they bring.
3. **Speak to the person.** Plain, warm, second-person Italian that values informal experience
   and assumes low digital confidence. Accessible, human language is part of the product, not a
   finishing touch.
4. **Brand by warmth, not noise.** Identity is carried by tone, space, and a single calm color —
   not by decoration. (See DESIGN.md's "One Voice Rule".)
5. **Dignity in the deliverable.** The candidate leaves with something useful and theirs (the
   report). Value *to the person* comes before value extracted *from* them.

## Accessibility & Inclusion

No formal WCAG conformance level is claimed as a commitment (best-effort). In practice the app
already follows strong accessibility patterns and should keep doing so: semantic controls
(`aria-pressed` choice buttons, `aria-invalid` fields), visible `focus-visible` focus rings,
screen-reader value text (`aria-valuetext` on the rating scale), large touch targets, and a
mobile-first layout.

Inclusion priorities specific to these users: **plain Italian for language barriers** (short
sentences, no jargon), with **multilingual support a plausible future direction**; never rely on
**color alone** to convey meaning (errors always carry text, not just a red border); keep motion
minimal and undemanding. The bar is "a wary, time-pressed person on a phone, possibly reading a
second language, can finish without help."
