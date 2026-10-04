import type { OperationsSectionProps } from "./OperationsSection.types";
import { ErrorBoundary } from "../../ErrorBoundary";
import { RoleGuard } from "../../RoleGuard";
import { SchedulerPanel } from "../../SchedulerPanel";
import { ActivityPanel } from "../../ActivityPanel";
import { ToolsPanel } from "../../ToolsPanel";

export const OperationsSection: React.FC<OperationsSectionProps> = ({
  tenantId,
}) => {
  return (
    <section id="section-operations" className="space-y-4">
      <RoleGuard panel="scheduler">
        <ErrorBoundary name="Scheduler">
          <div id="panel-scheduler">
            <SchedulerPanel tenantId={tenantId} />
          </div>
        </ErrorBoundary>
      </RoleGuard>
      <RoleGuard panel="activity">
        <ErrorBoundary name="Activity">
          <div id="panel-activity">
            <ActivityPanel />
          </div>
        </ErrorBoundary>
      </RoleGuard>
      <RoleGuard panel="tools">
        <ErrorBoundary name="Tools">
          <div id="panel-tools">
            <ToolsPanel tenantId={tenantId} />
          </div>
        </ErrorBoundary>
      </RoleGuard>
    </section>
  );
};
