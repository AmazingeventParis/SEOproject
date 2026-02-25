"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, X } from "lucide-react";
import type { Nugget, Site } from "@/lib/supabase/types";

const SOURCE_TYPE_OPTIONS = [
  { value: "vocal", label: "Vocal" },
  { value: "tweet", label: "Tweet" },
  { value: "note", label: "Note" },
  { value: "url", label: "URL" },
  { value: "observation", label: "Observation" },
] as const;

export interface NuggetFormData {
  content: string;
  source_type: string;
  source_ref: string;
  site_id: string;
  persona_id: string;
  tags: string[];
}

interface NuggetFormProps {
  nugget?: Nugget;
  onSubmit: (data: NuggetFormData) => Promise<void>;
  submitLabel?: string;
}

export function NuggetForm({ nugget, onSubmit, submitLabel = "Enregistrer" }: NuggetFormProps) {
  const [loading, setLoading] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [tagInput, setTagInput] = useState("");

  const [formData, setFormData] = useState<NuggetFormData>({
    content: nugget?.content ?? "",
    source_type: nugget?.source_type ?? "note",
    source_ref: nugget?.source_ref ?? "",
    site_id: nugget?.site_id ?? "",
    persona_id: nugget?.persona_id ?? "",
    tags: nugget?.tags ?? [],
  });

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch("/api/sites");
      if (res.ok) {
        const data = await res.json();
        setSites(data);
      }
    } catch {
      // silent fail - sites dropdown will be empty
    }
  }, []);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  function handleChange(field: keyof NuggetFormData, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  function handleAddTag(value: string) {
    const tag = value.trim().toLowerCase();
    if (tag && !formData.tags.includes(tag)) {
      setFormData((prev) => ({ ...prev, tags: [...prev.tags, tag] }));
    }
    setTagInput("");
  }

  function handleRemoveTag(tag: string) {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((t) => t !== tag),
    }));
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      handleAddTag(tagInput);
    }
  }

  function validate(): boolean {
    const newErrors: Partial<Record<string, string>> = {};

    if (!formData.content.trim()) newErrors.content = "Le contenu est requis";
    if (!formData.source_type) newErrors.source_type = "Le type de source est requis";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      await onSubmit(formData);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Content */}
      <div className="space-y-2">
        <Label htmlFor="content">Contenu</Label>
        <Textarea
          id="content"
          placeholder="Votre nugget de connaissance..."
          rows={6}
          value={formData.content}
          onChange={(e) => handleChange("content", e.target.value)}
        />
        {errors.content && (
          <p className="text-sm text-destructive">{errors.content}</p>
        )}
      </div>

      {/* Source Type */}
      <div className="space-y-2">
        <Label htmlFor="source_type">Type de source</Label>
        <Select
          value={formData.source_type}
          onValueChange={(value) => handleChange("source_type", value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selectionner un type" />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.source_type && (
          <p className="text-sm text-destructive">{errors.source_type}</p>
        )}
      </div>

      {/* Source Ref */}
      <div className="space-y-2">
        <Label htmlFor="source_ref">Reference source (optionnel)</Label>
        <Input
          id="source_ref"
          placeholder="URL ou reference de la source"
          value={formData.source_ref}
          onChange={(e) => handleChange("source_ref", e.target.value)}
        />
      </div>

      {/* Site */}
      <div className="space-y-2">
        <Label htmlFor="site_id">Site</Label>
        <Select
          value={formData.site_id || "__none__"}
          onValueChange={(value) =>
            handleChange("site_id", value === "__none__" ? "" : value)
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Tous les sites" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Tous les sites</SelectItem>
            {sites.map((site) => (
              <SelectItem key={site.id} value={site.id}>
                {site.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <Label htmlFor="tags">Tags</Label>
        <Input
          id="tags"
          placeholder="Tapez un tag et appuyez sur Entree"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={handleTagKeyDown}
        />
        {formData.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {formData.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1">
                {tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="ml-0.5 rounded-full hover:bg-muted-foreground/20"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
