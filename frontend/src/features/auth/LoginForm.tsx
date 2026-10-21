import React, { useMemo, useState } from "react";
import { Lock, Mail, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Alert, AlertDescription } from "@/components/ui/Alert";
import { Modal } from "@/components/ui/Modal";
import { Logo } from "@/components/common/Logo";
import LoginMascot, { type MascotMode } from "@/components/auth/LoginMascot";
import { useAuth } from "@/hooks/useAuth";
import { useCustomToast } from "@/hooks/useCustomToast";
import { ApiError } from "@/lib/api";
import { consumeAuthNotice } from "@/lib/authSession";
import { brand } from "@/config/brand";

const GoogleMark = () => (
  <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" aria-hidden="true">
    <path fill="#4285F4" d="M21.6 12.227c0-.709-.064-1.391-.182-2.045H12v3.868h5.382a4.6 4.6 0 0 1-1.995 3.018v2.509h3.227c1.89-1.741 2.986-4.305 2.986-7.35Z" />
    <path fill="#34A853" d="M12 22c2.7 0 4.964-.895 6.614-2.423l-3.227-2.509c-.895.6-2.041.955-3.387.955-2.605 0-4.809-1.759-5.595-4.123H3.07v2.591A9.997 9.997 0 0 0 12 22Z" />
    <path fill="#FBBC05" d="M6.405 13.9A6.017 6.017 0 0 1 6.09 12c0-.659.114-1.3.315-1.9V7.509H3.07A9.997 9.997 0 0 0 2 12c0 1.614.386 3.141 1.07 4.491L6.405 13.9Z" />
    <path fill="#EA4335" d="M12 5.977c1.468 0 2.786.504 3.823 1.491l2.864-2.864C16.959 2.995 14.695 2 12 2a9.997 9.997 0 0 0-8.93 5.509L6.405 10.1C7.191 7.736 9.395 5.977 12 5.977Z" />
  </svg>
);

export const LoginForm: React.FC = () => {
  const {
    login,
    loginWithGoogle,
    requestPasswordReset,
    resetPasswordWithOtp,
    authConfigured,
  } = useAuth();
  const { showErrorToast, showSuccessToast, showWarningToast } = useCustomToast();

  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [activeField, setActiveField] = useState<MascotMode>("idle");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(() => consumeAuthNotice());
  const [isRateLimited, setIsRateLimited] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [resetOpen, setResetOpen] = useState<boolean>(false);
  const [resetStep, setResetStep] = useState<"email" | "code">("email");
  const [resetEmail, setResetEmail] = useState<string>("");
  const [resetCode, setResetCode] = useState<string>("");
  const [newPassword, setNewPassword] = useState<string>("");
  const [confirmNewPassword, setConfirmNewPassword] = useState<string>("");
  const [resetBusy, setResetBusy] = useState<boolean>(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const emailHelper = useMemo(() => {
    if (activeField !== "email") return "Use the email linked to your Star Africa Logistics workspace.";
    if (!email.trim()) return "Start with your work email.";
    if (!email.includes("@")) return "Add the full email address.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Almost complete.";
    return "Email looks good.";
  }, [activeField, email]);

  const passwordHelper =
    activeField === "password"
      ? "Private mode on — the assistant is looking away."
      : "Your password stays hidden while you type.";

  const validateEmail = (val: string): boolean => {
    if (!val.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim())) {
      setEmailError("Enter a valid email address");
      return false;
    }
    setEmailError(null);
    return true;
  };

  const validatePassword = (val: string): boolean => {
    if (!val) {
      setPasswordError("Password is required");
      return false;
    }
    if (val.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return false;
    }
    setPasswordError(null);
    return true;
  };

  const clearServerError = () => {
    if (serverError) setServerError(null);
    setIsRateLimited(false);
  };

  const handleGoogleSignIn = async () => {
    setServerError(null);
    setIsRateLimited(false);

    try {
      await loginWithGoogle();
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Unable to start Google sign-in. Please try again.";
      setServerError(message);
      showErrorToast(message, "Authentication Error");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setIsRateLimited(false);

    if (!validateEmail(email) || !validatePassword(password)) return;

    setIsLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err: unknown) {
      let errorMsg = "Unable to sign in. Please try again.";
      let is429 = false;

      if (err instanceof ApiError) {
        errorMsg = err.message;
        is429 = err.status === 429;
      } else if (err instanceof Error && err.message) {
        errorMsg = err.message;
      } else if (typeof err === "string") {
        errorMsg = err;
      }

      setServerError(errorMsg);
      setIsRateLimited(is429);

      if (is429) showWarningToast(errorMsg, "Rate Limited");
      else showErrorToast(errorMsg, "Authentication Error");
    } finally {
      setIsLoading(false);
    }
  };

  const openPasswordReset = () => {
    setResetEmail(email.trim());
    setResetCode("");
    setNewPassword("");
    setConfirmNewPassword("");
    setResetError(null);
    setResetStep("email");
    setResetOpen(true);
  };

  const closePasswordReset = () => {
    if (resetBusy) return;
    setResetOpen(false);
    setResetError(null);
    setResetCode("");
    setNewPassword("");
    setConfirmNewPassword("");
  };

  const sendResetCode = async (event: React.FormEvent) => {
    event.preventDefault();
    const targetEmail = resetEmail.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      setResetError("Enter the email linked to your Star Africa Logistics account.");
      return;
    }

    setResetBusy(true);
    setResetError(null);
    try {
      await requestPasswordReset(targetEmail);
      setResetEmail(targetEmail);
      setResetStep("code");
      showSuccessToast(
        "A password reset code has been sent if this Star Africa Logistics account exists.",
        "Check your email",
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "The reset code could not be sent. Please try again.";
      setResetError(message);
    } finally {
      setResetBusy(false);
    }
  };

  const completePasswordReset = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!resetCode.trim()) {
      setResetError("Enter the reset code from your email.");
      return;
    }
    if (newPassword.length < 8) {
      setResetError("Your new password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setResetError("The new passwords do not match.");
      return;
    }

    setResetBusy(true);
    setResetError(null);
    try {
      await resetPasswordWithOtp(
        resetEmail.trim().toLowerCase(),
        resetCode.trim(),
        newPassword,
      );
      setEmail(resetEmail.trim().toLowerCase());
      setPassword("");
      setResetOpen(false);
      setResetStep("email");
      setResetCode("");
      setNewPassword("");
      setConfirmNewPassword("");
      showSuccessToast(
        "Your Star Africa Logistics password is ready. Sign in with the new password.",
        "Password updated",
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "The reset code is invalid or has expired.";
      setResetError(message);
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="w-full">
      <div className="mb-3 lg:hidden">
        <Logo variant="full" className="h-14 w-48" />
      </div>

      <div className="mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#DC1D2D]">
          {brand.companyName}
        </p>
        <h2 className="mt-1 text-[32px] font-semibold tracking-[-0.045em] text-[#07233c] dark:text-white">
          Welcome back.
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Sign in to your workspace.
        </p>
      </div>

      <LoginMascot mode={activeField} email={email} />

      {serverError && (
        <Alert variant={isRateLimited ? "warning" : "destructive"} className="mb-5">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <Button
        type="button"
        variant="outline"
        onClick={handleGoogleSignIn}
        disabled={!authConfigured}
        className="h-11 w-full gap-3 rounded-xl border-[#d8e0ea] bg-white text-[#17324a] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#f8fafc] hover:shadow-md dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:hover:bg-white/[0.08]"
      >
        <GoogleMark />
        Continue with Google
      </Button>
      <div className="mt-2 flex justify-center">
        <a
          href={`tel:${brand.administratorPhone}`}
          className="inline-flex h-8 items-center gap-2 rounded-lg border border-[#d8e0ea] px-3 text-[11px] font-semibold text-[#022E55] transition hover:border-[#b8c7d6] hover:bg-[#f8fafc] hover:text-[#DC1D2D] dark:border-white/10 dark:text-white dark:hover:bg-white/[0.06]"
        >
          <PhoneCall className="h-3.5 w-3.5" />
          Contact administrator
        </a>
      </div>

      <div className="my-3 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          or
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        <Input
          id="email"
          name="email"
          type="email"
          label="Email"
          placeholder="name@starafricalogistics.com"
          value={email}
          onFocus={() => setActiveField("email")}
          onChange={(e) => {
            setEmail(e.target.value);
            if (emailError) setEmailError(null);
            clearServerError();
          }}
          onBlur={() => {
            if (email) validateEmail(email);
            setActiveField("idle");
          }}
          error={emailError ?? undefined}
          helperText={emailError ? undefined : emailHelper}
          icon={<Mail className="h-4 w-4" />}
          autoComplete="username"
          className="h-10 rounded-xl"
          required
        />

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="password"
              className={`block text-xs font-medium tracking-tight ${
                passwordError ? "text-destructive" : "text-foreground"
              }`}
            >
              Password
            </label>
            <button
              type="button"
              className="text-xs font-semibold text-[#022E55] transition hover:text-[#DC1D2D] dark:text-white/75 dark:hover:text-white"
              onClick={openPasswordReset}
            >
              Set / forgot password
            </button>
          </div>

          <PasswordInput
            id="password"
            name="password"
            placeholder="Enter your password"
            value={password}
            onFocus={() => setActiveField("password")}
            onChange={(e) => {
              setPassword(e.target.value);
              if (passwordError) setPasswordError(null);
              clearServerError();
            }}
            onBlur={() => {
              if (password) validatePassword(password);
              setActiveField("idle");
            }}
            error={passwordError ?? undefined}
            helperText={passwordError ? undefined : passwordHelper}
            showLeftLock={true}
            autoComplete="current-password"
            className="h-10 rounded-xl"
            required
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          className="mt-1 h-11 w-full rounded-xl bg-[#022E55] font-semibold shadow-[0_12px_30px_rgba(2,46,85,0.16)] transition hover:-translate-y-0.5 hover:bg-[#063d6e] hover:shadow-[0_16px_34px_rgba(2,46,85,0.20)] dark:bg-[#DC1D2D] dark:hover:bg-[#ef3040]"
          loading={isLoading}
        >
          Sign in
        </Button>
      </form>

      <Modal
        isOpen={resetOpen}
        onClose={closePasswordReset}
        title={resetStep === "email" ? "Set or reset password" : "Enter reset code"}
        description={
          resetStep === "email"
            ? "We will send a secure one-time code to the email linked to your Star Africa Logistics account."
            : `Enter the code sent to ${resetEmail} and choose your Star Africa Logistics password.`
        }
      >
        {resetError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{resetError}</AlertDescription>
          </Alert>
        )}

        {resetStep === "email" ? (
          <form onSubmit={sendResetCode} className="space-y-4">
            <Input
              id="reset-email"
              type="email"
              label="Star Africa Logistics email"
              value={resetEmail}
              onChange={(event) => {
                setResetEmail(event.target.value);
                if (resetError) setResetError(null);
              }}
              placeholder="name@starafricalogistics.com"
              autoComplete="email"
              required
            />
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={closePasswordReset}
                disabled={resetBusy}
              >
                Cancel
              </Button>
              <Button type="submit" loading={resetBusy}>
                Send code
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={completePasswordReset} className="space-y-4">
            <Input
              id="reset-code"
              label="Reset code"
              value={resetCode}
              onChange={(event) => {
                setResetCode(event.target.value);
                if (resetError) setResetError(null);
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
            <PasswordInput
              id="new-login-password"
              label="New password"
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value);
                if (resetError) setResetError(null);
              }}
              autoComplete="new-password"
              required
            />
            <PasswordInput
              id="confirm-login-password"
              label="Confirm new password"
              value={confirmNewPassword}
              onChange={(event) => {
                setConfirmNewPassword(event.target.value);
                if (resetError) setResetError(null);
              }}
              autoComplete="new-password"
              required
            />
            <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setResetStep("email");
                  setResetCode("");
                  setResetError(null);
                }}
                disabled={resetBusy}
              >
                Use another email
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closePasswordReset}
                  disabled={resetBusy}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={resetBusy}>
                  Save password
                </Button>
              </div>
            </div>
          </form>
        )}
      </Modal>

      <div className="mt-3 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        <Lock className="h-3 w-3" />
        Secure Star Africa Logistics access
      </div>
    </div>
  );
};

export default LoginForm;
