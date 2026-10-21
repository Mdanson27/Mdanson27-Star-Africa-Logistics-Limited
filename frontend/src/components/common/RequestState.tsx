import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";

export const PageLoading: React.FC<{ label?: string }> = ({
  label = "Loading Star Africa Logistics data...",
}) => (
  <Card className="min-h-[220px]">
    <LoadingSpinner className="min-h-[180px]" label={label} />
  </Card>
);

export const PageError: React.FC<{
  message: string;
  onRetry: () => void | Promise<void>;
  title?: string;
}> = ({
  message,
  onRetry,
  title = "We couldn't load this section",
}) => (
  <Card className="flex min-h-[220px] items-center justify-center text-center">
    <div className="max-w-md">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{message}</p>
      <Button
        size="sm"
        variant="outline"
        className="mt-4 gap-2"
        onClick={() => void onRetry()}
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Try again
      </Button>
    </div>
  </Card>
);
