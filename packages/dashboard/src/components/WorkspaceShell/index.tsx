import React from "react";
import { ExecutionChat } from "../ExecutionChat";

export interface WorkspaceShellProps {
  /** Tenant cuyo chat y datos se muestran. El chat se reinicia al cambiarlo. */
  tenantId: string;
}

/**
 * Contenedor del espacio de trabajo del tenant. Es el punto donde se monta
 * la UI de negocio según el perfil; por ahora solo ancla el chat en la
 * esquina inferior derecha. No conoce industrias ni roles.
 */
export const WorkspaceShell: React.FC<WorkspaceShellProps> = ({ tenantId }) => {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex h-128 w-96 flex-col">
      <ExecutionChat key={tenantId} tenantId={tenantId} />
    </div>
  );
};
