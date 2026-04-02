"use client";

import React, { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import type { Persona, Site } from "@/lib/supabase/types";

export interface PersonaFormData {
  site_ids: string[];
  name: string;
  role: string;
  tone_description: string;
  bio: string;
  avatar_reference_url: string;
  writing_style_examples: string;
  banned_phrases: string;
  familiar_expressions: string;
}

interface PersonaWithSites extends Persona {
  seo_persona_sites?: { site_id: string; seo_sites: { id: string; name: string; domain: string } | null }[];
}

interface PersonaFormProps {
  persona?: PersonaWithSites | null;
  onSubmit: (data: PersonaFormData) => Promise<void>;
  loading?: boolean;
}

export function PersonaForm({ persona, onSubmit, loading }: PersonaFormProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [sitesLoading, setSitesLoading] = useState(true);

  // Extract site_ids from pivot data, fall back to legacy site_id
  const initialSiteIds = persona?.seo_persona_sites?.map((ps) => ps.site_id) ??
    (persona?.site_id ? [persona.site_id] : []);

  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>(initialSiteIds);
  const [name, setName] = useState(persona?.name ?? "");
  const [role, setRole] = useState(persona?.role ?? "");
  const [toneDescription, setToneDescription] = useState(
    persona?.tone_description ?? ""
  );
  const [bio, setBio] = useState(persona?.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(
    persona?.avatar_reference_url ?? ""
  );
  const [writingExamples, setWritingExamples] = useState(() => {
    if (persona?.writing_style_examples && persona.writing_style_examples.length > 0) {
      return persona.writing_style_examples
        .map((ex) => (ex as Record<string, unknown>).text || "")
        .filter(Boolean)
        .join("\n\n---\n\n");
    }
    return "";
  });

  const [bannedPhrases, setBannedPhrases] = useState(() => {
    if (persona?.banned_phrases && persona.banned_phrases.length > 0) {
      return persona.banned_phrases.join("\n");
    }
    return "";
  });
  const [familiarExpressions, setFamiliarExpressions] = useState(() => {
    if (persona?.familiar_expressions && persona.familiar_expressions.length > 0) {
      return persona.familiar_expressions.join("\n");
    }
    return "";
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load sites
  useEffect(() => {
    async function loadSites() {
      try {
        const res = await fetch("/api/sites");
        if (res.ok) {
          const data = await res.json();
          setSites(data);
        }
      } catch {
        // silent
      } finally {
        setSitesLoading(false);
      }
    }
    loadSites();
  }, []);

  // Update form fields when persona prop changes (edit mode)
  useEffect(() => {
    if (persona) {
      const siteIds = persona.seo_persona_sites?.map((ps) => ps.site_id) ??
        (persona.site_id ? [persona.site_id] : []);
      setSelectedSiteIds(siteIds);
      setName(persona.name);
      setRole(persona.role);
      setToneDescription(persona.tone_description ?? "");
      setBio(persona.bio ?? "");
      setAvatarUrl(persona.avatar_reference_url ?? "");
      if (persona.writing_style_examples && persona.writing_style_examples.length > 0) {
        setWritingExamples(
          persona.writing_style_examples
            .map((ex) => (ex as Record<string, unknown>).text || "")
            .filter(Boolean)
            .join("\n\n---\n\n")
        );
      } else {
        setWritingExamples("");
      }
      setBannedPhrases(
        persona.banned_phrases && persona.banned_phrases.length > 0
          ? persona.banned_phrases.join("\n")
          : ""
      );
      setFamiliarExpressions(
        persona.familiar_expressions && persona.familiar_expressions.length > 0
          ? persona.familiar_expressions.join("\n")
          : ""
      );
    }
  }, [persona]);

  function toggleSite(siteId: string) {
    setSelectedSiteIds((prev) =>
      prev.includes(siteId)
        ? prev.filter((id) => id !== siteId)
        : [...prev, siteId]
    );
  }

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (selectedSiteIds.length === 0) newErrors.site_ids = "Au moins un site est requis";
    if (!name.trim()) newErrors.name = "Le nom est requis";
    if (!role.trim()) newErrors.role = "Le role est requis";
    if (
      avatarUrl.trim() &&
      !avatarUrl.match(/^https?:\/\/.+/)
    ) {
      newErrors.avatar_reference_url = "L'URL doit etre valide";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    await onSubmit({
      site_ids: selectedSiteIds,
      name: name.trim(),
      role: role.trim(),
      tone_description: toneDescription.trim(),
      bio: bio.trim(),
      avatar_reference_url: avatarUrl.trim(),
      writing_style_examples: writingExamples.trim(),
      banned_phrases: bannedPhrases.trim(),
      familiar_expressions: familiarExpressions.trim(),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Sites (multi-select checkboxes) */}
      <div className="space-y-2">
        <Label>
          Sites <span className="text-destructive">*</span>
        </Label>
        {sitesLoading ? (
          <div className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement des sites...
          </div>
        ) : (
          <div className="space-y-2 rounded-md border p-3">
            {sites.map((site) => (
              <label
                key={site.id}
                className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5"
              >
                <Checkbox
                  checked={selectedSiteIds.includes(site.id)}
                  onCheckedChange={() => toggleSite(site.id)}
                />
                <span className="text-sm">
                  {site.name} <span className="text-muted-foreground">({site.domain})</span>
                </span>
              </label>
            ))}
            {sites.length === 0 && (
              <p className="text-sm text-muted-foreground">Aucun site disponible</p>
            )}
          </div>
        )}
        {errors.site_ids && (
          <p className="text-sm text-destructive">{errors.site_ids}</p>
        )}
      </div>

      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="name">
          Nom <span className="text-destructive">*</span>
        </Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Marie Dupont"
        />
        {errors.name && (
          <p className="text-sm text-destructive">{errors.name}</p>
        )}
      </div>

      {/* Role */}
      <div className="space-y-2">
        <Label htmlFor="role">
          Role <span className="text-destructive">*</span>
        </Label>
        <Input
          id="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="Ex: Photographe professionnelle"
        />
        {errors.role && (
          <p className="text-sm text-destructive">{errors.role}</p>
        )}
      </div>

      {/* Tone description */}
      <div className="space-y-2">
        <Label htmlFor="tone_description">Ton / Style</Label>
        <Textarea
          id="tone_description"
          value={toneDescription}
          onChange={(e) => setToneDescription(e.target.value)}
          placeholder="Ex: Ton chaleureux et expert, tutoiement"
          rows={2}
        />
      </div>

      {/* Bio */}
      <div className="space-y-2">
        <Label htmlFor="bio">Bio (E-E-A-T)</Label>
        <Textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Courte biographie pour renforcer l'expertise et l'autorite..."
          rows={3}
        />
      </div>

      {/* Writing style examples */}
      <div className="space-y-2">
        <Label htmlFor="writing_style_examples">Exemples de style d&apos;ecriture</Label>
        <p className="text-xs text-muted-foreground">
          Collez des extraits de textes ecrits par ce persona. Separez chaque extrait par &quot;---&quot; sur une ligne seule.
        </p>
        <Textarea
          id="writing_style_examples"
          value={writingExamples}
          onChange={(e) => setWritingExamples(e.target.value)}
          placeholder={"Premier extrait de texte du persona...\n\n---\n\nDeuxieme extrait..."}
          rows={6}
        />
      </div>

      {/* Familiar expressions */}
      <div className="space-y-2">
        <Label htmlFor="familiar_expressions">Expressions familieres (humanisation)</Label>
        <p className="text-xs text-muted-foreground">
          Une expression par ligne. Tournures familieres que ce persona utiliserait naturellement.
        </p>
        <Textarea
          id="familiar_expressions"
          value={familiarExpressions}
          onChange={(e) => setFamiliarExpressions(e.target.value)}
          placeholder={"ca pique\npas folichon\non est d'accord\nc'est la galere\nbon courage"}
          rows={4}
        />
      </div>

      {/* Banned phrases */}
      <div className="space-y-2">
        <Label htmlFor="banned_phrases">Expressions interdites (tics de langage)</Label>
        <p className="text-xs text-muted-foreground">
          Une expression par ligne. Ces tournures ne seront JAMAIS utilisees lors de la redaction.
        </p>
        <Textarea
          id="banned_phrases"
          value={bannedPhrases}
          onChange={(e) => setBannedPhrases(e.target.value)}
          placeholder={"On va pas se mentir\nLe bon sens paysan\nSoyons honnetes"}
          rows={4}
        />
      </div>

      {/* Avatar URL */}
      <div className="space-y-2">
        <Label htmlFor="avatar_reference_url">URL Avatar</Label>
        <Input
          id="avatar_reference_url"
          type="url"
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          placeholder="https://example.com/avatar.jpg"
        />
        {errors.avatar_reference_url && (
          <p className="text-sm text-destructive">
            {errors.avatar_reference_url}
          </p>
        )}
      </div>

      {/* Submit */}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {persona ? "Mettre a jour" : "Creer le persona"}
        </Button>
      </div>
    </form>
  );
}
