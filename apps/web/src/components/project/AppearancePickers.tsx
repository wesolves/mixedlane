import { useDeferredValue, useMemo, useState } from "react";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { splitIcon } from "@/components/common";
import { SWATCHES } from "@/lib/meta";
import { cn } from "@/lib/utils";

const HEX = /^#[0-9a-fA-F]{6}$/;

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [hex, setHex] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setHex(value);
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            onClick={() => onChange(c)}
            className={cn(
              "size-7 rounded-full ring-offset-2 ring-offset-background transition hover:scale-110",
              value.toLowerCase() === c && "ring-2 ring-foreground",
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label
          className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-lg border shadow-xs"
          style={{ backgroundColor: value }}
          title="Pick any color"
        >
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        <Input
          value={hex}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            setHex(v);
            if (HEX.test(v)) onChange(v.toLowerCase());
          }}
          className="h-9 w-32 font-mono uppercase"
          maxLength={7}
          aria-label="Hex color"
          aria-invalid={!HEX.test(hex)}
        />
        <span className="text-xs text-muted-foreground">Any color — use the picker or type a hex value.</span>
      </div>
    </div>
  );
}

const EMOJIS = [
  "🚀", "📱", "💻", "🌐", "🛒", "💳", "📦", "🧩", "🎨", "✨", "🔥", "⚡", "🎯", "📈", "📊", "🧪",
  "🛠️", "⚙️", "🔒", "🤖", "🧠", "📚", "📝", "📣", "🎮", "🎬", "🎵", "🏠", "🏥", "🏦", "✈️", "🚗",
  "🌱", "🍕", "☕", "❤️", "⭐", "🌈", "🐞", "🦄", "🐙", "🦊", "🐳", "🌍", "🏆", "💡", "🔔", "🗂️",
];

const POPULAR: IconName[] = [
  "rocket", "smartphone", "globe", "code", "briefcase", "palette", "database", "heart", "zap", "shopping-cart",
  "book", "cpu", "cloud", "server", "shield", "bot", "brain", "gamepad-2", "music", "camera",
  "graduation-cap", "hospital", "building-2", "car", "plane", "leaf", "flame", "star", "trophy", "target",
  "megaphone", "chart-line", "wallet", "package", "truck", "store", "users", "message-circle", "mail", "calendar",
];

export function IconPicker({ value, color, onChange }: { value: string; color: string; onChange: (icon: string) => void }) {
  const [kind, current] = splitIcon(value);
  const [q, setQ] = useState("");
  const deferred = useDeferredValue(q.trim().toLowerCase());
  const [emoji, setEmoji] = useState(kind === "emoji" ? current : "");

  const results = useMemo(() => {
    if (!deferred) return POPULAR;
    const words = deferred.split(/\s+/);
    return iconNames.filter((n) => words.every((w) => n.includes(w))).slice(0, 160);
  }, [deferred]);

  return (
    <Tabs defaultValue={kind === "emoji" ? "emoji" : "icons"}>
      <TabsList>
        <TabsTrigger value="icons">Icons ({iconNames.length.toLocaleString()})</TabsTrigger>
        <TabsTrigger value="emoji">Emoji</TabsTrigger>
      </TabsList>

      <TabsContent value="icons" className="mt-3 space-y-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search every Lucide icon — e.g. car, chart, heart" className="pl-8" />
        </div>
        <div className="grid max-h-56 grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1.5 overflow-y-auto rounded-lg border p-2 scroll-thin">
          {results.map((name) => {
            const selected = kind === "lucide" && current === name;
            return (
              <button
                key={name}
                type="button"
                title={name}
                onClick={() => onChange(`lucide:${name}`)}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  selected && "text-white",
                )}
                style={selected ? { backgroundColor: color } : undefined}
              >
                <DynamicIcon name={name} className="size-5" fallback={() => <span className="size-5" />} />
              </button>
            );
          })}
          {results.length === 0 && <p className="col-span-full py-6 text-center text-sm text-muted-foreground">No icons match “{q}”.</p>}
        </div>
        {!deferred && <p className="text-xs text-muted-foreground">Showing popular icons — search to browse all of them.</p>}
      </TabsContent>

      <TabsContent value="emoji" className="mt-3 space-y-3">
        <div className="flex items-center gap-2">
          <Input
            value={emoji}
            onChange={(e) => {
              // Keep a single grapheme (emoji can be several code units).
              const chars = [...new Intl.Segmenter().segment(e.target.value)].map((s) => s.segment);
              const next = chars.at(-1) ?? "";
              setEmoji(next);
              if (next.trim()) onChange(`emoji:${next}`);
            }}
            placeholder="Type or paste any emoji"
            className="w-56"
          />
          <span className="text-xs text-muted-foreground">Tip: Win + . opens the emoji keyboard.</span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1.5 rounded-lg border p-2">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                setEmoji(e);
                onChange(`emoji:${e}`);
              }}
              className={cn(
                "flex aspect-square items-center justify-center rounded-md text-xl hover:bg-muted",
                kind === "emoji" && current === e && "bg-primary/15 ring-2 ring-primary",
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </TabsContent>
    </Tabs>
  );
}
