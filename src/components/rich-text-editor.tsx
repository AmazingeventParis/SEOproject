"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { useEffect, useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Table2,
  Undo,
  Redo,
} from "lucide-react";
import { TableBuilderDialog } from "@/components/table-builder-dialog";

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
}

function stripTableWrappers(html: string): string {
  return html.replace(
    /<div class="table-container">\s*(<table[\s\S]*?<\/table>)\s*<\/div>/g,
    "$1"
  );
}

function wrapTablesWithContainer(html: string): string {
  return html.replace(
    /(<table[\s\S]*?<\/table>)/g,
    '<div class="table-container">$1</div>'
  );
}

export function RichTextEditor({ content, onChange }: RichTextEditorProps) {
  const lastEmittedHtml = useRef<string>("");
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const [selectedText, setSelectedText] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          rel: "noopener noreferrer",
        },
      }),
      Underline,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: stripTableWrappers(content),
    onUpdate: ({ editor }) => {
      const html = wrapTablesWithContainer(editor.getHTML());
      lastEmittedHtml.current = html;
      onChange(html);
    },
  });

  useEffect(() => {
    if (editor && content !== lastEmittedHtml.current) {
      editor.commands.setContent(stripTableWrappers(content));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("URL du lien :", previousUrl);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url })
      .run();
  }, [editor]);

  const openTableBuilder = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, "\n");
    setSelectedText(text);
    setTableDialogOpen(true);
  }, [editor]);

  const handleTableInsert = useCallback(
    (tableHtml: string) => {
      if (!editor) return;
      editor.chain().focus().deleteSelection().insertContent(tableHtml).run();
    },
    [editor]
  );

  if (!editor) return null;

  return (
    <div className="border rounded-md overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/50 p-1">
        <Button
          type="button"
          size="sm"
          variant={editor.isActive("bold") ? "default" : "ghost"}
          className="h-7 w-7 p-0"
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Gras"
        >
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant={editor.isActive("italic") ? "default" : "ghost"}
          className="h-7 w-7 p-0"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italique"
        >
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant={editor.isActive("underline") ? "default" : "ghost"}
          className="h-7 w-7 p-0"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="Souligne"
        >
          <UnderlineIcon className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant={editor.isActive("link") ? "default" : "ghost"}
          className="h-7 w-7 p-0"
          onClick={setLink}
          title="Lien"
        >
          <LinkIcon className="h-3.5 w-3.5" />
        </Button>

        <div className="w-px h-5 bg-border mx-1" />

        <Button
          type="button"
          size="sm"
          variant={editor.isActive("bulletList") ? "default" : "ghost"}
          className="h-7 w-7 p-0"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Liste a puces"
        >
          <List className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant={editor.isActive("orderedList") ? "default" : "ghost"}
          className="h-7 w-7 p-0"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Liste numerotee"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant={editor.isActive("blockquote") ? "default" : "ghost"}
          className="h-7 w-7 p-0"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Citation"
        >
          <Quote className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant={editor.isActive("table") ? "default" : "ghost"}
          className="h-7 w-7 p-0"
          onClick={openTableBuilder}
          title="Tableau"
        >
          <Table2 className="h-3.5 w-3.5" />
        </Button>

        <div className="w-px h-5 bg-border mx-1" />

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Annuler"
        >
          <Undo className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Retablir"
        >
          <Redo className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Editor content */}
      <EditorContent
        editor={editor}
        className="prose prose-sm max-w-none p-3 min-h-[200px] focus-within:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[180px]"
      />

      {/* Table builder dialog */}
      <TableBuilderDialog
        open={tableDialogOpen}
        selectedText={selectedText}
        onInsert={handleTableInsert}
        onClose={() => setTableDialogOpen(false)}
      />
    </div>
  );
}
