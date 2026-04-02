"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PersonaForm, type PersonaFormData } from "./persona-form";
import { useToast } from "@/hooks/use-toast";
import type { Persona } from "@/lib/supabase/types";

interface PersonaWithSites extends Persona {
  seo_persona_sites?: { site_id: string; seo_sites: { id: string; name: string; domain: string } | null }[];
}

interface PersonaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  persona?: PersonaWithSites | null;
  onSuccess: () => void;
}

export function PersonaDialog({
  open,
  onOpenChange,
  persona,
  onSuccess,
}: PersonaDialogProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const isEdit = !!persona;

  async function handleSubmit(formData: PersonaFormData) {
    setLoading(true);

    try {
      const url = isEdit ? `/api/personas/${persona!.id}` : "/api/personas";
      const method = isEdit ? "PATCH" : "POST";

      const body: Record<string, unknown> = {
        site_ids: formData.site_ids,
        name: formData.name,
        role: formData.role,
      };

      // Only send optional fields if they have values
      body.tone_description = formData.tone_description || null;
      body.bio = formData.bio || null;
      body.avatar_reference_url = formData.avatar_reference_url || null;

      // Parse writing style examples from text (separated by ---) into JSON array
      if (formData.writing_style_examples) {
        body.writing_style_examples = formData.writing_style_examples
          .split(/\n---\n/)
          .map((text) => text.trim())
          .filter(Boolean)
          .map((text) => ({ text }));
      } else {
        body.writing_style_examples = [];
      }

      // Parse banned phrases (one per line) into JSON array
      if (formData.banned_phrases) {
        body.banned_phrases = formData.banned_phrases
          .split("\n")
          .map((p) => p.trim())
          .filter(Boolean);
      } else {
        body.banned_phrases = [];
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erreur serveur");
      }

      toast({
        title: isEdit ? "Persona mis a jour" : "Persona cree",
        description: isEdit
          ? "Les modifications ont ete enregistrees."
          : "Le persona a ete ajoute avec succes.",
      });

      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description:
          err instanceof Error ? err.message : "Une erreur est survenue",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Modifier le persona" : "Nouveau persona"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Modifiez les informations du persona."
              : "Creez un nouveau persona pour la redaction de contenu."}
          </DialogDescription>
        </DialogHeader>
        <PersonaForm
          persona={persona}
          onSubmit={handleSubmit}
          loading={loading}
        />
      </DialogContent>
    </Dialog>
  );
}
