"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";

interface TableBuilderDialogProps {
  open: boolean;
  selectedText: string;
  onInsert: (html: string) => void;
  onClose: () => void;
}

function parseSelectedText(text: string): string[][] {
  if (!text.trim()) {
    return [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""],
    ];
  }

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Detect delimiter: pipe or tab
  const hasPipe = lines.some((l) => l.includes("|"));
  const hasTab = lines.some((l) => l.includes("\t"));
  const delimiter = hasPipe ? "|" : hasTab ? "\t" : null;

  if (!delimiter) {
    // One column per line
    return lines.map((l) => [l]);
  }

  const rows = lines.map((line) =>
    line
      .split(delimiter)
      .map((cell) => cell.trim())
      .filter((_, i, arr) => {
        // Remove empty first/last cells from pipe-delimited lines like |a|b|
        if (delimiter === "|" && (i === 0 || i === arr.length - 1)) {
          return arr[i] !== "";
        }
        return true;
      })
  );

  // Normalize column count
  const maxCols = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => {
    while (r.length < maxCols) r.push("");
    return r;
  });
}

function generateTableHtml(
  data: string[][],
  hasHeader: boolean
): string {
  const rows = data.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (rows.length === 0) return "";

  let html = "<table>\n";

  if (hasHeader && rows.length > 0) {
    const headerRow = rows[0];
    html += "  <thead>\n    <tr>\n";
    headerRow.forEach((cell) => {
      html += `      <th>${escapeHtml(cell)}</th>\n`;
    });
    html += "    </tr>\n  </thead>\n";

    if (rows.length > 1) {
      html += "  <tbody>\n";
      for (let i = 1; i < rows.length; i++) {
        html += "    <tr>\n";
        rows[i].forEach((cell) => {
          html += `      <td>${escapeHtml(cell)}</td>\n`;
        });
        html += "    </tr>\n";
      }
      html += "  </tbody>\n";
    }
  } else {
    html += "  <tbody>\n";
    rows.forEach((row) => {
      html += "    <tr>\n";
      row.forEach((cell) => {
        html += `      <td>${escapeHtml(cell)}</td>\n`;
      });
      html += "    </tr>\n";
    });
    html += "  </tbody>\n";
  }

  html += "</table>";
  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function TableBuilderDialog({
  open,
  selectedText,
  onInsert,
  onClose,
}: TableBuilderDialogProps) {
  const [data, setData] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);

  useEffect(() => {
    if (open) {
      setData(parseSelectedText(selectedText));
      setHasHeader(true);
    }
  }, [open, selectedText]);

  const colCount = data.length > 0 ? data[0].length : 0;

  const updateCell = (row: number, col: number, value: string) => {
    setData((prev) => {
      const next = prev.map((r) => [...r]);
      next[row][col] = value;
      return next;
    });
  };

  const addRow = () => {
    setData((prev) => [...prev, new Array(colCount).fill("")]);
  };

  const addColumn = () => {
    setData((prev) => prev.map((row) => [...row, ""]));
  };

  const removeRow = (index: number) => {
    if (data.length <= 1) return;
    setData((prev) => prev.filter((_, i) => i !== index));
  };

  const previewHtml = useMemo(
    () => generateTableHtml(data, hasHeader),
    [data, hasHeader]
  );

  const handleInsert = () => {
    if (previewHtml) {
      onInsert(previewHtml);
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Construire un tableau</DialogTitle>
          <DialogDescription>
            Organisez les donnees en grille puis inserez le tableau.
          </DialogDescription>
        </DialogHeader>

        {/* Header toggle */}
        <div className="flex items-center gap-2">
          <Switch
            id="has-header"
            checked={hasHeader}
            onCheckedChange={setHasHeader}
          />
          <Label htmlFor="has-header">Premiere ligne = en-tete</Label>
        </div>

        {/* Editable grid */}
        <div className="space-y-1 overflow-x-auto">
          {data.map((row, ri) => (
            <div key={ri} className="flex items-center gap-1">
              {row.map((cell, ci) => (
                <Input
                  key={ci}
                  value={cell}
                  onChange={(e) => updateCell(ri, ci, e.target.value)}
                  className={`h-8 text-xs min-w-[100px] ${
                    hasHeader && ri === 0 ? "font-semibold bg-muted" : ""
                  }`}
                  placeholder={
                    hasHeader && ri === 0
                      ? `En-tete ${ci + 1}`
                      : `Cellule`
                  }
                />
              ))}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 shrink-0"
                onClick={() => removeRow(ri)}
                disabled={data.length <= 1}
                title="Supprimer la ligne"
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>

        {/* Add row / column */}
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addRow}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Ligne
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addColumn}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Colonne
          </Button>
        </div>

        {/* Live preview */}
        {previewHtml && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Apercu</Label>
            <div
              className="table-container border rounded-md p-2"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button type="button" onClick={handleInsert} disabled={!previewHtml}>
            Inserer le tableau
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
