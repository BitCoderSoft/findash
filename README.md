# FinDash

Sistema local de controle financeiro de investimentos. Registre compras,
vendas, entradas, conversões e proventos de ações, FIIs, BDRs e criptomoedas;
acompanhe patrimônio, rentabilidade e métricas de carteira com cotações reais
de mercado.

Uso local e single-tenant: funciona offline, os dados ficam no próprio
navegador (localStorage).

## Como rodar

**Sem instalação.** Basta abrir o arquivo no navegador:

```
Finder → duplo clique em dash-finance.html
```

ou via terminal:

```bash
open dash-finance.html
```

Não há servidor, Python, Node ou qualquer dependência para instalar.

## Stack

- HTML + CSS + JavaScript puro (arquivo único, sem bundler)
- `localStorage` como banco de dados local
- Cotações B3 (Ação/FII/BDR) via [brapi.dev](https://brapi.dev)
- Cotações de cripto via Binance API (pública, sem chave)

## Funcionalidades

| Página | O que faz |
|---|---|
| **Resumo** | KPIs de patrimônio, gráfico de evolução mensal, donut de alocação, rankings de mercado |
| **Posições** | Posição por ativo com preço médio, rentabilidade real e destaques da carteira |
| **Proventos** | Histórico de dividendos/JCP/rendimentos com YoC e retorno total |
| **Lançamentos** | CRUD de todas as operações via drawer lateral |
| **Ativo** | Gráfico histórico de preço, indicadores e lançamentos de um ativo específico |
| **Balanceamento** | Alocação ideal por classe, notas por ativo e simulador de aporte |
| **Objetivos** | Metas de patrimônio ou renda mensal com progresso e prazo estimado |
| **Backup** | Export e import do JSON da carteira + verificação de integridade |

## Token brapi

O arquivo contém `var BRAPI_TOKEN` próximo à linha 1792. Substitua pelo
seu token (obtido em [brapi.dev](https://brapi.dev)) para habilitar as
cotações de B3. Sem token, cotações ficam indisponíveis mas o resto do app
funciona normalmente.

> **Atenção**: não versione o arquivo com o token real em repositório público.

## Documentação técnica

Ver [AGENTS.md](AGENTS.md) para contexto completo: arquitetura, modelo de
dados, motor de carteira, convenções de manutenção, débitos técnicos e roadmap.
