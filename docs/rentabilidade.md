# Rentabilidade — Documentação técnica (HIST v2)

## Problema original

O cálculo de rentabilidade mensal (Modified Dietz) exige o **valor de mercado** da carteira no início e no fim de cada mês fechado. Sem preços históricos reais, o sistema caia em fallback para o custo contábil (PM × quantidade), que é constante — resultando em 0% para todos os meses fechados.

A raiz do problema: `buscarPrecosMensaisB3` usava `range=2y&interval=1mo` no plano free da brapi.dev, que **não suporta** esses parâmetros (retorna `INVALID_RANGE` e `INVALID_INTERVAL`).

---

## Solução: chunks de 90 dias (`[HIST v1]`)

### Restrições do plano free brapi.dev

| Parâmetro | Plano free | Plano pago |
|---|---|---|
| `interval` | apenas `1d` | `1d`, `1wk`, `1mo` |
| `range` | apenas `1d`, `5d`, `1mo`, `3mo` | todos |
| Janela por chamada (startDate/endDate) | ≤ 90 dias | maior |
| Requisições simultâneas | 1 | múltiplas |

O endpoint `/api/v2/stocks/historical` aceita `startDate` e `endDate` no plano free — isso nos dá controle da janela, desde que cada chunk ≤ 90 dias.

### Estratégia geral

1. **Primeira execução**: gera chunks de 90 dias desde o primeiro lançamento do ticker até hoje. Executa um request por chunk (em série, via `brapiFetch()`) e agrega fechamentos mensais.
2. **Execuções seguintes**: se o histórico já cobre desde `dataInicio` E o mês atual está presente → retorna cache imediatamente, sem request.
3. **Atualização do mês corrente**: se o histórico cobre o histórico mas falta o mês atual → apenas os últimos 90 dias são buscados.
4. **Imutabilidade de meses fechados**: uma vez gravado, o close de um mês passado nunca é sobrescrito. Só o mês corrente (parcial) pode atualizar.

### Agregação diária → mensal

A brapi retorna candles diários em **ordem decrescente** (mais novo primeiro). Para pegar o fechamento do último dia útil de cada mês, basta tomar o **primeiro candle de cada mês** nessa lista (que já é o mais recente):

```js
// _agregarMensalDescendente: lê lista em ordem descendente,
// guarda apenas o primeiro (= mais recente) por mês.
function _agregarMensalDescendente(lista, mapa, mesAtual) {
    var vistos = {};
    lista.forEach(function (p) {
        var am = normalizarDataBrapi(p.date); // timestamp em segundos → "YYYY-MM"
        if (!am || !p.close || vistos[am]) return;
        vistos[am] = true;
        if (am === mesAtual || !mapa[am]) mapa[am] = p.close;
    });
}
```

### Armazenamento

| Chave localStorage | Conteúdo | Formato |
|---|---|---|
| `DASH_FINANCE_STOCK_HIST_V1` | Fechamentos mensais de ações/FIIs/BDRs | `{ "ITSA4": { "2025-04": 10.50, "2025-05": 11.20 }, ... }` |
| `DASH_FINANCE_IBOV_HIST_V1` | Fechamentos mensais do IBOV (`^BVSP`) | `{ "2025-04": 126500, "2025-05": 128000, ... }` |

Helpers: `loadStockHist()` / `saveStockHist(mapa)` e `loadIBOVHist()` / `saveIBOVHist(mapa)`.

---

## Funções principais

### `gerarChunks(dataInicio, dataFim)`

Divide `[dataInicio, dataFim]` em janelas de exatamente 90 dias.
Retorna `[{ s: "YYYY-MM-DD", e: "YYYY-MM-DD" }, ...]`.

### `_fetchChunksB3(sym, chunks, mapa, mesAtual)`

Executa os chunks em série (Promise chain) usando `brapiFetch()` (que já serializa globalmente).
Reusada tanto para tickers de bolsa quanto para o IBOV (`sym = '%5EBVSP'`).

### `buscarPrecosMensaisB3(ticker, dataInicio)`

- Carrega histórico do storage.
- Verifica cobertura; retorna cache se completo.
- Gera chunks e chama `_fetchChunksB3`.
- Salva resultado em `STOCK_HIST_KEY`.

### `buscarPrecosMensaisIBOV(dataInicio)`

Mesma arquitetura que B3. `dataInicio` deve ser a data do primeiro lançamento de **qualquer** ativo de bolsa do usuário (passada por `renderDashboard` e `fecharMesAnteriorSeNecessario`).

### `buscarPrecosMensaisCripto(ticker, dataInicio)`

Usa Binance klines (`interval=1M`) sem restrição de janela. O `limit` é calculado dinamicamente:

```
limit = min(1000, ceil((hoje - dataInicio) / 30 dias) + 6)
```

### `buscarPrecosMensais(ticker, classe, dataInicio)`

Roteador: direciona para B3, Cripto ou Renda Fixa conforme a `classe`, repassando `dataInicio`.

---

## Migração de versão

| Versão | Mudança |
|---|---|
| 4 | Modified Dietz + preços a mercado (base) |
| 5 | Histórico via chunks de 90 dias (HIST v1) — recalcula com preços reais |
| 6 | Primeiro mês com rentabilidade real via Modified Dietz (PI=0); gráfico acumulado no estilo Investidor10; barras evolutivas a valor de mercado |
| 7 | CDI do `primeiroMes` pro-rateado desde a data real do 1º lançamento (não o mês inteiro) |
| **8** | Corrige dupla-contagem de `RENDIMENTO_RF`: removido de `proventosNoMes` (já estava em `patrimonioNaData`). Inflava ~0,8 p.p./mês proporcional ao saldo de RF |

A flag `db.historicoRentabilidadeVersao` controla a migração em `fecharMesAnteriorSeNecessario`. Ao detectar versão `< 8`, apaga o histórico e recalcula tudo no boot.

---

## Backup (v2)

O backup v2 inclui os campos `stockHist` e `ibovHist`:

```json
{
  "formato": "dash-finance-backup",
  "versao": 2,
  "stockHist": { "ITSA4": { "2025-04": 10.50 } },
  "ibovHist":  { "2025-04": 126500 }
}
```

Na importação, `stockHist` e `ibovHist` são restaurados diretamente no storage antes de gravar o DB. Isso evita que o usuário precise esperar re-fetch de meses já conhecidos após importar o backup.

O `historicoRentabilidade` importado é aceito mas a flag de versão é resetada para 5, forçando recálculo completo no próximo boot (garante consistência com os preços importados).

---

## Fórmula Modified Dietz

```
Numerador   = PatrimonioFim − PatrimonioInicio − AportesLiquidos + Proventos
Denominador = PatrimonioInicio + AportesLiquidos × 0.5
Rentabilidade = Numerador / Denominador × 100
```

- **PatrimonioInicio/Fim**: `patrimonioNaData()` — reconstrói posições até o último dia do mês e aplica os fechamentos mensais dos tickers.
- **AportesLiquidos**: COMPRA/APORTE menos VENDA/SAIDA (ENTRADA, STAKE, CONVERSÃO, PROVENTO e RENDIMENTO_RF não são fluxos de capital).
- **Proventos**: soma de PROVENTO + RENDIMENTO_RF do mês.
- **Fallback de preço**: se não houver histórico para um ticker em um mês específico, usa o PM (custo/qtd) da posição naquela data.

### Primeiro mês da carteira (PI = 0)

Quando `patrimonioInicio = 0` (nenhuma posição no início do mês), a fórmula simplifica para:

```
Denominador = Aportes × 0.5   (capital médio exposto ≈ metade do mês)
Numerador   = PatrimonioFim − Aportes + Proventos
```

O retorno pode ser negativo se o ativo caiu entre a compra e o fechamento do mês.

---

## Gráfico de linhas acumulado (estilo Investidor10)

- **Origem** = primeiro mês da carteira, plotado a 0%.
- O retorno do primeiro mês **entra no acumulado** mas não gera um ponto visual separado: o segundo mês já exibe o acumulado composto (r₁ × r₂ - 1).
- IBOV e CDI também acumulam desde o primeiro mês (retorno do primeiro mês incluído, mas não exibido como ponto isolado).

---

## Gráfico de barras evolutivo (valor de mercado)

`dadosChartJsEvolucao` aceita `saldoPorMes` (mapa YYYY-MM → valor de mercado).

Dois datasets independentes (sem stacking):

| Dataset | Conteúdo | Visual |
|---|---|---|
| Dataset 1 "Custo aportado" | sempre = `e.valor` (custo real acumulado) | barra escura, altura imutável |
| Dataset 2 "Resultado" | barra flutuante `[min(custo,saldo), max(custo,saldo)]` | verde se saldo ≥ custo, vermelho se saldo < custo |

Meses com **ganho**: barra verde aparece acima da barra de custo (de `custo` até `saldo`).
Meses com **perda**: barra vermelha fica dentro da barra de custo (de `saldo` até `custo`), cobrindo parcialmente.
Meses sem saldo de mercado: Dataset 2 recebe `null` (não renderiza).

O campo `signed` (propriedade extra no Dataset 2) guarda `saldo - custo` assinado por índice, usado pelo callback do tooltip para mostrar "Ganho: R$+44,60" ou "Perda: R$−23,20" em vez do intervalo bruto `[min, max]`.

O seletor `noStack: true` na resposta de `dadosChartJsEvolucao` desativa `stacked` nas escalas X e Y, garantindo que os dois datasets se sobreponham em vez de empilhar.

`saldoPorMes` é construído em `renderDashboard` via `patrimonioNaData(user.id, anoMes, loadStockHist())` para cada mês passado, e `kpis.saldoAtual` para o mês corrente. **Não** usa `historicoRentabilidade[].patrimonioFim` — esse campo é um snapshot congelado no momento do fechamento e fica desatualizado se o usuário adicionar transações retroativas (ex.: aporte de Renda Fixa em mês já fechado). O cálculo dinâmico inclui sempre o estado atual das transações e os preços mensais do `stockHist`.

### Tooltip unificado

`inicializarCharts` usa `interaction: { mode: 'index', intersect: false }` para TODOS os tipos de gráfico (linha e barra). O tooltip aparece unificado para a posição X inteira, independente de onde o cursor está na barra.

Callback `tooltip.callbacks.label`:
- Datasets com `signed` metadata → mostra ganho/perda assinado (formato BR, 2 casas decimais)
- Outros datasets → label + `fmt(parsed.y)` padrão
- `filter` remove entradas `null` do tooltip (meses sem dado de mercado não aparecem)
