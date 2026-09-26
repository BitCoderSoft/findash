"""Cliente da API brapi.dev — cotação de ações/FIIs da B3.

Referência completa do endpoint, autenticação e limites: docs/brapi.md.
Token vem de `settings.BRAPI_TOKEN`, lido de `.env` (nunca hardcoded aqui e
nunca versionado — ver .gitignore).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation

import requests
from django.conf import settings

BRAPI_QUOTE_URL = 'https://brapi.dev/api/v2/stocks/quote'
TIMEOUT_SEGUNDOS = 10


class BrapiError(Exception):
    """Erro ao consultar a brapi: token ausente, resposta não-2xx, símbolo sem dado."""


@dataclass(frozen=True)
class CotacaoAtivo:
    """Cotação de um ativo — mapeia `results[0]['data']` da resposta da brapi.

    Preços em Decimal (não float), pela mesma disciplina do resto do projeto
    (`Transacao.preco_unitario` etc. também são Decimal) — evita erro de
    arredondamento binário quando isso entrar em cálculo de rentabilidade.
    """
    symbol: str
    nome: str
    moeda: str
    preco_atual: Decimal
    variacao: Decimal
    variacao_percentual: Decimal
    atualizado_em: datetime | None
    logo_url: str | None


def buscar_cotacao(symbol: str) -> CotacaoAtivo:
    """Busca a cotação atual de um único ticker.

    Levanta BrapiError se o token não estiver configurado, a resposta não for
    2xx, ou a brapi não retornar dado pro símbolo pedido (ticker inválido).
    """
    cotacoes = buscar_cotacoes([symbol])
    if symbol not in cotacoes:
        raise BrapiError(f'brapi não encontrou cotação para o símbolo {symbol} (ticker inválido ou deslistado?).')
    return cotacoes[symbol]


def buscar_cotacoes(symbols: list[str]) -> dict[str, CotacaoAtivo]:
    """Busca a cotação de vários tickers — uma requisição HTTP por símbolo.

    A brapi documenta `symbols` separados por vírgula no mesmo request, mas
    **o plano gratuito usado neste projeto permite só 1 ativo por
    requisição** (validado contra a API real: pedir vários de uma vez retorna
    400 "Seu plano permite no máximo 1 ativo(s) por requisição" — planos
    pagos liberam mais). Por isso isso itera e faz uma chamada por symbol, em
    vez de uma única combinada.

    Sem cache por enquanto (decisão explícita do usuário — cota de 15.000
    req/dia do plano dele é folga de sobra pro volume de uma carteira
    pessoal), mas isso significa N requisições sequenciais por carregamento
    de página — se a carteira crescer muito ou a latência incomodar, cache
    com TTL curto é o próximo passo natural (ver AGENTS.md).

    Retorna dict symbol -> CotacaoAtivo. Um símbolo que falhar (inválido,
    erro pontual de rede, resposta não-2xx) é só omitido do retorno — não
    derruba a consulta dos outros tickers.
    """
    if not symbols:
        return {}

    token = settings.BRAPI_TOKEN
    if not token:
        raise BrapiError('BRAPI_TOKEN não configurado — ver .env.example e docs/brapi.md.')

    cotacoes = {}
    for symbol in symbols:
        try:
            resposta = requests.get(
                BRAPI_QUOTE_URL,
                params={'symbols': symbol},
                headers={'Authorization': f'Bearer {token}'},
                timeout=TIMEOUT_SEGUNDOS,
            )
        except requests.RequestException:
            continue

        if not resposta.ok:
            continue

        resultados = (resposta.json().get('results')) or []
        if not resultados:
            continue

        item = resultados[0]
        data = item.get('data') or {}
        if not data:
            continue

        symbol_resp = item.get('symbol') or item.get('requestedSymbol') or symbol
        cotacoes[symbol_resp] = CotacaoAtivo(
            symbol=symbol_resp,
            nome=data.get('longName') or data.get('shortName') or symbol_resp,
            moeda=data.get('currency', 'BRL'),
            preco_atual=_para_decimal(data.get('regularMarketPrice')),
            variacao=_para_decimal(data.get('regularMarketChange')),
            variacao_percentual=_para_decimal(data.get('regularMarketChangePercent')),
            atualizado_em=_parse_datetime(data.get('regularMarketTime')),
            logo_url=data.get('logourl') or None,
        )
    return cotacoes


def _para_decimal(valor) -> Decimal:
    if valor is None:
        return Decimal('0')
    try:
        return Decimal(str(valor))
    except InvalidOperation:
        return Decimal('0')


def _parse_datetime(valor: str | None) -> datetime | None:
    if not valor:
        return None
    try:
        return datetime.fromisoformat(valor.replace('Z', '+00:00'))
    except ValueError:
        return None
