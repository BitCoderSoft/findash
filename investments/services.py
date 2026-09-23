import datetime
from decimal import Decimal

from .models import Ativo, Transacao

MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']


def _posicoes_liquidas(usuario):
    """Posição líquida (compras - vendas) por ativo do usuário.

    Retorna dict ativo_id -> {'classe': str, 'quantidade': Decimal, 'valor': Decimal}.
    """
    posicoes = {}

    transacoes = Transacao.objects.filter(usuario=usuario).values(
        'ativo_id', 'ativo__classe', 'tipo', 'quantidade', 'preco_unitario', 'corretagem_taxas',
    )

    for t in transacoes:
        sinal = 1 if t['tipo'] == Transacao.Tipo.COMPRA else -1
        valor_total = t['quantidade'] * t['preco_unitario'] + t['corretagem_taxas']

        pos = posicoes.setdefault(t['ativo_id'], {
            'classe': t['ativo__classe'], 'quantidade': Decimal('0'), 'valor': Decimal('0'),
        })
        pos['quantidade'] += sinal * t['quantidade']
        pos['valor'] += sinal * valor_total

    return posicoes


def calcular_kpis(usuario):
    """Agrega as transações do usuário em KPIs para o dashboard.

    Feito em Python (não via aggregation do ORM) por simplicidade: o volume de
    dados esperado é pequeno (uso pessoal) e a aritmética em Decimal puro é
    mais fácil de revisar do que Case/When no banco.
    """
    posicoes = _posicoes_liquidas(usuario)

    valor_investido = sum((p['valor'] for p in posicoes.values()), Decimal('0'))
    num_posicoes = sum(1 for p in posicoes.values() if p['quantidade'] > 0)

    return {
        'valor_investido': valor_investido,
        'num_posicoes': num_posicoes,
        'lucro_prejuizo': None,
        'rentabilidade': None,
    }


def alocacao_por_classe(usuario):
    """Alocação atual (valor investido líquido) por classe de ativo.

    Só considera posições com quantidade líquida positiva (uma posição
    zerada/vendida não entra na alocação). Retorna na ordem fixa das classes
    (não por tamanho), para a cor de cada classe não mudar conforme a
    carteira muda.
    """
    posicoes = _posicoes_liquidas(usuario)

    valor_por_classe = {}
    for pos in posicoes.values():
        if pos['quantidade'] > 0 and pos['valor'] > 0:
            valor_por_classe[pos['classe']] = valor_por_classe.get(pos['classe'], Decimal('0')) + pos['valor']

    total = sum(valor_por_classe.values(), Decimal('0'))
    if total <= 0:
        return []

    ordem_fixa = [Ativo.Classe.ACAO, Ativo.Classe.FII, Ativo.Classe.CRIPTO, Ativo.Classe.RENDA_FIXA]

    resultado = []
    for classe in ordem_fixa:
        valor = valor_por_classe.get(classe)
        if valor:
            resultado.append({
                'classe': classe,
                'label': Ativo.Classe(classe).label,
                'valor': valor,
                'percentual': float(valor / total * 100),
            })
    return resultado


def evolucao_mensal(usuario):
    """Valor investido líquido acumulado, mês a mês, desde o primeiro lançamento.

    Meses sem nenhum lançamento repetem o acumulado do mês anterior (sem
    buracos no gráfico).
    """
    transacoes = Transacao.objects.filter(usuario=usuario).values(
        'tipo', 'quantidade', 'preco_unitario', 'corretagem_taxas', 'data',
    )

    deltas_por_mes = {}
    for t in transacoes:
        sinal = 1 if t['tipo'] == Transacao.Tipo.COMPRA else -1
        valor_total = t['quantidade'] * t['preco_unitario'] + t['corretagem_taxas']
        chave = (t['data'].year, t['data'].month)
        deltas_por_mes[chave] = deltas_por_mes.get(chave, Decimal('0')) + sinal * valor_total

    if not deltas_por_mes:
        return []

    ano, mes = min(deltas_por_mes)
    hoje = datetime.date.today()
    # cobre até o mês atual, ou até o mês do lançamento mais recente,
    # o que for mais tarde (um lançamento com data futura não some do gráfico)
    ultimo = max((hoje.year, hoje.month), max(deltas_por_mes))

    resultado = []
    acumulado = Decimal('0')
    while (ano, mes) <= ultimo:
        acumulado += deltas_por_mes.get((ano, mes), Decimal('0'))
        resultado.append({
            'label': f'{MESES_PT[mes - 1]}/{str(ano)[2:]}',
            'valor': acumulado,
        })
        mes += 1
        if mes > 12:
            mes = 1
            ano += 1

    return resultado
