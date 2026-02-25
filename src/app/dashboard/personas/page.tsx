"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
  Users,
  Loader2,
} from "lucide-react";
import { PersonaDialog } from "@/components/personas/persona-dialog";
import { useToast } from "@/hooks/use-toast";
import type { Persona } from "@/lib/supabase/types";

// Persona with joined site info from the API
interface PersonaWithSite extends Persona {
  seo_sites: { name: string; domain: string } | null;
}

// Deterministic color for avatar based on name
const AVATAR_COLORS = [
  "bg-red-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-yellow-500",
  "bg-lime-500",
  "bg-green-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-cyan-500",
  "bg-sky-500",
  "bg-blue-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-purple-500",
  "bg-fuchsia-500",
  "bg-pink-500",
  "bg-rose-500",
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function PersonasPage() {
  const [personas, setPersonas] = useState<PersonaWithSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchPersonas = useCallback(async () => {
    try {
      const res = await fetch("/api/personas");
      if (!res.ok) throw new Error("Erreur lors du chargement");
      const data = await res.json();
      setPersonas(data);
    } catch {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de charger les personas.",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchPersonas();
  }, [fetchPersonas]);

  function handleCreate() {
    setEditingPersona(null);
    setDialogOpen(true);
  }

  function handleEdit(persona: Persona) {
    setEditingPersona(persona);
    setDialogOpen(true);
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/personas/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        throw new Error("Erreur lors de la suppression");
      }
      toast({
        title: "Persona supprime",
        description: "Le persona a ete supprime avec succes.",
      });
      fetchPersonas();
    } catch {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de supprimer le persona.",
      });
    } finally {
      setDeletingId(null);
    }
  }

  function handleDialogSuccess() {
    fetchPersonas();
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Personas</h2>
          <p className="text-muted-foreground">
            Gerez les personas auteurs pour vos contenus SEO.
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Ajouter un persona
        </Button>
      </div>

      {/* Empty state */}
      {personas.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Users className="h-7 w-7 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">Aucun persona</h3>
            <p className="mt-1 text-center text-sm text-muted-foreground">
              Creez votre premier persona pour commencer a rediger du contenu
              avec une voix unique.
            </p>
            <Button className="mt-6" onClick={handleCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Creer un persona
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Personas grid */}
      {personas.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {personas.map((persona) => (
            <Card key={persona.id} className="relative group">
              <CardHeader className="flex flex-row items-start gap-4 space-y-0">
                {/* Avatar */}
                <Avatar className="h-12 w-12 shrink-0">
                  {persona.avatar_reference_url && (
                    <AvatarImage
                      src={persona.avatar_reference_url}
                      alt={persona.name}
                    />
                  )}
                  <AvatarFallback
                    className={`text-white font-semibold ${getAvatarColor(persona.name)}`}
                  >
                    {getInitials(persona.name)}
                  </AvatarFallback>
                </Avatar>

                {/* Name + Role */}
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base leading-tight">
                    {persona.name}
                  </CardTitle>
                  <CardDescription className="mt-0.5 text-sm">
                    {persona.role}
                  </CardDescription>
                  {persona.seo_sites && (
                    <Badge variant="secondary" className="mt-2 text-xs">
                      {persona.seo_sites.name}
                    </Badge>
                  )}
                </div>

                {/* Actions dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreVertical className="h-4 w-4" />
                      <span className="sr-only">Actions</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleEdit(persona)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Modifier
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => handleDelete(persona.id)}
                      disabled={deletingId === persona.id}
                    >
                      {deletingId === persona.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-2 h-4 w-4" />
                      )}
                      Supprimer
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>

              {/* Bio / Tone */}
              {(persona.bio || persona.tone_description) && (
                <CardContent className="pt-0">
                  {persona.tone_description && (
                    <p className="text-xs text-muted-foreground italic mb-1">
                      {persona.tone_description}
                    </p>
                  )}
                  {persona.bio && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {persona.bio}
                    </p>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <PersonaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        persona={editingPersona}
        onSuccess={handleDialogSuccess}
      />
    </div>
  );
}
