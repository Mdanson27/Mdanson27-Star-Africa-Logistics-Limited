import React from "react";
import { cn } from "@/lib/utils";
import { brand, brandAsset } from "@/config/brand";

interface LogoProps {
  variant?: "full" | "icon" | "responsive";
  className?: string;
  imageClassName?: string;
  asLink?: boolean;
}

export const Logo: React.FC<LogoProps> = ({
  variant = "full",
  className,
  imageClassName,
  asLink = false,
}) => {
  const logoSrc = brandAsset(variant === "icon" ? brand.assets.mark : variant === "responsive" ? brand.assets.compactLogo : brand.assets.logo);

  const sizeClass =
    variant === "icon"
      ? "h-12 w-12"
      : variant === "responsive"
        ? "h-14 w-14 sm:h-16 sm:w-16"
        : "h-16 w-16";

  const content = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        sizeClass,
        className,
      )}
      aria-label={brand.companyName}
    >
      <img
        src={logoSrc}
        alt={brand.companyName}
        className={cn("block h-full w-full object-contain object-center", imageClassName)}
        draggable={false}
      />
    </span>
  );

  if (!asLink) return content;

  return (
    <a
      href={import.meta.env.BASE_URL}
      className="inline-flex items-center justify-center"
      aria-label={`${brand.companyName} home`}
    >
      {content}
    </a>
  );
};

export default Logo;
