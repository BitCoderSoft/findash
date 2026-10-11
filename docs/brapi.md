# brapi.dev — referência da API de cotações

Referência técnica da API usada para cotação de mercado (ações/FIIs da B3).
Cliente Python: `investments/market_data.py` (`buscar_cotacao`/`buscar_cotacoes`).
Ver AGENTS.md para como isso se encaixa no roadmap do projeto.

## Autenticação

- Header `Authorization: Bearer <token>`.
- Token pessoal, obtido em https://brapi.dev/dashboard.
- **Nunca hardcoded no código nem versionado.** Vem de `BRAPI_TOKEN` em `.env`
  (raiz do projeto, ignorado pelo git), carregado em `settings.py` via
  `python-dotenv` e exposto como `settings.BRAPI_TOKEN`. Copiar `.env.example`
  pra `.env` e preencher o token real.

## Endpoint de cotação

```
GET https://brapi.dev/api/v2/stocks/quote?symbols=<TICKER1>,<TICKER2>,...
```

- `symbols` (obrigatório): um ou mais tickers separados por vírgula, **sem
  espaço** (`PETR4,VALE3`, não `PETR4, VALE3`) — isso é o que a documentação
  pública descreve. **Na prática, o plano do token deste projeto (free)
  permite só 1 ativo por requisição**: pedir vários de uma vez retorna
  **400** `"Seu plano permite no máximo 1 ativo(s) por requisição. Você
  enviou N. O plano Startup (R$ 119,99/mês) permite até 10 ativos por
  requisição."` — validado contra a API real, não é suposição. Por isso o
  cliente (`market_data.buscar_cotacoes`) faz **uma requisição HTTP por
  símbolo**, não uma combinada. Se o plano mudar pra Startup+ um dia, dá pra
  voltar a combinar em uma chamada só — mas aí também revalidar contra a API.
- Só `symbols` está documentado publicamente (sem `range`/`interval`/
  `fundamental` confirmados na doc introdutória no momento em que isso foi
  escrito — revalidar em https://brapi.dev/docs/acoes/cotacao se for buscar
  histórico ou fundamentos além do preço atual).

### Exemplo de resposta (200)

```json
{
  "results": [
    {
      "requestedSymbol": "B3SA3",
      "symbol": "B3SA3",
      "changed": false,
      "data": {
        "shortName": "B3SA3",
        "longName": "B3 SA - Brasil, Bolsa, Balcao",
        "currency": "BRL",
        "regularMarketPrice": 17.96,
        "regularMarketChange": 0.14,
        "regularMarketChangePercent": 0.79,
        "regularMarketTime": "2026-09-26T02:06:26.000Z",
        "regularMarketPreviousClose": 17.98,
        "regularMarketOpen": 17.76,
        "regularMarketDayHigh": 18.03,
        "regularMarketDayLow": 17.62,
        "fiftyTwoWeekLow": 12.16,
        "fiftyTwoWeekHigh": 20.33,
        "marketCap": 86578346701,
        "regularMarketVolume": 17058300,
        "logourl": "https://icons.brapi.dev/icons/B3SA3.svg"
      }
    }
  ],
  "requestedAt": "2026-09-26T13:27:56.861Z",
  "took": 0
}
```

Campos usados hoje pelo cliente (`CotacaoAtivo`): `regularMarketPrice`,
`regularMarketChange`, `regularMarketChangePercent`, `regularMarketTime`,
`currency`, `longName`/`shortName`, `logourl` (badge do ativo na tela de
Posições). O resto do payload (market cap, volume, range de 52 semanas) não é
consumido ainda, mas está disponível se for útil depois.

### Símbolo inválido/sem dado

Quando nenhum símbolo pedido é reconhecido, a API responde **404** com corpo:

```json
{ "message": "Nenhum resultado encontrado para os símbolos informados" }
```

`market_data.py` propaga essa mensagem dentro de `BrapiError`. Quando a lista
tem uma mistura de símbolos válidos e inválidos, o comportamento (se os
válidos ainda vêm no array `results` ou se a request inteira falha) **não foi
testado neste projeto** — validar antes de confiar nisso em produção.

### Outros códigos de erro documentados

| Código | Situação |
|---|---|
| 400 | Requisição malformada |
| 401 | Token ausente ou inválido |
| 403 | Plano atual não inclui esse dado |
| 404 | Nenhum símbolo pedido foi encontrado |
| 429 | Cota do plano esgotada ou limite de requisições simultâneas |
| 500 | Erro interno da brapi |

Limites exatos de cota/requisições por plano: ver https://brapi.dev/pricing
(não copiado aqui pra não ficar desatualizado — o token deste projeto é de um
plano específico, conferir lá qual).

## Cliente no projeto (`investments/market_data.py`)

- `buscar_cotacao(symbol: str) -> CotacaoAtivo` — um símbolo, levanta
  `BrapiError` se não encontrar.
- `buscar_cotacoes(symbols: list[str]) -> dict[str, CotacaoAtivo]` — vários
  símbolos, uma requisição HTTP por símbolo internamente (ver limite do
  plano acima). Símbolo que falhar (inválido, erro pontual) é só omitido do
  dict — não derruba os outros. É esta que a tela de Posições usa, pra não
  travar a página inteira se um ticker (ex.: cripto/renda fixa, que essa API
  nem cobre) não vier.
- `CotacaoAtivo` guarda preço/variação em `Decimal` (não `float`) e o
  `logo_url` do ícone do ativo — pela mesma disciplina do resto do projeto
  (`Transacao.preco_unitario` etc.) e pra exibir o badge visual na tela de
  Posições. Nem todo ticker tem ícone hospedado de verdade mesmo quando a
  API manda uma `logourl` (ex.: alguns FIIs) — a imagem falha no browser
  (404) e cai pro fallback visual (iniciais do ticker), tratado no template
  via `onerror`, não em Python.
- Erros de nível "requisição inteira" (token ausente, falha de rede) levantam
  `BrapiError` — a view (`views.posicoes`) trata isso com uma mensagem de
  aviso (`messages.warning`) e segue renderizando a página com os
  placeholders de sempre, não quebra.
- Validado manualmente contra a API real: símbolo único, lote de vários
  símbolos (ações e FIIs), ticker inválido, token ausente, e o limite de 1
  ativo/requisição do plano atual — sem teste automatizado ainda (projeto não
  tem suite de testes, débito já conhecido).
