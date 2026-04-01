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
  theme_color: string;
  blog_path: string;
  money_page_url: string;
  money_page_description: string;
  editorial_angle_site_description: string;
  editorial_angle_tone: string;
  editorial_angle_usp: string;
  editorial_angle_content_approach: string;
  editorial_angle_target_audience: string;
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
    theme_color: site?.theme_color ?? "",
    blog_path: (site as Record<string, unknown> | undefined)?.blog_path as string ?? "",
    money_page_url: site?.money_page_url ?? "",
    money_page_description: site?.money_page_description ?? "",
    editorial_angle_site_description: (site?.editorial_angle as Record<string, string> | null)?.site_description ?? "",
    editorial_angle_tone: (site?.editorial_angle as Record<string, string> | null)?.tone ?? "",
    editorial_angle_usp: (site?.editorial_angle as Record<string, string> | null)?.unique_selling_point ?? "",
    editorial_angle_content_approach: (site?.editorial_angle as Record<string, string> | null)?.content_approach ?? "",
    editorial_angle_target_audience: (site?.editorial_angle as Record<string, string> | null)?.target_audience ?? "",
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

      {/* Theme Color */}
      <div className="space-y-2">
        <Label htmlFor="theme_color">Couleur du site (optionnel)</Label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            id="theme_color_picker"
            value={formData.theme_color || "#4f46e5"}
            onChange={(e) => handleChange("theme_color", e.target.value)}
            className="h-10 w-10 rounded border cursor-pointer"
          />
          <Input
            id="theme_color"
            placeholder="#4f46e5"
            value={formData.theme_color}
            onChange={(e) => handleChange("theme_color", e.target.value)}
            className="max-w-[140px] font-mono"
          />
          {formData.theme_color && (
            <div
              className="h-10 flex-1 rounded border"
              style={{ backgroundColor: formData.theme_color }}
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground">Utilise pour les tableaux et elements visuels dans les articles</p>
      </div>

      {/* Blog Path */}
      <div className="space-y-2">
        <Label htmlFor="blog_path">Chemin du blog (optionnel)</Label>
        <Input
          id="blog_path"
          placeholder="blog"
          value={formData.blog_path}
          onChange={(e) => handleChange("blog_path", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Chemin utilise dans le breadcrumb JSON-LD (defaut: &quot;blog&quot;). Ex: articles, actualites</p>
      </div>

      {/* Money Page */}
      <div className="border-t pt-4 space-y-4">
        <p className="text-sm font-medium text-muted-foreground">Page prioritaire (Money Page)</p>
        <div className="space-y-2">
          <Label htmlFor="money_page_url">URL page prioritaire (optionnel)</Label>
          <Input
            id="money_page_url"
            placeholder="/location-photobooth/"
            value={formData.money_page_url}
            onChange={(e) => handleChange("money_page_url", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="money_page_description">Description de la page</Label>
          <Input
            id="money_page_description"
            placeholder="Page de location de photobooth pour evenements"
            value={formData.money_page_description}
            onChange={(e) => handleChange("money_page_description", e.target.value)}
          />
        </div>
      </div>

      {/* Editorial Angle */}
      <div className="border-t pt-4 space-y-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Angle editorial du site</p>
          <p className="text-xs text-muted-foreground mt-1">Definit l&apos;identite editoriale pour tous les articles de ce site</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ea_desc">Description du site</Label>
          <textarea
            id="ea_desc"
            placeholder="Ex: Blog specialise dans les solutions de chauffage connecte pour les particuliers"
            value={formData.editorial_angle_site_description}
            onChange={(e) => handleChange("editorial_angle_site_description", e.target.value)}
            rows={2}
            className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ea_tone">Ton et style</Label>
          <textarea
            id="ea_tone"
            placeholder="Ex: Expert accessible, pas de jargon inutile, ton de conseiller de confiance"
            value={formData.editorial_angle_tone}
            onChange={(e) => handleChange("editorial_angle_tone", e.target.value)}
            rows={2}
            className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ea_usp">Ce qui nous differencie (USP)</Label>
          <textarea
            id="ea_usp"
            placeholder="Ex: On teste reellement les produits, retours d'experience terrain avec mesures"
            value={formData.editorial_angle_usp}
            onChange={(e) => handleChange("editorial_angle_usp", e.target.value)}
            rows={2}
            className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ea_approach">Approche contenu</Label>
          <textarea
            id="ea_approach"
            placeholder="Ex: Guides pratiques bases sur des tests reels, comparatifs avec donnees mesurees"
            value={formData.editorial_angle_content_approach}
            onChange={(e) => handleChange("editorial_angle_content_approach", e.target.value)}
            rows={2}
            className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ea_audience">Audience cible</Label>
          <textarea
            id="ea_audience"
            placeholder="Ex: Proprietaires de maison, 30-55 ans, budget moyen, cherchent a optimiser leur consommation"
            value={formData.editorial_angle_target_audience}
            onChange={(e) => handleChange("editorial_angle_target_audience", e.target.value)}
            rows={2}
            className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
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
