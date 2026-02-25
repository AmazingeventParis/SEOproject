"use client";

import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { Site } from "@/lib/supabase/types";

const NICHE_OPTIONS = [
  { value: "photographie", label: "Photographie" },
  { value: "gastronomie", label: "Gastronomie" },
  { value: "habitat", label: "Habitat" },
  { value: "energie", label: "Energie" },
  { value: "technologie", label: "Technologie" },
  { value: "autre", label: "Autre" },
] as const;

export interface SiteFormData {
  name: string;
  domain: string;
  wp_url: string;
  wp_user: string;
  wp_app_password: string;
  gsc_property: string;
  niche: string;
}

interface SiteFormProps {
  site?: Site;
  onSubmit: (data: SiteFormData) => Promise<void>;
  submitLabel?: string;
}

export function SiteForm({ site, onSubmit, submitLabel = "Enregistrer" }: SiteFormProps) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof SiteFormData, string>>>({});

  const [formData, setFormData] = useState<SiteFormData>({
    name: site?.name ?? "",
    domain: site?.domain ?? "",
    wp_url: site?.wp_url ?? "",
    wp_user: site?.wp_user ?? "",
    wp_app_password: site?.wp_app_password ?? "",
    gsc_property: site?.gsc_property ?? "",
    niche: site?.niche ?? "",
  });

  function handleChange(field: keyof SiteFormData, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  function validate(): boolean {
    const newErrors: Partial<Record<keyof SiteFormData, string>> = {};

    if (!formData.name.trim()) newErrors.name = "Le nom est requis";
    if (!formData.domain.trim()) newErrors.domain = "Le domaine est requis";
    if (!formData.wp_url.trim()) {
      newErrors.wp_url = "L'URL WordPress est requise";
    } else {
      try {
        new URL(formData.wp_url);
      } catch {
        newErrors.wp_url = "L'URL doit etre valide (ex: https://...)";
      }
    }
    if (!formData.wp_user.trim()) newErrors.wp_user = "L'utilisateur est requis";
    if (!formData.wp_app_password.trim()) newErrors.wp_app_password = "Le mot de passe est requis";

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
      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="name">Nom du site</Label>
        <Input
          id="name"
          placeholder="Mon site WordPress"
          value={formData.name}
          onChange={(e) => handleChange("name", e.target.value)}
        />
        {errors.name && (
          <p className="text-sm text-destructive">{errors.name}</p>
        )}
      </div>

      {/* Domain */}
      <div className="space-y-2">
        <Label htmlFor="domain">Domaine</Label>
        <Input
          id="domain"
          placeholder="example.com"
          value={formData.domain}
          onChange={(e) => handleChange("domain", e.target.value)}
        />
        {errors.domain && (
          <p className="text-sm text-destructive">{errors.domain}</p>
        )}
      </div>

      {/* WP URL */}
      <div className="space-y-2">
        <Label htmlFor="wp_url">URL WordPress</Label>
        <Input
          id="wp_url"
          placeholder="https://example.com"
          value={formData.wp_url}
          onChange={(e) => handleChange("wp_url", e.target.value)}
        />
        {errors.wp_url && (
          <p className="text-sm text-destructive">{errors.wp_url}</p>
        )}
      </div>

      {/* WP User */}
      <div className="space-y-2">
        <Label htmlFor="wp_user">Utilisateur WordPress</Label>
        <Input
          id="wp_user"
          placeholder="admin"
          value={formData.wp_user}
          onChange={(e) => handleChange("wp_user", e.target.value)}
        />
        {errors.wp_user && (
          <p className="text-sm text-destructive">{errors.wp_user}</p>
        )}
      </div>

      {/* WP App Password */}
      <div className="space-y-2">
        <Label htmlFor="wp_app_password">Mot de passe applicatif</Label>
        <Input
          id="wp_app_password"
          type="password"
          placeholder="xxxx xxxx xxxx xxxx"
          value={formData.wp_app_password}
          onChange={(e) => handleChange("wp_app_password", e.target.value)}
        />
        {errors.wp_app_password && (
          <p className="text-sm text-destructive">{errors.wp_app_password}</p>
        )}
      </div>

      {/* GSC Property */}
      <div className="space-y-2">
        <Label htmlFor="gsc_property">Propriete Google Search Console</Label>
        <Input
          id="gsc_property"
          placeholder="sc-domain:example.com (optionnel)"
          value={formData.gsc_property}
          onChange={(e) => handleChange("gsc_property", e.target.value)}
        />
      </div>

      {/* Niche */}
      <div className="space-y-2">
        <Label htmlFor="niche">Niche</Label>
        <Select
          value={formData.niche}
          onValueChange={(value) => handleChange("niche", value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selectionner une niche (optionnel)" />
          </SelectTrigger>
          <SelectContent>
            {NICHE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
