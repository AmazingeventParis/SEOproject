"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/hooks/use-toast"
import { Save, Key, Brain, Search, ImageIcon, Loader2, CheckCircle, XCircle } from "lucide-react"

interface ConfigEntry {
  key: string
  value: unknown
}

const API_KEY_FIELDS = [
  { key: "anthropic_api_key", label: "Anthropic (Claude)", icon: Brain, placeholder: "sk-ant-..." },
  { key: "gemini_api_key", label: "Google Gemini", icon: Brain, placeholder: "AIza..." },
  { key: "serper_api_key", label: "Serper.dev (SERP)", icon: Search, placeholder: "Cle API Serper" },
  { key: "fal_api_key", label: "Fal.ai (Images)", icon: ImageIcon, placeholder: "fal-..." },
  { key: "gsc_client_email", label: "GSC Service Account Email", icon: Key, placeholder: "xxx@project.iam.gserviceaccount.com" },
]

const THRESHOLD_FIELDS = [
  { key: "nugget_density_threshold", label: "Seuil densite Nuggets", description: "Nombre minimum de nuggets par article", defaultValue: 3 },
  { key: "monthly_budget_usd", label: "Budget mensuel IA ($)", description: "Alerte si les depenses depassent 80% de ce montant", defaultValue: 50 },
]

export default function SettingsPage() {
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const { toast } = useToast()

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/config")
      if (res.ok) {
        const data: ConfigEntry[] = await res.json()
        const map: Record<string, unknown> = {}
        data.forEach((entry) => {
          map[entry.key] = entry.value
        })
        setConfig(map)
      }
    } catch {
      // Config may not exist yet
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const saveConfig = async (key: string, value: unknown) => {
    setSaving(key)
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      })
      if (!res.ok) throw new Error("Erreur sauvegarde")
      setConfig((prev) => ({ ...prev, [key]: value }))
      toast({ title: "Sauvegarde", description: `${key} mis a jour` })
    } catch {
      toast({ title: "Erreur", description: "Impossible de sauvegarder", variant: "destructive" })
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Configuration globale de l&apos;outil SEO</p>
      </div>

      {/* API Keys */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Cles API
          </CardTitle>
          <CardDescription>
            Configurez vos cles API pour les services externes
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {API_KEY_FIELDS.map((field) => {
            const currentValue = (config[field.key] as string) || ""
            const hasValue = !!currentValue
            return (
              <div key={field.key} className="flex items-end gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor={field.key} className="flex items-center gap-2">
                    <field.icon className="h-3.5 w-3.5 text-muted-foreground" />
                    {field.label}
                    {hasValue ? (
                      <Badge variant="outline" className="ml-1 gap-1 text-green-500 border-green-500/30">
                        <CheckCircle className="h-3 w-3" /> Configure
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="ml-1 gap-1 text-orange-500 border-orange-500/30">
                        <XCircle className="h-3 w-3" /> Non configure
                      </Badge>
                    )}
                  </Label>
                  <Input
                    id={field.key}
                    type="password"
                    placeholder={field.placeholder}
                    defaultValue={currentValue}
                    onBlur={(e) => {
                      const val = e.target.value.trim()
                      if (val !== currentValue) {
                        saveConfig(field.key, val)
                      }
                    }}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={saving === field.key}
                  onClick={(e) => {
                    const input = (e.currentTarget.parentElement?.querySelector("input") as HTMLInputElement)
                    if (input) saveConfig(field.key, input.value.trim())
                  }}
                >
                  {saving === field.key ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                </Button>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Separator />

      {/* Thresholds */}
      <Card>
        <CardHeader>
          <CardTitle>Seuils & Parametres</CardTitle>
          <CardDescription>Parametres de qualite du pipeline de production</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {THRESHOLD_FIELDS.map((field) => {
            const currentValue = config[field.key] as number | undefined
            return (
              <div key={field.key} className="flex items-end gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor={field.key}>{field.label}</Label>
                  <p className="text-xs text-muted-foreground">{field.description}</p>
                  <Input
                    id={field.key}
                    type="number"
                    min={0}
                    defaultValue={currentValue ?? field.defaultValue}
                    onBlur={(e) => {
                      const val = Number(e.target.value)
                      if (val !== currentValue) {
                        saveConfig(field.key, val)
                      }
                    }}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={saving === field.key}
                  onClick={(e) => {
                    const input = (e.currentTarget.parentElement?.querySelector("input") as HTMLInputElement)
                    if (input) saveConfig(field.key, Number(input.value))
                  }}
                >
                  {saving === field.key ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                </Button>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Supabase Info */}
      <Card>
        <CardHeader>
          <CardTitle>Infrastructure</CardTitle>
          <CardDescription>Informations de connexion (lecture seule)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Supabase URL</span>
              <code className="text-xs">{process.env.NEXT_PUBLIC_SUPABASE_URL || "Non configure"}</code>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">App URL</span>
              <code className="text-xs">{process.env.NEXT_PUBLIC_APP_URL || "Non configure"}</code>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
