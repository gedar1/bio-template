import { RestaurantWidgets } from "./RestaurantWidgets";
import { DevWidgets } from "./DevWidgets";
import type { DomainWidgetsProps } from "./DomainWidgets.types";

/**
 * Renderiza los widgets específicos del dominio según el perfil del tenant.
 * Si el perfil no tiene widgets específicos, muestra los de dev por defecto.
 */
export const DomainWidgets: React.FC<DomainWidgetsProps> = ({
  tenantId,
  profile,
}) => {
  switch (profile) {
    case "restaurant":
      return <RestaurantWidgets tenantId={tenantId} />;
    case "clinic":
      return (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p className="text-sm text-gray-400">
            📅 Widgets de clínica — próximamente
          </p>
        </div>
      );
    case "ecommerce":
      return (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p className="text-sm text-gray-400">
            🛒 Widgets de e-commerce — próximamente
          </p>
        </div>
      );
    case "dev":
    default:
      return <DevWidgets tenantId={tenantId} />;
  }
};
