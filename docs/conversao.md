# Conversão — Documentação técnica (`[CONV v1]`)

## O que é

Conversão é a troca direta de um ativo cripto por outro, sem passar pelo real.
No FinDash, a operação registra a **saída da origem**, a **entrada do destino** e
opcionalmente a **realização fiscal** do ganho ou perda nessa troca.

---

## Comportamento com cotação (realização fiscal)

Quando a cotação do token de origem é encontrada automaticamente pelo FinDash
(via Binance), a conversão gera realização fiscal:

```
Valor realizado  = qtd_origem × cotacao_origem
Ganho/perda      = Valor realizado − custo_origem_pelo_PM
Custo do destino = Valor realizado
PM do destino    = Valor realizado ÷ qtd_destino
```

### Exemplo testado em 13/10/2026

| Campo             | Valor               |
|-------------------|---------------------|
| Token de origem   | DOGE                |
| Quantidade saída  | 20                  |
| PM de compra DOGE | R$ 0,4437/un.       |
| Cotação DOGE/data | R$ 0,4267/un.       |
| Token de destino  | ATOM                |
| Quantidade recebida | 0,91550006        |

**Cálculo da realização:**

```
Custo de origem:    20 × R$ 0,4437  =  R$ 8,874
Valor realizado:    20 × R$ 0,4267  =  R$ 8,534
Perda registrada:   R$ 8,534 − R$ 8,874  =  −R$ 0,34
```

**ATOM entrou com custo = R$ 8,534** (valor de mercado do que foi entregue).

**Cálculo do novo PM do ATOM** (já havia 1 ATOM comprado a R$ 10,55):

```
Custo anterior:   1        × R$ 10,55  =  R$ 10,55
Custo conversão:  0,9155   (ver acima)  =  R$ 8,534
                                           ─────────
Total:            1,9155 ATOM           =  R$ 19,084

PM novo = R$ 19,084 ÷ 1,9155 = R$ 9,96/un.
```

**Resultado na tela de Posições:**

| Ativo | Qtd antes | Qtd depois | PM antes    | PM depois   | Total investido |
|-------|-----------|------------|-------------|-------------|-----------------|
| DOGE  | 120       | 100        | R$ 0,4437   | R$ 0,4437   | R$ 44,38        |
| ATOM  | 1         | 1,9155     | R$ 10,55    | R$ 9,96     | R$ 19,08        |

A queda de ~R$ 0,34 no Total investido da carteira reflete exatamente a perda
realizada na saída do DOGE.

---

## Comportamento sem cotação (legado — custo migra)

Quando a Binance não retorna cotação (par inexistente, rede fora):

```
Custo do destino = custo_origem_pelo_PM   ← sem realização
PM do destino    = custo_origem ÷ qtd_destino
```

Não há ganho/perda registrado. O total investido da carteira não muda.

---

## Como a cotação é obtida (`buscarPrecoConversaoNaData`)

| Situação        | Fonte                                          |
|-----------------|------------------------------------------------|
| Data = hoje     | `GET /api/v3/ticker/price` (Binance, ao vivo)  |
| Data no passado | `GET /api/v3/klines?interval=1d` (klines diários, USDT×USDTBRL) |

Sempre usa o par `{TOKEN}USDT × USDTBRL` para garantir cobertura histórica.
O preço é exibido no widget `conv-cotacao-info` no formulário antes de salvar.

---

## Implementação em `processarCarteira`

```js
} else if (t.tipo === 'CONVERSAO') {
    var saiu = baixar(pos(t.ativoId), t.quantidade);
    var destino = pos(t.ativoDestinoId);
    destino.quantidade += t.quantidadeDestino;
    if (t.precoUnitario) {
        // Realização fiscal
        var valorConv = t.quantidade * t.precoUnitario;
        realizado[t.id] = valorConv - saiu.custo;
        destino.custoTotal  += valorConv;
        destino.qtdComCusto += t.quantidadeDestino;
    } else {
        // Legado: custo migra sem realização
        destino.custoTotal += saiu.custo;
        var fracaoCC = t.quantidade > 0 ? saiu.qtdComCusto / t.quantidade : 0;
        destino.qtdComCusto += t.quantidadeDestino * fracaoCC;
    }
}
```

`processarCarteira` retorna `{ posicoes, deltaCusto, realizado }`.  
`realizado[id]` contém o ganho (positivo) ou perda (negativo) em reais de cada
conversão com cotação registrada.

---

## Efeito no Modified Dietz (rentabilidade mensal)

CONVERSÃO **não é fluxo de capital** — não entra em `aportesLiquidosNoMes`,
mesmo com realização fiscal. O `deltaCusto[t.id]` permanece 0.

A perda/ganho realizado aparece indiretamente: reduz/aumenta o `custoTotal` da
carteira, o que afeta o numerador do Modified Dietz via `patrimonioNaData`.

---

## Campo `descricao` (nota)

Todas as operações cripto e bolsa (exceto Renda Fixa) aceitam o campo opcional
`descricao`. Exibido como linha secundária itálica na tabela de Lançamentos.

Exemplo na tabela: badge "Conversão" + linha `conversao executada` abaixo.
