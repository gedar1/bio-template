import { useState, useEffect, useCallback } from "react";
import { authHeaders } from "./useApi";
import type {
  SystemSettings,
  SettingsPatch,
  UpdateResult,
} from "../types/settings";

const SETTINGS_ENDPOINT = "/api/settings";

export interface UseSettingsReturn {
  settings: SystemSettings | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  updateSettings: (patch: SettingsPatch) => Promise<UpdateResult>;
}

/**
 * Hook for fetching and updating system settings.
 * Handles all error scenarios: network errors, 403, 400/422 validation, and 409 revert.
 */
export function useSettings(): UseSettingsReturn {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(SETTINGS_ENDPOINT, {
        headers: authHeaders(),
      });

      if (res.status === 403) {
        setError("Acceso denegado: se requiere rol de administrador");
        setSettings(null);
        return;
      }

      if (!res.ok) {
        throw new Error(`Error al cargar configuración (HTTP ${res.status})`);
      }

      const data: SystemSettings = await res.json();
      setSettings(data);
      setError(null);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Error de red al cargar configuración";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = useCallback(
    async (patch: SettingsPatch): Promise<UpdateResult> => {
      try {
        const res = await fetch(SETTINGS_ENDPOINT, {
          method: "PATCH",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(patch),
        });

        const body = await res.json().catch(() => null);

        if (res.status === 403) {
          return {
            success: false,
            error: "Acceso denegado: se requiere rol de administrador",
          };
        }

        if (res.status === 400) {
          return {
            success: false,
            error: body?.error ?? "Solicitud inválida",
            details: body?.details ?? body?.setting,
          };
        }

        if (res.status === 422) {
          return {
            success: false,
            error: body?.error ?? "Error de validación",
            details: body?.details,
          };
        }

        if (res.status === 409) {
          return {
            success: false,
            error: body?.error ?? "Proveedor inalcanzable",
            reverted: body?.reverted ?? true,
          };
        }

        if (!res.ok) {
          return {
            success: false,
            error: body?.error ?? `Error del servidor (HTTP ${res.status})`,
          };
        }

        // Success: update local settings state with the server response
        if (body) {
          setSettings(body as SystemSettings);
        }

        return { success: true };
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Error de red: el cambio puede no haberse aplicado";
        return { success: false, error: message };
      }
    },
    [],
  );

  return { settings, loading, error, refetch: fetchSettings, updateSettings };
}
