import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Module boundaries from CLAUDE.md, enforced mechanically.
const ENGINE_FORBIDDEN_IMPORTS = [
  // Both "dir" (index import) and "dir/**" (deep import) forms.
  "**/store",
  "**/store/**",
  "**/channels",
  "**/channels/**",
  "**/nlu",
  "**/nlu/**",
  "**/integrations",
  "**/integrations/**",
  "**/runtime",
  "**/runtime/**",
  "**/ingress",
  "**/ingress/**",
  "**/generated/**",
  "@prisma/*",
  "pg",
  "pg-boss",
  "node:*",
];

export default tseslint.config(
  { ignores: ["node_modules/**", "src/generated/**", "coverage/**", "evals/reports/**"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Only the store module talks to the database.
    files: ["src/**/*.ts"],
    ignores: ["src/store/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@prisma/*", "**/generated/**", "pg"],
              message: "Only src/store may access the database (CLAUDE.md).",
            },
          ],
        },
      ],
    },
  },
  {
    // The engine is a pure function: no I/O, no clock, no randomness.
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ENGINE_FORBIDDEN_IMPORTS,
              message: "engine must stay pure (CLAUDE.md).",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", "fetch", "setTimeout", "setInterval", "process"],
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "Time must come from the event." },
        { object: "Math", property: "random", message: "The engine must be deterministic." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Time must come from the event.",
        },
      ],
    },
  },
  {
    files: ["**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
);
