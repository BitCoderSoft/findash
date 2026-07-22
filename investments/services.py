from decimal import Decimal

from .models import Transacao


def calcular_kpis(usuario):
    """Agrega as transações do usuário em KPIs para o dashboard.

    Feito em Python (não via aggregation do ORM) por simplicidade: o volume de
    dados esperado é pequeno (uso pessoal) e a aritmética em Decimal puro é
    mais fácil de revisar do que Case/When no banco.
    """
    posicoes = {}
    valor_investido = Decimal('0')

    transacoes = Transacao.objects.filter(usuario=usuario).values(
        'ativo_id', 'tipo', 'quantidade', 'preco_unitario', 'corretagem_taxas',
    )

    for t in transacoes:
        valor_total = t['quantidade'] * t['preco_unitario'] + t['corretagem_taxas']
        sinal = 1 if t['tipo'] == Transacao.Tipo.COMPRA else -1

        valor_investido += sinal * valor_total
        posicoes[t['ativo_id']] = posicoes.get(t['ativo_id'], Decimal('0')) + sinal * t['quantidade']

    num_posicoes = sum(1 for quantidade in posicoes.values() if quantidade > 0)

    return {
        'valor_investido': valor_investido,
        'num_posicoes': num_posicoes,
        'lucro_prejuizo': None,
        'rentabilidade': None,
    }
