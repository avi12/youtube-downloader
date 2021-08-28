import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import svelte from "rollup-plugin-svelte";
import { terser } from "rollup-plugin-terser";
import sveltePreprocess from "svelte-preprocess";
import postcss from "rollup-plugin-postcss";
import json from "@rollup/plugin-json";
import scss from "rollup-plugin-scss";
import replace from "rollup-plugin-replace";
import css from "rollup-plugin-css-only";

const isProduction = !process.env.ROLLUP_WATCH;

function createConfig(filename, useSvelte = false) {
  return {
    input: `src/${filename}.ts`,
    output: {
      format: "iife",
      file: `dist/build/${filename}.js`,
      strict: false,
      sourcemap: true,
      globals: ["@ffmpeg/ffmpeg"]
    },
    plugins: [
      useSvelte && css({ output: "popup/popup.css" }),
      useSvelte &&
        svelte({
          compilerOptions: {
            dev: !isProduction
          },
          preprocess: sveltePreprocess()
        }),

      json(),
      resolve({
        dedupe: ["svelte"]
      }),
      commonjs(),
      !useSvelte &&
        replace({
          "process.env.NODE_ENV": `"${
            !isProduction ? "development" : "production"
          }"`
        }),
      typescript({ sourceMap: false }),
      isProduction && terser()
    ],
    watch: {
      clearScreen: true
    }
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
    ],
    watch: {
      clearScreen: true
    }
  };
}

export default [
  createConfig("scripts/yt-downloader-content-script-initialize"),
  createConfig("scripts/background"),
  createConfigCss("yt-downloader-content-script-styles"),
  createConfig("scripts/popup", true)
];
