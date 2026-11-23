import { BookmarkPlus, ImagePlus, Star, Trash2 } from 'lucide-react';
import { ChangeEvent, useRef, useState } from 'react';
import { SavedFavoriteItem } from '../types/studio';
import { CollapsibleSection } from './CollapsibleSection';

interface FavoritesSectionProps {
  title: string;
  items: SavedFavoriteItem[];
  maxItems?: number;
  saving?: boolean;
  error?: string | null;
  placeholder?: string;
  onSave: (nome: string) => void;
  onLoad: (item: SavedFavoriteItem) => void;
  onDelete: (id: string) => void;
  defaultOpen?: boolean;
  // Opcional (usado em Thumbs favoritas): marcar como final padrao + importar imagem pronta
  defaultEndId?: string | null;
  onToggleDefaultEnd?: (id: string | null) => void;
  onImportImage?: (nome: string, pngBase64: string, w: number, h: number) => void;
}

export function FavoritesSection({
  title,
  items,
  maxItems = 10,
  saving = false,
  error = null,
  placeholder = 'Nome do favorito...',
  onSave,
  onLoad,
  onDelete,
  defaultOpen = false,
  defaultEndId = null,
  onToggleDefaultEnd,
  onImportImage,
}: FavoritesSectionProps) {
  const [nome, setNome] = useState('');
  const importRef = useRef<HTMLInputElement | null>(null);
  const cheio = items.length >= maxItems;

  const handleSave = () => {
    if (cheio || saving) return;
    const limpo = nome.trim() || `${title.split(' ')[0]} ${items.length + 1}`;
    onSave(limpo);
    setNome('');
  };

  const handleImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onImportImage) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : null;
      if (!dataUrl) return;
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        if (ctx) ctx.drawImage(img, 0, 0);
        const baseNome = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Imagem importada';
        onImportImage(baseNome, c.toDataURL('image/png'), c.width, c.height);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <CollapsibleSection
      title={title}
      badge={`${items.length}/${maxItems}`}
      defaultOpen={defaultOpen}
    >
      <div className="flex gap-1.5">
        <input
          type="text"
          value={nome}
          maxLength={40}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
          }}
          placeholder={placeholder}
          disabled={cheio || saving}
          className="flex-1 min-w-0 h-8 px-2.5 rounded-lg bg-[#181A20] border border-[#282C37] text-[12px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-400 disabled:opacity-45"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={cheio || saving}
          className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg bg-[#252936] hover:bg-[#313647] border border-[#343948] text-[12px] font-medium text-zinc-100 disabled:opacity-40 cursor-pointer shrink-0"
        >
          <BookmarkPlus className="w-3.5 h-3.5" aria-hidden="true" />
          {saving ? '...' : 'Salvar'}
        </button>
      </div>

      {onImportImage && (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={cheio || saving}
            onClick={() => importRef.current?.click()}
            className="w-full inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-lg bg-[#171920] hover:bg-[#222531] border border-[#2A2E3B] text-[11.5px] font-medium text-zinc-200 disabled:opacity-40 cursor-pointer transition-colors"
          >
            <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
            Importar imagem pronta do PC
          </button>
          <input
            ref={importRef}
            type="file"
            accept="image/*"
            onChange={handleImportFile}
            className="hidden"
          />
        </div>
      )}

      {onToggleDefaultEnd && (
        <p className="text-[11px] text-zinc-400 leading-snug">
          Clique na <span className="text-amber-300 font-medium">★ Final</span> de uma thumb para usá-la automaticamente no final de todos os cortes (clique de novo para desativar).
        </p>
      )}

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      {items.length === 0 ? (
        <p className="text-[11.5px] text-zinc-500">
          Nenhum favorito salvo ainda. Salve até {maxItems} para reutilizar aqui ou importar no Editor de Cortes.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {items.map((item) => {
            const isDefaultEnd = Boolean(defaultEndId && defaultEndId === item.id);
            return (
              <div
                key={item.id}
                onClick={() => onLoad(item)}
                className={`group relative rounded-lg overflow-hidden border bg-[#16181F] cursor-pointer transition-colors ${
                  isDefaultEnd
                    ? 'border-amber-400/80 ring-1 ring-amber-400/40'
                    : 'border-[#262934] hover:border-zinc-400'
                }`}
              >
                {item.arquivoPng ? (
                  <img
                    src={`/api/croma/favoritos/img/${encodeURIComponent(item.arquivoPng)}`}
                    alt={item.nome}
                    className="w-full h-16 object-cover block bg-[#0B0C0F]"
                  />
                ) : (
                  <div className="w-full h-16 bg-[#1C1F2A] flex items-center justify-center text-[11px] text-zinc-500">
                    Sem prévia
                  </div>
                )}
                {isDefaultEnd && (
                  <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-amber-500 text-zinc-950 text-[9.5px] font-bold tracking-tight shadow">
                    FINAL PADRÃO
                  </span>
                )}
                <div className="px-2 py-1 flex items-center justify-between gap-1">
                  <span className="text-[11px] text-zinc-200 truncate" title={item.nome}>
                    {item.nome}
                  </span>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {onToggleDefaultEnd && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleDefaultEnd(isDefaultEnd ? null : item.id);
                        }}
                        className={`p-0.5 rounded cursor-pointer transition-colors ${
                          isDefaultEnd
                            ? 'text-amber-400 bg-amber-400/15'
                            : 'text-zinc-500 hover:text-amber-300 hover:bg-amber-400/10'
                        }`}
                        title={isDefaultEnd ? 'Desativar como final padrão' : 'Usar no final de todos os cortes'}
                      >
                        <Star className="w-3 h-3" fill={isDefaultEnd ? 'currentColor' : 'none'} aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(item.id);
                      }}
                      className="p-0.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                      title="Remover favorito"
                    >
                      <Trash2 className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </CollapsibleSection>
  );
}
