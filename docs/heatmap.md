# Heatmap de Rentabilidade — Documentação técnica

> Leia em conjunto com [rentabilidade.md](rentabilidade.md), que detalha a fórmula
> Modified Dietz, os preços históricos e o gráfico de linhas acumuladas.

---

## O que é o heatmap

O heatmap é o componente "Mês a mês" exibido na seção **Rentabilidade vs CDI** do
Dashboard. Cada célula representa um mês da carteira e mostra:

- **Label**: abreviação do mês + ano (ex.: `Out/26`).
- **Percentual**: retorno calculado pelo Modified Dietz, com sinal (`+1,23%` /
  `-0,45%`).
- **Referência CDI**: retorno do CDI do mesmo mês para comparação.
- **Cor de fundo**: verde se acima do CDI, vermelho se abaixo, azul tracejado se
  parcial (mês em andamento).

---

## Fonte de dados: `historicoRentabilidade`

O heatmap lê `db.historicoRentabilidade` — array de objetos persistido em
`DASH_FINANCE_DB_V1` no `localStorage`. Cada entrada representa um **mês fechado**:

```js
{
  mes:              "YYYY-MM",
  usuarioId:        Number,
  rentabilidade:    Number,      // % calculado pelo Modified Dietz
  cdi:              Number,      // % CDI do mês (BCB SGS 12)
  primeiroMes:      Boolean,     // true → PI=0, denominador = aportes × 0,5
  patrimonioInicio: Number,
  patrimonioFim:    Number,
  aportesLiquidos:  Number,
  proventos:        Number,
}
```

Além dos meses fechados, o mês corrente (MTD) é injetado como entrada temporária
com `parcial: true` — **nunca** gravado no DB, existe apenas em memória de sessão.

---

## Quando um mês é consolidado (fechado)

**O fechamento não acontece ao final do último dia do mês.** Ele ocorre na
**próxima abertura do app após a virada do mês** — ou seja, no primeiro boot do
mês seguinte (ou em qualquer boot do novo mês, se o anterior não tiver sido aberto).

### Ponto de entrada: `renderCurrentRoute` (linha ~7119)

Toda navegação passa por `renderCurrentRoute`. Se há usuário logado, ela dispara
imediatamente — antes de renderizar qualquer página:

```js
popularCotacoesFechamentoRetroativo(user.id);          // síncrono
fecharMesAnteriorSeNecessario(user.id)
    .then(function (novos) {
        if (novos > 0) atualizarHeatmapDOM(user.id);  // atualiza só o bloco
        completarCotacoesFechamentoCripto(user.id).catch(…);
        completarUsdBrlFechamento(user.id).catch(…);
    });
```

O fechamento roda em **background** — não bloqueia a renderização da página.
Quando termina e encontrou meses novos (`novos > 0`), `atualizarHeatmapDOM`
substitui apenas o elemento `#rentab-bloco` no DOM, sem re-renderizar a tela inteira.

### Lógica interna: `fecharMesAnteriorSeNecessario` (linha ~5623)

```js
var mesFim = hoje.getMonth(); // 0-based em JS → representa o mês ANTERIOR ao atual
```

`getMonth()` retorna o mês atual como índice 0-based (janeiro = 0). Ao usar
`hoje.getMonth()` como `mesFim`, o loop nunca inclui o mês corrente — percorre
apenas os meses já encerrados.

**Exemplo**: se hoje é 18/10/2026, `mesFim = 9` (setembro), portanto todos os meses
de `primeiroMes` até setembro/2026 são elegíveis. Outubro/2026 não entra.

**Fluxo completo:**

1. **Migração de versão**: se `db.historicoRentabilidadeVersao < 8`, apaga
   `historicoRentabilidade` e recalcula tudo. Versão atual: **8**.
2. **Coleta meses pendentes**: itera do primeiro mês com transação até `mesFim`,
   filtrando os que ainda não têm entrada em `historicoRentabilidade`.
3. **Busca de preços históricos** (async, em paralelo):
   - B3 via `buscarPrecosMensaisB3` → chunks ≤ 90 dias (plano free brapi).
   - Cripto via `buscarPrecosMensaisCripto` → Binance klines `1M`.
   - IBOV via `buscarPrecosMensaisIBOV`.
   - USD-BRL via `buscarUsdBrlMensal` (BCB SGS 1).
4. **Fecha cada mês pendente em série** (síncrono após os fetches):
   - Chama `rentabilidadeCarteiraMes(usuarioId, am, precosMensaisPorTicker)`.
   - Busca CDI do mês fechado via `buscarCDIMesFechado` (BCB SGS 12). Se a API
     falhar, usa último `cdiDiario` em cache capitalizado por ~22 du.
   - Salva o registro em `db.historicoRentabilidade` e persiste no `armazem`.
   - Salva snapshot `cotacoesFechamento[am]` com os preços usados (ver
     `DASH_FINANCE_FECHAMENTOS_V1`).
5. **Preenche snapshots retroativos**: para meses já fechados sem snapshot de
   cotação, usa os preços já buscados nesta mesma execução — sem re-fetch.

---

## Mês corrente: MTD (Month-to-Date)

O mês em andamento nunca passa por `fecharMesAnteriorSeNecessario`. Seu retorno
parcial é calculado por `obterMTD` (linha ~5553) e injetado no heatmap como
célula temporária.

### `obterMTD(usuarioId, cotacoes, cdiHoje)` — linha 5553

| Campo | Fonte |
|---|---|
| `patrimonioInicio` | `patrimonioNaData(usuarioId, anoMesAnterior, loadStockHist())` — dinâmico, não usa snapshot histórico |
| `patrimonioFim` | `patrimonioMercadoAtual(usuarioId, cotacoes)` — cotações ao vivo |
| `aportesLiquidos` | `aportesLiquidosNoMes(usuarioId, anoMes)` |
| `proventos` | `proventosNoMes(usuarioId, anoMes)` |
| `cdi` | CDI parcial: `cdiDiario` capitalizado pelos dias úteis aproximados (`dia × 22/30`) |

`patrimonioInicio` usa cálculo dinâmico — não o `patrimonioFim` do snapshot
histórico — porque transações retroativas adicionadas depois de um fechamento
não atualizam o snapshot. O cálculo dinâmico sempre reflete o estado atual das
transações.

Retorna `null` se não há mês anterior fechado (carteira ainda em formação — o
usuário ainda está no primeiro mês).

**Cache de sessão**: `_mtdCache` — calculado uma única vez por abertura do app.
É invalidado se `mes` mudar (virada do mês detectada na próxima abertura).

---

## Renderização: `heatmapCelulasHTML` (linha 5921)

```
historicoRentabilidade (DB) → ordenado por mes ASC → + MTD (se parcial) → células HTML
```

Regras de cor por célula:

| Condição | Classe CSS | Visual |
|---|---|---|
| `rentab >= cdi` | `acima` | fundo verde claro |
| `rentab < cdi` | `abaixo` | fundo vermelho claro |
| CDI indisponível | `neutro` | fundo neutro |
| `primeiroMes: true` | `neutro` | texto "formação / sem base" |
| `parcial: true` | `+ parcial` (sufixo) | fundo azul claro, borda tracejada, fontes azuis `#2563eb` |

Células com `parcial` exibem `*` após o label do mês e `CDI ~X% · parcial`
como referência.

---

## Atualização do DOM: `atualizarHeatmapDOM` (linha 5913)

Quando `fecharMesAnteriorSeNecessario` retorna `novos > 0` (há meses recém-fechados),
`atualizarHeatmapDOM` substitui **apenas** o bloco `#rentab-bloco` no DOM:

```js
function atualizarHeatmapDOM(usuarioId) {
    var container = document.getElementById('rentab-bloco');
    if (!container) return;
    container.outerHTML = secaoRentabilidadeHTML(usuarioId, null, _ibovMapaCache);
    inicializarCharts(); // re-registra o Chart.js no canvas novo
}
```

Isso evita re-renderizar toda a página (KPIs, gráfico de barras, rankings) quando
apenas o histórico de rentabilidade mudou.

---

## Sequência completa de boot (após login)

```
renderCurrentRoute()
│
├── popularCotacoesFechamentoRetroativo(userId)   ← síncrono
│   └── preenche cotacoesFechamento de meses já fechados
│       usando stockHist + ibovHist + usdBrlHist já em cache
│
└── fecharMesAnteriorSeNecessario(userId)          ← async
    ├── migração de versão (se necessário)
    ├── detecta meses pendentes
    ├── busca preços históricos via brapi/Binance/BCB em paralelo
    ├── fecha cada mês pendente em série
    │   ├── rentabilidadeCarteiraMes()  → Modified Dietz
    │   ├── buscarCDIMesFechado()       → BCB SGS 12
    │   └── salva em historicoRentabilidade + cotacoesFechamento
    │
    └── .then(novos)
        ├── se novos > 0: atualizarHeatmapDOM()    ← substitui #rentab-bloco
        ├── completarCotacoesFechamentoCripto()    ← pares BRL mortos → USDT
        └── completarUsdBrlFechamento()            ← preenche USDBRL em snaps
```

Enquanto isso, `renderDashboard` já montou e exibiu a página com:
- Os meses já fechados que estavam no DB.
- O MTD calculado por `obterMTD` com cotações ao vivo.

Se novos meses forem fechados durante o boot, o heatmap atualiza automaticamente
sem piscar a tela inteira.

---

## Imutabilidade dos fechamentos

Uma vez gravado, um mês fechado **nunca é recalculado automaticamente**. O mecanismo
de proteção existe em duas camadas:

1. `jaFechou` — verificação na coleta de pendentes: se `historicoRentabilidade`
   já contém o mês para o usuário, ele é pulado.
2. `jaSalvou` — verificação antes do `push`: segunda checagem logo antes de
   persistir (evita condição de corrida se duas aberturas acontecessem em paralelo).

A única exceção é a **migração de versão**: ao detectar
`historicoRentabilidadeVersao < versaoAtual`, todo o histórico é apagado e
recalculado no próximo boot. Versão atual: **8**.

---

## Backup e restauração

O backup (página `/backup`) exporta `historicoRentabilidade` junto com `stockHist`,
`ibovHist`, `cotacoesFechamento` e `usdBrlHist`. Na importação, a flag de versão
é resetada para **5**, forçando recálculo completo no próximo boot — garantindo
consistência com os preços importados.

Ver [rentabilidade.md § Backup](rentabilidade.md#backup-v2) para o formato JSON.
