"use client";

import React, { useCallback, useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import type { Site } from "@/lib/supabase/types";
import { SiteDialog } from "@/components/sites/site-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Globe, Pencil, Plus, Trash2 } from "lucide-react";

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | undefined>(undefined);
  const { toast } = useToast();

  const fetchSites = useCallback(async () => {
    setLoading(true);
    const supabase = getBrowserClient();
    const { data, error } = await supabase
      .from("seo_sites")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de charger les sites.",
      });
    } else {
      setSites(data ?? []);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  function handleAdd() {
    setEditingSite(undefined);
    setDialogOpen(true);
  }

  function handleEdit(site: Site) {
    setEditingSite(site);
    setDialogOpen(true);
  }

  async function handleDelete(site: Site) {
    const confirmed = window.confirm(
      `Supprimer le site "${site.name}" ? Cette action est irreversible.`
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/sites/${site.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        throw new Error("Echec de la suppression");
      }
      toast({
        title: "Site supprime",
        description: `Le site "${site.name}" a ete supprime.`,
      });
      fetchSites();
    } catch {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de supprimer le site.",
      });
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Sites WordPress</h2>
          <p className="text-muted-foreground">
            Gerez vos sites WordPress connectes.
          </p>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Ajouter un site
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Chargement...</p>
        </div>
      ) : sites.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <Globe className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <h3 className="text-lg font-semibold">Aucun site</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            Commencez par ajouter votre premier site WordPress.
          </p>
          <Button onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Ajouter un site
          </Button>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Domaine</TableHead>
                <TableHead>Niche</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sites.map((site) => (
                <TableRow key={site.id}>
                  <TableCell className="font-medium">{site.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {site.domain}
                  </TableCell>
                  <TableCell>
                    {site.niche ? (
                      <span className="capitalize">{site.niche}</span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {site.active ? (
                      <Badge variant="default">Actif</Badge>
                    ) : (
                      <Badge variant="secondary">Inactif</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(site)}
                        title="Modifier"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(site)}
                        title="Supprimer"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Dialog for create/edit */}
      <SiteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        site={editingSite}
        onSuccess={fetchSites}
      />
    </div>
  );
}
