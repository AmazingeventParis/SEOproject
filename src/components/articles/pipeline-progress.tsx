"use client";

import { getPipelineProgress, getStatusLabel } from "@/lib/pipeline/state-machine";
import type { ArticleStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

const PIPELINE_STEPS: { status: ArticleStatus; label: string }[] = [
  { status: "draft", label: "Brouillon" },
  { status: "analyzing", label: "Analyse" },
  { status: "planning", label: "Plan" },
  { status: "writing", label: "Redaction" },
  { status: "media", label: "Media" },
  { status: "seo_check", label: "SEO" },
  { status: "reviewing", label: "Relecture" },
  { status: "published", label: "Publie" },
];

interface PipelineProgressProps {
  status: ArticleStatus;
  className?: string;
  showLabels?: boolean;
}

export function PipelineProgress({
  status,
  className,
  showLabels = false,
}: PipelineProgressProps) {
  const progress = getPipelineProgress(status);

  return (
    <div className={cn("w-full", className)}>
      {/* Progress bar */}
      <div className="flex items-center gap-1.5 mb-1">
        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              progress === 100
                ? "bg-green-500"
                : progress >= 70
                ? "bg-blue-500"
                : progress >= 40
                ? "bg-yellow-500"
                : "bg-gray-400"
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground font-medium w-9 text-right">
          {progress}%
        </span>
      </div>

      {/* Step labels */}
      {showLabels && (
        <div className="flex justify-between mt-2">
          {PIPELINE_STEPS.map((step) => {
            const stepProgress = getPipelineProgress(step.status);
            const isCurrent = step.status === status;
            const isPast = stepProgress < progress;
            const isRefresh = status === "refresh_needed";

            return (
              <div
                key={step.status}
                className={cn(
                  "flex flex-col items-center gap-1",
                  isCurrent && "font-semibold"
                )}
              >
                <div
                  className={cn(
                    "w-2.5 h-2.5 rounded-full border-2",
                    isCurrent
                      ? "bg-primary border-primary"
                      : isPast || (isRefresh && step.status === "published")
                      ? "bg-primary/50 border-primary/50"
                      : "bg-muted border-muted-foreground/30"
                  )}
                />
                <span
                  className={cn(
                    "text-[10px] leading-tight text-center",
                    isCurrent
                      ? "text-foreground font-medium"
                      : "text-muted-foreground"
                  )}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Current status label when not showing all labels */}
      {!showLabels && (
        <p className="text-xs text-muted-foreground">
          {getStatusLabel(status)}
        </p>
      )}
    </div>
  );
}
