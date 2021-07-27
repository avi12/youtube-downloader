import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import svelte from "rollup-plugin-svelte";
import { terser } from "rollup-plugin-terser";
import sveltePreprocess from "svelte-preprocess";
import postcss from "rollup-plugin-postcss";
import json from "@rollup/plugin-json";
import scss from "rollup-plugin-scss";

const isProduction = !process.env.ROLLUP_WATCH;

function createConfig(filename, useSvelte = false) {
  return {
    input: `src/${filename}.ts`,
    output: {
      format: "esm",
      file: `dist/build/${filename}.js`,
      strict: false
    },
    plugins: [
      useSvelte &&
        svelte({
          compilerOptions: {
            dev: !isProduction
          },
          preprocess: sveltePreprocess()
        }),

      json(),
      resolve({
        browser: true,
        dedupe: ["svelte"]
      }),
      commonjs(),
      typescript(),
      isProduction && terser()
    ]
  };
}

function createConfigCss(filename) {
  return {
    input: `src/styles-injected/${filename}.scss`,
    output: {
      file: `dist/build/styles-injected/${filename}.css`
    },
    plugins: [
      scss({
        output: `dist/build/styles-injected/${filename}.min.css`,
        outputStyle: "compressed"
      }),
      postcss({
        extract: true
      })
    ]
  };
}

export default [
  createConfig("scripts/yt-downloader-content-script-initialize"),
  createConfig("scripts/background"),
  createConfigCss("yt-downloader-content-script-styles")
];
