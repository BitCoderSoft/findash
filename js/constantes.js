/* =================================================================
   CONFIG / CONSTANTES
   ================================================================= */

// Uso 100% local — nunca publicado, nunca versionado num repo compartilhado.
// Por isso o token vive direto aqui (pedido explícito do usuário), em vez de
// vir de variável de ambiente como no backend Django original.
var BRAPI_TOKEN = 'fEDYWpoqpSFFpmUDdo2rzN';
var BRAPI_QUOTE_URL = 'https://brapi.dev/api/v2/stocks/quote';
var BRAPI_HISTORICAL_URL = 'https://brapi.dev/api/v2/stocks/historical';
var BRAPI_TICKERS_URL = 'https://brapi.dev/api/v2/tickers';
// 30 minutos — padronizado (era 5min) pra cotação E histórico: quem acompanha
// preço de bolsa não precisa de ciclo minuto a minuto, e isso reduz ainda mais
// as requisições reais à brapi (decisão explícita do usuário).
var CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas — reduz volume de chamadas à brapi

var DB_KEY = 'DASH_FINANCE_DB_V1';
var SESSION_KEY = 'DASH_FINANCE_SESSION_V1';
var QUOTE_CACHE_KEY = 'DASH_FINANCE_QUOTE_CACHE_V1';
var HIST_CACHE_KEY = 'DASH_FINANCE_HIST_CACHE_V1';
var RANKING_CACHE_KEY = 'DASH_FINANCE_RANKING_CACHE_V1';
// [CDI v1 · 11/10/2026] cache diário do CDI — uma chamada por dia por dispositivo
var CDI_CACHE_KEY = 'DASH_FINANCE_CDI_CACHE_V1';
// [RENT v2] cache de preços mensais históricos por ticker (24h — dado imutável)
var HIST_MENSAL_CACHE_KEY = 'DASH_FINANCE_HIST_MENSAL_V1';
var HIST_MENSAL_TTL_MS = 24 * 60 * 60 * 1000;
var IBOV_HIST_KEY  = 'DASH_FINANCE_IBOV_HIST_V1';  // histórico acumulado mensal do IBOV
var IFIX_HIST_KEY  = 'DASH_FINANCE_IFIX_HIST_V1';  // histórico acumulado mensal do IFIX
var STOCK_HIST_KEY = 'DASH_FINANCE_STOCK_HIST_V1'; // histórico acumulado mensal por ticker B3 { "ITSA4": { "YYYY-MM": close } }
var FECHAMENTOS_KEY  = 'DASH_FINANCE_FECHAMENTOS_V1'; // snapshot de cotações no fechamento { "YYYY-MM": { "TICKER": price, "IBOV": price } }
var USDBRL_HIST_KEY  = 'DASH_FINANCE_USDBRL_HIST_V1'; // histórico acumulado mensal do USD-BRL { "YYYY-MM": close }
var THEME_KEY        = 'DASH_FINANCE_THEME_V1';       // preferência de tema: 'light' | 'dark'
// BCB SGS série 12 = CDI over diário (API pública, sem autenticação)
var BCB_CDI_LATEST_URL = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/1?formato=json';
var BCB_CDI_PERIODO_URL = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json';

// [CRIPTO v2 · 28/09/2026] BDR entrou (a brapi cota BDR como qualquer ação
// da B3; quantidade inteira, igual ação e FII)
var CLASSES = { ACAO: 'Ação', FII: 'FII', BDR: 'BDR', ETF: 'ETF', CRIPTO: 'Criptomoeda', RENDA_FIXA: 'Renda fixa' };
var CLASSES_ORDEM = ['ACAO', 'FII', 'BDR', 'ETF', 'CRIPTO', 'RENDA_FIXA'];
// [RF v1 · 11/10/2026] Renda fixa reativada com abordagem manual: APORTE
// (valor total sem qty/preço) e RENDIMENTO_RF (rendimento manual, invisível
// em Lançamentos). Sem busca de cotação de mercado.
var CLASSES_LANCAVEIS = ['ACAO', 'FII', 'BDR', 'ETF', 'CRIPTO', 'RENDA_FIXA'];
// [CRIPTO v2] classes escolhíveis no mercado Bolsa (cripto não escolhe classe)
var CLASSES_BOLSA = ['ACAO', 'FII', 'BDR', 'ETF'];
var CLASSES_INTEIRAS = { ACAO: true, FII: true, BDR: true, ETF: true }; // B3 não fraciona ação/cota de FII/ETF
var CORES_CLASSE = { ACAO: '#2a78d6', FII: '#eb6834', BDR: '#8a5cd6', ETF: '#0891b2', CRIPTO: '#1baf7a', RENDA_FIXA: '#eda100' };
var MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
