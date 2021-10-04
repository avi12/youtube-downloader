<script lang="ts">
  import { gSupportedExts } from "../utils";

  export let type: "video" | "audio";
  export let ext: string;
</script>

<div class="extension--error">Unsupported for {type}: <b>{ext}</b></div>
<div class="extension--supported">
  Supported ones: <b>{gSupportedExts[type].join(", ")}</b>
</div>

<style>
  .extension--error {
    color: red;
  }

  .extension--supported {
    color: blue;
  }
</style>
