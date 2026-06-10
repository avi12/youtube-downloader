import type { Options } from "@/types";

export interface SettingsProps {
  options: Options;
}

export interface SlidingSettingsProps extends SettingsProps {
  slideDuration: number;
}
