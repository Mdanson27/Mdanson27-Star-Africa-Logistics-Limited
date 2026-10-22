import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api";
import { clearSectionCaches } from "@/lib/sectionCache";
import {
  AUTH_SESSION_EXPIRED_EVENT,
  cacheAccessToken,
  clearCachedAccessToken,
  getCachedAccessToken,
} from "@/lib/authSession";
import {
  clearAuthCallbackVerifier,
  getAuthCallbackUrl,
  getNeonAuthClient,
  isNeonAuthConfigured,
} from "@/lib/neonAuth";

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_superuser: boolean;
  role: string;
  image?: string | null;
}

const PLATFORM_ADMIN_EMAIL = (import.meta.env.VITE_PLATFORM_ADMIN_EMAIL || "").trim().toLowerCase();
const AUTH_USER_CACHE_KEY = "starafrica.authUser";

export type AuthState = "booting" | "signed_out" | "authenticating" | "verifying_neon" | "verifying_api" | "verified" | "auth_failed";

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  authState: AuthState;
  isAdmin: boolean;
  isPlatformAdmin: boolean;
  authConfigured: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  resetPasswordWithOtp: (
    email: string,
    otp: string,
    password: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function normalizeRole(role: unknown): string {
  if (Array.isArray(role)) {
    return role.map(String).join(",");
  }
  return typeof role === "string" && role ? role : "authenticated";
}

function mapNeonUser(raw: Record<string, unknown>): AuthUser {
  const role = normalizeRole(raw.role);
  const email = String(raw.email || "").trim().toLowerCase();

  return {
    id: String(raw.id || ""),
    email,
    full_name: String(raw.name || raw.email || "Star Africa Logistics User"),
    is_active: !Boolean(raw.banned),
    is_superuser: email === PLATFORM_ADMIN_EMAIL,
    role,
    image: typeof raw.image === "string" ? raw.image : null,
  };
}

function cacheUser(user: AuthUser): void {
  localStorage.setItem(AUTH_USER_CACHE_KEY, JSON.stringify(user));
}

function clearCachedUser(): void {
  localStorage.removeItem(AUTH_USER_CACHE_KEY);
}

function authErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Never bootstrap authenticated UI from localStorage. Neon Managed Auth is
  // the source of truth, so a reload must verify the live browser session
  // before protected screens mount. This prevents the dashboard-flash -> 401
  // -> forced-login loop caused by stale tokens from older auth revisions.
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [authState, setAuthState] = useState<AuthState>("booting");

  const clearSession = useCallback(() => {
    clearCachedAccessToken();
    clearCachedUser();
    clearSectionCaches();
    setToken(null);
    setUser(null);
    setAuthState("signed_out");
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!isNeonAuthConfigured) {
      clearSession();
      setIsLoading(false);
      return;
    }

    clearCachedAccessToken();
    clearCachedUser();
    setUser(null);
    setToken(null);
    setIsLoading(true);
    setAuthState("verifying_neon");

    try {
      const sessionResult = await getNeonAuthClient().getSession();
      clearAuthCallbackVerifier();
      const sessionData = sessionResult.data as
        | { session?: { token?: unknown }; user?: Record<string, unknown> }
        | null
        | undefined;

      if (sessionResult.error || !sessionData?.session || !sessionData.user) {
        clearSession();
        return;
      }

      const sessionToken =
        typeof sessionData.session.token === "string"
          ? sessionData.session.token.trim()
          : "";
      if (!sessionToken) {
        clearSession();
        return;
      }

      cacheAccessToken(sessionToken);
      setAuthState("verifying_api");

      const verified = await apiRequest<{ verified: boolean; email?: string; role?: string; is_superuser?: boolean }>(
        "/auth/session/verify",
      );
      if (!verified?.verified) {
        throw new ApiError("Star Africa Logistics could not verify this session.", 401);
      }

      const mappedUser = mapNeonUser(sessionData.user);
      cacheUser(mappedUser);
      setToken(sessionToken);
      setUser(mappedUser);
      setAuthState("verified");
    } catch {
      try {
        if (isNeonAuthConfigured) await getNeonAuthClient().signOut();
      } catch {
        // A failed sign-out must not preserve an unverified local session.
      }
      clearSession();
      setAuthState("auth_failed");
    } finally {
      clearAuthCallbackVerifier();
      setIsLoading(false);
    }
  }, [clearSession]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  useEffect(() => {
    const handleExpiredSession = () => {
      void (async () => {
        try {
          if (isNeonAuthConfigured) await getNeonAuthClient().signOut();
        } catch {
          // Local state must still be cleared if remote sign-out is unavailable.
        } finally {
          clearSession();
          setAuthState("auth_failed");
          setIsLoading(false);
        }
      })();
    };

    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleExpiredSession);
    return () =>
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleExpiredSession);
  }, [clearSession]);

  const login = async (email: string, password: string) => {
    if (!isNeonAuthConfigured) {
      throw new ApiError("Star Africa Logistics authentication is not configured yet.");
    }

    setIsLoading(true);
    setAuthState("authenticating");
    try {
      const result = await getNeonAuthClient().signIn.email({ email, password });

      if (result.error) {
        throw new ApiError(
          authErrorMessage(result.error, "Incorrect email or password."),
        );
      }

      await refreshProfile();

      if (!getCachedAccessToken()) {
        throw new ApiError(
          "Star Africa Logistics could not establish a secure session. Please try again.",
        );
      }

      // The platform admin was originally provisioned with email/password.
      // Link the same verified identity to Google once after a successful
      // credential sign-in so future Google sign-ins use the existing user.
      if (email.trim().toLowerCase() === PLATFORM_ADMIN_EMAIL) {
        try {
          const authClient = getNeonAuthClient();
          const accountsResult = await authClient.listAccounts();
          const accounts = Array.isArray(accountsResult?.data)
            ? accountsResult.data
            : [];
          const googleLinked = accounts.some((account) =>
            Boolean(
              account &&
                typeof account === "object" &&
                "providerId" in account &&
                account.providerId === "google",
            ),
          );

          if (!googleLinked) {
            const linkResult = await authClient.linkSocial({
              provider: "google",
              callbackURL: getAuthCallbackUrl(),
            });
            if (linkResult?.error) {
              console.warn("Star Africa Logistics could not link the admin Google account.");
            }
          }
        } catch {
          // Google linking must never prevent a valid password sign-in.
          console.warn("Star Africa Logistics admin Google linking was skipped.");
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    if (!isNeonAuthConfigured) {
      throw new ApiError("Star Africa Logistics authentication is not configured yet.");
    }

    const result = await getNeonAuthClient().signIn.social({
      provider: "google",
      callbackURL: getAuthCallbackUrl(),
    });

    if (result?.error) {
      throw new ApiError(
        authErrorMessage(result.error, "Google sign-in could not be started."),
      );
    }
  };

  const requestPasswordReset = async (email: string) => {
    if (!isNeonAuthConfigured) {
      throw new ApiError("Star Africa Logistics authentication is not configured yet.");
    }

    const result = await getNeonAuthClient().emailOtp.requestPasswordReset({
      email,
    });

    if (result?.error) {
      throw new ApiError(
        authErrorMessage(
          result.error,
          "Star Africa Logistics could not send the password reset code.",
        ),
      );
    }
  };

  const resetPasswordWithOtp = async (
    email: string,
    otp: string,
    password: string,
  ) => {
    if (!isNeonAuthConfigured) {
      throw new ApiError("Star Africa Logistics authentication is not configured yet.");
    }

    const result = await getNeonAuthClient().emailOtp.resetPassword({
      email,
      otp,
      password,
    });

    if (result?.error) {
      throw new ApiError(
        authErrorMessage(
          result.error,
          "The reset code is invalid or has expired.",
        ),
      );
    }
  };

  const logout = async () => {
    try {
      if (isNeonAuthConfigured) {
        await getNeonAuthClient().signOut();
      }
    } finally {
      clearSession();
    }
  };

  const isPlatformAdmin = Boolean(
    user?.email && user.email.trim().toLowerCase() === PLATFORM_ADMIN_EMAIL,
  );
  const isAdmin = isPlatformAdmin;

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: authState === "verified" && !!user && !!token,
        authState,
        isAdmin,
        isPlatformAdmin,
        authConfigured: isNeonAuthConfigured,
        login,
        loginWithGoogle,
        requestPasswordReset,
        resetPasswordWithOtp,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
