import type { SystemSectionProps } from "./SystemSection.types";
import { ErrorBoundary } from "../../ErrorBoundary";
import { RoleGuard } from "../../RoleGuard";
import { ReflexPanel } from "../../ReflexPanel";
import { CircuitBreakerPanel } from "../../CircuitBreakerPanel";
import { LogsPanel } from "../../LogsPanel";
import { MutationTimeline } from "../../MutationTimeline";
import { RegistryViewer } from "../../RegistryViewer";
import { WebSocketPanel } from "../../WebSocketPanel";

export const SystemSection: React.FC<SystemSectionProps> = ({ tenantId }) => {
  return (
    <section id="section-system" className="space-y-4">
      <RoleGuard panel="reflex">
        <ErrorBoundary name="Reflex">
          <div id="panel-reflex">
            <ReflexPanel tenantId={tenantId} />
          </div>
        </ErrorBoundary>
      </RoleGuard>
      <RoleGuard panel="circuit-breaker">
        <ErrorBoundary name="Circuit Breaker">
          <div id="panel-circuit-breaker">
            <CircuitBreakerPanel />
          </div>
        </ErrorBoundary>
      </RoleGuard>
      <RoleGuard panel="logs">
        <ErrorBoundary name="Logs">
          <div id="panel-logs">
            <LogsPanel />
          </div>
        </ErrorBoundary>
      </RoleGuard>
      <RoleGuard panel="mutations">
        <ErrorBoundary name="Mutations">
          <div id="panel-mutations">
            <MutationTimeline tenantId={tenantId} />
          </div>
        </ErrorBoundary>
      </RoleGuard>
      <RoleGuard panel="registry">
        <ErrorBoundary name="Registry">
          <div id="panel-registry">
            <RegistryViewer />
          </div>
        </ErrorBoundary>
      </RoleGuard>
      <RoleGuard panel="websocket">
        <ErrorBoundary name="WebSocket">
          <div id="panel-websocket">
            <WebSocketPanel tenantId={tenantId} />
          </div>
        </ErrorBoundary>
      </RoleGuard>
    </section>
  );
};
