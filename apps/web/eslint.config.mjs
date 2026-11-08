import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/components/ui/**/*.{ts,tsx}", "src/components/workspace/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@/features/**", "@/app/**", "@/server/**", "@/content/**"],
          message: "Componentes compartilhados recebem dados por propriedades; composição e domínio pertencem a features/content.",
        }],
      }],
    },
  },
  {
    files: ["src/features/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "JSXOpeningElement[name.name='table']", message: "Use DataTable para preservar o padrão compartilhado de tabelas." },
        { selector: "JSXOpeningElement[name.name='h1']", message: "Use PageTitle ou PageHeader para preservar a hierarquia das páginas." },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
