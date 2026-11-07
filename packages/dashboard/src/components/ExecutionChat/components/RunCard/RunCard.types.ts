import type { ExecutionRun } from "../../ExecutionChat.types";

export interface RunCardProps {
  run: ExecutionRun;
  /** Se muestra el botón de reintentar solo si se entrega este callback */
  onRetry?: () => void;
}
