import expandNestedTypeLiteral from "./eslint-rules/expand-nested-type-literal.js";
import multilineArgParenNewline from "./eslint-rules/multiline-arg-paren-newline.js";
import noPaddedTag from "./eslint-rules/no-padded-tag.js";
import eslint from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import importPlugin from "eslint-plugin-import";
import importNewlines from "eslint-plugin-import-newlines";
import perfectionist from "eslint-plugin-perfectionist";
import svelteEslint from "eslint-plugin-svelte";
import { globalIgnores } from "eslint/config";
import globals from "globals";
import svelteParser from "svelte-eslint-parser";
import tsEslint from "typescript-eslint";

const tsStyleRules = {
  "import/first": "error",
  "import/order": "off",
  "prefer-const": "error",
  "perfectionist/sort-imports": [
    "error",
    {
      type: "alphabetical",
      order: "asc",
      newlinesBetween: "ignore",
      sortSideEffects: true,
      groups: [["side-effect", "builtin", "external", "internal", "parent", "sibling", "index", "unknown"]]
    }
  ],
  "@stylistic/quotes": ["error", "double", { allowTemplateLiterals: "always" }],
  "@stylistic/quote-props": ["error", "as-needed"],
  "@stylistic/semi": ["error"],
  "@typescript-eslint/no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/naming-convention": [
    "error",
    {
      selector: "interface",
      format: ["PascalCase"],
      custom: {
        regex: "^I[A-Z]",
        match: false
      }
    }
  ],
  curly: ["error", "all"],
  "@stylistic/indent": ["error", 2],
  "@stylistic/arrow-parens": ["error", "as-needed"],
  "@stylistic/object-curly-spacing": ["error", "always"],
  "@stylistic/brace-style": "error",
  "@stylistic/comma-dangle": ["error", "never"],
  "@stylistic/no-trailing-spaces": "error",
  "@stylistic/eol-last": ["error", "always"],
  "@stylistic/no-multiple-empty-lines": ["error", { max: 1, maxEOF: 0, maxBOF: 0 }],
  "@stylistic/comma-spacing": ["error", { before: false, after: true }],
  "@stylistic/key-spacing": ["error", { beforeColon: false, afterColon: true }],
  "@stylistic/keyword-spacing": ["error", { before: true, after: true }],
  "@stylistic/space-before-blocks": "error",
  "@stylistic/space-before-function-paren": [
    "error",
    {
      named: "never",
      asyncArrow: "always",
      catch: "always"
    }
  ],
  "@stylistic/space-infix-ops": "error",
  "@stylistic/space-in-parens": ["error", "never"],
  "@stylistic/array-bracket-spacing": ["error", "never"],
  "@stylistic/computed-property-spacing": ["error", "never"],
  "@stylistic/template-curly-spacing": ["error", "never"],
  "@stylistic/block-spacing": ["error", "always"],
  "@stylistic/semi-spacing": ["error", { before: false, after: true }],
  "@stylistic/no-extra-semi": "error",
  "@stylistic/type-annotation-spacing": "error",
  "@stylistic/member-delimiter-style": [
    "error",
    { multiline: { delimiter: "semi", requireLast: true }, singleline: { delimiter: "semi", requireLast: false } }
  ],
  "@stylistic/no-mixed-spaces-and-tabs": "error",
  "@stylistic/no-tabs": "error",
  "@stylistic/max-len": [
    "error",
    {
      code: 120,
      ignoreUrls: true,
      ignoreStrings: true,
      ignoreTemplateLiterals: true,
      ignoreRegExpLiterals: true
    }
  ],
  "@stylistic/padded-blocks": ["error", "never"],
  "@stylistic/rest-spread-spacing": ["error", "never"],
  "@stylistic/spaced-comment": ["error", "always"],
  "import-newlines/enforce": ["error", { items: 4, "max-len": 120, forceSingleLine: true }],
  "@stylistic/object-curly-newline": [
    "error",
    {
      ObjectExpression: { consistent: true, multiline: true },
      ObjectPattern: { consistent: true, multiline: true },
      ExportDeclaration: { consistent: true, multiline: true }
    }
  ],
  "@stylistic/object-property-newline": ["error", { allowAllPropertiesOnSameLine: true }],
  "id-length": ["error", { min: 3, exceptions: ["z", "_", "i", "fs", "id", "os", "e", "db", "mi", "ui", "HL", "GL", "js", "q", "to", "dd", "mm", "x", "y", "d"], properties: "never" }],
  "func-style": ["error", "declaration", { allowArrowFunctions: false }],
  "no-restricted-syntax": [
    "error",
    {
      selector: "VariableDeclarator > ArrowFunctionExpression",
      message: "Do not assign arrow functions to variables. Use a named function declaration instead."
    },
    {
      selector: "ForOfStatement > CallExpression[callee.object.name='Object'][callee.property.name='keys']",
      message: "Use a for-in loop instead of for-of Object.keys()."
    },
    {
      selector: "MemberExpression[object.name='Reflect']",
      message: "Do not use Reflect. Use direct property access instead."
    }
  ],
  "@stylistic/padding-line-between-statements": [
    "error",
    { blankLine: "always", prev: "import", next: ["const", "let", "function", "export", "type"] },
    { blankLine: "any", prev: "import", next: "import" },
    { blankLine: "always", prev: "*", next: "if" },
    { blankLine: "never", prev: ["const", "let"], next: "if" },
    { blankLine: "always", prev: "if", next: "*" }
  ],
  "no-control-regex": "off",
  "object-shorthand": ["error", "always", { avoidExplicitReturnArrows: true }],
  "perfectionist/sort-objects": [
    "error",
    {
      type: "unsorted",
      newlinesBetween: 0
    }
  ],
  "arrow-body-style": ["error", "as-needed"],
  "@stylistic/function-call-argument-newline": ["error", "consistent"],
  "@stylistic/function-paren-newline": ["error", "consistent"],
  "local/expand-nested-type-literal": "error",
  "local/multiline-arg-paren-newline": "error",
  "local/no-padded-tag": "error",
  "no-nested-ternary": "error",
  "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
  "@typescript-eslint/no-floating-promises": "error"
};

const sharedPlugins = {
  "@stylistic": stylistic,
  import: importPlugin,
  "import-newlines": importNewlines,
  perfectionist,
  local: {
    rules: {
      "expand-nested-type-literal": expandNestedTypeLiteral,
      "multiline-arg-paren-newline": multilineArgParenNewline,
      "no-padded-tag": noPaddedTag
    }
  }
};

const sharedGlobals = {
  ...globals.browser,
  ...globals.node,
  chrome: "readonly"
};

export default [
  eslint.configs.recommended,
  ...tsEslint.configs.recommended,
  ...svelteEslint.configs["flat/recommended"],
  globalIgnores(["build/**", "node_modules/**", ".output/**", ".wxt/**", "scripts/**"]),
  {
    files: ["**/*.{ts,js,mjs}"],
    ignores: ["eslint.config.js"],
    languageOptions: {
      parser: tsEslint.parser,
      parserOptions: { project: "./tsconfig.json" },
      globals: sharedGlobals
    },
    plugins: sharedPlugins,
    rules: tsStyleRules
  },
  {
    files: ["eslint.config.js"],
    languageOptions: {
      parser: tsEslint.parser,
      globals: sharedGlobals
    },
    plugins: sharedPlugins,
    rules: {
      ...tsStyleRules,
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/consistent-type-assertions": "off"
    }
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: tsEslint.parser, project: "./tsconfig.json", extraFileExtensions: [".svelte"] },
      globals: sharedGlobals
    },
    plugins: sharedPlugins,
    rules: {
      ...tsStyleRules,
      "svelte/no-at-html-tags": "off",
      "svelte/sort-attributes": "error",
      "svelte/shorthand-directive": "error",
      "arrow-body-style": ["error", "as-needed"],
      "svelte/first-attribute-linebreak": ["error"],
      "svelte/shorthand-attribute": ["error", { prefer: "always" }],
      "@typescript-eslint/no-explicit-any": "off",
      "prefer-const": ["error", { destructuring: "all" }]
    }
  }
];
