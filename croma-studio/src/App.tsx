import { useCallback, useEffect, useState } from 'react';
import { CanvasStage } from './components/CanvasStage';
import { ExportModal } from './components/ExportModal';
import { GradientPanel } from './components/GradientPanel';
import { ShapesPanel } from './components/ShapesPanel';
import { TopBar } from './components/TopBar';
import { YouTubePanel } from './components/YouTubePanel';
import {
  createInitialTextLayers,
  generateRandomGeometric,
  generateRandomGradient,
  INITIAL_STUDIO_STATE,
  RESOLUTION_PRESETS,
  THUMBNAIL_PRESETS,
} from './data/presets';
import {
  BackgroundPhotoConfig,
  GradientPalette,
  MainTab,
  QrCodeConfig,
  SavedFavoriteItem,
  SavedFavoritesState,
  StudioState,
  TextLayer,
  ThumbnailPresetId,
  YouTubeSubMode,
} from './types/studio';
import { registerPhotoImage, renderStudioCanvas } from './utils/canvasRenderer';

const MAX_HISTORY = 24;

export default function App() {
  const [state, setState] = useState<StudioState>(INITIAL_STUDIO_STATE);
  const [history, setHistory] = useState<StudioState[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [favorites, setFavorites] = useState<SavedFavoritesState>({ gradientes: [], thumbs: [] });
  const [favSaving, setFavSaving] = useState(false);
  const [favError, setFavError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/croma/favoritos')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.gradientes) && Array.isArray(d.thumbs)) setFavorites(d);
      })
      .catch(() => {});
  }, []);

  const renderSnapshotPng = (w: number, h: number, snapState: StudioState): string => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (ctx) renderStudioCanvas(ctx, w, h, snapState);
    return c.toDataURL('image/png');
  };

  const handleSaveFavorite = async (tipo: 'gradiente' | 'thumb', nome: string) => {
    setFavSaving(true);
    setFavError(null);
    try {
      const dims = getActiveDimensions();
      const targetW = tipo === 'thumb' ? dims.width : 640;
      const targetH = tipo === 'thumb' ? dims.height : 360;
      const snapState: StudioState =
        tipo === 'gradiente'
          ? { ...state, activeTab: 'gradient' }
          : { ...state, activeTab: 'youtube', youtubeSubMode: 'thumbnail' };
      const pngBase64 = renderSnapshotPng(targetW, targetH, snapState);
      const dados =
        tipo === 'gradiente'
          ? { gradient: state.gradient, geometric: state.geometric }
          : {
              thumbnailPreset: state.thumbnailPreset,
              gradient: state.gradient,
              geometric: state.geometric,
              textLayers: state.textLayers,
              backdropScrim: state.backdropScrim,
              qrCode: state.qrCode,
              backgroundPhoto: state.backgroundPhoto,
            };
      const res = await fetch('/api/croma/favoritos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, nome, largura: targetW, altura: targetH, dados, pngBase64 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.erro || 'Falha ao salvar favorito');
      setFavorites(json);
    } catch (e: any) {
      setFavError(e?.message || 'Erro ao salvar favorito');
    } finally {
      setFavSaving(false);
    }
  };

  const handleDeleteFavorite = async (tipo: 'gradiente' | 'thumb', id: string) => {
    try {
      const res = await fetch(
        `/api/croma/favoritos?tipo=${encodeURIComponent(tipo)}&id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      if (res.ok) setFavorites(await res.json());
    } catch {
      // ignore
    }
  };

  const handleToggleDefaultEnd = async (thumbId: string | null) => {
    setFavError(null);
    try {
      const res = await fetch('/api/croma/final-padrao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thumbId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.erro || 'Falha ao definir final padrão');
      setFavorites(json);
    } catch (e: any) {
      setFavError(e?.message || 'Erro ao definir final padrão');
    }
  };

  const handleImportThumbImage = async (nome: string, pngBase64: string, largura: number, altura: number) => {
    setFavSaving(true);
    setFavError(null);
    try {
      const res = await fetch('/api/croma/favoritos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'thumb', nome, largura, altura, dados: null, pngBase64 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.erro || 'Falha ao importar imagem');
      setFavorites(json);
    } catch (e: any) {
      setFavError(e?.message || 'Erro ao importar imagem');
    } finally {
      setFavSaving(false);
    }
  };

  const handleLoadFavorite = (tipo: 'gradiente' | 'thumb', item: SavedFavoriteItem) => {
    const d = item.dados;
    if (!d) return;
    if (tipo === 'gradiente') {
      commitState((prev) => ({
        ...prev,
        gradient: d.gradient || prev.gradient,
        geometric: d.geometric || prev.geometric,
      }));
      return;
    }
    const applyThumb = () => {
      commitState((prev) => ({
        ...prev,
        activeTab: 'youtube',
        youtubeSubMode: 'thumbnail',
        thumbnailPreset: d.thumbnailPreset || prev.thumbnailPreset,
        gradient: d.gradient || prev.gradient,
        geometric: d.geometric || prev.geometric,
        textLayers: Array.isArray(d.textLayers) ? d.textLayers : prev.textLayers,
        backdropScrim: typeof d.backdropScrim === 'number' ? d.backdropScrim : prev.backdropScrim,
        qrCode: d.qrCode || prev.qrCode,
        backgroundPhoto: d.backgroundPhoto || prev.backgroundPhoto,
      }));
    };
    if (d.backgroundPhoto && d.backgroundPhoto.dataUrl) {
      const img = new Image();
      img.onload = () => {
        registerPhotoImage(d.backgroundPhoto.dataUrl, img);
        applyThumb();
      };
      img.onerror = applyThumb;
      img.src = d.backgroundPhoto.dataUrl;
    } else {
      applyThumb();
    }
  };

  const pushHistory = useCallback((prev: StudioState) => {
    setHistory((h) => [...h.slice(-(MAX_HISTORY - 1)), prev]);
  }, []);

  const commitState = useCallback(
    (updater: (prev: StudioState) => StudioState, recordHistory = true) => {
      setState((prev) => {
        if (recordHistory) pushHistory(prev);
        return updater(prev);
      });
    },
    [pushHistory]
  );

  const handleUndo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const previous = h[h.length - 1];
      setState(previous);
      return h.slice(0, -1);
    });
  }, []);

  // Resolve effective canvas dimensions based on active tab & YouTube sub-mode
  const getActiveDimensions = (): {
    width: number;
    height: number;
    label: string;
    filename: string;
  } => {
    if (state.activeTab === 'youtube') {
      if (state.youtubeSubMode === 'thumbnail') {
        const tp =
          THUMBNAIL_PRESETS.find((p) => p.id === state.thumbnailPreset) ??
          THUMBNAIL_PRESETS[0];
        return {
          width: tp.width,
          height: tp.height,
          label: tp.platform,
          filename: tp.filename,
        };
      }
      if (state.youtubeSubMode === 'banner') {
        return {
          width: 2560,
          height: 1440,
          label: 'YouTube Banner',
          filename: 'croma-youtube-banner',
        };
      }
      return {
        width: 150,
        height: 150,
        label: "YouTube Marca d'Água",
        filename: `croma-watermark-${(state.watermark.initials || 'yt')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '') || 'yt'}`,
      };
    }

    if (state.resolutionId === 'custom') {
      return {
        width: state.customWidth,
        height: state.customHeight,
        label: 'Formato Personalizado',
        filename: 'croma-gradiente',
      };
    }

    const preset =
      RESOLUTION_PRESETS.find((r) => r.id === state.resolutionId) ??
      RESOLUTION_PRESETS[0];
    return {
      width: preset.width,
      height: preset.height,
      label: `${preset.platform} — ${preset.label}`,
      filename: `croma-${preset.id}`,
    };
  };

  const { width: canvasWidth, height: canvasHeight, label: resolutionLabel, filename } =
    getActiveDimensions();

  // Keyboard shortcuts: arrow nudging for selected text layer in YouTube mode & Ctrl/Cmd+Z undo
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditingInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT');

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !isEditingInput) {
        e.preventDefault();
        handleUndo();
        return;
      }

      if (
        isEditingInput ||
        state.activeTab !== 'youtube' ||
        state.youtubeSubMode === 'watermark' ||
        !state.selectedTextId
      ) {
        return;
      }

      const step = e.shiftKey ? 0.025 : 0.005;
      if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight'
      ) {
        e.preventDefault();
        setState((prev) => ({
          ...prev,
          textLayers: prev.textLayers.map((l) => {
            if (l.id !== prev.selectedTextId) return l;
            if (e.key === 'ArrowUp') return { ...l, y: Math.max(0.04, l.y - step) };
            if (e.key === 'ArrowDown') return { ...l, y: Math.min(0.96, l.y + step) };
            if (e.key === 'ArrowLeft') return { ...l, x: Math.max(0.04, l.x - step) };
            return { ...l, x: Math.min(0.96, l.x + step) };
          }),
        }));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, state.activeTab, state.youtubeSubMode, state.selectedTextId]);

  const handleSelectTab = (tab: MainTab) => {
    setState((prev) => ({ ...prev, activeTab: tab }));
  };

  const handleChangeYouTubeSubMode = (subMode: YouTubeSubMode) => {
    commitState((prev) => {
      // Refresh default layout positions when switching between thumbnail & banner if untouched or matching default IDs
      let nextLayers = prev.textLayers;
      if (
        (subMode === 'banner' || subMode === 'thumbnail') &&
        prev.youtubeSubMode !== subMode
      ) {
        const hasOnlyDefaultIds = prev.textLayers.every(
          (l) => l.id === 'layer-title' || l.id === 'layer-subtitle'
        );
        if (hasOnlyDefaultIds) {
          nextLayers = createInitialTextLayers(subMode);
        }
      }

      return {
        ...prev,
        youtubeSubMode: subMode,
        textLayers: nextLayers,
        selectedTextId: nextLayers[0]?.id ?? null,
        showSafeZones: subMode === 'banner' ? true : prev.showSafeZones,
      };
    });
  };

  const handleApplyPalette = (palette: GradientPalette) => {
    commitState((prev) => ({
      ...prev,
      gradient: {
        ...prev.gradient,
        type: palette.type,
        angle: palette.angle,
        stops: palette.stops.map((s, idx) => ({
          id: `stop-${Date.now()}-${idx}`,
          color: s.color,
          position: s.position,
        })),
      },
      geometric: {
        ...prev.geometric,
        color: palette.shapeColor,
      },
    }));
  };

  const handleRandomizeGradient = () => {
    commitState((prev) => ({
      ...prev,
      gradient: generateRandomGradient(),
    }));
  };

  const handleRandomizeGeometric = () => {
    commitState((prev) => ({
      ...prev,
      geometric: generateRandomGeometric(),
    }));
  };

  const handleRandomizeAll = () => {
    commitState((prev) => ({
      ...prev,
      gradient: generateRandomGradient(),
      geometric: generateRandomGeometric(),
    }));
  };

  const handleUpdateTextLayer = (id: string, patch: Partial<TextLayer>) => {
    setState((prev) => ({
      ...prev,
      textLayers: prev.textLayers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    }));
  };

  const handleAddTextLayer = () => {
    const newId = `layer-${Date.now()}`;
    const newLayer: TextLayer = {
      id: newId,
      text: 'NOVO TEXTO',
      x: 0.5,
      y: 0.5,
      fontFamily: 'Outfit',
      fontSize: 64,
      fontWeight: 700,
      letterSpacing: 1,
      lineHeight: 1.1,
      uppercase: false,
      align: 'center',
      color: '#FFFFFF',
      opacity: 100,
      rotation: 0,
      visible: true,
      strokeEnabled: false,
      strokeColor: '#09090B',
      strokeWidth: 4,
      shadowEnabled: true,
      shadowColor: '#000000',
      shadowBlur: 18,
      shadowOffsetX: 0,
      shadowOffsetY: 6,
      shadowOpacity: 60,
      backdropEnabled: false,
      backdropColor: '#09090B',
      backdropOpacity: 65,
      backdropPaddingX: 22,
      backdropPaddingY: 10,
      backdropRadius: 8,
    };

    commitState((prev) => ({
      ...prev,
      textLayers: [...prev.textLayers, newLayer],
      selectedTextId: newId,
    }));
  };

  const handleDuplicateTextLayer = (id: string) => {
    const source = state.textLayers.find((l) => l.id === id);
    if (!source) return;
    const copyId = `layer-${Date.now()}`;
    const duplicate: TextLayer = {
      ...source,
      id: copyId,
      y: Math.min(0.92, source.y + 0.08),
    };
    commitState((prev) => ({
      ...prev,
      textLayers: [...prev.textLayers, duplicate],
      selectedTextId: copyId,
    }));
  };

  const handleDeleteTextLayer = (id: string) => {
    commitState((prev) => {
      const remaining = prev.textLayers.filter((l) => l.id !== id);
      return {
        ...prev,
        textLayers: remaining,
        selectedTextId:
          prev.selectedTextId === id ? remaining[0]?.id ?? null : prev.selectedTextId,
      };
    });
  };

  const handleQuickExportWatermark = () => {
    const offscreen = document.createElement('canvas');
    offscreen.width = 150;
    offscreen.height = 150;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;
    renderStudioCanvas(ctx, 150, 150, state);
    offscreen.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}-150x150.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  };

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-[#0B0C0F] text-zinc-100 lg:overflow-hidden">
      <TopBar
        activeTab={state.activeTab}
        onSelectTab={handleSelectTab}
        onOpenExport={() => setExportOpen(true)}
      />

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Left Inspector Sidebar */}
        <aside className="w-full lg:w-[348px] xl:w-[368px] shrink-0 border-b lg:border-b-0 lg:border-r border-[#22252D] bg-[#121318] lg:overflow-y-auto studio-scroll">
          {state.activeTab === 'gradient' && (
            <GradientPanel
              gradient={state.gradient}
              resolutionId={state.resolutionId}
              customWidth={state.customWidth}
              customHeight={state.customHeight}
              favoriteGradients={favorites.gradientes}
              favSaving={favSaving}
              favError={favError}
              onSaveFavorite={(nome) => handleSaveFavorite('gradiente', nome)}
              onLoadFavorite={(item) => handleLoadFavorite('gradiente', item)}
              onDeleteFavorite={(id) => handleDeleteFavorite('gradiente', id)}
              onChangeGradient={(next) =>
                setState((prev) => ({ ...prev, gradient: next }))
              }
              onApplyPalette={handleApplyPalette}
              onSelectResolution={(id) =>
                commitState((prev) => {
                  // If user picks YouTube Watermark preset from resolution dropdown, switch cleanly
                  if (id === 'yt-watermark') {
                    return {
                      ...prev,
                      resolutionId: id,
                      activeTab: 'youtube',
                      youtubeSubMode: 'watermark',
                    };
                  }
                  return { ...prev, resolutionId: id };
                })
              }
              onChangeCustomDimensions={(w, h) =>
                setState((prev) => ({ ...prev, customWidth: w, customHeight: h }))
              }
              onRandomizeGradient={handleRandomizeGradient}
            />
          )}

          {state.activeTab === 'shapes' && (
            <ShapesPanel
              geometric={state.geometric}
              onChangeGeometric={(next) =>
                setState((prev) => ({ ...prev, geometric: next }))
              }
              onRandomizeGeometric={handleRandomizeGeometric}
            />
          )}

          {state.activeTab === 'youtube' && (
            <YouTubePanel
              subMode={state.youtubeSubMode}
              onChangeSubMode={handleChangeYouTubeSubMode}
              thumbnailPreset={state.thumbnailPreset}
              onChangeThumbnailPreset={(preset: ThumbnailPresetId) =>
                commitState((prev) => ({ ...prev, thumbnailPreset: preset }))
              }
              backgroundPhoto={state.backgroundPhoto}
              onChangeBackgroundPhoto={(next: BackgroundPhotoConfig) =>
                setState((prev) => ({ ...prev, backgroundPhoto: next }))
              }
              qrCode={state.qrCode}
              onChangeQrCode={(next: QrCodeConfig) =>
                setState((prev) => ({ ...prev, qrCode: next }))
              }
              favoriteThumbs={favorites.thumbs}
              favoriteGradients={favorites.gradientes}
              defaultEndThumbId={favorites.finalPadrao?.thumbId ?? null}
              favSaving={favSaving}
              favError={favError}
              onSaveFavorite={handleSaveFavorite}
              onLoadFavorite={handleLoadFavorite}
              onDeleteFavorite={handleDeleteFavorite}
              onToggleDefaultEnd={handleToggleDefaultEnd}
              onImportThumbImage={handleImportThumbImage}
              textLayers={state.textLayers}
              selectedTextId={state.selectedTextId}
              onSelectText={(id) =>
                setState((prev) => ({ ...prev, selectedTextId: id }))
              }
              onUpdateTextLayer={handleUpdateTextLayer}
              onAddTextLayer={handleAddTextLayer}
              onDuplicateTextLayer={handleDuplicateTextLayer}
              onDeleteTextLayer={handleDeleteTextLayer}
              backdropScrim={state.backdropScrim}
              onChangeBackdropScrim={(val) =>
                setState((prev) => ({ ...prev, backdropScrim: val }))
              }
              watermark={state.watermark}
              onChangeWatermark={(next) =>
                setState((prev) => ({ ...prev, watermark: next }))
              }
              onApplyPalette={handleApplyPalette}
              onRandomizeGradient={handleRandomizeGradient}
            />
          )}
        </aside>

        {/* Central Interactive Canvas Stage */}
        <CanvasStage
          state={state}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          resolutionLabel={resolutionLabel}
          onSelectText={(id) =>
            setState((prev) => ({ ...prev, selectedTextId: id }))
          }
          onUpdateTextLayer={handleUpdateTextLayer}
          onUpdateQrCode={(patch) =>
            setState((prev) => ({ ...prev, qrCode: { ...prev.qrCode, ...patch } }))
          }
          onToggleSafeZones={() =>
            setState((prev) => ({ ...prev, showSafeZones: !prev.showSafeZones }))
          }
          onRandomizeAll={handleRandomizeAll}
          onUndo={handleUndo}
          canUndo={history.length > 0}
          onQuickExportWatermark={handleQuickExportWatermark}
        />
      </div>

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        state={state}
        width={canvasWidth}
        height={canvasHeight}
        baseFilename={filename}
      />
    </div>
  );
}
