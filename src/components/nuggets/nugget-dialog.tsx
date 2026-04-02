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
    try {
      if (isEdit) {
        const payload = {
          content: data.content,
          source_type: data.source_type,
          source_ref: data.source_ref || null,
          site_ids: data.site_ids,
          persona_id: data.persona_id || null,
          tags: data.tags,
        };

        const res = await fetch(`/api/nuggets/${nugget.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Erreur inconnue");
        }
        toast({ title: "Nugget mis a jour", description: "Le nugget a ete mis a jour." });
      } else {
        // Create ONE nugget with site_ids array (no more duplication)
        const payload = {
          content: data.content,
          source_type: data.source_type,
          source_ref: data.source_ref || null,
          site_ids: data.site_ids,
          persona_id: data.persona_id || null,
          tags: data.tags,
        };
        const res = await fetch("/api/nuggets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Erreur inconnue");
        }
        const siteCount = data.site_ids.length;
        toast({
          title: "Nugget cree",
          description: siteCount > 1
            ? `Nugget cree et associe a ${siteCount} sites.`
            : siteCount === 1
              ? "Nugget cree et associe au site."
              : "Nugget cree (disponible pour tous les sites).",
        });
      }

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
