"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { NuggetForm, type NuggetFormData } from "./nugget-form";
import { useToast } from "@/hooks/use-toast";
import type { Nugget } from "@/lib/supabase/types";

interface NuggetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nugget?: Nugget;
  onSuccess: () => void;
}

export function NuggetDialog({ open, onOpenChange, nugget, onSuccess }: NuggetDialogProps) {
  const { toast } = useToast();
  const isEdit = !!nugget;

  async function handleSubmit(data: NuggetFormData) {
    const payload = {
      ...data,
      source_ref: data.source_ref || null,
      site_id: data.site_id || null,
      persona_id: data.persona_id || null,
    };

    try {
      const url = isEdit ? `/api/nuggets/${nugget.id}` : "/api/nuggets";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erreur inconnue");
      }

      toast({
        title: isEdit ? "Nugget mis a jour" : "Nugget cree",
        description: isEdit
          ? "Le nugget a ete mis a jour."
          : "Le nugget a ete ajoute.",
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
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Modifier le nugget" : "Ajouter un nugget"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Modifiez les informations du nugget."
              : "Ajoutez un nouveau nugget de connaissance."}
          </DialogDescription>
        </DialogHeader>
        <NuggetForm
          nugget={nugget}
          onSubmit={handleSubmit}
          submitLabel={isEdit ? "Mettre a jour" : "Ajouter"}
        />
      </DialogContent>
    </Dialog>
  );
}
