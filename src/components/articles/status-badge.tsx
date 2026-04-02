"use client";

import { Badge } from "@/components/ui/badge";
import { getStatusLabel } from "@/lib/pipeline/state-machine";
import type { ArticleStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<ArticleStatus, string> = {
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  analyzing: "bg-blue-100 text-blue-700 border-blue-200",
  planning: "bg-blue-100 text-blue-700 border-blue-200",
  writing: "bg-yellow-100 text-yellow-700 border-yellow-200",
  media: "bg-purple-100 text-purple-700 border-purple-200",
  seo_check: "bg-purple-100 text-purple-700 border-purple-200",
  reviewing: "bg-orange-100 text-orange-700 border-orange-200",
  publishing: "bg-indigo-100 text-indigo-700 border-indigo-200",
  published: "bg-green-100 text-green-700 border-green-200",
  refresh_needed: "bg-red-100 text-red-700 border-red-200",
};

interface StatusBadgeProps {
  status: ArticleStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(STATUS_COLORS[status], className)}
    >
      {getStatusLabel(status)}
    </Badge>
  );
}
