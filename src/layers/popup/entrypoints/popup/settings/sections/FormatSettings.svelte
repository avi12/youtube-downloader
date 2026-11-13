<script lang="ts">
  import audioIcon from "@/layers/popup/entrypoints/popup/icons/audio.svg?raw";
  import videoIcon from "@/layers/popup/entrypoints/popup/icons/video.svg?raw";
  import type { SlidingSettingsProps } from "@/layers/popup/entrypoints/popup/settings/settings-props";
  import SettingsDropDown from "@/layers/popup/entrypoints/popup/settings/ui/SettingsDropDown.svelte";
  import SettingsGroup from "@/layers/popup/entrypoints/popup/settings/ui/SettingsGroup.svelte";
  import { setOption } from "@/lib/storage/storage";
  import { type Choice, findChoice } from "@/lib/utils/choices";
  import {
    AUDIO_CODEC_CHOICES,
    DYNAMIC_RANGE_CHOICES,
    listContainerChoices,
    type MediaKind,
    VIDEO_CODEC_CHOICES
  } from "@/lib/utils/containers";
  import type { Options } from "@/types";

  const { options, slideDuration }: SlidingSettingsProps = $props();

  const CODEC_SUBTITLE = "Used when the container supports it";

  interface FormatSettingRow {
    label: string;
    subtitle?: string;
    icon: string;
    choices: Choice[];
    value: string;
    select: (value: string) => void;
  }

  type ChoiceOptionKey = "videoCodec" | "audioCodec" | "dynamicRange";

  function optionRow<Key extends ChoiceOptionKey>({ key, choices, ...row }: {
    key: Key;
    label: string;
    subtitle?: string;
    icon: string;
    choices: Choice<Options[Key]>[];
  }) {
    return {
      ...row,
      choices,
      value: options[key],
      select(value: string) {
        const choice = findChoice(choices, value);
        if (choice) {
          void setOption({
            key,
            value: choice.value
          });
        }
      }
    };
  }

  function containerRow({ kind, ...row }: {
    kind: MediaKind;
    label: string;
    subtitle?: string;
    icon: string;
  }) {
    return {
      ...row,
      choices: listContainerChoices(kind),
      value: options.ext[kind],
      select(value: string) {
        void setOption({
          key: "ext",
          value: {
            ...options.ext,
            [kind]: value
          }
        });
      }
    };
  }

  const rows = $derived([
    containerRow({
      kind: "video",
      label: "Video container",
      icon: videoIcon
    }),
    optionRow({
      key: "videoCodec",
      label: "Video codec",
      subtitle: CODEC_SUBTITLE,
      icon: videoIcon,
      choices: VIDEO_CODEC_CHOICES
    }),
    optionRow({
      key: "dynamicRange",
      label: "Dynamic range",
      subtitle: "HDR comes in VP9 and AV1",
      icon: videoIcon,
      choices: DYNAMIC_RANGE_CHOICES
    }),
    optionRow({
      key: "audioCodec",
      label: "Audio codec",
      subtitle: CODEC_SUBTITLE,
      icon: audioIcon,
      choices: AUDIO_CODEC_CHOICES
    }),
    containerRow({
      kind: "audio",
      label: "Audio container",
      subtitle: "Used for audio-only downloads",
      icon: audioIcon
    })
  ]);
</script>

<SettingsGroup title="Format">
  {#each rows as row (row.label)}
    <SettingsDropDown
      currentValue={row.value}
      displayValue={findChoice(row.choices, row.value)?.label ?? row.value}
      items={row.choices}
      label={row.label}
      onSelect={row.select}
      {slideDuration}
      subtitle={row.subtitle}
    >
      {#snippet icon()}
        {@html row.icon}
      {/snippet}
    </SettingsDropDown>
  {/each}
</SettingsGroup>
