import { useEffect } from "react";

export function useUnsavedChanges(hasUnsavedChanges: boolean): void {
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);
}

export function confirmDiscardChanges(
  hasUnsavedChanges: boolean,
  message = "Discard your unsaved changes?",
): boolean {
  return !hasUnsavedChanges || window.confirm(message);
}
