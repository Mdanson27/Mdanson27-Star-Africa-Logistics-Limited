import React from "react";
import { brand } from "@/config/brand";

export const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="star-africa-footer border-t border-border py-4 px-6">
      <div className="flex flex-col items-center justify-between gap-3 sm:flex-row text-xs text-muted-foreground">
        <p>© {currentYear} {brand.legalName}</p>
        <p className="text-[11px]">Business OS · Powered by {brand.poweredBy}</p>
      </div>
    </footer>
  );
};

export default Footer;
