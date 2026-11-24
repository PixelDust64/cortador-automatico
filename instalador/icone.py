# -*- coding: utf-8 -*-
"""
Gera todos os icones oficiais do Cortador Automatico (Split-Screen Diretor IA)
com cantos transparentes suaves (RGBA), arquivo .ico multi-resolucao para o
Windows, PNGs do app/site e banners do instalador Inno Setup.

    python instalador/icone.py      (precisa do Pillow)
"""
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
SAIDA = os.path.join(AQUI, "imagens")
LOGO_BASE = os.path.join(SAIDA, "logo-base.png")


def recortar_de_arte_bruta(caminho_jpg):
    """Detecta a borda metalica do squircle na arte original e aplica mascara RGBA suave."""
    src = Image.open(caminho_jpg).convert("RGB")
    w, h = src.size
    px = src.load()

    # Varre a faixa central (40%..60%) de cada lado ate achar a borda iluminada do icone
    faixa_x = range(int(w * 0.42), int(w * 0.58))
    faixa_y = range(int(h * 0.42), int(h * 0.58))

    def brilho(r, g, b):
        return max(r, g, b)

    limiar = 24
    topo = next((y for y in range(h // 2) if max(brilho(*px[x, y]) for x in faixa_x) >= limiar), int(h * 0.12))
    base = next((y for y in range(h - 1, h // 2, -1) if max(brilho(*px[x, y]) for x in faixa_x) >= limiar), int(h * 0.88))
    esq = next((x for x in range(w // 2) if max(brilho(*px[x, y]) for y in faixa_y) >= limiar), int(w * 0.12))
    dir_ = next((x for x in range(w - 1, w // 2, -1) if max(brilho(*px[x, y]) for y in faixa_y) >= limiar), int(w * 0.88))

    # Garante quadrado simetrico centrado
    cx = (esq + dir_) / 2.0
    cy = (topo + base) / 2.0
    meio_lado = max(dir_ - esq, base - topo) / 2.0 - 2
    x0 = max(0, int(round(cx - meio_lado)))
    y0 = max(0, int(round(cy - meio_lado)))
    x1 = min(w, int(round(cx + meio_lado)))
    y1 = min(h, int(round(cy + meio_lado)))

    recorte = src.crop((x0, y0, x1, y1)).resize((1024, 1024), Image.LANCZOS).convert("RGBA")

    # Mascara squircle supersampled (2048 -> 1024) para cantos perfeitos sem serrilhado
    ss = 2048
    masc = Image.new("L", (ss, ss), 0)
    # Raio calibrado na curvatura exata da moldura metalica (~23.5% do lado)
    ImageDraw.Draw(masc).rounded_rectangle((4, 4, ss - 5, ss - 5), radius=round(ss * 0.235), fill=255)
    masc = masc.resize((1024, 1024), Image.LANCZOS)

    limpo = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    limpo.paste(recorte, (0, 0), masc)
    return limpo


def carregar_icone_mestre(fonte_opcional=None):
    os.makedirs(SAIDA, exist_ok=True)
    if fonte_opcional and os.path.isfile(fonte_opcional):
        mestre = recortar_de_arte_bruta(fonte_opcional)
        mestre.resize((512, 512), Image.LANCZOS).save(LOGO_BASE, optimize=True)
        return mestre
    if os.path.isfile(LOGO_BASE):
        return Image.open(LOGO_BASE).convert("RGBA").resize((1024, 1024), Image.LANCZOS)
    raise FileNotFoundError("logo-base.png nao encontrado em instalador/imagens")


def fundo_lateral(largura, altura):
    """Fundo escuro elegante com brilho azul/dourado suave pro assistente do instalador."""
    img = Image.new("RGB", (largura, altura), (9, 12, 18))
    px = img.load()
    cx, cy = largura * 0.5, altura * 0.46
    raio = max(largura, altura) * 0.65
    for y in range(altura):
        ty = y / max(1, altura - 1)
        for x in range(largura):
            d = math.hypot(x - cx, y - cy) / raio
            glow = max(0.0, 1.0 - d) ** 2.1
            r = round(9 + 14 * (1 - ty) + 24 * glow)
            g = round(12 + 22 * (1 - ty) + 58 * glow)
            b = round(20 + 44 * (1 - ty) + 128 * glow)
            px[x, y] = (min(255, r), min(255, g), min(255, b))
    return img


def lateral(mestre, largura, altura):
    img = fundo_lateral(largura, altura).convert("RGBA")
    lado = round(largura * 0.66)
    ic = mestre.resize((lado, lado), Image.LANCZOS)
    caixa = ((largura - lado) // 2, round(altura * 0.33))

    sombra = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sombra).rounded_rectangle(
        (caixa[0] + 2, caixa[1] + round(lado * 0.06), caixa[0] + lado - 2, caixa[1] + round(lado * 1.04)),
        radius=round(lado * 0.24),
        fill=(0, 0, 0, 175),
    )
    img = Image.alpha_composite(img, sombra.filter(ImageFilter.GaussianBlur(max(2, round(lado * 0.07)))))
    img.alpha_composite(ic, caixa)
    return img.convert("RGB")


def main():
    fonte = sys.argv[1] if len(sys.argv) > 1 else None
    mestre = carregar_icone_mestre(fonte)

    png256 = mestre.resize((256, 256), Image.LANCZOS)
    png256.save(os.path.join(SAIDA, "icone-256.png"), optimize=True)
    png256.save(os.path.join(RAIZ, "src", "ui", "icone.png"), optimize=True)
    png256.save(os.path.join(RAIZ, "docs", "icone.png"), optimize=True)

    montagem_png = os.path.join(AQUI, "montagem", "app", "src", "ui", "icone.png")
    if os.path.isdir(os.path.dirname(montagem_png)):
        png256.save(montagem_png, optimize=True)

    tamanhos = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    png256.save(os.path.join(SAIDA, "icone.ico"), sizes=[(t, t) for t in tamanhos])

    for i, (w, h) in enumerate([(164, 314), (246, 459), (410, 797)]):
        lateral(mestre, w, h).save(os.path.join(SAIDA, "lateral-%d.bmp" % i))

    for i, t in enumerate([55, 83, 138]):
        img = Image.new("RGB", (t, t), (255, 255, 255))
        ic = mestre.resize((round(t * 0.92), round(t * 0.92)), Image.LANCZOS)
        img.paste(ic, ((t - ic.width) // 2, (t - ic.height) // 2), ic)
        img.save(os.path.join(SAIDA, "pequena-%d.bmp" % i))

    print("Icones atualizados com sucesso em:", SAIDA, "src/ui/icone.png e docs/icone.png")


if __name__ == "__main__":
    main()
