# AGENTS.md — FinDash

Contexto técnico para qualquer agente (ou dev) que for continuar este projeto.

## O que é

**FinDash** é um sistema local de controle financeiro de investimentos, inspirado
nas plataformas Investidor10 e Smartfolio. O usuário registra manualmente suas
operações (compras, vendas, entradas, saídas, conversões, staking, proventos) e o
sistema calcula patrimônio, rentabilidade e comparações com índices — cruzando
com cotações reais via brapi.dev (B3) e Binance (cripto).

Uso é local e single-tenant: autenticação existe para separar contas na mesma
máquina, mas não há servidor nem deploy público.

## Stack

**O projeto migrou de Python/Django para uma aplicação web single-file.**

- **Arquivo principal: `index.html`** — HTML + CSS + JS puro, sem framework,
  sem bundler, sem servidor. Basta abrir no navegador.
- **"Banco de dados"**: `localStorage` do navegador, acessado via camada de
  abstração `armazem` (nunca usar `localStorage` diretamente no código — ver
  seção Armazenamento).
  Chave principal: `DASH_FINANCE_DB_V1`.
- **Autenticação**: client-side com hash simples de senha armazenado no
  `localStorage`. Não é segurança de produção — é só para separar dados de
  contas distintas na mesma máquina. Não reutilizar essas senhas em outros lugares.
- **Cotações B3 (Ação/FII/BDR)**: brapi.dev — token `BRAPI_TOKEN` hardcoded no
  arquivo (uso pessoal, nunca publicado). Cache de 30 minutos por símbolo via
  `armazem`.
- **Cotações cripto**: Binance REST API (endpoints públicos, sem chave) com
  fallback entre `data-api.binance.vision` e `api.binance.com`.
- **USD-BRL histórico**: BCB SGS série 1 (API pública, sem token) — mesma
  infraestrutura do CDI. Usado exclusivamente para preencher `cotacoesFechamento[mes]["USDBRL"]`.
- **Indicadores fundamentalistas**: bolsai.com.br — desativados
  (`INDICADORES_LIGADOS = false`) até resolver bloqueio de CORS no navegador.
- **Sem dependências de terceiros**: zero npm, zero pip. O arquivo `dash-finance.html`
  é autocontido (fontes via Google Fonts, tudo mais inline).
- **Não há `venv/`, `requirements.txt`, `manage.py` nem migrations** — tudo isso
  era da fase Django e não se aplica mais.

## Arquivo principal

```
index.html     ← FONTE DA VERDADE. 8 600+ linhas, ~1 MB.
                 Abrir direto no navegador, sem servidor.
```

O restante da estrutura de diretórios (`investments/`, `dash_finance/`,
`manage.py`, `requirements.txt`, `venv/`) é legado da fase Django — pode ser
ignorado ou removido; não é mais mantido.

## Estrutura interna do arquivo

O arquivo segue esta ordem:

1. **Comentário de cabeçalho** — guia de manutenção com todas as mudanças
   marcadas por tag (`[MOTOR v2]`, `[CRIPTO v1]`, etc.) e pendências de porte
   para quem quiser ressuscitar o Django.
2. **`<style>`** — design system completo (~1 600 linhas de CSS).
3. **`<body>`** — contém apenas `<div id="app"></div>` + uma faixa de aviso de
   armazenamento. Todo o HTML das páginas é gerado por JS.
4. **`<script>`** — todo o JavaScript inline, organizado em blocos marcados
   com comentários `/* ===...=== */`.

### Blocos JS (em ordem no arquivo)

| Bloco | Responsabilidade |
|---|---|
| CONSTANTES | Tokens, chaves de cache, TTLs, classes de ativo, cores |
| ARMAZENAMENTO | Camada `armazem` (localStorage / fallback em memória) |
| CAMADA DE DADOS | CRUD sobre o JSON do `armazem` (usuários, ativos, transações) |
| MOTOR DE CARTEIRA | Preço médio ponderado, posições, KPIs, alocação |
| GRÁFICOS | SVG montado em JS (evolução mensal, donut de alocação, gráfico de preço) |
| MARKET DATA (brapi) | Cotações B3, histórico de preço, rankings de mercado |
| MARKET DATA (Binance) | Cotações de cripto, fallback entre pares BRL/USDT |
| ROTEAMENTO | `navegar()`, sequenciamento de renderização, `renderCurrentRoute()` |
| COMPONENTES UI | Topbar, rodapé, saudação, drawer, formulário de lançamento |
| PÁGINAS | Uma função `renderXxx(user)` por página (ver lista abaixo) |
| BOOTSTRAP | Inicialização, evento DOMContentLoaded, delegação de eventos |

## Páginas / Rotas

| Rota | Função JS | Descrição |
|---|---|---|
| `/login` | `renderLogin()` | Tela de login (split-screen) |
| `/register` | `renderRegister()` | Cadastro de conta |
| `/` | `renderDashboard(user)` | Resumo: KPIs, gráfico de evolução, donut, rankings |
| `/posicoes` | `renderPosicoes(user)` | Posições por ativo e por classe, rentabilidade, destaques |
| `/proventos` | `renderProventos(user)` | Histórico de proventos, YoC |
| `/transacoes` | `renderTransacoes(user)` | CRUD de lançamentos (tabela + drawer) |
| `/ativo/:ticker` | `renderAtivoDetalhe(user, ticker)` | Detalhe do ativo: gráfico histórico, indicadores, lançamentos |
| `/balanceamento` | `renderBalanceamento(user)` | Alocação ideal por classe, notas por ativo, simulador de aporte |
| `/objetivos` | `renderObjetivos(user)` | Metas de patrimônio/renda; progresso e prazo estimado |
| `/backup` | `renderBackup(user)` | Export/import JSON da carteira + verificação de integridade |

A navegação é client-side via `data-rota="<rota>"` em links/botões — não há
`href` nos links internos (imposto pelo ambiente do preview do claude.ai, mas
mantido por consistência). A função `navegar(rota)` centraliza todo o roteamento.

## Modelo de dados (localStorage)

Tudo persiste em um único objeto JSON na chave `DASH_FINANCE_DB_V1`:

```js
{
  nextId: Number,          // contador global de IDs
  usuarios: [...],         // { id, username, email, passwordHash, criadoEm }
  ativos: [...],           // { id, ticker, classe, mercado, criadoEm }
  transacoes: [...]        // ver abaixo
}
```

### Ativo

- `ticker`: string maiúscula, trimada.
- `classe`: `'ACAO' | 'FII' | 'BDR' | 'CRIPTO' | 'RENDA_FIXA'`.
- `mercado`: `'BOLSA' | 'CRIPTO'` — determina quais tipos de transação são
  permitidos e qual fonte de cotação usar.

### Transação

```js
{
  id, usuarioId, ativoId,
  tipo,              // ver abaixo
  data,              // 'YYYY-MM-DD'
  quantidade,        // Decimal simulado como Number (CLASSES_INTEIRAS bloqueia fração em Ação/FII/BDR)
  precoUnitario,     // null em ENTRADA/SAIDA/STAKE/PROVENTO/RENDIMENTO_RF
  taxas,             // 0 por padrão
  // Apenas CONVERSAO:
  ativoDestinoId,
  quantidadeDestino,
  criadoEm           // timestamp para desempate de ordenação
}
```

### Tipos de transação por mercado

| Mercado | Tipos permitidos |
|---|---|
| BOLSA (Ação/FII/BDR) | `COMPRA`, `VENDA`, `PROVENTO` |
| CRIPTO | `COMPRA`, `VENDA`, `ENTRADA`, `SAIDA`, `CONVERSAO`, `STAKE` |
| RENDA_FIXA | `APORTE`, `RENDIMENTO_RF`, `SAIDA` |

Semântica dos tipos:

- `COMPRA` / `APORTE` → soma quantidade **e** custo (qtd × preço + taxas).
- `ENTRADA` / `STAKE` → soma **só** quantidade; custo zero (ex.: airdrop, staking).
- `VENDA` / `SAIDA` → retira quantidade e o custo proporcional pelo PM vigente.
- `CONVERSAO` → retira da origem pelo PM e migra esse mesmo custo para o ativo
  destino (campo `ativoDestinoId` + `quantidadeDestino`).
- `PROVENTO` / `RENDIMENTO_RF` → não mexe na posição; vai para o total de proventos.

### Preço médio ponderado

`processarCarteira()` é a única fonte de verdade para posições. Algoritmo:

1. Ordenar transações por `(data, PRIORIDADE_NO_DIA[tipo], criadoEm, id)`.
   - Compras antes de vendas no mesmo dia é crucial: uma compra e uma venda
     no mesmo dia só é válida se a compra vier primeiro.
2. Processar cada transação acumulando `quantidade`, `custoTotal` e
   `qtdComCusto` (quantidade que tem custo — exclui ENTRADA/STAKE).
3. PM = `custoTotal / qtdComCusto` (não divide pela quantidade total, para
   que staking não diluir o PM das compras pagas).
4. Residuo `< QTD_EPSILON` (1e-9) é zerado para evitar artefatos de ponto
   flutuante (equivalente ao `Decimal` do Python, mas JS não tem Decimal nativo).

**Não reimplementar este cálculo em outro lugar.** Toda lógica derivada
(destaques, KPIs, balanceamento, objetivos) chama `processarCarteira()` e
usa seu resultado.

### Validação cronológica de venda

`verificarCronologia(transacoes, novaTransacao, ativoId)` verifica que a
venda/saída/conversão não vai deixar nenhuma transação posterior no negativo —
validação considerando a posição **na data** do lançamento, não a posição total
de hoje. Isso previne: "comprei 10 em jan, vendi 10 em fev, tentei editar a
compra de jan para 5 → a venda de fev ficaria inválida".

## Market data

### brapi.dev (B3 — Ação/FII/BDR)

- Uma requisição por símbolo (plano gratuito não aceita batch).
- **Todas** as chamadas à brapi passam por `brapiFetch()`, que serializa numa
  fila global — o plano em uso não aceita mais de 1 requisição em voo
  simultâneo para nenhum endpoint (testado: paralelo derruba a conexão).
- Cache de **30 minutos** por símbolo (`CACHE_TTL_MS`), armazenado no
  `armazem` sob a chave `DASH_FINANCE_QUOTE_CACHE_V1`.
- Falha individual (ticker inválido, rede) não quebra o resto — símbolo
  ausente vira `null` em todos os campos derivados.
- Quando uma cotação expira e é buscada de novo, o histórico do ticker (1mo/1d)
  é aquecido em segundo plano na mesma janela, para que a página de detalhe
  não precise esperar.

### Binance (Cripto)

- Tenta cotação em BRL primeiro (`<TICKER>BRL`). Se o par não existir ou estiver
  parado (preço < R$ 0,50 ou variação zerada), cai para `<TICKER>USDT × USDTBRL`.
- Dois base URLs com fallback: `data-api.binance.vision` → `api.binance.com`.
- Não passa pela fila `brapiFetch()` — são APIs independentes.

**`[CRIPTO v1.3]`** `buscarPrecosMensaisCripto(ticker, dataInicio)` sempre busca `USDTBRL`
klines de forma independente (não depende de ter USDT na carteira do usuário). Verifica
se o par BRL está "vivo" checando se há dado para `mesAtual` ou `mesPrev`; se morto
(ex.: ENABRL ativo apenas jan–mar/2026, ATOMBRL ativo apenas até 2023), usa fallback
USDT×USDTBRL automaticamente.

### BCB SGS (USD-BRL)

- Série 1 do BCB SGS — taxa de câmbio USD-BRL diária, pública, sem token.
- `buscarUsdBrlMensal(dataInicio)` — chunks implícitos via uma única chamada com
  `dataInicial/dataFinal`, agrega o último valor por mês (fechamento do último dia útil).
  Armazena em `USDBRL_HIST_KEY`. Meses fechados imutáveis; mês corrente e mesPrev atualizáveis.
- `completarUsdBrlFechamento(usuarioId)` — roda no boot independente de haver meses pendentes.
  Busca o histórico completo desde a primeira transação e preenche `cotacoesFechamento[mes]["USDBRL"]`
  em snapshots existentes que ainda não têm o campo.

### Rankings (widget do Resumo)

- Ações em alta, ações em queda, FIIs por liquidez, cripto (BTC/ETH/USDT) em
  reais — buscados via `buscarRankings()`, cache separado
  (`DASH_FINANCE_RANKING_CACHE_V1`), também 30 minutos.

### bolsai.com.br (indicadores fundamentalistas)

- Desativado (`INDICADORES_LIGADOS = false`) — CORS bloqueia chamadas do
  navegador com a chave no cabeçalho; tentativa de fallback com `?api_key=`
  na URL também bloqueada. Reativar quando houver solução de proxy ou CORS
  oficial.
- Cache diário (expira à meia-noite UTC) quando ativado.

## Rentabilidade mensal (RENT v4)

O cálculo de rentabilidade usa **Modified Dietz** e **patrimônio a valor de mercado**.

### Fórmula (meses fechados)

```
Numerador   = PatrimonioFim − PatrimonioInicio − AportesLiquidos + Proventos
Denominador = PatrimonioInicio + AportesLiquidos × 0.5   ← Modified Dietz
Rentabilidade = Numerador / Denominador × 100
```

- **PatrimonioInicio/Fim**: `patrimonioNaData(usuarioId, anoMes, precosMensaisPorTicker)`
  — reconstrói posições até o último dia do mês + aplica preços históricos.
  RF usa custo acumulado (sem cotação de mercado).
- **AportesLiquidos**: `aportesLiquidosNoMes` — COMPRA/APORTE menos VENDA/SAIDA.
  ENTRADA, STAKE, CONVERSÃO, PROVENTO e RENDIMENTO_RF não são fluxos de capital.
- **Proventos**: `proventosNoMes` — soma de PROVENTO + RENDIMENTO_RF do mês
  (necessário para não distorcer o retorno no efeito ex-dividendo).
- **Fallback de preço**: se não tiver histórico para um ticker, usa preço médio
  de custo da posição naquela data.

### Fonte de preços históricos

| Classe | Fonte | Persistência |
|---|---|---|
| Ação/FII/BDR | brapi `startDate/endDate&interval=1d` em chunks de 90 dias | `STOCK_HIST_KEY` (localStorage, permanente) |
| Cripto | Binance klines `interval=1M`, limit dinâmico desde `dataInicio` | em memória por sessão |
| Renda Fixa | Custo contábil (sem API) | — |

**`[HIST v1]`** — Plano free brapi suporta apenas `interval=1d`; `range=2y` e `interval=1mo`
retornam erro. A solução usa `startDate/endDate` com janelas ≤ 90 dias (chunks gerados por
`gerarChunks()`). Meses fechados gravados em `STOCK_HIST_KEY` nunca são sobrescritos;
só o mês corrente atualiza a cada abertura.

O campo `date` da brapi retorna timestamp Unix em **segundos**. `normalizarDataBrapi(ts)`
converte para `"YYYY-MM"`. Candles diários chegam em ordem **decrescente** — `_agregarMensalDescendente`
toma o primeiro candle por mês (= fechamento mais recente do mês).

Ver `docs/rentabilidade.md` para documentação detalhada da estratégia.

### MTD (mês corrente em andamento)

`obterMTD(usuarioId, cotacoes, cdiHoje)` calcula rentabilidade parcial do mês
atual usando cotações ao vivo (as mesmas já buscadas no dashboard). Resultado
marcado como `parcial: true` — aparece no heatmap com asterisco. Não é gravado
no `historicoRentabilidade`; existe só em `_mtdCache` (memória de sessão).

**`patrimonioInicio` no MTD**: calculado via `patrimonioNaData(usuarioId, anoMesAnterior, loadStockHist())`
— **não** usa `histPrev.patrimonioFim` do histórico fechado. Motivo: o snapshot
armazenado reflete o estado da carteira no momento do fechamento; transações
retroativas adicionadas depois (como um aporte de RF em mês já fechado) não
atualizam esse snapshot. O cálculo dinâmico inclui sempre o estado atual das
transações. Fallback para o valor histórico apenas se `patrimonioNaData` retornar 0.

### Fluxo de fechamento

`fecharMesAnteriorSeNecessario(usuarioId)` roda em background no boot, retorna
`Promise<number>` (meses novos fechados). Ao terminar com `novos > 0`, chama
`atualizarHeatmapDOM` que substitui o bloco `#rentab-bloco` completo (gráfico
acumulado + heatmap) sem re-renderizar a página.

**Sequência de boot (após login):**
1. `popularCotacoesFechamentoRetroativo(userId)` — síncrono, preenche snapshots com cache local (stockHist + ibovHist + usdBrlHist)
2. `fecharMesAnteriorSeNecessario(userId)` — busca preços + IBOV + USDBRL via APIs, fecha meses pendentes, atualiza IBOV/USDBRL em snapshots existentes
3. `.then`: `completarCotacoesFechamentoCripto(userId)` — preenche preços cripto faltantes em snapshots já existentes (pares BRL mortos → fallback USDT)
4. `.then`: `completarUsdBrlFechamento(userId)` — preenche USDBRL em snapshots existentes (roda mesmo sem meses pendentes)

### Migração de versão

Flag `db.historicoRentabilidadeVersao`. Versão atual: **6**. Ao subir para uma
versão nova, apagar `historicoRentabilidade` e incrementar o número — o
fechamento automático recalcula tudo no próximo boot. Nunca recalcular meses já
fechados automaticamente fora da migração de versão.
Histórico de versões: 4 = Modified Dietz base; 5 = preços reais via chunks B3;
6 = primeiro mês com rentabilidade real (PI=0) + gráfico acumulado estilo Investidor10.

### Gráfico de linha acumulada

`dadosChartJsRentabAcumulada(usuarioId, mtd, ibovMapa)` gera séries acumuladas
(Carteira, CDI e IBOV) em % para Chart.js. Renderizado por `htmlChartJs`.
Exibido dentro de `secaoRentabilidadeHTML`, que agrupa título + subtítulo +
gráfico + heatmap.

**Origem no zero**: a função prepende um ponto `(origemLabel, 0, 0, 0)` antes do
primeiro mês calculado. O label vem do `primeiroMes` (mês de formação) quando
existe; caso contrário é derivado do mês anterior ao primeiro ponto. As três
linhas partem do mesmo 0% — a divergência visual reflete apenas retorno
incremental, nunca artefato de base diferente.

**Linha IBOV**: terceira série, vermelha tracejada (`#dc2626`, `borderDash: [4,3]`).
O retorno acumulado usa `ibovMapa[mes] / ibovMapa[mesAnterior] - 1` para cada
ponto. Se o mapa não tiver o par de meses necessário, aquele ponto fica em 0
(não quebra a série).

**IBOV — fonte e persistência** (`buscarPrecosMensaisIBOV(dataInicio)`):

- **`[HIST v1]`** Mesma arquitetura de chunks de 90 dias que `buscarPrecosMensaisB3`.
  Reutiliza `_fetchChunksB3('%5EBVSP', ...)` internamente.
- `dataInicio`: data do lançamento mais antigo de qualquer ativo de bolsa do usuário
  (passada por `renderDashboard` e `fecharMesAnteriorSeNecessario`). Garante cobertura
  total do histórico da carteira.
- O histórico acumulado fica em `IBOV_HIST_KEY = 'DASH_FINANCE_IBOV_HIST_V1'`
  no `armazem`. Meses fechados nunca são sobrescritos; mês corrente atualiza sempre.
- Helpers: `loadIBOVHist()` / `saveIBOVHist(mapa)` — leitura/gravação via `armazem`.
- `_ibovMapaCache` — cache de sessão em memória (evita refetch na mesma abertura).
- `renderDashboard` passa `ibovMapa` para `secaoRentabilidadeHTML`; se o mapa
  vier vazio (falha de rede, primeira abertura sem histórico), a linha IBOV
  simplesmente não é adicionada ao gráfico — nenhum erro.

### Heatmap (mês a mês)

Células renderizadas por `heatmapCelulasHTML`. Dimensões atuais: `72px` de
largura, `padding: 4px 5px` (compacto). Cores:
- **Acima do CDI**: verde claro.
- **Abaixo do CDI**: vermelho claro.
- **Formação** (`primeiroMes`): neutro com texto "formação / sem base".
- **Mês corrente** (`parcial: true`): fundo azul claro + borda tracejada + fontes
  em azul `#2563eb` — identidade visual própria, separada das células fechadas.

### Card "Resultado vs custo" (dashboard)

O quarto KPI do Resumo exibe:
- Valor principal: `(saldo + proventos − custo) / custo` em %.
- Linha secundária: CDI estimado do mês atual (`cdiHoje.cdiMesEst`), vindo da
  busca de CDI (BCB SGS 12) — substitui o chip de acumulado que existia antes.
- Botão `?` que abre `#drawer-info-resultado-custo`: gaveta com os valores reais
  do momento (resultado %, CDI/mês, acumulado carteira vs CDI, delta p.p.) e 4
  parágrafos explicativos em linguagem leiga.

### Card "Lucro/Prejuízo" no KPI de Resumo

O terceiro KPI do Resumo foi redesenhado com dois sub-blocos:
- **Lucro total** (topo): `lucroTotal + provTotal` — valorização + dividendos recebidos. Se
  há proventos, exibe "incluindo dividendos" abaixo.
- **Lucro/Prejuízo** (base): `lucroTotal` (só valorização) com percentual `lucroTotal / valorInvestido`.
- Ambos em `font-size: 1.2rem` (menor que o `kpi-value` padrão) para compactar o card.

## Armazenamento (`armazem`)

**Nunca usar `localStorage` diretamente.** Toda leitura/escrita passa por:

```js
armazem.get(chave)        // retorna string | null
armazem.set(chave, valor) // valor sempre string
armazem.remove(chave)
```

Internamente `armazem` escolhe o backend:
- `'local'` → `localStorage` (arquivo aberto direto no navegador — caso normal).
- `'memory'` → objeto JS em memória (preview do claude.ai bloqueia
  `localStorage`; uma faixa amarela avisa o usuário).

Chaves do sistema:

| Chave | Conteúdo |
|---|---|
| `DASH_FINANCE_DB_V1` | JSON principal (usuários, ativos, transações) |
| `DASH_FINANCE_SESSION_V1` | Sessão ativa `{ userId }` |
| `DASH_FINANCE_QUOTE_CACHE_V1` | Cache de cotações B3 |
| `DASH_FINANCE_HIST_CACHE_V1` | Cache de histórico de preço (detalhe do ativo) |
| `DASH_FINANCE_RANKING_CACHE_V1` | Cache de rankings de mercado |
| `DASH_FINANCE_IBOV_HIST_V1` | Histórico acumulado mensal do IBOV (`{ "YYYY-MM": close, "_mesPrevOk": "YYYY-MM" }`) |
| `DASH_FINANCE_STOCK_HIST_V1` | Histórico acumulado mensal por ticker B3 (`{ "ITSA4": { "YYYY-MM": close } }`) |
| `DASH_FINANCE_USDBRL_HIST_V1` | Histórico acumulado mensal USD-BRL via BCB SGS 1 (`{ "YYYY-MM": close }`) |
| `DASH_FINANCE_FECHAMENTOS_V1` | Snapshot de cotações no fechamento (`{ "YYYY-MM": { "TICKER": price, "IBOV": price, "USDBRL": price } }`) |

## Design system (CSS)

Princípios — manter consistência em telas novas:

- **Acento grafite/quase-preto** (`--color-primary: #201c1a`), não indigo como
  na fase Django. Verde/vermelho semânticos só para ganho/perda.
- **Tipografia compacta**: `--text-xs` (12px) a `--text-3xl` (36px). Nada de
  fonte gigante em card financeiro.
- **Superfícies planas**: bordas hairline, sombra só como reforço sutil.
  Exceção: drawer usa sombra mais presente (camada flutuante).
- **Raio contido**: 8–14px. Nada de 20px+ em card financeiro.
- **Paleta de classes** (`CORES_CLASSE`): azul/Ação `#2a78d6`, laranja/FII
  `#eb6834`, roxo/BDR `#8a5cd6`, verde/Cripto `#1baf7a`, amarelo/Renda fixa
  `#eda100`. Ordem fixa nas legendas — não muda conforme a carteira muda.
- **App shell**: topbar horizontal em desktop, menu sanduíche em mobile.
- **Drawer**: slide-over lateral direito (`min(520px, 92vw)`). Mesmo padrão
  da fase Django, portado para JS puro.
- **Mobile/PWA**: `@media (max-width: 768px)` ativa layout de cartões
  para tabelas, botão flutuante `+` para novo lançamento, menu sanduíche,
  tela cheia no formulário de lançamento.
- Todo CSS novo vai no `<style>` do próprio arquivo, não em arquivo externo.

## Convenções de manutenção

- **Tags de mudança**: toda divergência do comportamento original Django fica
  marcada com uma tag no código: `// [MOTOR v2 · 28/09/2026]`, `// [CRIPTO v1]`,
  etc. Procurar pela tag para achar todos os pontos afetados.
- **`APP_VERSAO`**: incrementar ao entregar uma versão com mudança relevante.
  Só alterar `var APP_VERSAO` (linha ~4095) — o rodapé usa essa variável.
- **`BRAPI_TOKEN`**: hardcoded em `var BRAPI_TOKEN` (linha ~1823). Arquivo é
  de uso pessoal; **nunca versionar/publicar com o token real**.
- **Novo ativo ou tipo de transação**: atualizar `CLASSES`, `CLASSES_ORDEM`,
  `CLASSES_LANCAVEIS`, `CORES_CLASSE` e `TIPOS_POR_MERCADO`.
- **Nova página**: criar `renderNovaPagina(user)`, registrar em
  `renderCurrentRoute()`, adicionar item no topbar/menu mobile.

## Débitos técnicos conhecidos

- `BRAPI_TOKEN` hardcoded — aceitável para uso pessoal, jamais subir ao git.
- Hash de senha simples — não é segurança real; adequado para separar contas
  na mesma máquina, não para proteger dado sensível contra atacante local.
- `INDICADORES_LIGADOS = false` — indicadores da bolsai desativados por CORS.
- `localStorage` não é compartilhado entre navegadores/dispositivos — backup
  manual (página Backup) é o único mecanismo de persistência fora do browser.
- Sem testes automatizados.
- Renda Fixa parcialmente implementada (APORTE/RENDIMENTO_RF existem no motor,
  UI de aporte ainda básica).
- Formulário não impede quantidade fracionada em Ação/FII/BDR no campo de
  quantidade (a validação `CLASSES_INTEIRAS` bloqueia, mas a mensagem de erro
  pode ser melhorada).

## Roadmap (atualizado)

1. ✅ Design system e fluxo de autenticação.
2. ✅ Modelo de dados (ativos, transações, proventos).
3. ✅ CRUD de lançamentos via drawer.
4. ✅ Dashboard com KPIs reais (sem cotação).
5. ✅ Tela de Posições com preço médio.
6. ✅ Integração brapi (cotação B3, rentabilidade, logos).
7. ✅ Motor de carteira v2: 5 tipos de transação + STAKE, validação cronológica,
      BDR como nova classe, preço médio de compra separado de quantidade com custo.
8. ✅ Cripto via Binance com fallback BRL → USDT×USDTBRL.
9. ✅ Proventos implementados (lançamento manual, YoC, retorno total).
10. ✅ Tela de Ativo (histórico de preço, indicadores, lançamentos do ativo).
11. ✅ Balanceamento (alocação ideal, simulador de aporte).
12. ✅ Objetivos (metas de patrimônio/renda, prazo estimado).
13. ✅ Backup (export/import JSON, verificação de integridade).
14. ✅ Mobile/PWA (menu sanduíche, botão flutuante, tabelas em cartão).
15. ✅ Rankings de mercado no Resumo.
16. **Pendente**: reativar indicadores bolsai (resolver CORS ou criar proxy).
17. **Pendente**: suporte multi-dispositivo (hoje cada browser tem sua própria
      carteira — export/import é o workaround atual).
18. **Pendente**: modo escuro.
19. ✅ Comparação com índices (CDI, IBOV) no gráfico acumulado de rentabilidade.
20. ✅ Histórico de preços mensais via chunks de 90 dias (`[HIST v1]`) — corrige
      rentabilidade 0% em carteiras antigas; estratégia `startDate/endDate` no
      plano free brapi; fechamentos acumulados em localStorage permanente;
      backup v2 exporta/importa `stockHist` e `ibovHist`.
21. ✅ Primeiro mês com rentabilidade real via Modified Dietz (PI=0); gráfico
      acumulado no estilo Investidor10 (origin = primeiro mês real, sem ponto
      sintético pré-carteira); gráfico de barras evolutivo a valor de mercado
      mês a mês com split custo/ganho por barra.
22. ✅ Gráfico de barras com dados dinâmicos via `patrimonioNaData + stockHist`
      (corrige exibição quando RF ou outros ativos são lançados retroativamente após
      meses já fechados). MTD também usa `patrimonioNaData` para `patrimonioInicio`
      pelo mesmo motivo. Sombra da gaveta corrigida (só aparece com `.drawer.open`).
23. ✅ Dashboard — KPI "Lucro/Prejuízo" redesenhado: dois sub-blocos (Lucro total c/
      dividendos + Lucro/Prejuízo s/ dividendos com %). Card Proventos: removido
      texto "s/ custo" do YoC.
24. ✅ Proventos — filtro por ativo, YoC individual por lançamento, cards de resumo
      aprimorados (YoC acumulado, total últimos 12 meses, gaveta "ver detalhe" com
      totais por ativo pagante, ativo + data no maior provento).
25. ✅ Posições — ordenação clicável por Quantidade, Rentabilidade e Saldo atual em
      todos os grupos (Ação, FII, BDR, Cripto). Estado `_ordemPosicoes` reseta ao
      sair da página. Primeiro clique: decrescente (maior primeiro).
26. ✅ `cotacoesFechamento` — snapshot de cotações por mês fechado (`[FECH v1]`), com
      `_mesPrevOk` para corrigir IBOV mid-month, `completarCotacoesFechamentoCripto` para
      pares BRL mortos (ENA/ATOM), e `completarUsdBrlFechamento` + BCB SGS 1 para USDBRL.
      Backup v3 exporta `cotacoesFechamento`, `usdBrlHist`, `mesAtual`; ibovHist exportado
      sem chaves de controle (prefixo `_`).
27. ✅ Import com IDs estáveis — transações preservam ID original do backup; ativos e
      objetivos novos usam ID original quando não há colisão; `nextId` recalculado como
      `max(todos os IDs) + 1` após import. `APP_VERSAO` 1.2.0.

## Preferências de trabalho

- Comunicação e conteúdo de UI em português (pt-BR).
- Design "clean" de verdade — sem sombras pesadas, cantos muito arredondados,
  fontes grandes ou cards genéricos "de IA". Antes de entregar mudança visual,
  verificar se foge desses clichês.
- Mudanças de UI devem ser verificadas no navegador (abrir o arquivo), não só
  lidas no código.
- Este arquivo (`AGENTS.md`) deve refletir o estado real do `dash-finance.html`,
  inclusive o que ainda não foi commitado. Ao fechar um bloco do roadmap,
  atualizar aqui no mesmo passo.
- Ao usar a skill `dataviz` do ambiente, manter consistência com a paleta e
  os princípios acima.
