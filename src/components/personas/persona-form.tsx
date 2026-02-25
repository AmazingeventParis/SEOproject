"use client";

import React, { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { Persona, Site } from "@/lib/supabase/types";

export interface PersonaFormData {
  site_id: string;
  name: string;
  role: string;
  tone_description: string;
  bio: string;
  avatar_reference_url: string;
  writing_style_examples: string;
}

interface PersonaFormProps {
  persona?: Persona | null;
  onSubmit: (data: PersonaFormData) => Promise<void>;
  loading?: boolean;
}

export function PersonaForm({ persona, onSubmit, loading }: PersonaFormProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [sitesLoading, setSitesLoading] = useState(true);

  const [siteId, setSiteId] = useState(persona?.site_id ?? "");
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

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load sites for the select dropdown
  useEffect(() => {
    async function loadSites() {
      try {
        const res = await fetch("/api/sites");
        if (res.ok) {
          const data = await res.json();
          setSites(data);
        }
      } catch {
        // Silently fail - the select will just be empty
      } finally {
        setSitesLoading(false);
      }
    }
    loadSites();
  }, []);

  // Update form fields when persona prop changes (edit mode)
  useEffect(() => {
    if (persona) {
      setSiteId(persona.site_id);
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
    }
  }, [persona]);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!siteId) newErrors.site_id = "Le site est requis";
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
      site_id: siteId,
      name: name.trim(),
      role: role.trim(),
      tone_description: toneDescription.trim(),
      bio: bio.trim(),
      avatar_reference_url: avatarUrl.trim(),
      writing_style_examples: writingExamples.trim(),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Site */}
      <div className="space-y-2">
        <Label htmlFor="site_id">
          Site <span className="text-destructive">*</span>
        </Label>
        {sitesLoading ? (
          <div className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement des sites...
          </div>
        ) : (
          <Select value={siteId} onValueChange={setSiteId}>
            <SelectTrigger id="site_id">
              <SelectValue placeholder="Selectionner un site" />
            </SelectTrigger>
            <SelectContent>
              {sites.map((site) => (
                <SelectItem key={site.id} value={site.id}>
                  {site.name} ({site.domain})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {errors.site_id && (
          <p className="text-sm text-destructive">{errors.site_id}</p>
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
          Collez des extraits de textes ecrits par ce persona. Separez chaque extrait par &quot;---&quot; sur une ligne seule. Ces exemples servent de reference stylistique pour l&apos;IA.
        </p>
        <Textarea
          id="writing_style_examples"
          value={writingExamples}
          onChange={(e) => setWritingExamples(e.target.value)}
          placeholder={"Premier extrait de texte du persona...\n\n---\n\nDeuxieme extrait..."}
          rows={6}
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
