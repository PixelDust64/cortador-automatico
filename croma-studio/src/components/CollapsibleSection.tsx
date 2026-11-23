import { ChevronDown, ChevronRight } from 'lucide-react';
import { ReactNode, useState } from 'react';

interface CollapsibleSectionProps {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  rightSlot?: ReactNode;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  badge,
  defaultOpen = true,
  rightSlot,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="p-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-left text-[13px] font-semibold text-zinc-100 hover:text-white transition-colors cursor-pointer min-w-0"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">{title}</span>
          {badge && (
            <span className="ml-1 px-1.5 py-0.5 rounded bg-[#1E212B] font-mono text-[10px] font-medium text-zinc-400 shrink-0">
              {badge}
            </span>
          )}
        </button>
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </section>
  );
}
