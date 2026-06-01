<script lang="ts">
  interface Props { size?: number }
  const { size = 18 }: Props = $props();
  const PATH = "M480-120q-16 0-28-10t-15-26l-13-98q-27-9-50.5-24T329-313l-93 41q-15 7-30 2t-23-19l-40-68q-8-14-5-30t15-25l80-59q-2-13-3-26.5t-1-27.5q0-14 1-27.5t3-26.5l-80-59q-12-9-15-25t5-30l40-68q8-14 23-19t30 2l93 41q21-17 44.5-32T425-806l13-98q3-16 15-26t28-10q16 0 28 10t15 26l13 98q27 9 50.5 24T631-747l93-41q15-7 30-2t23 19l40 68q8 14 5 30t-15 25l-80 59q2 13 3 26.5t1 27.5q0 14-1 27.5T727-508l80 59q12 9 15 25t-5 30l-40 68q-8 14-23 19t-30-2l-93-41q-21 17-44.5 32T535-294l-13 98q-3 16-15 26t-28 10Zm0-320q50 0 85-35t35-85q0-50-35-85t-85-35q-50 0-85 35t-35 85q0 50 35 85t85 35Z";
</script>

<svg aria-hidden="true" fill="currentColor" height={size} viewBox="0 -960 960 960" width={size} xmlns="http://www.w3.org/2000/svg">
  <path d={PATH} />
</svg>
