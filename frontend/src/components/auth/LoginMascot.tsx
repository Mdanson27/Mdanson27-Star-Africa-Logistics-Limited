import React from "react";
import { ShieldCheck } from "lucide-react";

export type MascotMode = "idle" | "email" | "password";

interface LoginMascotProps {
  mode: MascotMode;
  email: string;
}

function getMessage(mode: MascotMode, email: string): string {
  if (mode === "password") return "Password privacy on.";

  if (mode === "email") {
    if (!email.trim()) return "Use your Star Africa Logistics work email.";
    if (!email.includes("@")) return "Keep going — add the full address.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Almost there.";
    return "Email looks good.";
  }

  return "Ready when you are.";
}

function getSupportText(mode: MascotMode): string {
  if (mode === "password") return "I’ll look away while you type.";
  if (mode === "email") return "Your workspace details stay private.";
  return "Secure access to your Star Africa Logistics workspace.";
}

export const LoginMascot: React.FC<LoginMascotProps> = ({ mode, email }) => {
  const eyesClosed = mode === "password";
  const emailMode = mode === "email";

  return (
    <div className="mb-3 flex flex-col items-center text-center">
      <div className="relative">
        <div className="bertcom-mascot-float relative flex h-[82px] w-[82px] items-center justify-center rounded-full border border-[#dce5ee] bg-white shadow-[0_20px_55px_rgba(2,46,85,0.13)] dark:border-white/10 dark:bg-[#0b1f31]">
          <div className="absolute inset-[6px] rounded-full bg-[radial-gradient(circle_at_35%_25%,#ffffff_0%,#f7fbff_46%,#edf4fb_100%)] dark:bg-[radial-gradient(circle_at_35%_25%,#16334d_0%,#0c2134_55%,#081725_100%)]" />

          <div className="relative flex h-[56px] w-[56px] items-center justify-center rounded-full bg-[#022E55] shadow-[inset_0_0_0_2px_rgba(255,255,255,0.08)]">
            <div className="relative flex h-[44px] w-[44px] items-center justify-center rounded-full bg-white dark:bg-[#f6f9fc]">
              <div className="absolute -top-[3px] h-[8px] w-[22px] rounded-full bg-[#DC1D2D]" />

              <div className="absolute top-[14px] flex items-center gap-[8px]">
                {eyesClosed ? (
                  <>
                    <span className="h-[2px] w-[10px] rounded-full bg-[#022E55]" />
                    <span className="h-[2px] w-[10px] rounded-full bg-[#022E55]" />
                  </>
                ) : (
                  <>
                    <span
                      className={`relative h-[9px] w-[9px] rounded-full bg-[#022E55] transition-transform duration-300 ${emailMode ? "translate-x-[2px]" : ""}`}
                    >
                      <span className="absolute right-[2px] top-[2px] h-[3px] w-[3px] rounded-full bg-white" />
                    </span>
                    <span
                      className={`relative h-[9px] w-[9px] rounded-full bg-[#022E55] transition-transform duration-300 ${emailMode ? "translate-x-[2px]" : ""}`}
                    >
                      <span className="absolute right-[2px] top-[2px] h-[3px] w-[3px] rounded-full bg-white" />
                    </span>
                  </>
                )}
              </div>

              <div className="absolute bottom-[8px] h-[7px] w-[20px] rounded-b-full border-b-[3px] border-[#DC1D2D]" />
            </div>
          </div>

          <div className="absolute right-[2px] top-[4px] flex h-7 w-7 items-center justify-center rounded-full border-[3px] border-white bg-[#DC1D2D] text-white shadow-lg dark:border-[#0b1f31]">
            <ShieldCheck className="h-3.5 w-3.5" />
          </div>
        </div>

        <div className="absolute -bottom-2 left-1/2 h-2 w-14 -translate-x-1/2 rounded-full bg-[#022E55]/15 blur-md" />
      </div>

      <p className="mt-3 text-xs font-semibold text-[#0b2c49] dark:text-white">
        {getMessage(mode, email)}
      </p>
      <p className="mt-0.5 max-w-[280px] text-[10px] leading-4 text-muted-foreground">
        {getSupportText(mode)}
      </p>
    </div>
  );
};

export default LoginMascot;
