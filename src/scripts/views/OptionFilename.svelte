<script lang="ts">
  import type { OptionFileExtension, Options } from "./../types";
  import { Subheader, TextField } from "svelte-materialify";
  import { getStoredOption, setOption, gExtToMime } from "../utils";
  import ErrorFileExtension from "../components/ErrorFileExtension.svelte";
  import { slide } from "svelte/transition";
  export let options: Options;

  const extInput = {
    audio: options.ext.audio,
    video: options.ext.video
  };

  async function setExt(extType: "audio" | "video", e) {
    const extNew = e.target.value;
    extInput[extType] = extNew;
    const isExtSupported = gExtToMime[extType][extNew];
    if (!isExtSupported) {
      return;
    }

    const ext = await getStoredOption("ext") as OptionFileExtension;
    ext[extType] = extNew;
    await setOption("ext", ext);
  }
</script>

<Subheader>File extensions</Subheader>

<TextField
  outlined
  dense
  color={gExtToMime.video[extInput.video] ? "primary" : "error"}
  value={options.ext.video}
  on:input={e => setExt("video", e)}
>
  Video
</TextField>

{#if !gExtToMime.video[extInput.video]}
  <div transition:slide>
    <ErrorFileExtension type="video" ext={extInput.video} />
  </div>
{/if}

<TextField
  class="mt-4"
  outlined
  dense
  color={gExtToMime.audio[extInput.audio] ? "primary" : "error"}
  value={options.ext.audio}
  on:input={e => setExt("audio", e)}
>
  Audio
</TextField>

{#if !gExtToMime.audio[extInput.audio]}
  <div transition:slide>
    <ErrorFileExtension type="audio" ext={extInput.audio} />
  </div>
{/if}

<style>
  :global(.s-text-field__wrapper.outlined:focus-within::before) {
    border-width: 1px !important;
  }
</style>
