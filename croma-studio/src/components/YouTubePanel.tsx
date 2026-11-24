import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Copy,
  Eye,
  EyeOff,
  ImagePlus,
  Plus,
  QrCode,
  RotateCcw,
  Shuffle,
  Trash2,
} from 'lucide-react';
import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { ARTWORK_FONTS, CURATED_PALETTES, INITIAL_BACKGROUND_PHOTO, THUMBNAIL_PRESETS } from '../data/presets';
import {
  BackgroundPhotoConfig,
  GradientPalette,
  QrCodeConfig,
  SavedFavoriteItem,
  TextAlignOption,
  TextLayer,
  ThumbnailPresetId,
  WatermarkConfig,
  WatermarkShape,
  YouTubeSubMode,
} from '../types/studio';
import { registerPhotoImage } from '../utils/canvasRenderer';
import { CollapsibleSection } from './CollapsibleSection';
import { FavoritesSection } from './FavoritesSection';

interface YouTubePanelProps {
  subMode: YouTubeSubMode;
  onChangeSubMode: (mode: YouTubeSubMode) => void;
  thumbnailPreset: ThumbnailPresetId;
  onChangeThumbnailPreset: (preset: ThumbnailPresetId) => void;
  backgroundPhoto: BackgroundPhotoConfig;
  onChangeBackgroundPhoto: (next: BackgroundPhotoConfig) => void;
  qrCode: QrCodeConfig;
  onChangeQrCode: (next: QrCodeConfig) => void;
  favoriteThumbs: SavedFavoriteItem[];
  favoriteGradients: SavedFavoriteItem[];
  defaultEndThumbId: string | null;
  favSaving: boolean;
  favError: string | null;
  onSaveFavorite: (tipo: 'gradiente' | 'thumb', nome: string) => void;
  onLoadFavorite: (tipo: 'gradiente' | 'thumb', item: SavedFavoriteItem) => void;
  onDeleteFavorite: (tipo: 'gradiente' | 'thumb', id: string) => void;
  onToggleDefaultEnd: (thumbId: string | null) => void;
  onImportThumbImage: (nome: string, pngBase64: string, w: number, h: number) => void;
  // Text layers (thumbnail & banner)
  textLayers: TextLayer[];
  selectedTextId: string | null;
  onSelectText: (id: string | null) => void;
  onUpdateTextLayer: (id: string, patch: Partial<TextLayer>) => void;
  onAddTextLayer: () => void;
  onDuplicateTextLayer: (id: string) => void;
  onDeleteTextLayer: (id: string) => void;
  backdropScrim: number;
  onChangeBackdropScrim: (val: number) => void;
  // Watermark (150x150)
  watermark: WatermarkConfig;
  onChangeWatermark: (next: WatermarkConfig) => void;
  onApplyPalette: (palette: GradientPalette) => void;
  onRandomizeGradient: () => void;
}

const SUB_MODES: { id: YouTubeSubMode; label: string }[] = [
  { id: 'thumbnail', label: 'Thumbnail' },
  { id: 'banner', label: 'Banner' },
  { id: 'watermark', label: "Marca d'Água" },
];

const WATERMARK_SHAPES: { id: WatermarkShape; label: string }[] = [
  { id: 'rounded', label: 'Arredondado' },
  { id: 'circle', label: 'Círculo' },
  { id: 'square', label: 'Quadrado' },
  { id: 'squircle', label: 'Squircle' },
  { id: 'hexagon', label: 'Hexágono' },
  { id: 'cutout', label: 'Sem Fundo' },
];

export function YouTubePanel({
  subMode,
  onChangeSubMode,
  thumbnailPreset,
  onChangeThumbnailPreset,
  backgroundPhoto,
  onChangeBackgroundPhoto,
  qrCode,
  onChangeQrCode,
  favoriteThumbs,
  favoriteGradients,
  defaultEndThumbId,
  favSaving,
  favError,
  onSaveFavorite,
  onLoadFavorite,
  onDeleteFavorite,
  onToggleDefaultEnd,
  onImportThumbImage,
  textLayers,
  selectedTextId,
  onSelectText,
  onUpdateTextLayer,
  onAddTextLayer,
  onDuplicateTextLayer,
  onDeleteTextLayer,
  backdropScrim,
  onChangeBackdropScrim,
  watermark,
  onChangeWatermark,
  onApplyPalette,
  onRandomizeGradient,
}: YouTubePanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pcFonts, setPcFonts] = useState<string[]>([]);

  useEffect(() => {
    let ativo = true;
    fetch('/api/fontes-sistema')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!ativo || !d || !Array.isArray(d.fontes)) return;
        const padrao = new Set(ARTWORK_FONTS.map((f) => f.name.toLowerCase()));
        setPcFonts(d.fontes.filter((n: string) => !padrao.has(String(n).toLowerCase())));
      })
      .catch(() => {});
    return () => { ativo = false; };
  }, []);
  const selectedLayer =
    textLayers.find((l) => l.id === selectedTextId) ?? textLayers[0] ?? null;
  const activeThumbPreset =
    THUMBNAIL_PRESETS.find((p) => p.id === thumbnailPreset) ?? THUMBNAIL_PRESETS[0];

  const handleUploadPhoto = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : null;
      if (!dataUrl) return;
      const img = new Image();
      img.onload = () => {
        registerPhotoImage(dataUrl, img);
        onChangeBackgroundPhoto({
          ...backgroundPhoto,
          dataUrl,
          fileName: file.name,
          opacity: backgroundPhoto.opacity || 100,
          scale: 100,
          offsetX: 0,
          offsetY: 0,
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="divide-y divide-[#22252D]">
      {/* Mode Switcher */}
      <section className="p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-zinc-100">YouTube & Redes Sociais</h2>
          <span className="font-mono text-[11px] tabular-nums text-zinc-400">
            {subMode === 'thumbnail'
              ? `${activeThumbPreset.width} × ${activeThumbPreset.height}`
              : subMode === 'banner'
              ? '2560 × 1440'
              : '150 × 150'}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#181A20] border border-[#252832]">
          {SUB_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onChangeSubMode(m.id)}
              className={`py-1.5 px-1 text-[12px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                subMode === m.id
                  ? 'bg-[#2A2E3B] text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {subMode === 'thumbnail' && (
          <div className="space-y-1.5 pt-1">
            <span className="text-[11px] text-zinc-400 block">Resolução / Plataforma</span>
            <div className="grid grid-cols-2 gap-1.5">
              {THUMBNAIL_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onChangeThumbnailPreset(p.id)}
                  className={`px-2.5 py-1.5 rounded-lg border text-left transition-colors cursor-pointer ${
                    thumbnailPreset === p.id
                      ? 'bg-[#252936] border-zinc-400 text-white'
                      : 'bg-[#171920] border-[#252832] text-zinc-400 hover:text-zinc-200 hover:border-[#343948]'
                  }`}
                >
                  <div className="text-[11.5px] font-medium leading-tight truncate">{p.shortLabel}</div>
                  <div className="font-mono text-[10px] text-zinc-400 tabular-nums mt-0.5">
                    {p.width}×{p.height}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="text-[12px] leading-relaxed text-zinc-400">
          {subMode === 'thumbnail' && activeThumbPreset.hint}
          {subMode === 'banner' &&
            'Use as guias de área segura na barra superior para alinhar entre TV, desktop e celular.'}
          {subMode === 'watermark' &&
            'Aparece no canto inferior direito do player. Recomendado: 150 × 150 px em PNG, JPEG ou BMP até 1 MB.'}
        </p>
      </section>

      {subMode === 'watermark' ? (
        <>
          {/* Monogram / Initials */}
          <section className="p-4 space-y-3.5">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-zinc-100">Iniciais e texto</h3>
              <button
                type="button"
                onClick={onRandomizeGradient}
                className="inline-flex items-center gap-1.5 text-[12px] text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
              >
                <Shuffle className="w-3.5 h-3.5" aria-hidden="true" />
                Sortear fundo
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <label className="space-y-1">
                <span className="text-[11px] text-zinc-400">Iniciais (1–4 letras)</span>
                <input
                  type="text"
                  maxLength={4}
                  value={watermark.initials}
                  onChange={(e) =>
                    onChangeWatermark({ ...watermark, initials: e.target.value })
                  }
                  placeholder="CS"
                  className="w-full h-9 px-3 rounded-lg bg-[#1A1C23] border border-[#2A2E39] text-[15px] font-bold tracking-wide text-zinc-100 focus:outline-none focus:border-zinc-400"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[11px] text-zinc-400">Cor das letras</span>
                <div className="h-9 flex items-center gap-2 px-2 rounded-lg bg-[#1A1C23] border border-[#2A2E39]">
                  <input
                    type="color"
                    value={watermark.textColor}
                    onChange={(e) =>
                      onChangeWatermark({
                        ...watermark,
                        textColor: e.target.value.toUpperCase(),
                      })
                    }
                    className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer"
                  />
                  <span className="font-mono text-[11px] text-zinc-300">
                    {watermark.textColor}
                  </span>
                </div>
              </label>
            </div>

            <div className="space-y-2">
              <label className="flex items-center justify-between text-[12px] text-zinc-300 cursor-pointer">
                <span>Legenda inferior (ex: INSCREVA-SE)</span>
                <input
                  type="checkbox"
                  checked={watermark.showSubLabel}
                  onChange={(e) =>
                    onChangeWatermark({ ...watermark, showSubLabel: e.target.checked })
                  }
                  className="accent-zinc-100 w-4 h-4 cursor-pointer"
                />
              </label>
              {watermark.showSubLabel && (
                <input
                  type="text"
                  maxLength={14}
                  value={watermark.subLabel}
                  onChange={(e) =>
                    onChangeWatermark({ ...watermark, subLabel: e.target.value })
                  }
                  className="w-full h-8 px-2.5 rounded-md bg-[#1A1C23] border border-[#2A2E39] text-[12px] text-zinc-100 focus:outline-none focus:border-zinc-400"
                />
              )}
            </div>

            {/* Quick palette strip for watermark background */}
            <div className="space-y-1.5">
              <span className="text-[11px] text-zinc-400 block">Gradiente de fundo rápido</span>
              <div className="grid grid-cols-6 gap-1.5">
                {CURATED_PALETTES.slice(0, 6).map((p) => {
                  const cssStops = p.stops.map((s) => `${s.color} ${s.position}%`).join(', ');
                  return (
                    <button
                      key={p.id}
                      type="button"
                      title={p.name}
                      onClick={() => onApplyPalette(p)}
                      className="h-7 rounded-md border border-white/15 hover:border-white transition-colors cursor-pointer"
                      style={{ background: `linear-gradient(${p.angle}deg, ${cssStops})` }}
                    />
                  );
                })}
              </div>
            </div>
          </section>

          {/* Shape & Container */}
          <section className="p-4 space-y-3.5">
            <h3 className="text-[13px] font-semibold text-zinc-100">Formato e transparência</h3>

            <div className="grid grid-cols-3 gap-1.5">
              {WATERMARK_SHAPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onChangeWatermark({ ...watermark, shape: s.id })}
                  className={`py-1.5 px-2 rounded-md text-[12px] font-medium border transition-colors whitespace-nowrap cursor-pointer ${
                    watermark.shape === s.id
                      ? 'bg-[#252834] border-zinc-400 text-white'
                      : 'bg-[#16181F] border-[#232630] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {watermark.shape === 'rounded' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-zinc-400">Raio dos cantos</span>
                  <span className="font-mono tabular-nums text-zinc-200">
                    {watermark.cornerRadius}%
                  </span>
                </div>
                <input
                  type="range"
                  min={4}
                  max={50}
                  value={watermark.cornerRadius}
                  onChange={(e) =>
                    onChangeWatermark({
                      ...watermark,
                      cornerRadius: Number(e.target.value),
                    })
                  }
                  className="studio-slider"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-400">Opacidade do fundo</span>
                <span className="font-mono tabular-nums text-zinc-200">
                  {watermark.bgOpacity}%
                </span>
              </div>
              <input
                type="range"
                min={10}
                max={100}
                value={watermark.bgOpacity}
                onChange={(e) =>
                  onChangeWatermark({ ...watermark, bgOpacity: Number(e.target.value) })
                }
                className="studio-slider"
              />
            </div>

            <label className="flex items-center justify-between text-[12px] text-zinc-300 cursor-pointer">
              <span>Aplicar padrão geométrico da aba Formas</span>
              <input
                type="checkbox"
                checked={watermark.usePattern}
                onChange={(e) =>
                  onChangeWatermark({ ...watermark, usePattern: e.target.checked })
                }
                className="accent-zinc-100 w-4 h-4 cursor-pointer"
              />
            </label>
          </section>

          {/* Watermark Typography & Effects */}
          <section className="p-4 space-y-3.5">
            <h3 className="text-[13px] font-semibold text-zinc-100">Tipografia e acabamento</h3>

            <label className="space-y-1 block">
              <span className="text-[11px] text-zinc-400">Fonte</span>
              <select
                value={watermark.fontFamily}
                onChange={(e) =>
                  onChangeWatermark({ ...watermark, fontFamily: e.target.value })
                }
                className="w-full h-9 px-3 rounded-lg bg-[#1A1C23] border border-[#2A2E39] text-[13px] text-zinc-100 focus:outline-none focus:border-zinc-400 cursor-pointer"
              >
                <optgroup label="Fontes do Croma Studio">
                  {ARTWORK_FONTS.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.label} — {f.category}
                    </option>
                  ))}
                </optgroup>
                {pcFonts.length > 0 && (
                  <optgroup label="Fontes instaladas no seu PC">
                    {pcFonts.map((name) => (
                      <option key={`pc-${name}`} value={name}>
                        {name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-zinc-400">Tamanho</span>
                  <span className="font-mono tabular-nums text-zinc-200">
                    {watermark.fontSize}px
                  </span>
                </div>
                <input
                  type="range"
                  min={28}
                  max={108}
                  value={watermark.fontSize}
                  onChange={(e) =>
                    onChangeWatermark({ ...watermark, fontSize: Number(e.target.value) })
                  }
                  className="studio-slider"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-zinc-400">Espaçamento</span>
                  <span className="font-mono tabular-nums text-zinc-200">
                    {watermark.letterSpacing}px
                  </span>
                </div>
                <input
                  type="range"
                  min={-6}
                  max={18}
                  value={watermark.letterSpacing}
                  onChange={(e) =>
                    onChangeWatermark({
                      ...watermark,
                      letterSpacing: Number(e.target.value),
                    })
                  }
                  className="studio-slider"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-400">Opacidade das letras</span>
                <span className="font-mono tabular-nums text-zinc-200">
                  {watermark.textOpacity}%
                </span>
              </div>
              <input
                type="range"
                min={20}
                max={100}
                value={watermark.textOpacity}
                onChange={(e) =>
                  onChangeWatermark({ ...watermark, textOpacity: Number(e.target.value) })
                }
                className="studio-slider"
              />
            </div>

            {/* Border Ring */}
            <div className="pt-1 space-y-2.5">
              <label className="flex items-center justify-between text-[12px] text-zinc-200 cursor-pointer">
                <span>Borda externa</span>
                <input
                  type="checkbox"
                  checked={watermark.borderEnabled}
                  onChange={(e) =>
                    onChangeWatermark({ ...watermark, borderEnabled: e.target.checked })
                  }
                  className="accent-zinc-100 w-4 h-4 cursor-pointer"
                />
              </label>
              {watermark.borderEnabled && (
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={watermark.borderColor}
                    onChange={(e) =>
                      onChangeWatermark({
                        ...watermark,
                        borderColor: e.target.value.toUpperCase(),
                      })
                    }
                    className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer shrink-0"
                  />
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={watermark.borderWidth}
                    onChange={(e) =>
                      onChangeWatermark({
                        ...watermark,
                        borderWidth: Number(e.target.value),
                      })
                    }
                    className="studio-slider"
                  />
                  <span className="font-mono text-[11px] tabular-nums text-zinc-400 w-8 text-right">
                    {watermark.borderWidth}px
                  </span>
                </div>
              )}
            </div>

            {/* Text Stroke */}
            <div className="pt-1 space-y-2.5">
              <label className="flex items-center justify-between text-[12px] text-zinc-200 cursor-pointer">
                <span>Contorno nas letras</span>
                <input
                  type="checkbox"
                  checked={watermark.strokeEnabled}
                  onChange={(e) =>
                    onChangeWatermark({ ...watermark, strokeEnabled: e.target.checked })
                  }
                  className="accent-zinc-100 w-4 h-4 cursor-pointer"
                />
              </label>
              {watermark.strokeEnabled && (
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={watermark.strokeColor}
                    onChange={(e) =>
                      onChangeWatermark({
                        ...watermark,
                        strokeColor: e.target.value.toUpperCase(),
                      })
                    }
                    className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer shrink-0"
                  />
                  <input
                    type="range"
                    min={1}
                    max={8}
                    value={watermark.strokeWidth}
                    onChange={(e) =>
                      onChangeWatermark({
                        ...watermark,
                        strokeWidth: Number(e.target.value),
                      })
                    }
                    className="studio-slider"
                  />
                  <span className="font-mono text-[11px] tabular-nums text-zinc-400 w-8 text-right">
                    {watermark.strokeWidth}px
                  </span>
                </div>
              )}
            </div>

            {/* Drop Shadow */}
            <div className="pt-1 space-y-2.5">
              <label className="flex items-center justify-between text-[12px] text-zinc-200 cursor-pointer">
                <span>Sombra projetada</span>
                <input
                  type="checkbox"
                  checked={watermark.shadowEnabled}
                  onChange={(e) =>
                    onChangeWatermark({ ...watermark, shadowEnabled: e.target.checked })
                  }
                  className="accent-zinc-100 w-4 h-4 cursor-pointer"
                />
              </label>
              {watermark.shadowEnabled && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-zinc-400">
                      <span>Desfoque</span>
                      <span className="font-mono tabular-nums">{watermark.shadowBlur}px</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={28}
                      value={watermark.shadowBlur}
                      onChange={(e) =>
                        onChangeWatermark({
                          ...watermark,
                          shadowBlur: Number(e.target.value),
                        })
                      }
                      className="studio-slider"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-zinc-400">
                      <span>Opacidade</span>
                      <span className="font-mono tabular-nums">{watermark.shadowOpacity}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={watermark.shadowOpacity}
                      onChange={(e) =>
                        onChangeWatermark({
                          ...watermark,
                          shadowOpacity: Number(e.target.value),
                        })
                      }
                      className="studio-slider"
                    />
                  </div>
                </div>
              )}
            </div>
          </section>
        </>
      ) : (
        <>
          {/* Design Favoritos: Thumbs (10) e Gradientes (10) — retrateis */}
          <FavoritesSection
            title="Thumbs favoritas"
            items={favoriteThumbs}
            maxItems={10}
            saving={favSaving}
            error={favError}
            placeholder="Nome da thumb (ex: Final do Canal)..."
            onSave={(nome) => onSaveFavorite('thumb', nome)}
            onLoad={(item) => onLoadFavorite('thumb', item)}
            onDelete={(id) => onDeleteFavorite('thumb', id)}
            defaultEndId={defaultEndThumbId}
            onToggleDefaultEnd={onToggleDefaultEnd}
            onImportImage={onImportThumbImage}
            defaultOpen={false}
          />
          <FavoritesSection
            title="Gradientes favoritos"
            items={favoriteGradients}
            maxItems={10}
            saving={favSaving}
            error={favError}
            placeholder="Nome do fundo/gradiente..."
            onSave={(nome) => onSaveFavorite('gradiente', nome)}
            onLoad={(item) => onLoadFavorite('gradiente', item)}
            onDelete={(id) => onDeleteFavorite('gradiente', id)}
            defaultOpen={false}
          />

          {/* Foto / Imagem de Fundo (retratil) */}
          <CollapsibleSection
            title="Foto / Imagem"
            badge={backgroundPhoto.dataUrl ? 'Ativa' : undefined}
            defaultOpen={true}
            rightSlot={
              <div className="flex items-center gap-1.5">
                {backgroundPhoto.dataUrl && (
                  <button
                    type="button"
                    onClick={() => onChangeBackgroundPhoto(INITIAL_BACKGROUND_PHOTO)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#1E2129] hover:bg-red-500/20 text-[11px] text-zinc-400 hover:text-red-300 transition-colors cursor-pointer"
                    title="Remover foto"
                  >
                    <Trash2 className="w-3 h-3" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#1E2129] hover:bg-[#282C37] text-[12px] font-medium text-zinc-100 transition-colors cursor-pointer"
                >
                  <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                  {backgroundPhoto.dataUrl ? 'Trocar' : 'Incluir foto'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleUploadPhoto}
                  className="hidden"
                />
              </div>
            }
          >

            {backgroundPhoto.dataUrl ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                  <span className="truncate">{backgroundPhoto.fileName || 'Foto carregada'}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        onChangeBackgroundPhoto({
                          ...backgroundPhoto,
                          fit: backgroundPhoto.fit === 'cover' ? 'contain' : 'cover',
                        })
                      }
                      className="px-2 py-0.5 rounded bg-[#181A20] border border-[#282C37] text-zinc-300 hover:text-white cursor-pointer"
                    >
                      {backgroundPhoto.fit === 'cover' ? 'Preencher' : 'Encaixar'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onChangeBackgroundPhoto({
                          ...backgroundPhoto,
                          scale: 100,
                          offsetX: 0,
                          offsetY: 0,
                          blur: 0,
                        })
                      }
                      className="p-1 rounded bg-[#181A20] border border-[#282C37] text-zinc-400 hover:text-white cursor-pointer"
                      title="Centralizar foto"
                    >
                      <RotateCcw className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-zinc-400">
                      <span>Zoom</span>
                      <span className="font-mono tabular-nums">{backgroundPhoto.scale}%</span>
                    </div>
                    <input
                      type="range"
                      min={50}
                      max={250}
                      value={backgroundPhoto.scale}
                      onChange={(e) =>
                        onChangeBackgroundPhoto({ ...backgroundPhoto, scale: Number(e.target.value) })
                      }
                      className="studio-slider"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-zinc-400">
                      <span>Opacidade</span>
                      <span className="font-mono tabular-nums">{backgroundPhoto.opacity}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={backgroundPhoto.opacity}
                      onChange={(e) =>
                        onChangeBackgroundPhoto({ ...backgroundPhoto, opacity: Number(e.target.value) })
                      }
                      className="studio-slider"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-zinc-400">
                      <span>Posição X</span>
                      <span className="font-mono tabular-nums">{backgroundPhoto.offsetX}%</span>
                    </div>
                    <input
                      type="range"
                      min={-50}
                      max={50}
                      value={backgroundPhoto.offsetX}
                      onChange={(e) =>
                        onChangeBackgroundPhoto({ ...backgroundPhoto, offsetX: Number(e.target.value) })
                      }
                      className="studio-slider"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-zinc-400">
                      <span>Posição Y</span>
                      <span className="font-mono tabular-nums">{backgroundPhoto.offsetY}%</span>
                    </div>
                    <input
                      type="range"
                      min={-50}
                      max={50}
                      value={backgroundPhoto.offsetY}
                      onChange={(e) =>
                        onChangeBackgroundPhoto({ ...backgroundPhoto, offsetY: Number(e.target.value) })
                      }
                      className="studio-slider"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Desfoque da foto</span>
                    <span className="font-mono tabular-nums">{backgroundPhoto.blur}px</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={24}
                    value={backgroundPhoto.blur}
                    onChange={(e) =>
                      onChangeBackgroundPhoto({ ...backgroundPhoto, blur: Number(e.target.value) })
                    }
                    className="studio-slider"
                  />
                </div>
              </div>
            ) : (
              <p className="text-[11.5px] text-zinc-500">
                Envie uma foto ou print do vídeo para usar como fundo da thumbnail ou banner (PNG, JPG ou WebP).
              </p>
            )}
          </CollapsibleSection>

          {/* Gerador de QR Code (logo abaixo de Foto / Imagem, retratil) */}
          <CollapsibleSection
            title="QR Code na tela"
            badge={qrCode.enabled && qrCode.text.trim() ? 'Ativo' : undefined}
            defaultOpen={false}
            rightSlot={
              <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                <QrCode className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
                <input
                  type="checkbox"
                  checked={qrCode.enabled}
                  onChange={(e) => onChangeQrCode({ ...qrCode, enabled: e.target.checked })}
                  className="accent-zinc-100 w-3.5 h-3.5 cursor-pointer"
                />
              </label>
            }
          >
            <label className="space-y-1 block">
              <span className="text-[11px] text-zinc-400">Texto ou link do QR Code</span>
              <input
                type="text"
                value={qrCode.text}
                onChange={(e) =>
                  onChangeQrCode({
                    ...qrCode,
                    text: e.target.value,
                    enabled: e.target.value.trim().length > 0 ? true : qrCode.enabled,
                  })
                }
                placeholder="https://youtube.com/@seucanal ou Pix..."
                className="w-full h-8 px-2.5 rounded-lg bg-[#181A20] border border-[#282C37] text-[12px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-400"
              />
            </label>

            {qrCode.enabled && qrCode.text.trim() ? (
              <div className="space-y-2.5">
                <p className="text-[11px] text-zinc-400">
                  Arraste o QR Code diretamente sobre a arte para posicionar ou ajuste abaixo:
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-zinc-400">
                      <span>Tamanho</span>
                      <span className="font-mono tabular-nums">{qrCode.size}%</span>
                    </div>
                    <input
                      type="range"
                      min={8}
                      max={45}
                      value={qrCode.size}
                      onChange={(e) => onChangeQrCode({ ...qrCode, size: Number(e.target.value) })}
                      className="studio-slider"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-zinc-400">
                      <span>Opacidade</span>
                      <span className="font-mono tabular-nums">{qrCode.opacity}%</span>
                    </div>
                    <input
                      type="range"
                      min={20}
                      max={100}
                      value={qrCode.opacity}
                      onChange={(e) => onChangeQrCode({ ...qrCode, opacity: Number(e.target.value) })}
                      className="studio-slider"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-zinc-400">
                      <span>Posição X</span>
                      <span className="font-mono tabular-nums">{Math.round(qrCode.x * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={95}
                      value={Math.round(qrCode.x * 100)}
                      onChange={(e) => onChangeQrCode({ ...qrCode, x: Number(e.target.value) / 100 })}
                      className="studio-slider"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-zinc-400">
                      <span>Posição Y</span>
                      <span className="font-mono tabular-nums">{Math.round(qrCode.y * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={95}
                      value={Math.round(qrCode.y * 100)}
                      onChange={(e) => onChangeQrCode({ ...qrCode, y: Number(e.target.value) / 100 })}
                      className="studio-slider"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-[#181A20] border border-[#282C37] text-[11px] text-zinc-300">
                    <span>Cor QR</span>
                    <input
                      type="color"
                      value={qrCode.fgColor}
                      onChange={(e) => onChangeQrCode({ ...qrCode, fgColor: e.target.value.toUpperCase() })}
                      className="w-6 h-5 bg-transparent border-0 cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-[#181A20] border border-[#282C37] text-[11px] text-zinc-300">
                    <span>Fundo</span>
                    <input
                      type="color"
                      value={qrCode.bgColor}
                      onChange={(e) => onChangeQrCode({ ...qrCode, bgColor: e.target.value.toUpperCase() })}
                      className="w-6 h-5 bg-transparent border-0 cursor-pointer"
                    />
                  </label>
                </div>
              </div>
            ) : (
              <p className="text-[11.5px] text-zinc-500">
                Digite qualquer link ou texto acima para gerar um QR Code arrastável e redimensionável na tela.
              </p>
            )}
          </CollapsibleSection>

          {/* Text Layers Manager (retratil) */}
          <CollapsibleSection
            title="Camadas de texto"
            badge={String(textLayers.length)}
            defaultOpen={true}
            rightSlot={
              <button
                type="button"
                onClick={onAddTextLayer}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#1E2129] hover:bg-[#282C37] text-[12px] font-medium text-zinc-100 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                Novo texto
              </button>
            }
          >

            <div className="space-y-1.5">
              {textLayers.map((layer) => {
                const isSelected = selectedLayer?.id === layer.id;
                const firstLine = layer.text.split('\n')[0] || '(Sem texto)';
                return (
                  <div
                    key={layer.id}
                    onClick={() => onSelectText(layer.id)}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#222531] border-zinc-400 text-white'
                        : 'bg-[#16181F] border-[#232630] text-zinc-300 hover:border-[#343948]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateTextLayer(layer.id, { visible: !layer.visible });
                      }}
                      aria-label={layer.visible ? 'Ocultar camada' : 'Exibir camada'}
                      className="text-zinc-400 hover:text-zinc-100 cursor-pointer"
                    >
                      {layer.visible ? (
                        <Eye className="w-3.5 h-3.5" />
                      ) : (
                        <EyeOff className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <span className="flex-1 text-[12px] font-medium truncate">
                      {firstLine}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDuplicateTextLayer(layer.id);
                      }}
                      title="Duplicar texto"
                      className="p-1 text-zinc-500 hover:text-zinc-200 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteTextLayer(layer.id);
                      }}
                      title="Excluir texto"
                      className="p-1 text-zinc-500 hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Background Scrim Filter */}
            <div className="pt-2 space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-400">Filtro escuro sobre o fundo</span>
                <span className="font-mono tabular-nums text-zinc-200">{backdropScrim}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={75}
                value={backdropScrim}
                onChange={(e) => onChangeBackdropScrim(Number(e.target.value))}
                className="studio-slider"
              />
            </div>
          </CollapsibleSection>

          {/* Active Layer Editor */}
          {selectedLayer && (
            <>
              <section className="p-4 space-y-3.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold text-zinc-100">Conteúdo e fonte</h3>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onUpdateTextLayer(selectedLayer.id, { x: 0.5 })}
                      className="px-2 py-0.5 rounded bg-[#1C1F27] hover:bg-[#272B36] text-[11px] text-zinc-300 cursor-pointer"
                      title="Centralizar horizontalmente"
                    >
                      Centro X
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateTextLayer(selectedLayer.id, { y: 0.5 })}
                      className="px-2 py-0.5 rounded bg-[#1C1F27] hover:bg-[#272B36] text-[11px] text-zinc-300 cursor-pointer"
                      title="Centralizar verticalmente"
                    >
                      Centro Y
                    </button>
                  </div>
                </div>

                <textarea
                  rows={2}
                  value={selectedLayer.text}
                  onChange={(e) =>
                    onUpdateTextLayer(selectedLayer.id, { text: e.target.value })
                  }
                  placeholder="Digite seu texto..."
                  className="w-full p-2.5 rounded-lg bg-[#1A1C23] border border-[#2A2E39] text-[13px] text-zinc-100 focus:outline-none focus:border-zinc-400 resize-y"
                />

                <label className="space-y-1 block">
                  <span className="text-[11px] text-zinc-400">Família tipográfica</span>
                  <select
                    value={selectedLayer.fontFamily}
                    onChange={(e) =>
                      onUpdateTextLayer(selectedLayer.id, { fontFamily: e.target.value })
                    }
                    className="w-full h-9 px-3 rounded-lg bg-[#1A1C23] border border-[#2A2E39] text-[13px] text-zinc-100 focus:outline-none focus:border-zinc-400 cursor-pointer"
                  >
                    <optgroup label="Fontes do Croma Studio">
                      {ARTWORK_FONTS.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.label} — {f.category}
                        </option>
                      ))}
                    </optgroup>
                    {pcFonts.length > 0 && (
                      <optgroup label="Fontes instaladas no seu PC">
                        {pcFonts.map((name) => (
                          <option key={`pc-${name}`} value={name}>
                            {name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[12px]">
                      <span className="text-zinc-400">Tamanho</span>
                      <span className="font-mono tabular-nums text-zinc-200">
                        {selectedLayer.fontSize}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={18}
                      max={180}
                      value={selectedLayer.fontSize}
                      onChange={(e) =>
                        onUpdateTextLayer(selectedLayer.id, {
                          fontSize: Number(e.target.value),
                        })
                      }
                      className="studio-slider"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[12px]">
                      <span className="text-zinc-400">Peso</span>
                      <span className="font-mono tabular-nums text-zinc-200">
                        {selectedLayer.fontWeight}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={400}
                      max={900}
                      step={100}
                      value={selectedLayer.fontWeight}
                      onChange={(e) =>
                        onUpdateTextLayer(selectedLayer.id, {
                          fontWeight: Number(e.target.value),
                        })
                      }
                      className="studio-slider"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[12px]">
                      <span className="text-zinc-400">Espaçamento</span>
                      <span className="font-mono tabular-nums text-zinc-200">
                        {selectedLayer.letterSpacing}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-6}
                      max={28}
                      value={selectedLayer.letterSpacing}
                      onChange={(e) =>
                        onUpdateTextLayer(selectedLayer.id, {
                          letterSpacing: Number(e.target.value),
                        })
                      }
                      className="studio-slider"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[12px]">
                      <span className="text-zinc-400">Inclinação</span>
                      <span className="font-mono tabular-nums text-zinc-200">
                        {selectedLayer.rotation}°
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-35}
                      max={35}
                      value={selectedLayer.rotation}
                      onChange={(e) =>
                        onUpdateTextLayer(selectedLayer.id, {
                          rotation: Number(e.target.value),
                        })
                      }
                      className="studio-slider"
                    />
                  </div>
                </div>

                {/* Alignment + Uppercase + Color */}
                <div className="flex items-center gap-2 pt-1">
                  <div className="flex items-center p-0.5 rounded-lg bg-[#181A20] border border-[#252832]">
                    {(['left', 'center', 'right'] as TextAlignOption[]).map((al) => (
                      <button
                        key={al}
                        type="button"
                        onClick={() => onUpdateTextLayer(selectedLayer.id, { align: al })}
                        aria-label={`Alinhar ${al}`}
                        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                          selectedLayer.align === al
                            ? 'bg-[#2A2E3B] text-white'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {al === 'left' && <AlignLeft className="w-3.5 h-3.5" />}
                        {al === 'center' && <AlignCenter className="w-3.5 h-3.5" />}
                        {al === 'right' && <AlignRight className="w-3.5 h-3.5" />}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      onUpdateTextLayer(selectedLayer.id, {
                        uppercase: !selectedLayer.uppercase,
                      })
                    }
                    className={`px-2.5 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors cursor-pointer ${
                      selectedLayer.uppercase
                        ? 'bg-[#2A2E3B] border-zinc-400 text-white'
                        : 'bg-[#16181F] border-[#252832] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    AA
                  </button>

                  <div className="flex-1 flex items-center gap-2 px-2 py-1 rounded-lg bg-[#16181F] border border-[#252832]">
                    <input
                      type="color"
                      aria-label="Cor do texto"
                      value={selectedLayer.color}
                      onChange={(e) =>
                        onUpdateTextLayer(selectedLayer.id, {
                          color: e.target.value.toUpperCase(),
                        })
                      }
                      className="w-5 h-5 rounded border-0 bg-transparent cursor-pointer"
                    />
                    <span className="font-mono text-[11px] text-zinc-300">
                      {selectedLayer.color}
                    </span>
                  </div>
                </div>

                {/* Opacity Filter */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[12px]">
                    <span className="text-zinc-400">Opacidade do texto</span>
                    <span className="font-mono tabular-nums text-zinc-200">
                      {selectedLayer.opacity}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    value={selectedLayer.opacity}
                    onChange={(e) =>
                      onUpdateTextLayer(selectedLayer.id, {
                        opacity: Number(e.target.value),
                      })
                    }
                    className="studio-slider"
                  />
                </div>
              </section>

              {/* Effects: Stroke, Shadow, Backdrop */}
              <section className="p-4 space-y-4">
                <h3 className="text-[13px] font-semibold text-zinc-100">
                  Contorno, sombra e destaque
                </h3>

                {/* Stroke */}
                <div className="space-y-2">
                  <label className="flex items-center justify-between text-[12px] text-zinc-200 cursor-pointer">
                    <span>Contorno (Outline)</span>
                    <input
                      type="checkbox"
                      checked={selectedLayer.strokeEnabled}
                      onChange={(e) =>
                        onUpdateTextLayer(selectedLayer.id, {
                          strokeEnabled: e.target.checked,
                        })
                      }
                      className="accent-zinc-100 w-4 h-4 cursor-pointer"
                    />
                  </label>
                  {selectedLayer.strokeEnabled && (
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={selectedLayer.strokeColor}
                        onChange={(e) =>
                          onUpdateTextLayer(selectedLayer.id, {
                            strokeColor: e.target.value.toUpperCase(),
                          })
                        }
                        className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer shrink-0"
                      />
                      <input
                        type="range"
                        min={1}
                        max={18}
                        value={selectedLayer.strokeWidth}
                        onChange={(e) =>
                          onUpdateTextLayer(selectedLayer.id, {
                            strokeWidth: Number(e.target.value),
                          })
                        }
                        className="studio-slider"
                      />
                      <span className="font-mono text-[11px] tabular-nums text-zinc-400 w-8 text-right">
                        {selectedLayer.strokeWidth}px
                      </span>
                    </div>
                  )}
                </div>

                {/* Shadow */}
                <div className="space-y-2.5 pt-2 border-t border-[#22252D]">
                  <label className="flex items-center justify-between text-[12px] text-zinc-200 cursor-pointer">
                    <span>Sombra projetada</span>
                    <input
                      type="checkbox"
                      checked={selectedLayer.shadowEnabled}
                      onChange={(e) =>
                        onUpdateTextLayer(selectedLayer.id, {
                          shadowEnabled: e.target.checked,
                        })
                      }
                      className="accent-zinc-100 w-4 h-4 cursor-pointer"
                    />
                  </label>
                  {selectedLayer.shadowEnabled && (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={selectedLayer.shadowColor}
                          onChange={(e) =>
                            onUpdateTextLayer(selectedLayer.id, {
                              shadowColor: e.target.value.toUpperCase(),
                            })
                          }
                          className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer shrink-0"
                        />
                        <div className="flex-1 space-y-1">
                          <div className="flex justify-between text-[11px] text-zinc-400">
                            <span>Opacidade</span>
                            <span className="font-mono tabular-nums">
                              {selectedLayer.shadowOpacity}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={selectedLayer.shadowOpacity}
                            onChange={(e) =>
                              onUpdateTextLayer(selectedLayer.id, {
                                shadowOpacity: Number(e.target.value),
                              })
                            }
                            className="studio-slider"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px] text-zinc-400">
                            <span>Blur</span>
                            <span className="font-mono tabular-nums">
                              {selectedLayer.shadowBlur}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={60}
                            value={selectedLayer.shadowBlur}
                            onChange={(e) =>
                              onUpdateTextLayer(selectedLayer.id, {
                                shadowBlur: Number(e.target.value),
                              })
                            }
                            className="studio-slider"
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px] text-zinc-400">
                            <span>Eixo X</span>
                            <span className="font-mono tabular-nums">
                              {selectedLayer.shadowOffsetX}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={-30}
                            max={30}
                            value={selectedLayer.shadowOffsetX}
                            onChange={(e) =>
                              onUpdateTextLayer(selectedLayer.id, {
                                shadowOffsetX: Number(e.target.value),
                              })
                            }
                            className="studio-slider"
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px] text-zinc-400">
                            <span>Eixo Y</span>
                            <span className="font-mono tabular-nums">
                              {selectedLayer.shadowOffsetY}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={-30}
                            max={30}
                            value={selectedLayer.shadowOffsetY}
                            onChange={(e) =>
                              onUpdateTextLayer(selectedLayer.id, {
                                shadowOffsetY: Number(e.target.value),
                              })
                            }
                            className="studio-slider"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Backdrop Highlight */}
                <div className="space-y-2.5 pt-2 border-t border-[#22252D]">
                  <label className="flex items-center justify-between text-[12px] text-zinc-200 cursor-pointer">
                    <span>Fundo de destaque</span>
                    <input
                      type="checkbox"
                      checked={selectedLayer.backdropEnabled}
                      onChange={(e) =>
                        onUpdateTextLayer(selectedLayer.id, {
                          backdropEnabled: e.target.checked,
                        })
                      }
                      className="accent-zinc-100 w-4 h-4 cursor-pointer"
                    />
                  </label>
                  {selectedLayer.backdropEnabled && (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={selectedLayer.backdropColor}
                          onChange={(e) =>
                            onUpdateTextLayer(selectedLayer.id, {
                              backdropColor: e.target.value.toUpperCase(),
                            })
                          }
                          className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer shrink-0"
                        />
                        <div className="flex-1 space-y-1">
                          <div className="flex justify-between text-[11px] text-zinc-400">
                            <span>Opacidade</span>
                            <span className="font-mono tabular-nums">
                              {selectedLayer.backdropOpacity}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={5}
                            max={100}
                            value={selectedLayer.backdropOpacity}
                            onChange={(e) =>
                              onUpdateTextLayer(selectedLayer.id, {
                                backdropOpacity: Number(e.target.value),
                              })
                            }
                            className="studio-slider"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px] text-zinc-400">
                          <span>Arredondamento</span>
                          <span className="font-mono tabular-nums">
                            {selectedLayer.backdropRadius}px
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={32}
                          value={selectedLayer.backdropRadius}
                          onChange={(e) =>
                            onUpdateTextLayer(selectedLayer.id, {
                              backdropRadius: Number(e.target.value),
                            })
                          }
                          className="studio-slider"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
