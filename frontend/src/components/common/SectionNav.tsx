import React from "react";
import { cn } from "@/lib/utils";

export interface SectionNavItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

interface SectionNavProps<T extends string> {
  items: SectionNavItem<T>[];
  active: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}

export function SectionNav<T extends string>({
  items,
  active,
  onChange,
  ariaLabel,
}: SectionNavProps<T>) {
  return (
    <nav
      aria-label={ariaLabel}
      className="scrollbar-none max-w-full overflow-x-auto rounded-xl border border-border bg-card p-1.5"
    >
      <div className="flex min-w-max gap-1">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
              active === item.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span>{item.label}</span>
            {typeof item.count === "number" && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px]",
                  active === item.id
                    ? "bg-primary-foreground/15 text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}

export default SectionNav;
