<script lang="ts">
  interface Props {
    text: string;
  }

  const { text }: Props = $props();
</script>

<p class="ytdl-option-hint">{text}</p>

<style>
  .ytdl-option-hint {
    margin: 0;
    color: var(--yt-sys-color-baseline--text-secondary, #606060);
    font-size: 1.2rem;
  }
</style>
