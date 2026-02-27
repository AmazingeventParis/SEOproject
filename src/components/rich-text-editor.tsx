"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import { useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Undo,
  Redo,
} from "lucide-react";

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
}

export function RichTextEditor({ content, onChange }: RichTextEditorProps) {
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
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
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
    </div>
  );
}
