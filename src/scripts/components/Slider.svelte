<script lang="ts">
  import { Slider } from "svelte-materialify";
  export let values = [];
  export let value: number;
  const iValue = values.indexOf(value);
  function onInput(e) {
    value = values.find((_, i) => i === Number(e.detail.value[0]));
    
  }
  function getThumb(iValue) {
    const qualityNumber = values[iValue];
    return `${qualityNumber}p`;
  }
</script>

<Slider
  color="red"
  max={values.length - 1}
  min={0}
  on:update={onInput}
  step={1}
  thumb={getThumb}
  value={iValue}>
  <slot></slot>
</Slider>

<style>
:global(.s-slider__tooltip::before) {
  --size: 38px;
  width: var(--size, 38px) !important;
  height: var(--size, 38px) !important;
  background: #f44336 !important;
}

:global(.s-input__slot) {
  max-width: 96%;
}
</style>