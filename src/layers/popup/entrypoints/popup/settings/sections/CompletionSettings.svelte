<script lang="ts">
  import bellIcon from "@/layers/popup/entrypoints/popup/icons/bell.svg?raw";
  import downloadIcon from "@/layers/popup/entrypoints/popup/icons/download.svg?raw";
  import folderIcon from "@/layers/popup/entrypoints/popup/icons/folder.svg?raw";
  import playArrowIcon from "@/layers/popup/entrypoints/popup/icons/play-arrow.svg?raw";
  import type { SettingsProps } from "@/layers/popup/entrypoints/popup/settings/settings-props";
  import SettingsGroup from "@/layers/popup/entrypoints/popup/settings/ui/SettingsGroup.svelte";
  import SettingsSwitchRow from "@/layers/popup/entrypoints/popup/settings/ui/SettingsSwitchRow.svelte";
  import { setOption } from "@/lib/storage/storage";

  const { options }: SettingsProps = $props();
</script>

<SettingsGroup title="When download completes">
  <SettingsSwitchRow
    icon={bellIcon}
    isAccent
    isChecked={options.isNotifyOnIdle}
    label="Notify when window is idle"
    onchange={isChecked => {
      void setOption({
        key: "isNotifyOnIdle",
        value: isChecked
      });
    }}
  />
  <SettingsSwitchRow
    icon={folderIcon}
    isChecked={options.isRevealOnComplete}
    label="Reveal file in folder"
    onchange={isChecked => {
      void setOption({
        key: "isRevealOnComplete",
        value: isChecked
      });
    }}
  />
</SettingsGroup>

<SettingsGroup title="Integration">
  <SettingsSwitchRow
    icon={playArrowIcon}
    isAccent
    isChecked={options.isShowNativeDownload}
    label="Show YouTube's own download button on watch page"
    onchange={isChecked => {
      void setOption({
        key: "isShowNativeDownload",
        value: isChecked
      });
    }}
  />
  <SettingsSwitchRow
    icon={downloadIcon}
    isChecked={options.isShowGridDownloadButtons}
    label="Show download buttons on home, subscriptions, channel and search pages"
    onchange={isChecked => {
      void setOption({
        key: "isShowGridDownloadButtons",
        value: isChecked
      });
    }}
  />
</SettingsGroup>
