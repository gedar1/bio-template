import { DevWidgets } from "./DevWidgets";
import type { DomainWidgetsProps } from "../../types";

/**
 * Renderiza los widgets del dominio. El template solo tiene el perfil `domain`,
 * que usa los widgets de desarrollo. Los widgets de otros casos de uso se
 * agregan cuando exista un perfil que los necesite.
 */
export const DomainWidgets: React.FC<DomainWidgetsProps> = ({ tenantId }) => {
  return <DevWidgets tenantId={tenantId} />;
};
