import Options from "./components/Options.svelte";

async function init() {
  new Options({
    target: document.body
  });
}

init();
