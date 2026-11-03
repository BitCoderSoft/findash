# Histórico de Migração — FinDash

Documento de referência para entender as decisões tomadas durante as duas
grandes migrações do projeto, com registro de problemas encontrados e como
foram resolvidos.

---

## Fase 1 — Django → HTML single-file (histórico)

O projeto nasceu como uma aplicação Django/Python com banco SQLite. A migração
para single-file HTML+CSS+JS ocorreu porque:

- Uso é local e single-tenant; servidor Python era overhead desnecessário
- Elimina `venv`, `manage.py`, migrations, dependências de terceiros
- O arquivo pode ser aberto direto no navegador com `file://`
- Facilita o uso do preview do Claude (artifacts)

**O que ficou do Django** (legado ignorado, não manter):
```
investments/   dash_finance/   manage.py   requirements.txt   venv/
```

**Adaptações necessárias na migração Django → HTML:**
- Banco de dados: SQLite → `localStorage` via camada `armazem`
- Autenticação: sessions Django → hash de senha no `localStorage`
- Templates Jinja2 → funções JS que retornam strings HTML
- Views → funções `renderXxx(user)`
- URLs → roteamento client-side via `navegar(rota)`
- ORM → CRUD JS sobre o JSON do `armazem`
- `Decimal` Python → `Number` JS + `QTD_EPSILON` para artefatos de float

---

## Fase 2 — HTML single-file → arquivos JS modulares (branch `feat-refatoracao`)

### Motivação

Com o arquivo `index.html` ultrapassando 9 600 linhas, navegação, edição e
testes ficaram difíceis. A extração em arquivos separados melhora:
- Leitura: cada arquivo tem escopo semântico claro
- Manutenção: diff de commit mais legível
- Futura testabilidade: funções puras podem ser testadas sem o HTML

### Decisão de design: scripts clássicos, sem ES modules

**Por que não usar `import`/`export`?**
- `index.html` é aberto via `file://` — browsers bloqueiam ES modules por
  CORS em `file://` (flag necessária no Chrome/Firefox)
- GitHub Pages funciona, mas adiciona complexidade sem bundler
- A abordagem clássica (`<script src>` em ordem, tudo no escopo global)
  replica exatamente o que o IIFE inline já fazia — zero risco de regressão

**Regra de ouro:** cada arquivo `js/` expõe suas funções como globals (sem
IIFE). O IIFE em `index.html` consome tudo via globals. A ordem dos `<script>`
determina o que está disponível no momento da definição.

**Forward references são seguras:** funções como `_mesAnterior` que `graficos.js`
chama são resolvidas no momento da *invocação* (render time), não da
*definição* (parse time). Basta que `utils.js` carregue antes do usuário
interagir com a página.

---

### Etapas de extração concluídas

#### Bloco 1 — `js/constantes.js`
- **Commit:** `a813c1b`
- **Conteúdo:** tokens de API, chaves de cache, TTLs, `CLASSES`, `CLASSES_ORDEM`,
  `CLASSES_INTEIRAS`, `CLASSES_BOLSA`, `CORES_CLASSE`, `TIPOS_POR_MERCADO`,
  `MESES_PT`, `QTD_EPSILON`, `PRIORIDADE_NO_DIA`
- **Dependências:** nenhuma (carregado primeiro)
- **Problemas:** nenhum

#### Bloco 2 — `js/armazem.js`
- **Commit:** `2726da3`
- **Conteúdo:** `modoArmazenamento`, `espelho`, `armazem` (get/set/remove),
  `carregarArmazenamento()`, `mostrarAvisoArmazenamento()`
- **Dependências:** `CONSTANTES` (usa `DB_KEY`, `SESSION_KEY`, `CHAVES_PERSISTENTES`)
- **Problemas:** nenhum

#### Bloco 3 — `js/data.js`
- **Commit:** `d4a3311`
- **Conteúdo:** todo o CRUD de banco (`loadDB`/`saveDB`/`setSession`/etc.),
  `processarCarteira()`, `calcularKpis()`, `evolucaoMensal()`, `patrimonioNaData()`,
  funções de RF (`posicoesRF`, `rfRendimentos`), `verificarCronologia()`
- **Dependências:** `CONSTANTES`, `ARMAZEM`
- **Problemas:** nenhum na extração em si; bugs latentes descobertos depois
  (ver seção Bugs abaixo)

#### Bloco U — `js/utils.js`
- **Commit:** `f1aead9` (junto com graficos.js)
- **Origem:** criado como correção emergencial após o erro
  `_mesAnterior is not defined` no carregamento do dashboard
- **Conteúdo:** `_mesAnterior()`, `agruparMilhar()`, `formatarBR()`,
  `fmt0/1/2/4()`, `fmtPreco()`, `formatValorGrande()`, `formatQuantidade()`,
  `formatarQuantidadeLivre()`, `escapeHtml()`, `formatDataBR()`, `formatDataCurta()`
- **Por que existe separado:** essas funções estavam definidas *dentro* do
  IIFE em `index.html`. Quando `graficos.js` (externo ao IIFE) chamava
  `_mesAnterior` em render time, o browser a procurava no escopo global —
  onde não existia. A solução foi mover as funções de utilitário para fora
  do IIFE em `utils.js` (global), e remover as duplicatas do IIFE.
- **Dependências:** `CONSTANTES` (`CLASSES_INTEIRAS` em `formatQuantidade`)

#### Bloco 4 — `js/graficos.js`
- **Commit:** `f1aead9`
- **Conteúdo:** `montarGraficoEvolucao()`, `dadosChartJsEvolucao()`,
  `dadosChartJsProventos()`, `_chartQueue`, `htmlChartJs()`,
  `dadosChartJsRentabAcumulada()`, `inicializarCharts()`,
  `montarGraficoAlocacao()`, `graficoHistoricoState`, `montarGraficoHistoricoHTML()`,
  `wireGraficoHistorico()`
- **Dependências:** `CONSTANTES`, `utils.js`
- **Problemas:** ver bug `_mesAnterior` acima

---

### Etapas de extração pendentes

| Próximo bloco | Conteúdo principal | Dependências esperadas |
|---|---|---|
| Bloco 5 — `js/market.js` | `brapiFetch()`, `buscarCotacoesB3()`, `buscarPrecosMensaisB3()`, `buscarCotacaoBinance()`, `buscarPrecosMensaisCripto()`, `buscarPrecosMensaisIBOV()`, `buscarPrecosMensaisIFIX()`, `buscarRankings()`, `buscarCDI()` | CONSTANTES, ARMAZEM, utils |
| Bloco 6 — `js/engine.js` (TBD) | `fecharMesAnteriorSeNecessario()`, `obterMTD()`, `aportesLiquidosNoMes()`, `proventosNoMes()` | CONSTANTES, ARMAZEM, data, market |
| Bloco 7+ | ROTEAMENTO, COMPONENTES UI, PÁGINAS, BOOTSTRAP | tudo |

> Cada extração deve ser validada no navegador antes de commitar.
> Atualizar esta seção e o AGENTS.md no mesmo commit.

---

## Bugs descobertos durante a refatoração

### Bug 1 — `_mesAnterior is not defined` (resolvido)

**Sintoma:** ao abrir o dashboard, console mostrava
`ReferenceError: _mesAnterior is not defined` e os gráficos não carregavam.

**Causa:** `_mesAnterior` e as funções de formatação estavam definidas *dentro*
do IIFE. Quando `graficos.js` as chamava no scope global, elas não existiam.

**Fix:** criar `js/utils.js` com essas funções como globals. Remover as
duplicatas do IIFE (`sed -i '' '3063,3171d'`). Adicionar `<script src="js/utils.js">`
antes de `<script src="js/graficos.js">` em `index.html`.

**Validado:** usuário confirmou "graficos carregaram normalmente".

---

### Bug 2 — Lucro fantasma no gráfico de barras "Evolução do patrimônio" (resolvido)

**Sintoma:** a barra de Out/26 mostrava lucro (+R$16,72 antes do fix, +R$11,65
depois do fix parcial) quando outubro foi um mês negativo (−2,17% no heatmap).
Outros dois sistemas de acompanhamento mostravam prejudízo em outubro.

**Identificado:** nov/03/2026, após o usuário lançar dados de novembro e
comparar os gráficos.

**Causa raiz — duas partes independentes:**

**Parte A — RESGATE RF com rendimentos (`js/data.js → evolucaoMensal`):**

```
custo RF = Σ APORTE − Σ RESGATE
```

Quando o RESGATE inclui rendimentos (resgate total = principal + juros), o
resultado era `custo = −rendimentos` (negativo). O `patrimonioNaData` calculava
saldo = 0 após resgate completo. Logo: `saldo − custo = 0 − (−rendimentos) = +rendimentos`.
O lucro fantasma era igual ao total de RENDIMENTO_RF de contas resgatadas.

**Fix A:** limitar a dedução do RESGATE ao APORTE acumulado para aquele ativo.
Rendimentos que nunca entraram como custo não são descontados:

```js
var acum = aporteAcumRF[t.ativoId] || 0;
var deducao = Math.min(Number(t.valor) || 0, acum);
aporteAcumRF[t.ativoId] = acum - deducao;
deltasPorMes[chave] -= deducao;
```

Efeito colateral benéfico: RF com saldo ativo ainda mostra lucro real
(rendimentos > 0 com custo = APORTE apenas). ✓

**Parte B — Cripto sem preço histórico (`index.html → renderDashboard`):**

O gráfico de barras chamava `patrimonioNaData(user.id, anoMes, loadStockHist())`.
`stockHist` armazena apenas preços B3. Cripto não tem entrada → fallback ao
custo → zero delta de mercado. Para outubro, com cripto em queda, a barra
mostrava zero delta para a maior parte da carteira (cripto ~32%).

**Fix B:** antes de chamar `patrimonioNaData`, mesclar `cotacoesFechamento`
(que tem preços reais de fechamento de TODOS os ativos, B3 + cripto) no mapa
de preços, sem sobrescrever entradas B3 já presentes em `stockHist`:

```js
var fech = loadCotacoesFechamento();
Object.keys(fech).forEach(function (mes) {
    Object.keys(fech[mes]).forEach(function (ticker) {
        if (['IBOV','IFIX','USDBRL'].includes(ticker) || ticker[0]==='_') return;
        if (!stockHistEvol[ticker]) stockHistEvol[ticker] = {};
        if (stockHistEvol[ticker][mes] == null) stockHistEvol[ticker][mes] = fech[mes][ticker];
    });
});
```

Tag: `[EVOL v1]`

**Resultado após os dois fixes:** Out/26 mostra Prejuízo: −R$29,29 com
Custo aportado: R$2.132. Patrimônio implícito: R$2.132 − R$29,29 = R$2.102,71.
Bate com os R$2.102,75 do PDF de análise gerado em 31/10.

---

### Bug 3 — `inicializarCharts` não chamado em `/posicoes` (resolvido)

**Sintoma:** gráfico "Consolidação de aportes" adicionado em `renderPosicoes`
mostrava a área cinza (canvas vazio) mas sem barras — nenhum erro no console.

**Causa:** o roteador de `/posicoes` não chamava `inicializarCharts()` após
`app.innerHTML = html`. As outras rotas com Chart.js (`/dashboard`, `/proventos`)
já tinham essa chamada; `/posicoes` nunca precisou porque nunca tinha gráfico.

**Fix:** adicionar `inicializarCharts()` no `.then()` do roteador de `/posicoes`:
```js
renderPosicoes(user).then(function (html) {
    if (seq !== navegacaoSeq) return;
    app.innerHTML = html;
    inicializarCharts(); // ← adicionado
});
```

**Regra geral:** toda rota que rendere HTML contendo `htmlChartJs(...)` precisa
chamar `inicializarCharts()` depois de `app.innerHTML = html`. Charts são
enfileirados em `_chartQueue` durante o render; `inicializarCharts` processa a
fila depois que o DOM existe.

---

## BCB SGS 404 (observação, não é bug)

**Sintoma:** console mostra
`GET https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados?formato=json&dataInicial=...&dataFinal=... 404`
no dia corrente.

**Causa:** o BCB publica a taxa USD-BRL com atraso de horas. O mesmo dia
geralmente retorna 404 até a tarde.

**Impacto:** o CDI parcial do mês corrente no heatmap pode aparecer com valor
incorreto (ex.: −0,10%) no dia. No dia seguinte (ou após o BCB publicar), o
valor se corrige automaticamente ao reabrir o app.

**Ação:** nenhuma. O código já trata `resp.ok ? resp.json() : []`.
