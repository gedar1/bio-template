import type { LucideIcon } from "lucide-react";

export interface StepIndicatorProps {
  steps: string[];
  mode: "reflex" | "hint" | "executing";
  currentStep?: number;
  /** Index of the step that failed (shows in red) */
  failedStep?: number;
}

export interface StepIconDef {
  icon: LucideIcon;
  label: string;
}
