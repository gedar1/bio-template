import { useRole } from "../../context/RoleContext";

const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-purple-600",
  admin: "bg-red-600",
  operator: "bg-yellow-600",
  viewer: "bg-gray-600",
};

export const RoleBadge: React.FC = () => {
  const { role, loading } = useRole();
  if (loading) return null;

  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium text-white ${ROLE_COLORS[role] ?? "bg-gray-600"}`}
    >
      {role}
    </span>
  );
};
