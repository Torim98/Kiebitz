import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { useT } from "../lib/i18n";
import { Button, Tag } from "./ui";

export function parseTagInput(value: string): string[] {
  return value.split(/[,;]/).map((tag) => tag.trim()).filter(Boolean);
}

export default function TagEditor({
  tags,
  onChange,
  editable = true,
  prefix,
}: {
  tags: string[];
  onChange: (tags: string[]) => void | Promise<void>;
  editable?: boolean;
  prefix?: ReactNode;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");

  const addTags = async () => {
    const additions = parseTagInput(draft);
    if (!additions.length) return;
    await onChange([...tags, ...additions]);
    setDraft("");
  };

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {prefix}
        {tags.map((tag) => (
          <button
            key={tag}
            onClick={() => onChange(tags.filter((value) => value !== tag))}
            disabled={!editable}
            title={t("games.removeTag")}
          >
            <Tag>{tag} ×</Tag>
          </button>
        ))}
        {!prefix && tags.length === 0 && (
          <span className="text-[12px] text-ink3">{t("games.noTags")}</span>
        )}
      </div>
      {editable && (
        <div className="mt-2 flex gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                addTags();
              }
            }}
            placeholder={t("games.tagPlaceholder")}
            className="min-w-0 flex-1 rounded-md border border-line bg-panel2 px-2 py-1.5 text-[12px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
          />
          <Button
            onClick={addTags}
            disabled={!draft.trim()}
            className="!px-2.5 !py-1.5 !text-[12px]"
          >
            <Plus size={13} /> {t("games.addTag")}
          </Button>
        </div>
      )}
    </>
  );
}
