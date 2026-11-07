import { createContext, useContext, useState, useEffect, useMemo } from "react";
import { useApi } from "../hooks/useApi";

export type ProfileId = "domain";

export interface ProfileInfo {
  description: string;
  allowedCells: string[];
  systemPromptExtra: string;
}

interface ProfileContextValue {
  profile: ProfileId;
  profileInfo: ProfileInfo | null;
  availableProfiles: Record<string, ProfileInfo>;
  loading: boolean;
}

const ProfileContext = createContext<ProfileContextValue>({
  profile: "domain",
  profileInfo: null,
  availableProfiles: {},
  loading: true,
});

export const useProfile = () => useContext(ProfileContext);

interface ProfileProviderProps {
  tenantId: string;
  children: React.ReactNode;
}

export const ProfileProvider: React.FC<ProfileProviderProps> = ({
  tenantId,
  children,
}) => {
  const [profile, setProfile] = useState<ProfileId>("domain");
  const { data: profileData, loading } = useApi<{
    profile: ProfileId;
    profileInfo: ProfileInfo;
    availableProfiles: Record<string, ProfileInfo>;
  }>(`/api/tenant-profile?tenantId=${tenantId}`, 30000);

  useEffect(() => {
    if (profileData) {
      setProfile(profileData.profile);
    }
  }, [profileData]);

  const value = useMemo(
    () => ({
      profile,
      profileInfo: profileData?.profileInfo || null,
      availableProfiles: profileData?.availableProfiles || {},
      loading,
    }),
    [profile, profileData, loading],
  );

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
};
