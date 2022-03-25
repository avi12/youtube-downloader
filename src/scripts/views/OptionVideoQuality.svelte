<script lang="ts">
  import type { Options } from "../types";
  import SliderQuality from "../components/Slider.svelte";
  import { qualities, setOption } from "../utils";
  import { Radio, Subheader } from "svelte-materialify";
  import { slide } from "svelte/transition";

  export let options: Options;

  let qualitySelected = options.videoQuality;
  let { videoQualityMode } = options;
  const qualitiesReversed = [...qualities].reverse();

  $: {
    setOption("videoQuality", qualitySelected);
  }

  $: {
    setOption("videoQualityMode", videoQualityMode);
  }
</script>

<Subheader>Video quality to download</Subheader>
<Radio bind:group={videoQualityMode} value="current-quality">Currently-selected in the video</Radio>
<Radio bind:group={videoQualityMode} value="best">Best</Radio>
<Radio bind:group={videoQualityMode} value="custom">Custom</Radio>

{#if videoQualityMode === "custom"}
  <div transition:slide>
    <SliderQuality values={qualitiesReversed} bind:value={qualitySelected}>
      {qualitySelected}p
    </SliderQuality>
  </div>
{/if}
