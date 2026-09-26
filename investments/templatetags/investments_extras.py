from django import template
from django.template.defaultfilters import floatformat

from investments.models import Ativo

register = template.Library()

# B3 não permite comprar ação/cota fracionada (mercado fracionário à parte,
# fora do escopo aqui) — quantidade dessas classes é sempre inteira.
CLASSES_INTEIRAS = {Ativo.Classe.ACAO, Ativo.Classe.FII}


@register.filter
def quantidade_fmt(quantidade, classe):
    """Formata quantidade conforme a classe do ativo.

    Ação/FII: inteiro, sem casas decimais. Cripto/Renda fixa: até 8 casas,
    sem zero à direita — `floatformat` com argumento negativo NÃO faz isso
    (só remove decimais quando a parte fracionária inteira é zero, ex.:
    34.000000 -> "34", mas 34.232000 continua "34,23200000"), por isso o
    strip manual abaixo.
    """
    if classe in CLASSES_INTEIRAS:
        return floatformat(quantidade, 0)

    texto = format(quantidade, 'f')
    if '.' in texto:
        texto = texto.rstrip('0').rstrip('.')
    return texto.replace('.', ',')
