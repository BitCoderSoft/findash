import math
from decimal import Decimal

from .models import Ativo

CORES_CLASSE = {
    Ativo.Classe.ACAO: '#2a78d6',
    Ativo.Classe.FII: '#eb6834',
    Ativo.Classe.CRIPTO: '#1baf7a',
    Ativo.Classe.RENDA_FIXA: '#eda100',
}


def _bar_path(x, y, width, height, radius):
    """Path SVG de uma barra com cantos superiores arredondados e base reta."""
    r = min(radius, height / 2, width / 2)
    if r <= 0:
        return f'M{x},{y + height} L{x},{y} L{x + width},{y} L{x + width},{y + height} Z'

    return (
        f'M{x},{y + height} '
        f'L{x},{y + r} '
        f'Q{x},{y} {x + r},{y} '
        f'L{x + width - r},{y} '
        f'Q{x + width},{y} {x + width},{y + r} '
        f'L{x + width},{y + height} Z'
    )


def montar_grafico_evolucao(evolucao):
    """Recebe o retorno de services.evolucao_mensal() e monta a geometria SVG das barras."""
    if not evolucao:
        return None

    largura = 520
    altura = 180
    padding_esquerda = 8
    padding_direita = 8
    padding_topo = 20
    padding_baixo = 24

    area_largura = largura - padding_esquerda - padding_direita
    area_altura = altura - padding_topo - padding_baixo
    baseline_y = padding_topo + area_altura

    valores = [item['valor'] for item in evolucao]
    valor_max = max(valores) if max(valores) > 0 else Decimal('1')

    n = len(evolucao)
    gap = 4
    # slot ocupa a largura inteira disponível, dividida igualmente entre os
    # meses; a barra em si é centralizada dentro do slot e nunca passa de
    # 24px (spec de marca), mesmo que isso deixe espaço sobrando no slot
    slot = area_largura / n if n else 0
    largura_barra = max(min(slot - gap, 24), 4) if n else 0

    barras = []
    for i, item in enumerate(evolucao):
        altura_barra = float(item['valor'] / valor_max) * area_altura if valor_max else 0
        altura_barra = max(altura_barra, 2)
        x = padding_esquerda + i * slot + (slot - largura_barra) / 2
        y = baseline_y - altura_barra

        barras.append({
            'path': _bar_path(round(x, 1), round(y, 1), round(largura_barra, 1), round(altura_barra, 1), 4),
            # coordenadas SVG precisam de ponto decimal — formatadas aqui em
            # Python para não passar por floats "crus" no template, que o
            # Django re-formata com vírgula (LANGUAGE_CODE=pt-br) e quebra o atributo
            'x_centro': f'{x + largura_barra / 2:.1f}',
            'label': item['label'],
            'valor': item['valor'],
            'valor_label_y': f'{y - 6:.1f}',
        })

    return {
        'width': largura,
        'height': altura,
        'baseline_y': baseline_y,
        'label_y': altura - 6,
        'axis_x2': largura - padding_direita,
        'padding_esquerda': padding_esquerda,
        'barras': barras,
    }


def montar_grafico_alocacao(alocacao):
    """Recebe o retorno de services.alocacao_por_classe() e monta a geometria SVG do donut."""
    if not alocacao:
        return None

    raio = 45
    centro = 60
    circunferencia = 2 * math.pi * raio
    gap = 2 if len(alocacao) > 1 else 0

    fatias = []
    offset_acumulado = 0.0
    for item in alocacao:
        fracao = item['percentual'] / 100
        comprimento = max(fracao * circunferencia - gap, 0)

        fatias.append({
            'classe': item['classe'],
            'label': item['label'],
            'percentual': item['percentual'],
            'valor': item['valor'],
            'cor': CORES_CLASSE[item['classe']],
            'dasharray': f'{comprimento:.2f} {circunferencia - comprimento:.2f}',
            'dashoffset': f'{-offset_acumulado:.2f}',
        })
        offset_acumulado += fracao * circunferencia

    return {
        'raio': raio,
        'centro': centro,
        'fatias': fatias,
    }
