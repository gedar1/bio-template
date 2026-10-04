import { ReflexPanel } from "../../ReflexPanel";
import { ErrorBoundary } from "../../ErrorBoundary";
import type { DevWidgetsProps } from "./DevWidgets.types";

/**
 * Widgets específicos para el perfil "dev" (desarrollo de software).
 * Muestra reflexes, herramientas y métricas de desarrollo.
 */
export const DevWidgets: React.FC<DevWidgetsProps> = ({ tenantId }) => {
  return (
    <div className="space-y-4">
      <ErrorBoundary name="Reflex">
        <ReflexPanel tenantId={tenantId} />
      </ErrorBoundary>
    </div>
  );
};
