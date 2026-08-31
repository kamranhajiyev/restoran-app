import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Compiled output of the Electron shell, and the installers built from it.
    // It is CommonJS by design, which every rule here is right to reject in
    // source and wrong to reject in a build artifact.
    "dist-electron/**",
    "release/**",
  ]),
]);

export default eslintConfig;
