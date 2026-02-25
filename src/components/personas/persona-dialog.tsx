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

interface PersonaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  persona?: Persona | null;
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
        site_id: formData.site_id,
        name: formData.name,
        role: formData.role,
      };

      // Only send optional fields if they have values
      if (formData.tone_description) {
        body.tone_description = formData.tone_description;
      } else {
        body.tone_description = null;
      }

      if (formData.bio) {
        body.bio = formData.bio;
      } else {
        body.bio = null;
      }

      if (formData.avatar_reference_url) {
        body.avatar_reference_url = formData.avatar_reference_url;
      } else {
        body.avatar_reference_url = null;
      }

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
      <DialogContent className="sm:max-w-[520px]">
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
