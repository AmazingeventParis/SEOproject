"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const MODELS = [
  {
    id: "claude-sonnet-4-20250514",
    label: "Claude Sonnet 4",
    costInput: 3,
    costOutput: 15,
    tag: "Recommande",
    tagColor: "bg-blue-100 text-blue-700 border-blue-200",
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    costInput: 1,
    costOutput: 5,
    tag: "Equilibre",
    tagColor: "bg-amber-100 text-amber-700 border-amber-200",
  },
  {
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    costInput: 2.0,
    costOutput: 12.0,
    tag: "Puissant",
    tagColor: "bg-violet-100 text-violet-700 border-violet-200",
  },
  {
    id: "gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    costInput: 0.5,
    costOutput: 3.0,
    tag: "Rapide",
    tagColor: "bg-cyan-100 text-cyan-700 border-cyan-200",
  },
  {
    id: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    costInput: 0.1,
    costOutput: 0.4,
    tag: "Economique",
    tagColor: "bg-green-100 text-green-700 border-green-200",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    costInput: 0.15,
    costOutput: 0.6,
    tag: "Economique+",
    tagColor: "bg-emerald-100 text-emerald-700 border-emerald-200",
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    costInput: 2.5,
    costOutput: 10,
    tag: "Premium",
    tagColor: "bg-purple-100 text-purple-700 border-purple-200",
  },
] as const;

const STEP_ESTIMATES: Record<string, { tokensIn: number; tokensOut: number }> = {
  plan: { tokensIn: 3000, tokensOut: 2000 },
  write: { tokensIn: 2000, tokensOut: 1500 },
};

function estimateCost(
  modelId: string,
  step: "plan" | "write"
): string {
  const model = MODELS.find((m) => m.id === modelId);
  const est = STEP_ESTIMATES[step];
  if (!model || !est) return "";
  const cost =
    (est.tokensIn * model.costInput + est.tokensOut * model.costOutput) /
    1_000_000;
  if (cost < 0.001) return "<$0.001";
  return `~$${cost.toFixed(3)}`;
}

interface ModelSelectorProps {
  value: string | null;
  onChange: (value: string) => void;
  step: "plan" | "write";
}

export function ModelSelector({ value, onChange, step }: ModelSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <Select value={value ?? "claude-sonnet-4-20250514"} onValueChange={onChange}>
        <SelectTrigger className="w-[280px]">
          <SelectValue placeholder="Modele IA" />
        </SelectTrigger>
        <SelectContent>
          {MODELS.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              <div className="flex items-center gap-2">
                <span>{model.label}</span>
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 ${model.tagColor}`}
                >
                  {model.tag}
                </Badge>
                <span className="text-xs text-muted-foreground ml-auto">
                  {estimateCost(model.id, step)}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
