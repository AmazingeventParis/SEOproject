"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Site, Persona, SearchIntent } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2 } from "lucide-react";

const SEARCH_INTENT_OPTIONS: { value: SearchIntent; label: string }[] = [
  { value: "traffic", label: "Trafic" },
  { value: "review", label: "Test / Avis" },
  { value: "comparison", label: "Comparatif" },
  { value: "discover", label: "Decouverte" },
  { value: "lead_gen", label: "Generation de leads" },
  { value: "informational", label: "Informationnel" },
];

interface PersonaWithSite extends Persona {
  seo_sites: { name: string; domain: string } | null;
}

export default function NewArticlePage() {
  const router = useRouter();
  const { toast } = useToast();

  const [sites, setSites] = useState<Site[]>([]);
  const [personas, setPersonas] = useState<PersonaWithSite[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [keyword, setKeyword] = useState("");
  const [siteId, setSiteId] = useState("");
  const [searchIntent, setSearchIntent] = useState<SearchIntent>("traffic");
  const [personaId, setPersonaId] = useState<string>("");

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch("/api/sites");
      if (res.ok) {
        const data = await res.json();
        setSites(data);
      }
    } catch {
      // silent
    }
  }, []);

  const fetchPersonas = useCallback(async () => {
    try {
      const res = await fetch("/api/personas");
      if (res.ok) {
        const data = await res.json();
        setPersonas(data);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchSites();
    fetchPersonas();
  }, [fetchSites, fetchPersonas]);

  // Filter personas by selected site
  const filteredPersonas = siteId
    ? personas.filter((p) => p.site_id === siteId)
    : [];

  // Reset persona when site changes
  useEffect(() => {
    setPersonaId("");
  }, [siteId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!keyword.trim()) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Le mot-cle est requis.",
      });
      return;
    }

    if (!siteId) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Veuillez selectionner un site.",
      });
      return;
    }

    setSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        keyword: keyword.trim(),
        site_id: siteId,
        search_intent: searchIntent,
      };
      if (personaId) {
        payload.persona_id = personaId;
      }

      const res = await fetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erreur lors de la creation");
      }

      const newArticle = await res.json();

      toast({
        title: "Article cree",
        description: `L'article "${keyword}" a ete cree avec succes.`,
      });

      router.push(`/dashboard/articles/${newArticle.id}`);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description:
          err instanceof Error ? err.message : "Une erreur est survenue.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Back link */}
      <Link
        href="/dashboard/articles"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        Retour aux articles
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Nouvel article</CardTitle>
          <CardDescription>
            Renseignez les informations de base pour lancer la production de
            votre article SEO.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Keyword */}
            <div className="space-y-2">
              <Label htmlFor="keyword">
                Mot-cle principal <span className="text-destructive">*</span>
              </Label>
              <Input
                id="keyword"
                placeholder="ex: meilleur aspirateur robot 2025"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="text-lg h-12"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Le mot-cle principal autour duquel l&apos;article sera optimise.
              </p>
            </div>

            {/* Site */}
            <div className="space-y-2">
              <Label htmlFor="site">
                Site <span className="text-destructive">*</span>
              </Label>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger id="site">
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
            </div>

            {/* Search Intent */}
            <div className="space-y-2">
              <Label htmlFor="intent">Intention de recherche</Label>
              <Select
                value={searchIntent}
                onValueChange={(v) => setSearchIntent(v as SearchIntent)}
              >
                <SelectTrigger id="intent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEARCH_INTENT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                L&apos;intention de recherche influence le ton et la structure de
                l&apos;article.
              </p>
            </div>

            {/* Persona */}
            <div className="space-y-2">
              <Label htmlFor="persona">Persona (optionnel)</Label>
              <Select
                value={personaId || "__none__"}
                onValueChange={(v) =>
                  setPersonaId(v === "__none__" ? "" : v)
                }
                disabled={!siteId}
              >
                <SelectTrigger id="persona">
                  <SelectValue
                    placeholder={
                      siteId
                        ? "Selectionner un persona"
                        : "Selectionnez d'abord un site"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Aucun persona</SelectItem>
                  {filteredPersonas.map((persona) => (
                    <SelectItem key={persona.id} value={persona.id}>
                      {persona.name} - {persona.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Le persona definit le ton et le style de redaction. Peut etre
                assigne plus tard.
              </p>
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-3 pt-2">
              <Link href="/dashboard/articles">
                <Button type="button" variant="outline">
                  Annuler
                </Button>
              </Link>
              <Button type="submit" disabled={submitting}>
                {submitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Creer l&apos;article
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
