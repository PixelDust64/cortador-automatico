# -*- coding: utf-8 -*-
"""
Desenha o icone do Cortador Automatico (degrade azul da tela, com
a tesoura branca) e as imagens do instalador. Roda uma vez; os arquivos
gerados ficam em instalador/imagens e o montar.js so usa.

    python instalador/icone.py      (precisa do Pillow)
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.join(AQUI, "imagens")
AZUL_FUNDO = (35, 98, 214)       # azul mais fundo (em cima, a esquerda)
AZUL_CLARO = (110, 172, 255)  # azul claro, --marca2 da tela
TESOURA = "\u2702"
FONTE = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", "seguisym.ttf")


def degrade(largura, altura):
    """Degrade na diagonal, do azul fundo (em cima, a esquerda) pro azul claro."""
    img = Image.new("RGB", (largura, altura))
    px = img.load()
    total = largura + altura - 2 or 1
    for y in range(altura):
        for x in range(largura):
            t = (x + y) / total
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(AZUL_FUNDO, AZUL_CLARO))
    return img


def tesoura(lado, cor=(255, 255, 255, 255)):
    """A tesoura branca num quadrado transparente, com uma sombra leve."""
    camada = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    fonte = ImageFont.truetype(FONTE, round(lado * 0.78))
    d = ImageDraw.Draw(camada)
    caixa = d.textbbox((0, 0), TESOURA, font=fonte)
    x = (lado - (caixa[2] - caixa[0])) / 2 - caixa[0]
    y = (lado - (caixa[3] - caixa[1])) / 2 - caixa[1]

    sombra = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    ImageDraw.Draw(sombra).text((x, y + lado * 0.025), TESOURA, font=fonte, fill=(8, 24, 64, 120))
    sombra = sombra.filter(ImageFilter.GaussianBlur(lado * 0.02))
    ImageDraw.Draw(camada).text((x, y), TESOURA, font=fonte, fill=cor)
    return Image.alpha_composite(sombra, camada).rotate(-20, resample=Image.BICUBIC)


def icone(lado=1024):
    fundo = degrade(lado, lado).convert("RGBA")
    mascara = Image.new("L", (lado, lado), 0)
    ImageDraw.Draw(mascara).rounded_rectangle((0, 0, lado - 1, lado - 1), radius=round(lado * 0.23), fill=255)
    img = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    img.paste(fundo, (0, 0), mascara)
    miolo = round(lado * 0.8)
    t = tesoura(miolo)
    img.alpha_composite(t, ((lado - miolo) // 2, (lado - miolo) // 2))
    return img


def lateral(largura, altura):
    """Imagem da esquerda nas telas de boas-vindas e de fim do instalador."""
    img = degrade(largura, altura).convert("RGBA")
    lado = round(largura * 0.62)
    ic = icone(lado * 2).resize((lado, lado), Image.LANCZOS)
    sombra = Image.new("RGBA", img.size, (0, 0, 0, 0))
    caixa = ((largura - lado) // 2, round(altura * 0.34))
    ImageDraw.Draw(sombra).rounded_rectangle(
        (caixa[0], caixa[1] + lado * 0.05, caixa[0] + lado, caixa[1] + lado * 1.05),
        radius=round(lado * 0.23), fill=(6, 18, 52, 100))
    img = Image.alpha_composite(img, sombra.filter(ImageFilter.GaussianBlur(lado * 0.06)))
    # contorno branco pro icone nao sumir no fundo da mesma cor
    borda = Image.new("RGBA", (lado + 8, lado + 8), (0, 0, 0, 0))
    ImageDraw.Draw(borda).rounded_rectangle((0, 0, lado + 7, lado + 7), radius=round(lado * 0.25), fill=(255, 255, 255, 200))
    img.alpha_composite(borda, (caixa[0] - 4, caixa[1] - 4))
    img.alpha_composite(ic, caixa)
    return img.convert("RGB")


def main():
    os.makedirs(SAIDA, exist_ok=True)
    grande = icone()
    grande.resize((256, 256), Image.LANCZOS).save(os.path.join(SAIDA, "icone-256.png"))
    tamanhos = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    base = grande.resize((256, 256), Image.LANCZOS)
    base.save(os.path.join(SAIDA, "icone.ico"), sizes=[(t, t) for t in tamanhos])

    # Inno Setup escolhe a que melhor cabe na escala da tela (100%, 150%, 250%)
    for i, (w, h) in enumerate([(164, 314), (246, 459), (410, 797)]):
        lateral(w, h).save(os.path.join(SAIDA, "lateral-%d.bmp" % i))
    for i, t in enumerate([55, 83, 138]):
        img = Image.new("RGB", (t, t), (255, 255, 255))
        ic = grande.resize((round(t * 0.9), round(t * 0.9)), Image.LANCZOS)
        img.paste(ic, ((t - ic.width) // 2, (t - ic.height) // 2), ic)
        img.save(os.path.join(SAIDA, "pequena-%d.bmp" % i))
    print("imagens em", SAIDA)


if __name__ == "__main__":
    main()
