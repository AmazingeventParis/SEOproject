"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SiteForm, type SiteFormData } from "./site-form";
import { useToast } from "@/hooks/use-toast";
import type { Site } from "@/lib/supabase/types";

interface SiteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site?: Site;
  onSuccess: () => void;
}

export function SiteDialog({ open, onOpenChange, site, onSuccess }: SiteDialogProps) {
  const { toast } = useToast();
  const isEdit = !!site;

  async function handleSubmit(data: SiteFormData) {
    const payload = {
      ...data,
      gsc_property: data.gsc_property || null,
      niche: data.niche || null,
      money_page_url: data.money_page_url || null,
      money_page_description: data.money_page_description || null,
    };

    try {
      const url = isEdit ? `/api/sites/${site.id}` : "/api/sites";
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
        title: isEdit ? "Site mis a jour" : "Site cree",
        description: isEdit
          ? `Le site "${data.name}" a ete mis a jour.`
          : `Le site "${data.name}" a ete ajoute.`,
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
            {isEdit ? "Modifier le site" : "Ajouter un site"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Modifiez les informations du site WordPress."
              : "Renseignez les informations de votre site WordPress."}
          </DialogDescription>
        </DialogHeader>
        <SiteForm
          site={site}
          onSubmit={handleSubmit}
          submitLabel={isEdit ? "Mettre a jour" : "Ajouter"}
        />
      </DialogContent>
    </Dialog>
  );
}
