import QRCode from 'qrcode';
import {
  BackgroundPhotoConfig,
  GeometricConfig,
  GradientConfig,
  QrCodeConfig,
  StudioState,
  TextLayer,
  WatermarkConfig,
} from '../types/studio';

// Cache sincrono das fotos carregadas pelo usuario para preview instantaneo e exportacao em alta resolucao
const photoImageCache = new Map<string, HTMLImageElement>();

export function registerPhotoImage(dataUrl: string, img: HTMLImageElement) {
  photoImageCache.set(dataUrl, img);
}

export function drawBackgroundPhoto(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  photo: BackgroundPhotoConfig
) {
  if (!photo.dataUrl || photo.opacity <= 0) return;
  const img = photoImageCache.get(photo.dataUrl);
  if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) return;

  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const baseScale =
    photo.fit === 'contain'
      ? Math.min(width / iw, height / ih)
      : Math.max(width / iw, height / ih);
  const finalScale = baseScale * (photo.scale / 100);
  const drawW = iw * finalScale;
  const drawH = ih * finalScale;
  const dx = (width - drawW) / 2 + (photo.offsetX / 100) * width;
  const dy = (height - drawH) / 2 + (photo.offsetY / 100) * height;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, photo.opacity / 100));
  if (photo.blur > 0) {
    const blurScale = Math.min(width, height) / 1080;
    ctx.filter = `blur(${(photo.blur * Math.max(0.5, blurScale)).toFixed(1)}px)`;
  }
  ctx.drawImage(img, dx, dy, drawW, drawH);
  ctx.restore();
}

// Deterministic PRNG (Mulberry32) so preview and export match pixel-for-pixel
function createRng(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Reusable cached noise tile for crisp, fast film grain
let cachedNoiseCanvas: HTMLCanvasElement | null = null;
function getNoiseTile(): HTMLCanvasElement {
  if (cachedNoiseCanvas) return cachedNoiseCanvas;
  const size = 256;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const tctx = tile.getContext('2d');
  if (tctx) {
    const img = tctx.createImageData(size, size);
    const rng = createRng(90210);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(rng() * 255);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    tctx.putImageData(img, 0, 0);
  }
  cachedNoiseCanvas = tile;
  return tile;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '').trim();
  let r = 0,
    g = 0,
    b = 0;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else if (clean.length >= 6) {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  }
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return `rgba(0, 0, 0, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

export function drawGradientBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  gradient: GradientConfig
) {
  const sortedStops = [...gradient.stops].sort((a, b) => a.position - b.position);
  if (sortedStops.length === 0) return;

  ctx.save();

  if (gradient.type === 'linear') {
    const rad = ((gradient.angle - 90) * Math.PI) / 180;
    const cx = width / 2;
    const cy = height / 2;
    const halfDiag =
      (Math.abs(width * Math.cos(rad)) + Math.abs(height * Math.sin(rad))) / 2;
    const x0 = cx - Math.cos(rad) * halfDiag;
    const y0 = cy - Math.sin(rad) * halfDiag;
    const x1 = cx + Math.cos(rad) * halfDiag;
    const y1 = cy + Math.sin(rad) * halfDiag;

    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    sortedStops.forEach((s) => grad.addColorStop(s.position / 100, s.color));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  } else if (gradient.type === 'radial') {
    const fx = (gradient.focalX / 100) * width;
    const fy = (gradient.focalY / 100) * height;
    const maxR = Math.hypot(
      Math.max(fx, width - fx),
      Math.max(fy, height - fy)
    );
    const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, maxR);
    sortedStops.forEach((s) => grad.addColorStop(s.position / 100, s.color));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  } else if (gradient.type === 'conic') {
    const fx = (gradient.focalX / 100) * width;
    const fy = (gradient.focalY / 100) * height;
    const startRad = ((gradient.angle - 90) * Math.PI) / 180;
    if (typeof ctx.createConicGradient === 'function') {
      const grad = ctx.createConicGradient(startRad, fx, fy);
      sortedStops.forEach((s) => grad.addColorStop(s.position / 100, s.color));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    } else {
      // Fallback for older engines
      const grad = ctx.createLinearGradient(0, 0, width, height);
      sortedStops.forEach((s) => grad.addColorStop(s.position / 100, s.color));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }
  } else if (gradient.type === 'mesh') {
    // Base fill with first stop
    ctx.fillStyle = sortedStops[0].color;
    ctx.fillRect(0, 0, width, height);

    // Subtle directional under-wash
    const baseGrad = ctx.createLinearGradient(0, 0, width, height);
    sortedStops.forEach((s) => baseGrad.addColorStop(s.position / 100, s.color));
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;

    // Multi-point organic aura blobs
    const rng = createRng(gradient.meshSeed * 13 + 7);
    const spreadFactor = gradient.meshSpread / 100;
    const diag = Math.hypot(width, height);
    const blobCount = Math.max(5, sortedStops.length * 2 + 1);

    for (let i = 0; i < blobCount; i++) {
      const stop = sortedStops[i % sortedStops.length];
      const angleOffset = (gradient.angle * Math.PI) / 180;
      const baseAngle = (i / blobCount) * Math.PI * 2 + angleOffset;
      const dist = (0.18 + rng() * 0.38) * Math.min(width, height);
      const bx =
        (gradient.focalX / 100) * width + Math.cos(baseAngle) * dist * 1.15;
      const by =
        (gradient.focalY / 100) * height + Math.sin(baseAngle) * dist * 0.95;
      const radius = diag * (0.34 + rng() * 0.34) * spreadFactor;

      const radGrad = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
      radGrad.addColorStop(0, hexToRgba(stop.color, 0.92));
      radGrad.addColorStop(0.5, hexToRgba(stop.color, 0.42));
      radGrad.addColorStop(1, hexToRgba(stop.color, 0));

      ctx.fillStyle = radGrad;
      ctx.fillRect(0, 0, width, height);
    }
  }

  // Vignette
  if (gradient.vignetteOpacity > 0) {
    const cx = width / 2;
    const cy = height / 2;
    const outerR = Math.hypot(cx, cy);
    const vig = ctx.createRadialGradient(cx, cy, outerR * 0.35, cx, cy, outerR);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, `rgba(0,0,0,${(gradient.vignetteOpacity / 100) * 0.85})`);
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, width, height);
  }

  // Subtle film grain / noise
  if (gradient.noiseOpacity > 0) {
    const tile = getNoiseTile();
    const pattern = ctx.createPattern(tile, 'repeat');
    if (pattern) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = (gradient.noiseOpacity / 100) * 0.38;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
  }

  ctx.restore();
}

export function drawGeometricOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  geo: GeometricConfig
) {
  if (geo.type === 'none' || geo.opacity <= 0) return;

  // Normalize scale relative to a 1080px reference so patterns look identical across resolutions
  const refFactor = Math.min(width, height) / 1080;
  const cell = Math.max(8, geo.scale * refFactor);
  const strokeW = Math.max(0.5, geo.strokeWidth * Math.max(0.45, refFactor));

  ctx.save();
  ctx.globalAlpha = geo.opacity / 100;
  ctx.globalCompositeOperation = geo.blendMode;
  ctx.strokeStyle = geo.color;
  ctx.fillStyle = geo.color;
  ctx.lineWidth = strokeW;

  const cx = width / 2;
  const cy = height / 2;
  const diag = Math.hypot(width, height);

  if (geo.type !== 'bauhaus' && geo.type !== 'orbs') {
    ctx.translate(cx, cy);
    ctx.rotate((geo.rotation * Math.PI) / 180);
  }

  const half = diag * 0.65;

  switch (geo.type) {
    case 'grid': {
      ctx.beginPath();
      for (let x = -half; x <= half; x += cell) {
        ctx.moveTo(x, -half);
        ctx.lineTo(x, half);
      }
      for (let y = -half; y <= half; y += cell) {
        ctx.moveTo(-half, y);
        ctx.lineTo(half, y);
      }
      ctx.stroke();

      if (geo.fillMode === 'mixed' || geo.fillMode === 'fill') {
        const dotR = strokeW * 1.4;
        ctx.fillStyle = geo.fillMode === 'mixed' ? geo.secondaryColor : geo.color;
        for (let x = -half; x <= half; x += cell) {
          for (let y = -half; y <= half; y += cell) {
            ctx.beginPath();
            ctx.arc(x, y, dotR, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      break;
    }

    case 'dots': {
      const r = Math.max(1.2, (cell * 0.14) * (0.6 + geo.strokeWidth * 0.14));
      for (let x = -half; x <= half; x += cell) {
        for (let y = -half; y <= half; y += cell) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          if (geo.fillMode === 'stroke') {
            ctx.stroke();
          } else {
            ctx.fill();
          }
        }
      }
      break;
    }

    case 'diagonals': {
      ctx.beginPath();
      for (let x = -half * 1.4; x <= half * 1.4; x += cell) {
        ctx.moveTo(x, -half);
        ctx.lineTo(x + half * 1.2, half);
      }
      ctx.stroke();
      if (geo.fillMode === 'mixed') {
        ctx.strokeStyle = geo.secondaryColor;
        ctx.beginPath();
        for (let x = -half * 1.4 + cell / 2; x <= half * 1.4; x += cell) {
          ctx.moveTo(x, -half);
          ctx.lineTo(x - half * 1.2, half);
        }
        ctx.stroke();
      }
      break;
    }

    case 'circles': {
      const maxR = half;
      let idx = 0;
      for (let r = cell; r <= maxR; r += cell) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        if (geo.fillMode === 'mixed' && idx % 2 === 1) {
          ctx.strokeStyle = geo.secondaryColor;
        } else {
          ctx.strokeStyle = geo.color;
        }
        ctx.stroke();
        idx++;
      }
      break;
    }

    case 'triangles': {
      const h = (cell * Math.sqrt(3)) / 2;
      const rng = createRng(geo.seed);
      for (let row = -Math.ceil(half / h); row <= Math.ceil(half / h); row++) {
        for (let col = -Math.ceil(half / cell); col <= Math.ceil(half / cell); col++) {
          const x = col * cell + (row % 2 === 0 ? 0 : cell / 2);
          const y = row * h;
          const up = (row + col) % 2 === 0;
          ctx.beginPath();
          if (up) {
            ctx.moveTo(x, y - h / 2);
            ctx.lineTo(x + cell / 2, y + h / 2);
            ctx.lineTo(x - cell / 2, y + h / 2);
          } else {
            ctx.moveTo(x - cell / 2, y - h / 2);
            ctx.lineTo(x + cell / 2, y - h / 2);
            ctx.lineTo(x, y + h / 2);
          }
          ctx.closePath();

          if (geo.fillMode === 'fill' || (geo.fillMode === 'mixed' && rng() > 0.65)) {
            ctx.save();
            ctx.globalAlpha *= 0.25 + rng() * 0.55;
            ctx.fillStyle = rng() > 0.5 ? geo.color : geo.secondaryColor;
            ctx.fill();
            ctx.restore();
          }
          if (geo.fillMode !== 'fill') {
            ctx.stroke();
          }
        }
      }
      break;
    }

    case 'hexagons': {
      const r = cell * 0.58;
      const dx = r * 1.5;
      const dy = r * Math.sqrt(3);
      const rng = createRng(geo.seed);

      for (let col = -Math.ceil(half / dx); col <= Math.ceil(half / dx); col++) {
        for (let row = -Math.ceil(half / dy); row <= Math.ceil(half / dy); row++) {
          const hx = col * dx;
          const hy = row * dy + (col % 2 !== 0 ? dy / 2 : 0);
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i;
            const px = hx + r * Math.cos(a);
            const py = hy + r * Math.sin(a);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          if (geo.fillMode === 'fill' || (geo.fillMode === 'mixed' && rng() > 0.72)) {
            ctx.save();
            ctx.globalAlpha *= 0.3 + rng() * 0.5;
            ctx.fillStyle = rng() > 0.5 ? geo.color : geo.secondaryColor;
            ctx.fill();
            ctx.restore();
          }
          if (geo.fillMode !== 'fill') {
            ctx.stroke();
          }
        }
      }
      break;
    }

    case 'waves': {
      const amp = cell * 0.42;
      const freq = (Math.PI * 2) / (cell * 3.5);
      let lineIndex = 0;
      for (let y = -half; y <= half; y += cell * 0.75) {
        ctx.beginPath();
        ctx.strokeStyle =
          geo.fillMode === 'mixed' && lineIndex % 2 === 1
            ? geo.secondaryColor
            : geo.color;
        for (let x = -half; x <= half; x += Math.max(6, cell * 0.2)) {
          const wy = y + Math.sin(x * freq + lineIndex * 0.65) * amp;
          if (x === -half) ctx.moveTo(x, wy);
          else ctx.lineTo(x, wy);
        }
        ctx.stroke();
        lineIndex++;
      }
      break;
    }

    case 'bauhaus': {
      const rng = createRng(geo.seed);
      const shapes = Math.max(4, geo.count);
      const minDim = Math.min(width, height);
      for (let i = 0; i < shapes; i++) {
        const px = rng() * width;
        const py = rng() * height;
        const size = (0.1 + rng() * 0.32) * minDim * (geo.scale / 80);
        const kind = Math.floor(rng() * 4);
        const rot = ((geo.rotation + rng() * 360) * Math.PI) / 180;
        const useSec = i % 2 === 1;
        const col = useSec ? geo.secondaryColor : geo.color;

        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(rot);
        ctx.fillStyle = col;
        ctx.strokeStyle = col;
        ctx.lineWidth = strokeW * 1.4;

        ctx.beginPath();
        if (kind === 0) {
          // Semicircle arc
          ctx.arc(0, 0, size / 2, 0, Math.PI);
          ctx.closePath();
        } else if (kind === 1) {
          // Quarter-circle wedge
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, size / 2, 0, Math.PI / 2);
          ctx.closePath();
        } else if (kind === 2) {
          // Crisp geometric rectangle / pillar
          ctx.rect(-size / 2, -size / 4, size, size / 2);
        } else {
          // Ring / circle
          ctx.arc(0, 0, size * 0.4, 0, Math.PI * 2);
        }

        if (geo.fillMode === 'fill' || (geo.fillMode === 'mixed' && i % 2 === 0)) {
          ctx.fill();
        } else {
          ctx.stroke();
        }
        ctx.restore();
      }
      break;
    }

    case 'orbs': {
      const rng = createRng(geo.seed);
      const count = Math.max(3, geo.count);
      const minDim = Math.min(width, height);
      for (let i = 0; i < count; i++) {
        const px = rng() * width;
        const py = rng() * height;
        const r = (0.08 + rng() * 0.28) * minDim * (geo.scale / 80);
        const col = i % 2 === 0 ? geo.color : geo.secondaryColor;

        ctx.save();
        if (geo.fillMode === 'stroke') {
          ctx.strokeStyle = col;
          ctx.lineWidth = strokeW * 1.5;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          const g = ctx.createRadialGradient(
            px - r * 0.25,
            py - r * 0.25,
            r * 0.05,
            px,
            py,
            r
          );
          g.addColorStop(0, hexToRgba(col, 0.9));
          g.addColorStop(0.6, hexToRgba(col, 0.35));
          g.addColorStop(1, hexToRgba(col, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();

          if (geo.fillMode === 'mixed') {
            ctx.strokeStyle = hexToRgba(col, 0.45);
            ctx.lineWidth = strokeW;
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      break;
    }

    case 'fractals': {
      // Fractal geometrico radial (galhos recursivos em simetria hexagonal)
      const rng = createRng(geo.seed);
      const minDim = Math.min(width, height);
      const baseLen = minDim * (0.18 + (geo.scale / 240) * 0.24);
      const maxDepth = geo.scale > 120 ? 4 : 5;
      const spreadAngle = 0.42 + (rng() * 0.22);

      const drawBranch = (x: number, y: number, len: number, angle: number, depth: number) => {
        if (depth <= 0 || len < 4) return;
        const x2 = x + Math.cos(angle) * len;
        const y2 = y + Math.sin(angle) * len;

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = depth % 2 === 0 ? geo.secondaryColor : geo.color;
        ctx.lineWidth = Math.max(0.8, strokeW * (depth / maxDepth) * 1.3);
        ctx.stroke();

        if (geo.fillMode !== 'stroke' && depth <= 2) {
          ctx.beginPath();
          ctx.arc(x2, y2, Math.max(2, len * 0.14), 0, Math.PI * 2);
          ctx.fillStyle = depth === 1 ? geo.secondaryColor : geo.color;
          ctx.fill();
        }

        const nextLen = len * 0.66;
        drawBranch(x2, y2, nextLen, angle - spreadAngle, depth - 1);
        drawBranch(x2, y2, nextLen, angle + spreadAngle, depth - 1);
      };

      const arms = 6;
      for (let i = 0; i < arms; i++) {
        const a = ((Math.PI * 2) / arms) * i;
        drawBranch(0, 0, baseLen, a, maxDepth);
      }
      break;
    }

    case 'tri-fractal': {
      // Triangulo Fractal de Sierpinski recursivo com subdivisao geometrica
      const rng = createRng(geo.seed);
      const minDim = Math.min(width, height);
      const r = minDim * (0.36 + (geo.scale / 240) * 0.42);
      const depth = geo.scale < 50 ? 5 : 4;

      const drawSierpinski = (
        x1: number, y1: number,
        x2: number, y2: number,
        x3: number, y3: number,
        d: number
      ) => {
        if (d <= 0) {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.lineTo(x3, y3);
          ctx.closePath();

          const pick = rng();
          const col = pick > 0.5 ? geo.color : geo.secondaryColor;
          if (geo.fillMode === 'fill' || (geo.fillMode === 'mixed' && pick > 0.42)) {
            ctx.save();
            ctx.globalAlpha *= 0.35 + rng() * 0.55;
            ctx.fillStyle = col;
            ctx.fill();
            ctx.restore();
          }
          if (geo.fillMode !== 'fill') {
            ctx.strokeStyle = col;
            ctx.lineWidth = Math.max(0.8, strokeW * 0.85);
            ctx.stroke();
          }
          return;
        }
        const mx12 = (x1 + x2) / 2;
        const my12 = (y1 + y2) / 2;
        const mx23 = (x2 + x3) / 2;
        const my23 = (y2 + y3) / 2;
        const mx31 = (x3 + x1) / 2;
        const my31 = (y3 + y1) / 2;
        drawSierpinski(x1, y1, mx12, my12, mx31, my31, d - 1);
        drawSierpinski(mx12, my12, x2, y2, mx23, my23, d - 1);
        drawSierpinski(mx31, my31, mx23, my23, x3, y3, d - 1);
      };

      const a0 = -Math.PI / 2;
      const a1 = a0 + (Math.PI * 2) / 3;
      const a2 = a1 + (Math.PI * 2) / 3;
      drawSierpinski(
        Math.cos(a0) * r, Math.sin(a0) * r,
        Math.cos(a1) * r, Math.sin(a1) * r,
        Math.cos(a2) * r, Math.sin(a2) * r,
        depth
      );
      break;
    }
  }

  ctx.restore();
}

export interface TextLayerBounds {
  id: string;
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawTextWithTracking(
  ctx: CanvasRenderingContext2D,
  line: string,
  x: number,
  y: number,
  letterSpacing: number,
  align: CanvasTextAlign,
  mode: 'fill' | 'stroke'
) {
  if (Math.abs(letterSpacing) < 0.1) {
    if (mode === 'stroke') ctx.strokeText(line, x, y);
    else ctx.fillText(line, x, y);
    return;
  }

  const chars = Array.from(line);
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const totalWidth =
    widths.reduce((acc, w) => acc + w, 0) +
    letterSpacing * Math.max(0, chars.length - 1);

  let cursorX = x;
  if (align === 'center') cursorX = x - totalWidth / 2;
  else if (align === 'right') cursorX = x - totalWidth;

  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  for (let i = 0; i < chars.length; i++) {
    if (mode === 'stroke') ctx.strokeText(chars[i], cursorX, y);
    else ctx.fillText(chars[i], cursorX, y);
    cursorX += widths[i] + letterSpacing;
  }
  ctx.textAlign = prevAlign;
}

function measureLineWidth(
  ctx: CanvasRenderingContext2D,
  line: string,
  letterSpacing: number
): number {
  if (Math.abs(letterSpacing) < 0.1) {
    return ctx.measureText(line).width;
  }
  const chars = Array.from(line);
  return (
    chars.reduce((acc, ch) => acc + ctx.measureText(ch).width, 0) +
    letterSpacing * Math.max(0, chars.length - 1)
  );
}

export function drawTextLayers(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  layers: TextLayer[]
): TextLayerBounds[] {
  const scaleFactor = height / 720; // Consistent sizing across 720p thumbnail and 1440p banner
  const bounds: TextLayerBounds[] = [];

  for (const layer of layers) {
    if (!layer.visible || !layer.text.trim()) continue;

    const displayStr = layer.uppercase ? layer.text.toUpperCase() : layer.text;
    const lines = displayStr.split('\n');
    const fontSizePx = layer.fontSize * scaleFactor;
    const trackingPx = layer.letterSpacing * scaleFactor;
    const lineHeightPx = fontSizePx * layer.lineHeight;

    ctx.save();
    ctx.font = `${layer.fontWeight} ${fontSizePx}px "${layer.fontFamily}", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = layer.align;

    const lineWidths = lines.map((l) => measureLineWidth(ctx, l, trackingPx));
    const maxLineW = Math.max(fontSizePx * 0.8, ...lineWidths);
    const totalH = lines.length * lineHeightPx;

    const cx = layer.x * width;
    const cy = layer.y * height;

    const padX = layer.backdropEnabled ? layer.backdropPaddingX * scaleFactor : 10 * scaleFactor;
    const padY = layer.backdropEnabled ? layer.backdropPaddingY * scaleFactor : 8 * scaleFactor;

    bounds.push({
      id: layer.id,
      cx,
      cy,
      width: maxLineW + padX * 2,
      height: totalH + padY * 2,
      rotation: layer.rotation,
    });

    ctx.translate(cx, cy);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.globalAlpha = layer.opacity / 100;

    // Optional backdrop highlight box
    if (layer.backdropEnabled && layer.backdropOpacity > 0) {
      ctx.save();
      const boxW = maxLineW + padX * 2;
      const boxH = totalH + padY * 2;
      const boxX =
        layer.align === 'center'
          ? -boxW / 2
          : layer.align === 'left'
          ? -maxLineW / 2 - padX
          : -maxLineW / 2 - padX;
      const boxY = -boxH / 2;

      if (layer.shadowEnabled && layer.shadowOpacity > 0) {
        ctx.shadowColor = hexToRgba(layer.shadowColor, layer.shadowOpacity / 100);
        ctx.shadowBlur = layer.shadowBlur * scaleFactor;
        ctx.shadowOffsetX = layer.shadowOffsetX * scaleFactor;
        ctx.shadowOffsetY = layer.shadowOffsetY * scaleFactor;
      }

      ctx.fillStyle = hexToRgba(layer.backdropColor, layer.backdropOpacity / 100);
      drawRoundedRectPath(ctx, boxX, boxY, boxW, boxH, layer.backdropRadius * scaleFactor);
      ctx.fill();
      ctx.restore();
    }

    // Configure text shadow
    if (layer.shadowEnabled && layer.shadowOpacity > 0 && !layer.backdropEnabled) {
      ctx.shadowColor = hexToRgba(layer.shadowColor, layer.shadowOpacity / 100);
      ctx.shadowBlur = layer.shadowBlur * scaleFactor;
      ctx.shadowOffsetX = layer.shadowOffsetX * scaleFactor;
      ctx.shadowOffsetY = layer.shadowOffsetY * scaleFactor;
    }

    const startY = -((lines.length - 1) * lineHeightPx) / 2;
    const textAnchorX =
      layer.align === 'center'
        ? 0
        : layer.align === 'left'
        ? -maxLineW / 2
        : maxLineW / 2;

    lines.forEach((line, idx) => {
      const ly = startY + idx * lineHeightPx;

      // Stroke first (behind fill) for crisp outlines
      if (layer.strokeEnabled && layer.strokeWidth > 0) {
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.lineWidth = layer.strokeWidth * 2 * scaleFactor;
        ctx.strokeStyle = layer.strokeColor;
        drawTextWithTracking(ctx, line, textAnchorX, ly, trackingPx, layer.align, 'stroke');
        ctx.restore();
      }

      // Fill
      ctx.fillStyle = layer.color;
      drawTextWithTracking(ctx, line, textAnchorX, ly, trackingPx, layer.align, 'fill');
    });

    ctx.restore();
  }

  return bounds;
}

function buildWatermarkClipPath(
  ctx: CanvasRenderingContext2D,
  size: number,
  wm: WatermarkConfig,
  inset = 0
) {
  const s = size - inset * 2;
  const x = inset;
  const y = inset;
  const cx = size / 2;
  const cy = size / 2;
  const r = s / 2;

  ctx.beginPath();
  if (wm.shape === 'circle') {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  } else if (wm.shape === 'square') {
    ctx.rect(x, y, s, s);
  } else if (wm.shape === 'rounded') {
    const rad = (wm.cornerRadius / 100) * r;
    drawRoundedRectPath(ctx, x, y, s, s, rad);
  } else if (wm.shape === 'squircle') {
    // Superellipse approximation
    const k = r * 0.92;
    ctx.moveTo(cx, y);
    ctx.bezierCurveTo(cx + k, y, x + s, cy - k, x + s, cy);
    ctx.bezierCurveTo(x + s, cy + k, cx + k, y + s, cx, y + s);
    ctx.bezierCurveTo(cx - k, y + s, x, cy + k, x, cy);
    ctx.bezierCurveTo(x, cy - k, cx - k, y, cx, y);
    ctx.closePath();
  } else if (wm.shape === 'hexagon') {
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2;
      const px = cx + r * Math.cos(angle);
      const py = cy + r * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else {
    // cutout (transparent container)
    drawRoundedRectPath(ctx, x, y, s, s, r * 0.25);
  }
}

export function drawWatermarkCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  gradient: GradientConfig,
  geometric: GeometricConfig,
  wm: WatermarkConfig
) {
  const size = Math.min(width, height);
  const scale = size / 150;
  ctx.clearRect(0, 0, width, height);

  ctx.save();

  const inset = wm.borderEnabled ? (wm.borderWidth * scale) / 2 + 1 : 0;

  if (wm.shape !== 'cutout') {
    ctx.save();
    buildWatermarkClipPath(ctx, size, wm, inset);
    ctx.clip();

    ctx.globalAlpha = wm.bgOpacity / 100;
    drawGradientBackground(ctx, size, size, gradient);
    if (wm.usePattern && geometric.type !== 'none') {
      drawGeometricOverlay(ctx, size, size, geometric);
    }
    ctx.restore();
  }

  // Optional outer ring / border
  if (wm.borderEnabled && wm.borderWidth > 0) {
    ctx.save();
    buildWatermarkClipPath(ctx, size, wm, inset);
    ctx.strokeStyle = wm.borderColor;
    ctx.lineWidth = wm.borderWidth * scale;
    ctx.globalAlpha = (wm.bgOpacity / 100) * 0.92;
    ctx.stroke();
    ctx.restore();
  }

  // Monogram / Initials
  const text = (wm.initials || 'CS').slice(0, 4);
  const fontSizePx = wm.fontSize * scale;
  const trackingPx = wm.letterSpacing * scale;
  const hasSub = wm.showSubLabel && wm.subLabel.trim().length > 0;
  const mainY = hasSub ? size * 0.44 : size * 0.515;

  ctx.save();
  ctx.globalAlpha = wm.textOpacity / 100;
  ctx.font = `${wm.fontWeight} ${fontSizePx}px "${wm.fontFamily}", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (wm.shadowEnabled && wm.shadowOpacity > 0) {
    ctx.shadowColor = hexToRgba(wm.shadowColor, wm.shadowOpacity / 100);
    ctx.shadowBlur = wm.shadowBlur * scale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = wm.shadowOffsetY * scale;
  }

  if (wm.strokeEnabled && wm.strokeWidth > 0) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = wm.strokeWidth * 2 * scale;
    ctx.strokeStyle = wm.strokeColor;
    drawTextWithTracking(ctx, text, size / 2, mainY, trackingPx, 'center', 'stroke');
    ctx.restore();
  }

  ctx.fillStyle = wm.textColor;
  drawTextWithTracking(ctx, text, size / 2, mainY, trackingPx, 'center', 'fill');

  if (hasSub) {
    const subSize = Math.max(9, 13 * scale);
    ctx.font = `700 ${subSize}px "Plus Jakarta Sans", sans-serif`;
    ctx.fillStyle = hexToRgba(wm.textColor, 0.9);
    drawTextWithTracking(
      ctx,
      wm.subLabel.toUpperCase().slice(0, 14),
      size / 2,
      size * 0.78,
      1.6 * scale,
      'center',
      'fill'
    );
  }

  ctx.restore();
  ctx.restore();
}

// Cache sincrono da matriz QR Code para desenhar em alta resolucao sem atraso
const qrMatrixCache = new Map<string, { size: number; data: Uint8Array }>();

function getQrMatrix(text: string): { size: number; data: Uint8Array } | null {
  const clean = text.trim();
  if (!clean) return null;
  const cached = qrMatrixCache.get(clean);
  if (cached) return cached;
  try {
    const qr = QRCode.create(clean, { errorCorrectionLevel: 'M' });
    const entry = { size: qr.modules.size, data: qr.modules.data };
    if (qrMatrixCache.size > 40) qrMatrixCache.clear();
    qrMatrixCache.set(clean, entry);
    return entry;
  } catch {
    return null;
  }
}

export function drawQrCode(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  qr: QrCodeConfig
): TextLayerBounds | null {
  if (!qr || !qr.enabled || !qr.text.trim()) return null;
  const matrix = getQrMatrix(qr.text);
  if (!matrix) return null;

  const minDim = Math.min(width, height);
  const boxSize = Math.max(48, Math.round(minDim * (qr.size / 100)));
  const cx = qr.x * width;
  const cy = qr.y * height;
  const pad = Math.round(boxSize * (qr.padding / 100));
  const inner = Math.max(24, boxSize - pad * 2);
  const cell = inner / matrix.size;
  const rad = Math.round(boxSize * (qr.radius / 100));

  ctx.save();
  ctx.globalAlpha = Math.max(0.1, Math.min(1, qr.opacity / 100));
  ctx.translate(cx - boxSize / 2, cy - boxSize / 2);

  // Fundo arredondado do QR Code
  ctx.fillStyle = qr.bgColor || '#FFFFFF';
  ctx.beginPath();
  ctx.roundRect(0, 0, boxSize, boxSize, rad);
  ctx.fill();

  // Modulos do QR Code
  ctx.fillStyle = qr.fgColor || '#09090B';
  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (matrix.data[row * matrix.size + col]) {
        ctx.fillRect(
          pad + col * cell,
          pad + row * cell,
          Math.ceil(cell),
          Math.ceil(cell)
        );
      }
    }
  }
  ctx.restore();

  return {
    id: '__qrcode__',
    cx,
    cy,
    width: boxSize,
    height: boxSize,
    rotation: 0,
  };
}

export function renderStudioCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: StudioState
): TextLayerBounds[] {
  const isWatermarkMode =
    state.activeTab === 'youtube' && state.youtubeSubMode === 'watermark';

  if (isWatermarkMode) {
    drawWatermarkCanvas(ctx, width, height, state.gradient, state.geometric, state.watermark);
    return [];
  }

  ctx.clearRect(0, 0, width, height);
  drawGradientBackground(ctx, width, height, state.gradient);
  if (state.backgroundPhoto && state.backgroundPhoto.dataUrl) {
    drawBackgroundPhoto(ctx, width, height, state.backgroundPhoto);
  }
  drawGeometricOverlay(ctx, width, height, state.geometric);

  const isYouTubeTextMode =
    state.activeTab === 'youtube' &&
    (state.youtubeSubMode === 'thumbnail' || state.youtubeSubMode === 'banner');

  if (isYouTubeTextMode) {
    // Optional contrast scrim behind typography
    if (state.backdropScrim > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${state.backdropScrim / 100})`;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    const bounds = drawTextLayers(ctx, width, height, state.textLayers);
    const qrBounds = drawQrCode(ctx, width, height, state.qrCode);
    if (qrBounds) bounds.push(qrBounds);
    return bounds;
  }

  return [];
}
