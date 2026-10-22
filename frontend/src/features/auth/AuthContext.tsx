import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { clearSectionCaches } from "@/lib/sectionCache";
import {
  AUTH_SESSION_EXPIRED_EVENT,
  cacheAccessToken,
  clearCachedAccessToken,
  getAccessToken,
  getCachedAccessToken,
} from "@/lib/authSession";
import {
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

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
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

function readCachedUser(): AuthUser | null {
  try {
    const value = localStorage.getItem(AUTH_USER_CACHE_KEY);
    if (!value) return null;

    const parsed = JSON.parse(value) as Partial<AuthUser>;
    if (!parsed.id || !parsed.email) return null;

    return {
      id: String(parsed.id),
      email: String(parsed.email).trim().toLowerCase(),
      full_name: String(parsed.full_name || parsed.email),
      is_active: parsed.is_active !== false,
      is_superuser:
        String(parsed.email).trim().toLowerCase() === PLATFORM_ADMIN_EMAIL,
      role: String(parsed.role || "authenticated"),
      image: typeof parsed.image === "string" ? parsed.image : null,
    };
  } catch {
    return null;
  }
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
  const initialToken = getCachedAccessToken();
  const [user, setUser] = useState<AuthUser | null>(() =>
    initialToken ? readCachedUser() : null,
  );
  const [token, setToken] = useState<string | null>(initialToken);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const clearSession = useCallback(() => {
    clearCachedAccessToken();
    clearCachedUser();
    clearSectionCaches();
    setToken(null);
    setUser(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!isNeonAuthConfigured) {
      clearSession();
      setIsLoading(false);
      return;
    }

    const cachedToken = getCachedAccessToken();
    const cachedUser = cachedToken ? readCachedUser() : null;

    if (cachedToken && cachedUser) {
      setToken(cachedToken);
      setUser(cachedUser);
    }

    try {
      const sessionResult = await getNeonAuthClient().getSession();
      const sessionData = sessionResult.data as
        | { session?: unknown; user?: Record<string, unknown> }
        | null
        | undefined;

      if (
        sessionResult.error ||
        !sessionData?.session ||
        !sessionData.user
      ) {
        // A valid cached JWT remains sufficient for the frontend until expiry.
        // The API still cryptographically validates every request server-side.
        if (cachedToken && cachedUser) return;
        clearSession();
        return;
      }

      const jwtToken = await getAccessToken(true);
      if (!jwtToken) {
        if (cachedToken && cachedUser) return;
        clearSession();
        return;
      }

      const mappedUser = mapNeonUser(sessionData.user);

      cacheAccessToken(jwtToken);
      cacheUser(mappedUser);
      setToken(jwtToken);
      setUser(mappedUser);
    } catch {
      if (!(cachedToken && cachedUser)) clearSession();
    } finally {
      setIsLoading(false);
    }
  }, [clearSession]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  useEffect(() => {
    const handleExpiredSession = () => {
      clearSession();
      setIsLoading(false);
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
        isAuthenticated: !!user && !!token,
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
