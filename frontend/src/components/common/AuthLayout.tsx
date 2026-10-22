import React from "react";
import { Appearance } from "@/components/common/Appearance";
import { Logo } from "@/components/common/Logo";
import { brand } from "@/config/brand";

interface AuthLayoutProps {
  children: React.ReactNode;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({ children }) => {
  const year = new Date().getFullYear();

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#f4f7fb] text-foreground dark:bg-[#06111c] lg:h-dvh lg:overflow-hidden">
      <div className="grid min-h-dvh lg:h-full lg:grid-cols-[0.98fr_1.02fr]">
        <section className="star-africa-auth-panel relative hidden overflow-hidden px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-16 xl:py-12">
          <div className="pointer-events-none absolute inset-0 opacity-[0.045] [background-image:linear-gradient(rgba(255,255,255,.3)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.3)_1px,transparent_1px)] [background-size:54px_54px]" />
          <div className="pointer-events-none absolute -left-36 top-24 h-80 w-80 rounded-full bg-[#DC1D2D]/16 blur-3xl" />
          <div className="pointer-events-none absolute right-[-120px] bottom-[-40px] h-96 w-96 rounded-full bg-[#2f78b4]/14 blur-3xl" />

          <div className="relative z-10">
            <div className="inline-flex h-32 w-32 items-center justify-center rounded-[28px] bg-white p-3 shadow-[0_18px_50px_rgba(0,0,0,0.14)]">
              <Logo variant="full" className="h-full w-full" />
            </div>
          </div>

          <div className="relative z-10 flex flex-1 items-center">
            <div>
              <div className="star-africa-gradient-word text-[clamp(58px,6vw,86px)] font-semibold leading-none tracking-[-0.055em]">
                STAR AFRICA
              </div>
              <div className="mt-4 text-[clamp(20px,2vw,30px)] font-medium uppercase tracking-[0.16em] text-white/88">
                Logistics Operating System
              </div>
            </div>
          </div>

          <div className="relative z-10 flex items-center justify-between border-t border-white/10 pt-6 text-[11px] text-white/42">
            <span>© {year} {brand.legalName}</span>
            <span>Powered by {brand.poweredBy}</span>
          </div>
        </section>

        <section className="star-africa-auth-content relative flex min-h-dvh flex-col overflow-x-hidden overflow-y-auto lg:h-full lg:min-h-0 lg:overflow-hidden">
          <div className="pointer-events-none absolute right-[-80px] top-[10%] h-64 w-64 rounded-full bg-[#DC1D2D]/[0.045] blur-3xl" />
          <div className="pointer-events-none absolute bottom-[4%] left-[-70px] h-64 w-64 rounded-full bg-[#022E55]/[0.055] blur-3xl" />

          <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6 md:right-10 md:top-8">
            <Appearance />
          </div>

          <div className="relative z-10 flex flex-1 items-start justify-center px-3 pb-4 pt-14 sm:px-5 sm:pb-6 sm:pt-16 md:px-8 lg:min-h-0 lg:items-center lg:py-3">
            <div className="w-full max-w-[500px] overflow-visible rounded-[22px] border border-[#d9e3ed] bg-white/94 p-4 shadow-[0_24px_80px_rgba(2,46,85,0.09)] backdrop-blur-xl sm:rounded-[28px] sm:p-6 dark:border-[#3977a6]/25 dark:bg-[#0b1a2a]/92 lg:max-h-[calc(100dvh-24px)] lg:overflow-y-auto">
              {children}
            </div>
          </div>

          <div className="relative z-10 px-4 pb-4 text-center text-[10px] text-muted-foreground lg:hidden">
            © {year} {brand.legalName} · Powered by {brand.poweredBy}
          </div>
        </section>
      </div>
    </main>
  );
};

export default AuthLayout;
