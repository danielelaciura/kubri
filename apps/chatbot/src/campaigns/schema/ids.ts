import { z } from "zod";

/** Step, question, option, consent and text ids. */
export const IdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case id");

/** Campaign, organization and sender slugs. */
export const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "kebab-case slug");
