"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  Save,
  GripVertical,
  Link2,
  Star,
  ShoppingCart,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { ProductRating } from "@/lib/supabase/types";

// ---- Local types ----

interface LocalCriterion {
  id: string;
  name: string;
  unit: string;
}

interface LocalSpec {
  criterion_id: string;
  value: string;
  rating: ProductRating;
}

interface LocalProduct {
  id: string;
  name: string;
  brand: string;
  price: string;
  price_label: string;
  image_url: string;
  affiliate_url: string;
  affiliate_enabled: boolean;
  rating: string;
  rating_scale: number;
  verdict: string;
  pros: string[];
  cons: string[];
  specs: LocalSpec[];
  collapsed: boolean;
}

interface Props {
  articleId: string;
}

function genId() {
  return crypto.randomUUID();
}

const RATING_COLORS: Record<ProductRating, { bg: string; text: string; label: string }> = {
  above: { bg: "#dcfce7", text: "#166534", label: "Au-dessus" },
  average: { bg: "#fef9c3", text: "#854d0e", label: "Moyen" },
  below: { bg: "#fee2e2", text: "#991b1b", label: "En-dessous" },
};

export function ProductComparisonEditor({ articleId }: Props) {
  const [criteria, setCriteria] = useState<LocalCriterion[]>([]);
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  // Load existing data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/articles/${articleId}/products`);
      if (!res.ok) throw new Error("Erreur chargement");
      const data = await res.json();

      const loadedCriteria = (data.criteria || []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any) => ({ id: c.id, name: c.name, unit: c.unit || "" })
      );
      setCriteria(loadedCriteria);

      const loadedProducts = (data.products || []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p: any) => ({
          id: p.id,
          name: p.name || "",
          brand: p.brand || "",
          price: p.price != null ? String(p.price) : "",
          price_label: p.price_label || "",
          image_url: p.image_url || "",
          affiliate_url: p.affiliate_url || "",
          affiliate_enabled: p.affiliate_enabled || false,
          rating: p.rating != null ? String(p.rating) : "",
          rating_scale: p.rating_scale || 10,
          verdict: p.verdict || "",
          pros: p.pros?.length ? p.pros : [""],
          cons: p.cons?.length ? p.cons : [""],
          specs: loadedCriteria.map((c: LocalCriterion) => {
            const existing = (p.specs || []).find(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (s: any) => s.criterion_id === c.id
            );
            return existing || { criterion_id: c.id, value: "", rating: "average" as ProductRating };
          }),
          collapsed: false,
        })
      );
      setProducts(loadedProducts);
    } catch {
      // start fresh
    }
    setLoading(false);
  }, [articleId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ---- Criteria management ----

  function addCriterion() {
    const newC: LocalCriterion = { id: genId(), name: "", unit: "" };
    setCriteria((prev) => [...prev, newC]);
    // Add spec slot to all products
    setProducts((prev) =>
      prev.map((p) => ({
        ...p,
        specs: [...p.specs, { criterion_id: newC.id, value: "", rating: "average" as ProductRating }],
      }))
    );
  }

  function removeCriterion(id: string) {
    setCriteria((prev) => prev.filter((c) => c.id !== id));
    setProducts((prev) =>
      prev.map((p) => ({
        ...p,
        specs: p.specs.filter((s) => s.criterion_id !== id),
      }))
    );
  }

  function updateCriterion(id: string, field: "name" | "unit", value: string) {
    setCriteria((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  }

  // ---- Product management ----

  function addProduct() {
    setProducts((prev) => [
      ...prev,
      {
        id: genId(),
        name: "",
        brand: "",
        price: "",
        price_label: "",
        image_url: "",
        affiliate_url: "",
        affiliate_enabled: false,
        rating: "",
        rating_scale: 10,
        verdict: "",
        pros: [""],
        cons: [""],
        specs: criteria.map((c) => ({
          criterion_id: c.id,
          value: "",
          rating: "average" as ProductRating,
        })),
        collapsed: false,
      },
    ]);
  }

  function removeProduct(id: string) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  function updateProduct(id: string, field: string, value: unknown) {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  }

  function updateSpec(productId: string, criterionId: string, field: "value" | "rating", value: string) {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== productId) return p;
        return {
          ...p,
          specs: p.specs.map((s) =>
            s.criterion_id === criterionId ? { ...s, [field]: value } : s
          ),
        };
      })
    );
  }

  function addListItem(productId: string, field: "pros" | "cons") {
    setProducts((prev) =>
      prev.map((p) =>
        p.id === productId ? { ...p, [field]: [...p[field], ""] } : p
      )
    );
  }

  function updateListItem(productId: string, field: "pros" | "cons", index: number, value: string) {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== productId) return p;
        const list = [...p[field]];
        list[index] = value;
        return { ...p, [field]: list };
      })
    );
  }

  function removeListItem(productId: string, field: "pros" | "cons", index: number) {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== productId) return p;
        return { ...p, [field]: p[field].filter((_, i) => i !== index) };
      })
    );
  }

  // ---- Save ----

  async function handleSave() {
    setSaving(true);
    setMessage("");

    const payload = {
      criteria: criteria
        .filter((c) => c.name.trim())
        .map((c, i) => ({
          id: c.id,
          name: c.name.trim(),
          unit: c.unit.trim() || null,
          sort_order: i,
        })),
      products: products
        .filter((p) => p.name.trim())
        .map((p, i) => ({
          id: p.id,
          name: p.name.trim(),
          brand: p.brand.trim() || null,
          price: p.price ? parseFloat(p.price) : null,
          price_label: p.price_label.trim() || null,
          image_url: p.image_url.trim() || null,
          affiliate_url: p.affiliate_url.trim() || null,
          affiliate_enabled: p.affiliate_enabled,
          rating: p.rating ? parseFloat(p.rating) : null,
          rating_scale: p.rating_scale,
          verdict: p.verdict.trim() || null,
          pros: p.pros.filter((x) => x.trim()),
          cons: p.cons.filter((x) => x.trim()),
          specs: p.specs
            .filter((s) => s.value.trim())
            .map((s) => ({
              criterion_id: s.criterion_id,
              value: s.value.trim(),
              rating: s.rating,
            })),
          sort_order: i,
        })),
    };

    try {
      const res = await fetch(`/api/articles/${articleId}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erreur");
      }

      const result = await res.json();
      setMessage(`${result.products_count} produit(s) et ${result.criteria_count} critere(s) sauvegardes.`);
      // Reload to get real IDs
      await loadData();
    } catch (err) {
      setMessage(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ---- Criteria definition ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
            Criteres de comparaison
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Definissez les colonnes du tableau comparatif (ex: Autonomie, Poids, Ecran, Prix).
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {criteria.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <Input
                placeholder="Nom du critere (ex: Autonomie)"
                value={c.name}
                onChange={(e) => updateCriterion(c.id, "name", e.target.value)}
                className="flex-1"
              />
              <Input
                placeholder="Unite (ex: heures)"
                value={c.unit}
                onChange={(e) => updateCriterion(c.id, "unit", e.target.value)}
                className="w-32"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeCriterion(c.id)}
                className="shrink-0 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addCriterion}>
            <Plus className="mr-1 h-3 w-3" />
            Ajouter un critere
          </Button>
        </CardContent>
      </Card>

      {/* ---- Products ---- */}
      {products.map((product, pIdx) => (
        <Card key={product.id} className="border-l-4 border-l-primary/30">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                {product.name || `Produit ${pIdx + 1}`}
                {product.affiliate_enabled && (
                  <Badge variant="secondary" className="text-xs">
                    <Link2 className="mr-1 h-3 w-3" />
                    Affiliation
                  </Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => updateProduct(product.id, "collapsed", !product.collapsed)}
                >
                  {product.collapsed ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronUp className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeProduct(product.id)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>

          {!product.collapsed && (
            <CardContent className="space-y-4">
              {/* Basic info */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Nom du produit *</Label>
                  <Input
                    value={product.name}
                    onChange={(e) => updateProduct(product.id, "name", e.target.value)}
                    placeholder="Ex: iPhone 16 Pro"
                  />
                </div>
                <div>
                  <Label className="text-xs">Marque</Label>
                  <Input
                    value={product.brand}
                    onChange={(e) => updateProduct(product.id, "brand", e.target.value)}
                    placeholder="Ex: Apple"
                  />
                </div>
                <div>
                  <Label className="text-xs">Prix</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={product.price}
                    onChange={(e) => updateProduct(product.id, "price", e.target.value)}
                    placeholder="299.99"
                  />
                </div>
                <div>
                  <Label className="text-xs">Label prix (optionnel)</Label>
                  <Input
                    value={product.price_label}
                    onChange={(e) => updateProduct(product.id, "price_label", e.target.value)}
                    placeholder="Ex: A partir de 299 EUR"
                  />
                </div>
              </div>

              {/* Rating */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs flex items-center gap-1">
                    <Star className="h-3 w-3" />
                    Note
                  </Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={product.rating}
                    onChange={(e) => updateProduct(product.id, "rating", e.target.value)}
                    placeholder="8.5"
                  />
                </div>
                <div>
                  <Label className="text-xs">Echelle</Label>
                  <Select
                    value={String(product.rating_scale)}
                    onValueChange={(v) => updateProduct(product.id, "rating_scale", parseInt(v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">/ 5</SelectItem>
                      <SelectItem value="10">/ 10</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Image URL</Label>
                  <Input
                    value={product.image_url}
                    onChange={(e) => updateProduct(product.id, "image_url", e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              </div>

              {/* Affiliate */}
              <div className="flex items-center gap-4 rounded-md border p-3 bg-muted/30">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={product.affiliate_enabled}
                    onCheckedChange={(v) => updateProduct(product.id, "affiliate_enabled", v)}
                  />
                  <Label className="text-xs font-medium">Lien d&apos;affiliation</Label>
                </div>
                {product.affiliate_enabled && (
                  <Input
                    value={product.affiliate_url}
                    onChange={(e) => updateProduct(product.id, "affiliate_url", e.target.value)}
                    placeholder="https://www.amazon.fr/dp/..."
                    className="flex-1"
                  />
                )}
              </div>

              {/* Specs with color rating */}
              {criteria.length > 0 && (
                <div>
                  <Label className="text-xs font-medium mb-2 block">
                    Caracteristiques
                  </Label>
                  <div className="space-y-2">
                    {criteria.map((c) => {
                      const spec = product.specs.find((s) => s.criterion_id === c.id);
                      const rating = spec?.rating || "average";
                      const colors = RATING_COLORS[rating];

                      return (
                        <div key={c.id} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-28 shrink-0 truncate">
                            {c.name || "..."}
                            {c.unit ? ` (${c.unit})` : ""}
                          </span>
                          <Input
                            value={spec?.value || ""}
                            onChange={(e) =>
                              updateSpec(product.id, c.id, "value", e.target.value)
                            }
                            placeholder="Valeur"
                            className="flex-1"
                          />
                          <Select
                            value={rating}
                            onValueChange={(v) =>
                              updateSpec(product.id, c.id, "rating", v)
                            }
                          >
                            <SelectTrigger
                              className="w-36"
                              style={{
                                backgroundColor: colors.bg,
                                color: colors.text,
                                borderColor: colors.text + "40",
                              }}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="above">
                                <span className="flex items-center gap-1">
                                  <span
                                    className="inline-block w-2 h-2 rounded-full"
                                    style={{ backgroundColor: RATING_COLORS.above.text }}
                                  />
                                  Au-dessus
                                </span>
                              </SelectItem>
                              <SelectItem value="average">
                                <span className="flex items-center gap-1">
                                  <span
                                    className="inline-block w-2 h-2 rounded-full"
                                    style={{ backgroundColor: RATING_COLORS.average.text }}
                                  />
                                  Moyen
                                </span>
                              </SelectItem>
                              <SelectItem value="below">
                                <span className="flex items-center gap-1">
                                  <span
                                    className="inline-block w-2 h-2 rounded-full"
                                    style={{ backgroundColor: RATING_COLORS.below.text }}
                                  />
                                  En-dessous
                                </span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Pros & Cons */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-medium text-green-700 mb-1 block">
                    Avantages
                  </Label>
                  {product.pros.map((pro, i) => (
                    <div key={i} className="flex items-center gap-1 mb-1">
                      <span className="text-green-600 text-xs">+</span>
                      <Input
                        value={pro}
                        onChange={(e) =>
                          updateListItem(product.id, "pros", i, e.target.value)
                        }
                        placeholder="Avantage..."
                        className="h-8 text-sm"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={() => removeListItem(product.id, "pros", i)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-green-700 text-xs h-6"
                    onClick={() => addListItem(product.id, "pros")}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Avantage
                  </Button>
                </div>
                <div>
                  <Label className="text-xs font-medium text-red-700 mb-1 block">
                    Inconvenients
                  </Label>
                  {product.cons.map((con, i) => (
                    <div key={i} className="flex items-center gap-1 mb-1">
                      <span className="text-red-600 text-xs">-</span>
                      <Input
                        value={con}
                        onChange={(e) =>
                          updateListItem(product.id, "cons", i, e.target.value)
                        }
                        placeholder="Inconvenient..."
                        className="h-8 text-sm"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={() => removeListItem(product.id, "cons", i)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-700 text-xs h-6"
                    onClick={() => addListItem(product.id, "cons")}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Inconvenient
                  </Button>
                </div>
              </div>

              {/* Verdict */}
              <div>
                <Label className="text-xs">Verdict (1-2 phrases)</Label>
                <Textarea
                  value={product.verdict}
                  onChange={(e) => updateProduct(product.id, "verdict", e.target.value)}
                  placeholder="Resume en 1-2 phrases : pour qui ce produit est-il fait ?"
                  rows={2}
                />
              </div>
            </CardContent>
          )}
        </Card>
      ))}

      {/* Add product + Save */}
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={addProduct}>
          <Plus className="mr-1 h-4 w-4" />
          Ajouter un produit
        </Button>

        <div className="flex items-center gap-3">
          {message && (
            <span
              className={`text-sm ${
                message.startsWith("Erreur") ? "text-destructive" : "text-green-600"
              }`}
            >
              {message}
            </span>
          )}
          <Button onClick={handleSave} disabled={saving || products.length === 0}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Sauvegarder les produits
          </Button>
        </div>
      </div>

      {/* Preview table */}
      {products.length >= 2 && criteria.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Apercu du tableau comparatif</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2 font-medium text-muted-foreground">
                      Critere
                    </th>
                    {products.filter((p) => p.name.trim()).map((p) => (
                      <th key={p.id} className="text-center p-2 font-medium">
                        {p.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Price row */}
                  <tr className="border-b">
                    <td className="p-2 font-medium text-muted-foreground">Prix</td>
                    {products.filter((p) => p.name.trim()).map((p) => (
                      <td key={p.id} className="text-center p-2">
                        {p.price_label || (p.price ? `${p.price} EUR` : "-")}
                      </td>
                    ))}
                  </tr>
                  {/* Rating row */}
                  <tr className="border-b">
                    <td className="p-2 font-medium text-muted-foreground">Note</td>
                    {products.filter((p) => p.name.trim()).map((p) => (
                      <td key={p.id} className="text-center p-2">
                        {p.rating ? `${p.rating}/${p.rating_scale}` : "-"}
                      </td>
                    ))}
                  </tr>
                  {/* Specs rows */}
                  {criteria.filter((c) => c.name.trim()).map((c) => (
                    <tr key={c.id} className="border-b">
                      <td className="p-2 font-medium text-muted-foreground">
                        {c.name}
                        {c.unit ? ` (${c.unit})` : ""}
                      </td>
                      {products.filter((p) => p.name.trim()).map((p) => {
                        const spec = p.specs.find((s) => s.criterion_id === c.id);
                        const rating = spec?.rating || "average";
                        const colors = RATING_COLORS[rating];
                        return (
                          <td
                            key={p.id}
                            className="text-center p-2 font-medium"
                            style={{
                              backgroundColor: spec?.value ? colors.bg : undefined,
                              color: spec?.value ? colors.text : undefined,
                            }}
                          >
                            {spec?.value || "-"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {/* Affiliate row */}
                  <tr>
                    <td className="p-2 font-medium text-muted-foreground">Lien</td>
                    {products.filter((p) => p.name.trim()).map((p) => (
                      <td key={p.id} className="text-center p-2">
                        {p.affiliate_enabled && p.affiliate_url ? (
                          <Badge variant="secondary" className="text-xs">
                            <Link2 className="mr-1 h-3 w-3" />
                            Affilie
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
