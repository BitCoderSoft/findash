import datetime
from decimal import Decimal

from .models import Ativo, Transacao

MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']


def _custo_medio_por_ativo(usuario):
    """Posição por ativo do usuário, calculada pelo método de preço médio.

    Ao vender, o custo total é reduzido pela quantidade vendida * preço médio
    vigente (não pelo preço da própria venda) — é o método de custo médio
    ponderado usado no mercado brasileiro para apurar preço médio de ações,
    não uma soma ingênua de fluxo de caixa. Isso mantém "valor investido" e
    "preço médio" corretos mesmo depois de vendas parciais.

    Retorna dict ativo_id -> {'ativo': Ativo, 'quantidade': Decimal, 'custo_total': Decimal}.
    Quantidade pode ficar negativa se houver venda maior que a posição
    disponível (dado inconsistente, ainda sem validação no form) — quem
    consome este retorno deve filtrar por quantidade > 0 quando for tratar
    isso como posição aberta.
    """
    posicoes = {}

    transacoes = Transacao.objects.filter(usuario=usuario).select_related('ativo').order_by('data', 'criado_em', 'pk')

    for t in transacoes:
        pos = posicoes.setdefault(t.ativo_id, {
            'ativo': t.ativo, 'quantidade': Decimal('0'), 'custo_total': Decimal('0'),
        })

        if t.tipo == Transacao.Tipo.COMPRA:
            pos['quantidade'] += t.quantidade
            pos['custo_total'] += t.quantidade * t.preco_unitario + t.corretagem_taxas
        else:
            preco_medio = pos['custo_total'] / pos['quantidade'] if pos['quantidade'] > 0 else Decimal('0')
            pos['quantidade'] -= t.quantidade
            pos['custo_total'] -= t.quantidade * preco_medio

    return posicoes


def quantidade_disponivel(usuario, ativo, excluir_transacao_id=None):
    """Quantidade líquida em carteira (compras - vendas) para um ativo.

    Usado só para validar venda no `TransacaoForm` (bloquear venda a
    descoberto) — não passa pelo método de preço médio porque aqui só
    importa a quantidade, não o custo. `excluir_transacao_id` ignora a
    própria transação sendo editada, senão editar uma venda existente
    conta ela mesma contra si.
    """
    transacoes = Transacao.objects.filter(usuario=usuario, ativo=ativo)
    if excluir_transacao_id:
        transacoes = transacoes.exclude(pk=excluir_transacao_id)

    quantidade = Decimal('0')
    for t in transacoes.values('tipo', 'quantidade'):
        sinal = 1 if t['tipo'] == Transacao.Tipo.COMPRA else -1
        quantidade += sinal * t['quantidade']
    return quantidade


def posicoes_atuais(usuario):
    """Posições abertas (quantidade > 0) com preço médio, para a tela de Posições.

    Ordenada por valor investido (maior primeiro) — não por ticker — para
    destacar as posições mais relevantes da carteira primeiro.
    """
    posicoes = _custo_medio_por_ativo(usuario)
    abertas = [p for p in posicoes.values() if p['quantidade'] > 0]
    total = sum((p['custo_total'] for p in abertas), Decimal('0'))

    resultado = []
    for p in abertas:
        resultado.append({
            'ativo': p['ativo'],
            'quantidade': p['quantidade'],
            'preco_medio': p['custo_total'] / p['quantidade'],
            'valor_investido': p['custo_total'],
            'percentual': float(p['custo_total'] / total * 100) if total > 0 else 0.0,
        })

    resultado.sort(key=lambda p: p['valor_investido'], reverse=True)
    return resultado


def posicoes_por_classe(usuario):
    """Agrupa posicoes_atuais() por classe de ativo, na ordem fixa de Ativo.Classe.

    Não recalcula posição — só reagrupa o que posicoes_atuais() já apurou, que
    continua sendo a única fonte de verdade. `percentual` de cada posição
    dentro do grupo é relativo à carteira inteira (mesma base do KPI e da
    tela antiga), não ao total da classe.
    """
    posicoes = posicoes_atuais(usuario)
    if not posicoes:
        return []

    total_carteira = sum((p['valor_investido'] for p in posicoes), Decimal('0'))

    por_classe = {}
    for p in posicoes:
        classe = p['ativo'].classe
        grupo = por_classe.setdefault(classe, {'classe': classe, 'posicoes': [], 'valor_total': Decimal('0')})
        grupo['posicoes'].append(p)
        grupo['valor_total'] += p['valor_investido']

    ordem_fixa = [Ativo.Classe.ACAO, Ativo.Classe.FII, Ativo.Classe.CRIPTO, Ativo.Classe.RENDA_FIXA]
    resultado = []
    for classe in ordem_fixa:
        grupo = por_classe.get(classe)
        if grupo:
            grupo['label'] = Ativo.Classe(classe).label
            grupo['percentual'] = float(grupo['valor_total'] / total_carteira * 100) if total_carteira > 0 else 0.0
            resultado.append(grupo)
    return resultado


def aplicar_cotacoes_lista(posicoes, cotacoes):
    """Enriquece uma lista flat de posições (retorno de posicoes_atuais()) com
    cotação de mercado.

    `cotacoes` é o retorno de `market_data.buscar_cotacoes()` — este módulo
    continua sem fazer chamada de rede, só aplica o que já foi buscado (busca
    é responsabilidade da view). Cada posição ganha `cotacao`, `preco_atual`,
    `valor_atual` (preço atual × quantidade), `rentabilidade_percentual` e
    `lucro`; ficam `None` quando o ticker não tem cotação disponível
    (cripto/renda fixa hoje não têm fonte plugada, ou a brapi não respondeu)
    — nunca levanta erro por posição individual.
    """
    for p in posicoes:
        cot = cotacoes.get(p['ativo'].ticker)
        if cot and p['preco_medio'] > 0:
            p['cotacao'] = cot
            p['preco_atual'] = cot.preco_atual
            p['valor_atual'] = cot.preco_atual * p['quantidade']
            p['rentabilidade_percentual'] = float((cot.preco_atual - p['preco_medio']) / p['preco_medio'] * 100)
            p['lucro'] = p['rentabilidade_percentual'] > 0
        else:
            p['cotacao'] = None
            p['preco_atual'] = None
            p['valor_atual'] = None
            p['rentabilidade_percentual'] = None
            p['lucro'] = None
    return posicoes


def aplicar_cotacoes(grupos, cotacoes):
    """Mesma coisa que aplicar_cotacoes_lista(), mas para os grupos de
    posicoes_por_classe() (cada grupo tem uma lista `posicoes` por dentro)."""
    for grupo in grupos:
        aplicar_cotacoes_lista(grupo['posicoes'], cotacoes)
    return grupos


def calcular_kpis_mercado(posicoes):
    """Lucro/Prejuízo e rentabilidade agregados, só sobre posições avaliadas
    (com cotação — ver aplicar_cotacoes_lista, chamar depois dela).

    Não é persistido em `calcular_kpis()` de propósito: aquela função nunca
    faz I/O de rede (é chamada em vários lugares, inclusive sem cotação
    disponível); esta aqui é o complemento que só faz sentido quando o
    chamador já buscou cotação. Chaves (`lucro_prejuizo`, `rentabilidade`) de
    propósito iguais às de `calcular_kpis()` — feito pra sobrescrever via
    `kpis.update(calcular_kpis_mercado(...))`, não pra coexistir com chave
    diferente.
    """
    avaliadas = [p for p in posicoes if p['rentabilidade_percentual'] is not None]
    base = {'avaliadas': len(avaliadas), 'sem_cotacao': len(posicoes) - len(avaliadas)}

    if not avaliadas:
        return {**base, 'lucro_prejuizo': None, 'rentabilidade': None}

    valor_investido = sum((p['valor_investido'] for p in avaliadas), Decimal('0'))
    valor_atual = sum((p['valor_atual'] for p in avaliadas), Decimal('0'))
    lucro_prejuizo = valor_atual - valor_investido

    return {
        **base,
        'lucro_prejuizo': lucro_prejuizo,
        'rentabilidade': float(lucro_prejuizo / valor_investido * 100) if valor_investido > 0 else 0.0,
    }


def destaques_carteira(grupos):
    """Melhor/pior posição por rentabilidade e contagem de posições no lucro.

    Só considera posições com `rentabilidade_percentual` calculado (ver
    `aplicar_cotacoes`) — chamar depois dela, nunca antes.
    """
    todas = [p for grupo in grupos for p in grupo['posicoes']]
    avaliadas = [p for p in todas if p['rentabilidade_percentual'] is not None]
    base = {'total': len(todas), 'avaliadas': len(avaliadas), 'sem_cotacao': len(todas) - len(avaliadas)}

    if not avaliadas:
        return {**base, 'melhor': None, 'pior': None, 'no_lucro': 0, 'percentual_no_lucro': 0.0}

    no_lucro = sum(1 for p in avaliadas if p['lucro'])
    return {
        **base,
        'melhor': max(avaliadas, key=lambda p: p['rentabilidade_percentual']),
        'pior': min(avaliadas, key=lambda p: p['rentabilidade_percentual']),
        'no_lucro': no_lucro,
        'percentual_no_lucro': float(no_lucro / len(avaliadas) * 100),
    }


def calcular_kpis(usuario):
    """Agrega as transações do usuário em KPIs para o dashboard.

    Feito em Python (não via aggregation do ORM) por simplicidade: o volume de
    dados esperado é pequeno (uso pessoal) e a aritmética em Decimal puro é
    mais fácil de revisar do que Case/When no banco.
    """
    posicoes = _custo_medio_por_ativo(usuario)

    valor_investido = sum((p['custo_total'] for p in posicoes.values() if p['quantidade'] > 0), Decimal('0'))
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
    posicoes = _custo_medio_por_ativo(usuario)

    valor_por_classe = {}
    for pos in posicoes.values():
        if pos['quantidade'] > 0 and pos['custo_total'] > 0:
            classe = pos['ativo'].classe
            valor_por_classe[classe] = valor_por_classe.get(classe, Decimal('0')) + pos['custo_total']

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
    """Custo de aquisição acumulado (método de preço médio), mês a mês.

    Cada venda reduz o acumulado pelo preço médio vigente do ativo naquele
    momento (mesma lógica de `_custo_medio_por_ativo`), não pelo preço da
    própria venda — senão o gráfico diverge do KPI "Valor investido" e da
    tela de Posições sempre que houver venda parcial. Meses sem nenhum
    lançamento repetem o acumulado do mês anterior (sem buracos no gráfico).
    """
    transacoes = Transacao.objects.filter(usuario=usuario).order_by('data', 'criado_em', 'pk').values(
        'ativo_id', 'tipo', 'quantidade', 'preco_unitario', 'corretagem_taxas', 'data',
    )

    estado_por_ativo = {}
    deltas_por_mes = {}
    for t in transacoes:
        estado = estado_por_ativo.setdefault(t['ativo_id'], {'quantidade': Decimal('0'), 'custo_total': Decimal('0')})

        if t['tipo'] == Transacao.Tipo.COMPRA:
            delta = t['quantidade'] * t['preco_unitario'] + t['corretagem_taxas']
            estado['quantidade'] += t['quantidade']
            estado['custo_total'] += delta
        else:
            preco_medio = estado['custo_total'] / estado['quantidade'] if estado['quantidade'] > 0 else Decimal('0')
            delta = -(t['quantidade'] * preco_medio)
            estado['quantidade'] -= t['quantidade']
            estado['custo_total'] += delta

        chave = (t['data'].year, t['data'].month)
        deltas_por_mes[chave] = deltas_por_mes.get(chave, Decimal('0')) + delta

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
