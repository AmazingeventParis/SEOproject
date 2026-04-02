"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface AddOpportunityDialogProps {
  siteId: string;
  onCreated: () => void;
}

export function AddOpportunityDialog({ siteId, onCreated }: AddOpportunityDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const [form, setForm] = useState({
    vendor_domain: "",
    vendor_url: "",
    tf: "",
    cf: "",
    da: "",
    dr: "",
    organic_traffic: "",
    price: "",
    target_page: "",
    target_keyword: "",
    niche: "",
    notes: "",
  });

  const handleSubmit = async () => {
    if (!form.vendor_domain.trim()) {
      toast({ title: "Domaine vendeur requis", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/netlinking/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: siteId,
          vendor_domain: form.vendor_domain.trim(),
          vendor_url: form.vendor_url || null,
          tf: parseInt(form.tf) || 0,
          cf: parseInt(form.cf) || 0,
          da: parseInt(form.da) || 0,
          dr: parseInt(form.dr) || 0,
          organic_traffic: parseInt(form.organic_traffic) || 0,
          price: parseFloat(form.price) || 0,
          target_page: form.target_page || null,
          target_keyword: form.target_keyword || null,
          niche: form.niche || null,
          notes: form.notes || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erreur");
      }

      toast({ title: "Opportunite ajoutee" });
      setOpen(false);
      setForm({ vendor_domain: "", vendor_url: "", tf: "", cf: "", da: "", dr: "", organic_traffic: "", price: "", target_page: "", target_keyword: "", niche: "", notes: "" });
      onCreated();
    } catch (e) {
      toast({ title: "Erreur", description: e instanceof Error ? e.message : "Erreur", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Ajouter</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajouter une opportunite de lien</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <div>
            <Label>Domaine vendeur *</Label>
            <Input placeholder="exemple.fr" value={form.vendor_domain} onChange={(e) => setForm({ ...form, vendor_domain: e.target.value })} />
          </div>
          <div>
            <Label>URL specifique (optionnel)</Label>
            <Input placeholder="https://exemple.fr/page" value={form.vendor_url} onChange={(e) => setForm({ ...form, vendor_url: e.target.value })} />
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label>TF</Label>
              <Input type="number" min="0" max="100" placeholder="0" value={form.tf} onChange={(e) => setForm({ ...form, tf: e.target.value })} />
            </div>
            <div>
              <Label>CF</Label>
              <Input type="number" min="0" max="100" placeholder="0" value={form.cf} onChange={(e) => setForm({ ...form, cf: e.target.value })} />
            </div>
            <div>
              <Label>DA</Label>
              <Input type="number" min="0" max="100" placeholder="0" value={form.da} onChange={(e) => setForm({ ...form, da: e.target.value })} />
            </div>
            <div>
              <Label>DR</Label>
              <Input type="number" min="0" max="100" placeholder="0" value={form.dr} onChange={(e) => setForm({ ...form, dr: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Trafic organique</Label>
              <Input type="number" min="0" placeholder="0" value={form.organic_traffic} onChange={(e) => setForm({ ...form, organic_traffic: e.target.value })} />
            </div>
            <div>
              <Label>Prix (EUR)</Label>
              <Input type="number" min="0" step="0.01" placeholder="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Page cible (mon site)</Label>
            <Input placeholder="https://monsite.fr/page-a-booster" value={form.target_page} onChange={(e) => setForm({ ...form, target_page: e.target.value })} />
          </div>
          <div>
            <Label>Mot-cle cible</Label>
            <Input placeholder="mot-cle principal" value={form.target_keyword} onChange={(e) => setForm({ ...form, target_keyword: e.target.value })} />
          </div>
          <div>
            <Label>Niche du vendeur</Label>
            <Input placeholder="technologie, maison, auto..." value={form.niche} onChange={(e) => setForm({ ...form, niche: e.target.value })} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea placeholder="Notes libres..." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <Button onClick={handleSubmit} disabled={loading} className="w-full">
            {loading ? "Ajout en cours..." : "Ajouter l'opportunite"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
