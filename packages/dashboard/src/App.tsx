import { RoleProvider } from "./context/RoleContext";
import { ProfileProvider } from "./context/ProfileContext";
import { TenantAuthProvider } from "./context/TenantAuthContext";
import { ToastProvider } from "./components/Toast";
import { DashboardLayout } from "./components/DashboardLayout";
import "./App.css";

export default function App() {
  return (
    <TenantAuthProvider>
      <RoleProvider>
        <ProfileProvider tenantId="default">
          <ToastProvider>
            <DashboardLayout />
          </ToastProvider>
        </ProfileProvider>
      </RoleProvider>
    </TenantAuthProvider>
  );
}
