# Renda Fixa no FinDash

## Visão geral

O FinDash trata Renda Fixa de forma manual e simplificada: não há integração com corretoras nem atualização automática de saldo. O usuário registra cada evento relevante — aporte, rendimento e resgate — e o sistema calcula o saldo e o yield a partir dessas entradas.

Isso é adequado para o perfil da ferramenta (uso pessoal, single-tenant) e garante que o histórico seja exato, sem depender de APIs que exigiriam autenticação por corretora.

---

## Modelo de dados

Cada título de Renda Fixa é um **ativo** com `classe = 'RENDA_FIXA'` e `mercado = 'RENDA_FIXA'`. O "ticker" do ativo é o nome livre dado pelo usuário no primeiro aporte (ex.: `CDB Nubank 2027`, `LCI XP 12%`).

As transações de RF usam o campo `valor` (em R$) em vez de `quantidade` e `precoUnitario`, que ficam zerados. Os três tipos possíveis são:

| Tipo | Efeito no saldo | Efeito no rendimento | Fluxo de capital |
|---|---|---|---|
| `APORTE` | `+valor` | — | Positivo (+) |
| `RENDIMENTO_RF` | `+valor` | `+valor` | Nenhum (já está no patrimônio) |
| `RESGATE` | `−valor` | — | Negativo (−) |

**Fórmula do saldo:**

```
saldo = Σ APORTE + Σ RENDIMENTO_RF − Σ RESGATE
```

**Fórmula do yield acumulado:**

```
yield (%) = Σ RENDIMENTO_RF / Σ APORTE × 100
```

O yield é calculado sobre o total aportado historicamente, não sobre o saldo líquido — isso preserva a representação correta do rendimento mesmo após resgates parciais.

---

## Tipos de lançamento

### APORTE

Registra uma aplicação em um título de RF.

- **Campo**: nome livre do título (ex.: `CDB Nubank 2027`). Se o título já existir (mesmo nome, case-insensitive), o aporte é somado ao saldo existente. Se for nome novo, um ativo de RF é criado automaticamente.
- **Campo**: valor aportado em R$ (total aplicado nesta data).
- **Campo**: data da aplicação.

Efeito: aumenta o saldo do título e entra como fluxo de capital positivo no cálculo de rentabilidade mensal (Modified Dietz).

---

### RENDIMENTO_RF

> **⚠️ Lançamento manual por enquanto.**
>
> O FinDash não integra com nenhuma corretora para buscar rendimentos automaticamente. O usuário deve consultar o extrato da corretora/banco e registrar o rendimento manualmente com o valor e a data exatos.
>
> Registre o valor **bruto ou líquido**, conforme preferir — mas seja consistente ao longo do tempo para que o yield acumulado faça sentido.

Registra o rendimento creditado em um título já existente.

- **Campo**: título de RF (select dos títulos já cadastrados).
- **Campo**: valor do rendimento em R$ (bruto ou líquido de IR, conforme critério pessoal).
- **Campo**: data do crédito do rendimento.

Efeito: aumenta o saldo do título. **Não é tratado como fluxo de capital** no Modified Dietz — o rendimento já está refletido no patrimônio ao final do mês, e somá-lo como aporte inflaria artificialmente o denominador da fórmula.

---

### RESGATE

Registra a retirada parcial ou total de um título de RF.

- **Campo**: título a resgatar (select dos títulos já cadastrados).
- **Campo**: valor resgatado em R$ (total recebido no resgate — principal + rendimentos acumulados ainda não lançados, se houver).
- **Campo**: data do resgate.

Efeito: reduz o saldo do título. Entra como **fluxo de capital negativo** no Modified Dietz do mês correspondente.

**Resgate parcial**: o título permanece visível em Posições com o saldo remanescente. Uma coluna "Resgatado" aparece na tabela de RF mostrando o valor já retirado.

**Resgate total**: o saldo chega a zero e o título desaparece da tela de Posições. O histórico de transações (APORTE, RENDIMENTO_RF, RESGATE) permanece salvo e é exportado integralmente no backup JSON.

---

## Cálculo de saldo e patrimônio

A função `posicoesRF(usuarioId)` percorre todas as transações de RF do usuário e retorna um array com:

```js
{
  ativo,        // objeto do ativo (ticker = nome do título)
  aportado,     // Σ APORTE
  rendimento,   // Σ RENDIMENTO_RF
  resgatado,    // Σ RESGATE
  saldo,        // aportado + rendimento − resgatado
  yieldPct,     // rendimento / aportado × 100
}
```

`totalAportadoRF(usuarioId)` retorna `Σ max(0, saldo)` de todas as posições — representa o capital líquido atual em RF e compõe o `valorInvestido` total da carteira.

A função `patrimonioNaData(usuarioId, anoMes, precosMensais)` também considera RF, somando `APORTE` e `RENDIMENTO_RF` e subtraindo `SAIDA` e `RESGATE` até a data-limite de cada mês — isso garante que o gráfico de evolução histórica e o cálculo de rentabilidade mensal reflitam corretamente o saldo de RF em cada período, mesmo quando o resgate ocorre em mês posterior.

---

## Visão em Posições

A tela de Posições exibe apenas **posições abertas** (saldo > 0). Posições totalmente resgatadas são ocultadas.

**Colunas exibidas:**

| Coluna | Descrição |
|---|---|
| Título | Nome do ativo de RF |
| Valor aportado | Total aplicado historicamente |
| Rendimento | Soma de todos os RENDIMENTO_RF lançados |
| Resgatado | Soma de RESGATES (coluna aparece apenas se houver ao menos um resgate parcial) |
| Saldo atual | `aportado + rendimento − resgatado` |
| Yield | `rendimento / aportado × 100` |
| % da carteira | `saldo / valorTotalCarteira × 100` |

O header do grupo RF exibe o total aportado, total resgatado (quando houver) e saldo atual consolidados.

---

## Rentabilidade mensal

Os lançamentos de RF participam do cálculo de rentabilidade mensal (Modified Dietz) da seguinte forma:

- **APORTE** → fluxo positivo no mês (aumenta o denominador).
- **RESGATE** → fluxo negativo no mês (diminui o denominador).
- **RENDIMENTO_RF** → não é fluxo; já está embutido no `patrimonioFim` via `patrimonioNaData`.

Isso evita dupla contagem: o rendimento não infla o denominador e não é somado separadamente no numerador.

---

## Backup

O backup JSON (`/backup`) exporta **todas** as transações de RF sem filtro, incluindo as de títulos já totalmente resgatados. O campo relevante é:

```json
{
  "ativos": [
    { "id": 42, "ticker": "CDB Nubank 2027", "classe": "RENDA_FIXA" }
  ],
  "transacoes": [
    { "id": 101, "ativoId": 42, "tipo": "APORTE",        "valor": 1000,   "data": "2026-09-01" },
    { "id": 102, "ativoId": 42, "tipo": "RENDIMENTO_RF", "valor": 12.75,  "data": "2026-10-01" },
    { "id": 103, "ativoId": 42, "tipo": "RESGATE",       "valor": 512.75, "data": "2026-10-15" }
  ]
}
```

O saldo reconstruído a qualquer momento é sempre `APORTE − RESGATE + RENDIMENTO_RF`.

---

## Limitações conhecidas e roadmap

- **Rendimento manual**: não há integração com corretoras. O usuário precisa consultar o extrato e lançar manualmente. Planejado para futura integração quando houver API pública disponível ou solução de proxy.
- **Sem marcação a mercado**: o saldo de RF usa custo contábil (sem cotação de mercado). Títulos com liquidez diária podem ter valor diferente do saldo contábil em caso de resgate antecipado com deságio — o sistema não modela esse cenário.
- **IR não calculado automaticamente**: o rendimento pode ser lançado bruto ou líquido; o sistema não aplica tabela regressiva de IR automaticamente.
