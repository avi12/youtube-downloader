//! The dev-only HMR build. Compiles the Svelte component trees of the popup and the `YouTube` content
//! script into re-importable ES modules under `<output>/hmr/`, plus the manifest the in-page runtime
//! polls. The prod `wxt build` never runs this - the dev server's loaders point the popup and the
//! content script at these modules instead of the prod bundle, so the running code IS the HMR build
//! and a `.svelte` edit swaps in place.
//!
//! `.svelte` files hot-swap through their own HMR proxy; a `.ts` / `.svelte.ts` module swaps by
//! re-mounting the components above it only when re-running its top level is harmless, and its
//! `$state` is carried over. Anything else is left to the rebuild and reload.

mod build;
mod output;
mod preserve_state;
mod protocol;
mod versions;
mod worker;

pub(crate) use self::build::{build_hmr, HmrBuild, HmrRequest};
