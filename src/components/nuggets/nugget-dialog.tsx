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
        // Edit: update single nugget (keep first selected site or null)
        const payload = {
          ...data,
          source_ref: data.source_ref || null,
          site_id: data.site_ids.length > 0 ? data.site_ids[0] : null,
          persona_id: data.persona_id || null,
        };
        delete (payload as Record<string, unknown>).site_ids;

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
        // Create: one nugget per selected site (or one with null if none)
        const siteIds = data.site_ids.length > 0 ? data.site_ids : [null];
        let created = 0;
        for (const siteId of siteIds) {
          const payload = {
            content: data.content,
            source_type: data.source_type,
            source_ref: data.source_ref || null,
            site_id: siteId,
            persona_id: data.persona_id || null,
            tags: data.tags,
          };
          const res = await fetch("/api/nuggets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (res.ok) created++;
        }
        const plural = created > 1 ? "s" : "";
        toast({
          title: `Nugget${plural} cree${plural}`,
          description: created > 1
            ? `${created} nuggets crees (1 par site selectionne).`
            : "Le nugget a ete ajoute.",
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
