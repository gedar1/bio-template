import { ErrorBoundary } from "../../ErrorBoundary";
import { PerfPanel } from "../../PerfPanel";
import { DomainWidgets } from "../../DomainWidgets";
import { useProfile } from "../../../context/ProfileContext";

export const OverviewSection: React.FC = () => {
  const { profile } = useProfile();

  return (
    <section id="section-overview" className="space-y-4">
      {/* Widgets específicos del dominio (restaurante, clínica, etc.) */}
      <ErrorBoundary name="DomainWidgets">
        <div id="panel-domain-widgets">
          <DomainWidgets tenantId="" profile={profile} />
        </div>
      </ErrorBoundary>

      <ErrorBoundary name="Performance">
        <div
          id="panel-performance"
          className="grid grid-cols-1 lg:grid-cols-2 gap-6"
        >
          <PerfPanel tenantId="" />
        </div>
      </ErrorBoundary>
    </section>
  );
};
