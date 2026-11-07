import { RoleProvider } from "./context/RoleContext";
import { ProfileProvider } from "./context/ProfileContext";
import { TenantAuthProvider } from "./context/TenantAuthContext";
import { ToastProvider } from "./components/Toast";
import { DashboardLayout } from "./components/DashboardLayout";
import { DEFAULT_TENANT_ID } from "./utils/deploymentMode";
import { WorkspaceShell } from "./components/WorkspaceShell";
import "./App.css";

export default function App() {
  return (
    <TenantAuthProvider>
      <RoleProvider>
        <ProfileProvider tenantId="default">
          <ToastProvider>
            <DashboardLayout />
            {/* Espacio de trabajo del tenant (chat mock por ahora). */}
            <WorkspaceShell tenantId={DEFAULT_TENANT_ID} />
          </ToastProvider>
        </ProfileProvider>
      </RoleProvider>
    </TenantAuthProvider>
  );
}
