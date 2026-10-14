<script lang="ts">
  interface Props {
    isVisible: boolean;
    isDisabled: boolean;
    isSpaced?: boolean;
    onclick: () => void;
  }

  const { isVisible, isDisabled, isSpaced, onclick }: Props = $props();
</script>

<p
  class="ytdl-reset-wrapper"
  class:is-spaced={isSpaced}
  class:is-visible={isVisible}
  inert={!isVisible}
>
  <button
    class="ytdl-reset-link"
    disabled={isDisabled}
    {onclick}
    type="button"
  >
    Reset to my defaults
  </button>
</p>

<style>
  .ytdl-reset-wrapper {
    display: grid;
    grid-template-rows: 0fr;
    overflow: clip;
    width: fit-content;
    margin: 0;
    transition: grid-template-rows 200ms ease;

    &.is-spaced {
      margin-top: 16px;
    }

    &.is-visible {
      grid-template-rows: 1fr;
    }
  }

  .ytdl-reset-link {
    min-height: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--yt-sys-color-baseline--call-to-action, #3ea6ff);
    font-family: inherit;
    font-size: 1.2rem;
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }
  }
</style>
