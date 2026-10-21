import React from "react";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/common/Logo";

export const BrandedLoadingScreen: React.FC = () => (
  <main className="flex min-h-screen items-center justify-center bg-[#f4f7fb] px-6 text-foreground dark:bg-[#06111c]">
    <div className="flex w-full max-w-md flex-col items-center text-center">
      <div className="flex h-44 w-44 items-center justify-center sm:h-52 sm:w-52">
        <Logo className="h-full w-full" />
      </div>
      <h1 className="mt-5 text-2xl font-semibold tracking-[-0.025em] text-[#022E55] sm:text-3xl dark:text-white">
        Star Africa Logistics Operating System
      </h1>
      <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Opening your workspace</span>
      </div>
    </div>
  </main>
);

export default BrandedLoadingScreen;
