/* =================================================================
   MARKET DATA — brapi.dev (B3), Binance (cripto), BCB SGS (CDI/USDBRL),
   bolsai.com.br (indicadores fundamentalistas)
   Extraído do IIFE de index.html para escopo global.
   Dependências: constantes.js, armazem.js, utils.js, data.js
   ================================================================= */

/* =================================================================
   MARKET DATA — porte fiel de investments/market_data.py (brapi.dev)
   ================================================================= */

// Fila global de requisições à brapi — o plano em uso só aceita 1 requisição
// HTTP em voo por vez PRA QUALQUER endpoint (testado contra a API real:
// /quote + /tickers em paralelo já derruba a conexão, não é só dentro do
// mesmo endpoint). Por isso NENHUM fetch pra brapi.dev deve ser feito direto
// — sempre passar por brapiFetch(), que encadeia tudo numa fila única,
// mesmo chamadas vindas de partes independentes do app (ex.: cotação do
// Resumo e rankings buscados via Promise.all no mesmo render).
var brapiFilaPromise = Promise.resolve();

function brapiFetch(url, opcoes) {
    var resultado = brapiFilaPromise.then(function () { return fetch(url, opcoes); });
    // a fila segue adiante mesmo se essa chamada falhar — senão uma falha
    // trava todas as próximas pra sempre
    brapiFilaPromise = resultado.then(function () {}, function () {});
    return resultado;
}

function getCachedQuote(symbol) {
    try {
        var raw = armazem.get(QUOTE_CACHE_KEY);
        if (!raw) return null;
        var cache = JSON.parse(raw);
        var entry = cache[symbol];
        if (!entry || Date.now() > entry.expiresAt) return null;
        return entry.cotacao;
    } catch (e) { return null; }
}

function setCachedQuote(symbol, cotacao) {
    try {
        var raw = armazem.get(QUOTE_CACHE_KEY);
        var cache = raw ? JSON.parse(raw) : {};
        cache[symbol] = { cotacao: cotacao, expiresAt: Date.now() + CACHE_TTL_MS };
        armazem.set(QUOTE_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { /* localStorage cheio/bloqueado — segue sem cache */ }
}

// Porte de buscar_cotacoes(symbols): uma requisição HTTP por símbolo (não em
// lote — mesma limitação de plano observada no backend Django: a brapi
// recusa vários símbolos numa única chamada em planos gratuitos), com cache
// de 5 minutos por símbolo e tolerância a falha individual (um ticker que
// falhar simplesmente não entra no resultado, não derruba os outros).
// [CRIPTO v1] renomeada (era buscarCotacoes). Agora só cuida de B3.
// Quem decide a fonte é o novo buscarCotacoes(), lá embaixo.
function buscarCotacoesBrapi(symbols) {
    var resultado = {};
    var pendentes = [];

    symbols.forEach(function (symbol) {
        var cached = getCachedQuote(symbol);
        if (cached) resultado[symbol] = cached;
        else pendentes.push(symbol);
    });

    function buscarUm(symbol) {
        var url = BRAPI_QUOTE_URL + '?symbols=' + encodeURIComponent(symbol);
        return brapiFetch(url, { headers: { Authorization: 'Bearer ' + BRAPI_TOKEN } })
            .then(function (resp) {
                if (!resp.ok) return null;
                return resp.json();
            })
            .then(function (payload) {
                if (!payload) return;
                var item = (payload.results || [])[0];
                if (!item || !item.data) return;
                var data = item.data;
                var cotacao = {
                    symbol: symbol,
                    nome: data.longName || data.shortName || symbol,
                    moeda: data.currency || 'BRL',
                    precoAtual: Number(data.regularMarketPrice) || 0,
                    variacao: Number(data.regularMarketChange) || 0,
                    variacaoPercentual: Number(data.regularMarketChangePercent) || 0,
                    atualizadoEm: data.regularMarketTime || null,
                    logoUrl: data.logourl || null,
                };
                setCachedQuote(symbol, cotacao);
                resultado[symbol] = cotacao;

                // Aproveita esta MESMA janela de atualização (cache da cotação
                // expirou, é hora de atualizar) pra também esquentar o cache de
                // histórico desse ticker, em segundo plano — sem `return`, não
                // bloqueia buscarCotacoes(). Não é uma chamada a mais por
                // visita: só dispara quando o histórico já teria expirado de
                // qualquer forma, então ele acompanha o mesmo ciclo de 30min da
                // cotação. Resultado: quando o usuário abre a página de
                // detalhe do ativo, o histórico já está pronto no cache — não
                // evita a requisição, evita o usuário esperar por ela.
                if (!getCachedHistorico(symbol + ':1mo:1d')) {
                    buscarHistorico(symbol, '1mo', '1d');
                }
            })
            .catch(function () { /* símbolo inválido ou falha de rede pontual — só não entra no resultado */ });
    }

    var cadeia = Promise.resolve();
    pendentes.forEach(function (symbol) {
        cadeia = cadeia.then(function () { return buscarUm(symbol); });
    });
    return cadeia.then(function () { return resultado; });
}

function getCachedHistorico(chave) {
    try {
        var raw = armazem.get(HIST_CACHE_KEY);
        if (!raw) return null;
        var cache = JSON.parse(raw);
        var entry = cache[chave];
        if (!entry || Date.now() > entry.expiresAt) return null;
        return entry.pontos;
    } catch (e) { return null; }
}

function setCachedHistorico(chave, pontos) {
    try {
        var raw = armazem.get(HIST_CACHE_KEY);
        var cache = raw ? JSON.parse(raw) : {};
        cache[chave] = { pontos: pontos, expiresAt: Date.now() + CACHE_TTL_MS };
        armazem.set(HIST_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { /* localStorage cheio/bloqueado — segue sem cache */ }
}

// [RENT v2] Cache de preços mensais históricos por ticker.
// Chave no cache: "B3:<TICKER>" ou "CRIPTO:<TICKER>" pra não misturar fontes.
// Valor: { "2026-09": 49.12, "2026-08": 45.02, ... }  (anoMes → close)
function getCachedHistoricoMensal(chave) {
    try {
        var raw = armazem.get(HIST_MENSAL_CACHE_KEY);
        if (!raw) return null;
        var cache = JSON.parse(raw);
        var entry = cache[chave];
        if (!entry || Date.now() > entry.expiresAt) return null;
        return entry.precos;
    } catch (e) { return null; }
}

function setCachedHistoricoMensal(chave, precos) {
    try {
        var raw = armazem.get(HIST_MENSAL_CACHE_KEY);
        var cache = raw ? JSON.parse(raw) : {};
        cache[chave] = { precos: precos, expiresAt: Date.now() + HIST_MENSAL_TTL_MS };
        armazem.set(HIST_MENSAL_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { /* localStorage cheio/bloqueado — segue */ }
}

// [RENT v2] Converte o campo `date` da brapi (timestamp em segundos, confirmado
// em teste de 11/10/2026) para "YYYY-MM". Também aceita string ISO como
// fallback defensivo.
function normalizarDataBrapi(ts) {
    var ms = (typeof ts === 'string') ? Date.parse(ts) : (ts > 1e12 ? ts : ts * 1000);
    if (!ms || isNaN(ms)) return null;
    return new Date(ms).toISOString().slice(0, 7);
}

// Histórico de fechamento diário — endpoint /stocks/historical da brapi.
// Descoberto via o assistente do dashboard da brapi (não estava óbvio na doc
// pública): aceita `range`/`interval` (ex.: "1mo"/"1d" = ~20 pregões, um por
// dia útil) e, ao contrário de /stocks/quote, aceitou vários `symbols` numa
// mesma chamada quando testado — mas aqui só pedimos 1 ticker por vez mesmo,
// que é tudo que a página de detalhe precisa.
function buscarHistorico(symbol, range, interval) {
    range = range || '1mo';
    interval = interval || '1d';
    var chave = symbol + ':' + range + ':' + interval;
    var cached = getCachedHistorico(chave);
    if (cached) return Promise.resolve(cached);

    var url = BRAPI_HISTORICAL_URL + '?symbols=' + encodeURIComponent(symbol) + '&range=' + range + '&interval=' + interval;
    return brapiFetch(url, { headers: { Authorization: 'Bearer ' + BRAPI_TOKEN } })
        .then(function (resp) { return resp.ok ? resp.json() : null; })
        .then(function (payload) {
            if (!payload) return [];
            var item = (payload.results || [])[0];
            var lista = (item && item.data && item.data.historicalDataPrice) || [];
            // a brapi retorna do mais recente pro mais antigo — inverte pra
            // ordem cronológica (mais fácil de desenhar e de calcular
            // variação dia-a-dia depois)
            var pontos = lista.slice().reverse().map(function (p) {
                return { date: p.date, close: p.close };
            });
            setCachedHistorico(chave, pontos);
            return pontos;
        })
        .catch(function () { return []; });
}

function getCachedRanking(chave) {
    try {
        var raw = armazem.get(RANKING_CACHE_KEY);
        if (!raw) return null;
        var cache = JSON.parse(raw);
        var entry = cache[chave];
        if (!entry || Date.now() > entry.expiresAt) return null;
        return entry.lista;
    } catch (e) { return null; }
}

function setCachedRanking(chave, lista) {
    try {
        var raw = armazem.get(RANKING_CACHE_KEY);
        var cache = raw ? JSON.parse(raw) : {};
        cache[chave] = { lista: lista, expiresAt: Date.now() + CACHE_TTL_MS };
        armazem.set(RANKING_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { /* localStorage cheio/bloqueado — segue sem cache */ }
}

// Ranking geral (não é ticker por ticker) — endpoint /v2/tickers, descoberto
// testando contra a API real (a doc pública não lista os valores aceitos de
// `sortBy`; o enum exato só apareceu no corpo de um erro 400: symbol, name,
// close, change, volume, marketCap). Filtra fora os tickers do mercado
// fracionário (ex.: PETR4F) — são a mesma empresa duplicada com volume
// irrisório, só ruído num ranking.
function buscarRanking(params) {
    var chave = JSON.stringify(params);
    var cached = getCachedRanking(chave);
    if (cached) return Promise.resolve(cached);

    var qs = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    var url = BRAPI_TICKERS_URL + '?' + qs;
    return brapiFetch(url, { headers: { Authorization: 'Bearer ' + BRAPI_TOKEN } })
        .then(function (resp) { return resp.ok ? resp.json() : null; })
        .then(function (payload) {
            if (!payload) return [];
            var lista = (payload.results || []).filter(function (r) { return !/[0-9]F$/.test(r.symbol); });
            setCachedRanking(chave, lista);
            return lista;
        })
        .catch(function () { return []; });
}

// Some empresas aparecem 2x no ranking de valor de mercado (PETR4 e PETR3 são
// a mesma Petrobras, classes de ação diferentes) — mantém só a primeira
// ocorrência (a mais líquida, já que a lista vem ordenada) por nome de
// empresa, senão o top 5 vira top 3 de empresas repetidas.
function dedupePorEmpresa(lista) {
    var vistos = {};
    return lista.filter(function (r) {
        var chave = r.name || r.longName || r.symbol;
        if (vistos[chave]) return false;
        vistos[chave] = true;
        return true;
    });
}

// [RANK v2 · 28/09/2026] PAINEL DE RANKINGS EM 4 COLUNAS, SEM ABAS
// Pedido do Junior: tudo visível de uma vez, 5 itens em cada coluna.
//   1) Ações: maiores altas do dia
//   2) Ações: maiores quedas do dia
//   3) FIIs: maior liquidez diária em R$ (o ranking que já existia)
//   4) Cripto: BTC, ETH e USDT em reais, variação de 24h (Binance)
// Saiu o "maiores valores de mercado" das ações.
//
// Altas e quedas: a brapi ordena por variação (sortBy=change), mas pedir
// direto as maiores variações traz papel sem liquidez nenhuma (ação de
// centavos que subiu 40% com meia dúzia de negócios). Então o universo é
// outro: as 100 ações MAIS NEGOCIADAS do dia (sortBy=volume), e a ordenação
// por variação é feita aqui. As duas colunas saem dessa MESMA chamada.
// Campo usado: quote.changePercent (documentado em /docs/tickers).
// Dedupe por empresa antes (PETR3 e PETR4 não ocupam duas vagas); fica a
// classe mais negociada. Alta só entra se subiu, queda só se caiu: num dia
// de mercado todo pra cima, a coluna de quedas pode vir com menos de 5.
//
// Chamadas à brapi continuam 2 (ações + FIIs), serializadas pela fila de
// brapiFetch(). Cripto vai pela Binance, em paralelo.
// Django: não existia nada disso lá além dos rankings antigos; se portar,
// mesma lógica em services (ou market_data).
var RANKING_CRIPTO_TOKENS = ['BTC', 'ETH', 'USDT'];
var RANKING_CRIPTO_NOMES = { BTC: 'Bitcoin', ETH: 'Ethereum', USDT: 'Tether (dólar digital)' };

function buscarRankingsResumo() {
    return Promise.all([
        buscarRanking({ type: 'stock', sortBy: 'volume', sortOrder: 'desc', limit: 100 }),
        // FIIs: a API só ordena por volume (cotas), não por R$; busca 30 e
        // reordena pelo valor financeiro (volume x preço) aqui
        buscarRanking({ subType: 'fii', sortBy: 'volume', sortOrder: 'desc', limit: 30 }),
        buscarCotacoesCripto(RANKING_CRIPTO_TOKENS),
    ]).then(function (r) {
        function pct(x) { return Number(x.quote && x.quote.changePercent); }

        var acoes = dedupePorEmpresa((r[0] || []).filter(function (x) { return isFinite(pct(x)); }));
        var altas = acoes.filter(function (x) { return pct(x) > 0; })
            .sort(function (a, b) { return pct(b) - pct(a); })
            .slice(0, 5);
        var quedas = acoes.filter(function (x) { return pct(x) < 0; })
            .sort(function (a, b) { return pct(a) - pct(b); })
            .slice(0, 5);

        var fiis = (r[1] || []).slice().sort(function (a, b) {
            var liqA = (a.quote.volume || 0) * (a.quote.lastPrice || 0);
            var liqB = (b.quote.volume || 0) * (b.quote.lastPrice || 0);
            return liqB - liqA;
        }).slice(0, 5);

        var cotCripto = r[2] || {};
        var cripto = RANKING_CRIPTO_TOKENS.map(function (t) {
            var c = cotCripto[t];
            return c ? { symbol: t, nome: RANKING_CRIPTO_NOMES[t], preco: c.precoAtual, pct: c.variacaoPercentual } : null;
        }).filter(Boolean);

        return { altas: altas, quedas: quedas, fiiLiquidez: fiis, cripto: cripto };
    });
}


/* =================================================================
   MARKET DATA CRIPTO — Binance  [CRIPTO v1 · 28/09/2026]
   ================================================================= */

// Regras combinadas com o Junior:
//   - o ticker da cripto é o símbolo do token (BTC, ETH, DOGE, SOL...)
//   - prioridade pro par em reais: TOKEN + 'BRL' (ex.: BTCBRL)
//   - se ele não existir, estiver parado ou fora do mercado ([CRIPTO v1.2],
//     ver escolherCotacaoCripto): TOKEN + 'USDT' convertido pelo USDTBRL.
//     USDT é o dólar digital da Binance (atrelado ao USD), então USDTBRL
//     é, na prática, a cotação do dólar em reais vista pela corretora
//   - token sem nenhum dos dois pares: fica sem cotação (aparece "—")
//
// Endpoints usados (todos públicos, SEM chave, SEM token):
//   /api/v3/ticker/price            -> lista de todos os pares existentes
//                                      (1 chamada, usada só pra descobrir
//                                      qual par cada token tem)
//   /api/v3/ticker/24hr?symbols=[]  -> preço + variação 24h de vários pares
//                                      numa chamada só (diferente da brapi)
//   /api/v3/klines                  -> candles diários pro gráfico
// Base principal: data-api.binance.vision (a própria doc indica pra quem só
// consome dado público de mercado). api.binance.com fica de reserva se a
// primeira falhar na rede.
//
// Limites: são por IP. Se vier 429 (ou 418, banimento), a Binance manda
// parar; o código pausa TODAS as chamadas a ela por um tempo em vez de
// insistir (insistir após 429 gera banimento de 2 min até 3 dias).
// Não usa a fila da brapi: são APIs independentes e uma não espera a outra.
//
// Cache: cotação usa o mesmo cache e o mesmo TTL (30 min) da brapi.
// A descoberta de pares fica 24h em cache (par não aparece/some todo dia).
//
// Ainda NÃO há WebSocket (tempo real). Fica pra quando a tela deixar de
// ser redesenhada inteira a cada atualização (ver conversa de 28/09).
//
// Django: portar como investments/market_data_crypto.py (mesma lógica;
// lá pode usar requests com timeout e cache do Django).

var BINANCE_BASES = ['https://data-api.binance.vision', 'https://api.binance.com'];
// [CRIPTO v1.2] V2: o cache agora guarda os dois pares (BRL e USDT)
var PARES_CACHE_KEY = 'DASH_FINANCE_CRIPTO_PARES_V2';
var PARES_TTL_MS = 24 * 60 * 60 * 1000;
var binancePausadoAte = 0;

function binanceGet(caminho) {
    if (Date.now() < binancePausadoAte) {
        return Promise.reject(new Error('Binance em pausa por limite de requisições'));
    }

    function tentar(i) {
        return fetch(BINANCE_BASES[i] + caminho).then(function (resp) {
            if (resp.status === 429 || resp.status === 418) {
                // Retry-After nem sempre é legível no navegador (CORS);
                // sem ele, espera 60s por segurança
                var espera = parseInt(resp.headers.get('Retry-After') || '60', 10) || 60;
                binancePausadoAte = Date.now() + espera * 1000;
                var erroLimite = new Error('Binance: limite atingido');
                erroLimite.status = resp.status;
                throw erroLimite;
            }
            if (!resp.ok) {
                var erro = new Error('Binance respondeu ' + resp.status);
                erro.status = resp.status;
                throw erro;
            }
            return resp.json();
        }, function (erroDeRede) {
            // falha de rede (não de resposta): tenta a próxima base
            if (i + 1 < BINANCE_BASES.length) return tentar(i + 1);
            throw erroDeRede;
        });
    }
    return tentar(0);
}

// [CRIPTO v1.1 · 28/09/2026] CHAVE DE CACHE SEPARADA PRA CRIPTO
// Bug achado no primeiro teste real: BTC apareceu cotado a R$ 37,12. A
// versão anterior (sem Binance) mandava QUALQUER ticker pra brapi, e a
// brapi tem um "BTC" que não é bitcoin (é um fundo/ETF de bolsa
// americana). Essa cotação errada ficou no cache sob a chave "BTC" e a
// Binance lia o mesmo cache, então devolvia o valor velho em vez de
// buscar. Agora cotação de cripto mora em "CRIPTO:<ticker>", que a brapi
// nunca escreve. Regra: toda leitura/escrita de cotação de cripto passa
// por chaveCotacaoCripto(). O lixo antigo em "BTC" fica lá inofensivo.
// [CRIPTO v1.2] prefixo "v2": joga fora cotações calculadas pela regra
// antiga (a do ENA a R$ 0,60) sem precisar esperar o cache vencer
function chaveCotacaoCripto(ticker) {
    return 'CRIPTO:v2:' + ticker;
}

// "btc", " BTC " -> "BTC". Só letras e números.
function tokenCripto(ticker) {
    return String(ticker || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function lerCachePares() {
    try {
        var raw = armazem.get(PARES_CACHE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

// [CRIPTO v1.2 · 28/09/2026] Descobre, pra cada token, QUAIS pares existem:
// { brl: 'ENABRL' | null, usdt: 'ENAUSDT' | null }. A escolha de qual usar
// ficou pra hora da cotação (ver escolherCotacaoCripto), porque só ali dá
// pra saber se o par em reais está vivo.
function resolverParesCripto(tokens) {
    var cache = lerCachePares();
    var agora = Date.now();
    var faltando = tokens.filter(function (t) {
        return !cache[t] || agora > cache[t].expiraEm;
    });
    if (!faltando.length) return Promise.resolve(cache);

    return binanceGet('/api/v3/ticker/price').then(function (lista) {
        var existe = {};
        (lista || []).forEach(function (p) { existe[p.symbol] = true; });

        faltando.forEach(function (t) {
            cache[t] = {
                brl: existe[t + 'BRL'] ? t + 'BRL' : null,
                usdt: existe[t + 'USDT'] ? t + 'USDT' : null,
                expiraEm: agora + PARES_TTL_MS,
            };
        });

        try { armazem.set(PARES_CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* segue sem cache */ }
        return cache;
    }).catch(function () {
        return cache; // sem rede: usa o que já sabia
    });
}

// [CRIPTO v1.2 · 28/09/2026] QUAL COTAÇÃO USAR
// Bug do ENA: a Binance ainda lista o par ENABRL, mas ele está parado (sem
// negócio recente), e o "último preço" dele era de muito tempo atrás:
// R$ 0,60 enquanto o mercado real estava em R$ 1,35. O par existir não
// garante que ele funcione. Regra nova, mantendo a prioridade em reais:
//   1) usa o par BRL se ele teve negócio nas últimas 24h (count > 0) E o
//      preço dele não se afasta mais de 15% do preço via USDT x USDTBRL
//   2) senão, usa USDT x USDTBRL (o par mais líquido do token)
//   3) sem USDT disponível pra comparar, usa o BRL se ele teve negócio
// O motivo da escolha vai no `nome` da cotação e aparece na página do ativo.
var DIVERGENCIA_MAX_BRL = 0.15;

function escolherCotacaoCripto(pares, porSimbolo) {
    var brl = pares.brl ? porSimbolo[pares.brl] : null;
    var usdt = pares.usdt ? porSimbolo[pares.usdt] : null;
    var dolar = porSimbolo.USDTBRL;

    var viaUsdt = null;
    if (usdt && dolar && Number(usdt.lastPrice) > 0 && Number(dolar.lastPrice) > 0) {
        var taxa = Number(dolar.lastPrice);
        var preco = Number(usdt.lastPrice) * taxa;
        var pct = ((1 + Number(usdt.priceChangePercent) / 100) * (1 + Number(dolar.priceChangePercent) / 100) - 1) * 100;
        viaUsdt = {
            preco: preco,
            variacaoPct: pct,
            variacao: preco - preco / (1 + pct / 100),
            par: pares.usdt,
            via: 'USDT',
            closeTime: usdt.closeTime,
        };
    }

    // `count` = número de negócios nas últimas 24h (campo do /ticker/24hr).
    // Se um dia ele não vier na resposta, não dá pra afirmar que o par está
    // parado: aí só a comparação com o USDT decide.
    var semNegocios = brl && brl.count !== undefined && brl.count !== null && !(Number(brl.count) > 0);
    var brlVivo = brl && Number(brl.lastPrice) > 0 && !semNegocios;
    var viaBrl = brlVivo ? {
        preco: Number(brl.lastPrice),
        variacaoPct: Number(brl.priceChangePercent),
        variacao: Number(brl.priceChange),
        par: pares.brl,
        via: 'BRL',
        closeTime: brl.closeTime,
    } : null;

    if (viaBrl && viaUsdt) {
        var desvio = Math.abs(viaBrl.preco / viaUsdt.preco - 1);
        if (desvio <= DIVERGENCIA_MAX_BRL) {
            viaBrl.nome = 'Cotação Binance, par ' + viaBrl.par;
            return viaBrl;
        }
        viaUsdt.nome = 'Cotação Binance, ' + viaUsdt.par + ' convertido por USDTBRL (o par ' + viaBrl.par +
            ' está ' + fmt0(desvio * 100) + '% fora do mercado)';
        return viaUsdt;
    }
    if (viaUsdt) {
        viaUsdt.nome = 'Cotação Binance, ' + viaUsdt.par + ' convertido por USDTBRL' +
            (pares.brl ? ' (o par ' + pares.brl + ' está sem negócios)' : ' (sem par em reais)');
        return viaUsdt;
    }
    if (viaBrl) {
        viaBrl.nome = 'Cotação Binance, par ' + viaBrl.par;
        return viaBrl;
    }
    return null;
}

function buscarCotacoesCripto(tickers) {
    var resultado = {};
    var pendentes = [];
    tickers.forEach(function (t) {
        var c = getCachedQuote(chaveCotacaoCripto(t)); // [CRIPTO v1.1]
        if (c) resultado[t] = c;
        else pendentes.push(t);
    });
    if (!pendentes.length) return Promise.resolve(resultado);

    var tokens = [];
    pendentes.forEach(function (t) {
        var tk = tokenCripto(t);
        if (tk && tokens.indexOf(tk) === -1) tokens.push(tk);
    });

    return resolverParesCripto(tokens).then(function (pares) {
        // [CRIPTO v1.2] pede os DOIS pares de cada token (BRL e USDT) + o
        // USDTBRL, numa chamada só, pra poder comparar antes de escolher
        var simbolos = ['USDTBRL'];
        pendentes.forEach(function (t) {
            var r = pares[tokenCripto(t)];
            if (!r) return;
            [r.brl, r.usdt].forEach(function (sym) {
                if (sym && simbolos.indexOf(sym) === -1) simbolos.push(sym);
            });
        });
        if (simbolos.length === 1 && pendentes.every(function (t) { return tokenCripto(t) !== 'USDT'; })) {
            return resultado; // nenhum token com par conhecido
        }

        var caminho = '/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(simbolos));
        return binanceGet(caminho).then(function (dados) {
            var porSimbolo = {};
            (dados || []).forEach(function (d) { porSimbolo[d.symbol] = d; });

            pendentes.forEach(function (t) {
                var r = pares[tokenCripto(t)];
                if (!r) return;
                var e = escolherCotacaoCripto(r, porSimbolo);
                if (!e || !(e.preco > 0)) return;

                var cotacao = {
                    symbol: t,
                    nome: e.nome,
                    moeda: 'BRL',
                    precoAtual: e.preco,
                    variacao: e.variacao,
                    variacaoPercentual: e.variacaoPct,
                    atualizadoEm: e.closeTime || null,
                    logoUrl: null,
                    fonte: 'binance',
                    janelaVariacao: '24h',
                    par: e.par,
                    via: e.via,
                };
                setCachedQuote(chaveCotacaoCripto(t), cotacao);
                resultado[t] = cotacao;
            });
            return resultado;
        });
    }).catch(function (erro) {
        // 400 aqui quase sempre é par que sumiu da Binance (o cache de pares
        // ficou velho): joga o cache fora pra redescobrir na próxima vez
        if (erro && erro.status === 400) armazem.remove(PARES_CACHE_KEY);
        return resultado;
    });
}

// Candles diários dos últimos 30 dias, no formato que o gráfico já usa:
// [{ date: segundos UNIX, close: preço em R$ }], em ordem cronológica.
// [CRIPTO v1.2] usa o MESMO caminho que a cotação escolheu (se a cotação
// saiu via USDT porque o par BRL está parado, o gráfico também sai via USDT).
function buscarHistoricoCripto(ticker) {
    var chave = 'CRIPTO:v2:' + ticker + ':30d';
    var cached = getCachedHistorico(chave);
    if (cached) return Promise.resolve(cached);

    var token = tokenCripto(ticker);
    return Promise.all([resolverParesCripto([token]), buscarCotacoesCripto([ticker])]).then(function (res) {
        var r = res[0][token];
        var cot = res[1][ticker];
        if (!r) return [];

        var par, viaUsdt;
        if (cot && cot.par) {
            par = cot.par;
            viaUsdt = cot.via === 'USDT';
        } else if (r.usdt) {
            par = r.usdt;
            viaUsdt = true;
        } else if (r.brl) {
            par = r.brl;
            viaUsdt = false;
        } else {
            return [];
        }

        var base = '/api/v3/klines?interval=1d&limit=30&symbol=';
        var pedidos = [binanceGet(base + par)];
        if (viaUsdt) pedidos.push(binanceGet(base + 'USDTBRL'));

        return Promise.all(pedidos).then(function (k) {
            // kline = [abertura(ms), open, high, low, close, ...]
            var dolarPorDia = {};
            if (k[1]) k[1].forEach(function (c) { dolarPorDia[c[0]] = Number(c[4]); });

            var pontos = (k[0] || []).map(function (c) {
                var close = Number(c[4]);
                if (viaUsdt) {
                    var taxa = dolarPorDia[c[0]];
                    if (!taxa) return null;
                    close = close * taxa;
                }
                return { date: Math.floor(c[0] / 1000), close: close };
            }).filter(Boolean);

            setCachedHistorico(chave, pontos);
            return pontos;
        });
    }).catch(function () {
        return [];
    });
}

// [CRIPTO v1] PORTA DE ENTRADA ÚNICA de cotação. Separa os tickers pela
// classe do ativo: CRIPTO vai pra Binance, renda fixa não busca nada
// ([RF-OFF]), o resto (ação, FII, ticker ainda desconhecido) vai pra brapi.
// As telas chamam só esta função, nunca as específicas.
function buscarCotacoes(symbols) {
    var cripto = [];
    var b3 = [];
    symbols.forEach(function (s) {
        var ativo = buscarAtivoPorTicker(s);
        if (ativo && ativo.classe === 'CRIPTO') cripto.push(s);
        else if (ativo && ativo.classe === 'RENDA_FIXA') { /* sem fonte */ }
        else b3.push(s);
    });

    return Promise.all([
        b3.length ? buscarCotacoesBrapi(b3) : Promise.resolve({}),
        cripto.length ? buscarCotacoesCripto(cripto) : Promise.resolve({}),
    ]).then(function (r) {
        return Object.assign({}, r[0], r[1]);
    });
}

// [CRIPTO v1] mesmo papel, pro gráfico da página do ativo
function buscarHistoricoDoAtivo(ticker) {
    var ativo = buscarAtivoPorTicker(ticker);
    if (ativo && ativo.classe === 'CRIPTO') return buscarHistoricoCripto(ticker);
    return buscarHistorico(ticker, '1mo', '1d');
}

/* =================================================================
   PREÇOS MENSAIS HISTÓRICOS [RENT v2 · 11/10/2026]
   Usados por patrimonioNaData() para reconstruir o valor de mercado
   da carteira no último dia de cada mês fechado.

   Plano free brapi: interval=1d apenas; 90 dias por chunk via startDate/endDate.
   [HIST v1] Closes mensais acumulados em STOCK_HIST_KEY (localStorage).
   ================================================================= */

// [HIST v1] buscarPrecosMensaisB3 — usa startDate/endDate em chunks de 90 dias (plano free brapi).
// dataInicio: 'YYYY-MM-DD' do primeiro lançamento do ticker (opcional; default = 1 ano atrás).
// Acumula fechamentos mensais em STOCK_HIST_KEY; meses fechados nunca são sobrescritos,
// exceto o mês anterior (mesPrev) que pode ser atualizado para corrigir closes mid-month.
// [FIX race] recarrega hist antes de salvar — evita race condition quando múltiplos tickers
// são buscados em paralelo (Promise.all) e cada chamada capturava o hist vazio do início.
function buscarPrecosMensaisB3(ticker, dataInicio) {
    var mapaInicio = (loadStockHist()[ticker]) || {};
    var hoje  = hojeISO();
    var mesAtual = hoje.slice(0, 7);
    var mesPrev  = _mesAnterior(mesAtual);

    if (!dataInicio) {
        var d1a = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        dataInicio = d1a.toISOString().slice(0, 10);
    }

    var primMesNec   = dataInicio.slice(0, 7);
    var mesesCobr    = Object.keys(mapaInicio).sort();
    var priMesCobr   = mesesCobr[0] || null;
    var coberto      = priMesCobr && priMesCobr <= primMesNec && mapaInicio[mesAtual] && mapaInicio[mesPrev];
    if (coberto) return Promise.resolve(mapaInicio);

    // Define fetchInicio: se histórico já cobre desde dataInicio, só atualiza últimos 90 dias
    var fetchInicio = dataInicio;
    if (priMesCobr && priMesCobr <= primMesNec && !mapaInicio[mesAtual]) {
        var d90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        fetchInicio = d90.toISOString().slice(0, 10);
    }
    var chunks = gerarChunks(fetchInicio, hoje);

    return _fetchChunksB3(encodeURIComponent(ticker), chunks, mapaInicio, mesAtual, mesPrev).then(function () {
        // [FIX race] recarrega hist fresco para não sobrescrever tickers salvos por outras chamadas paralelas
        var histAtual = loadStockHist();
        histAtual[ticker] = mapaInicio;
        saveStockHist(histAtual);
        return mapaInicio;
    });
}

// Cripto: Binance klines mensais (interval=1M, limit=25). Mesmo mecanismo
// de par BRL/USDT×USDTBRL de buscarHistoricoCripto, mas granularidade mensal.
// [HIST v1] dataInicio: 'YYYY-MM-DD' do primeiro lançamento desse ticker (calcula limit dinamicamente).
function buscarPrecosMensaisCripto(ticker, dataInicio) {
    var token = tokenCripto(ticker);
    return resolverParesCripto([token]).then(function (pares) {
        var r = pares[token];
        if (!r) return {};

        var parBrl  = r.brl  || null;
        var parUsdt = r.usdt || null;
        if (!parBrl && !parUsdt) return {};

        var limit = 25;
        if (dataInicio) {
            var msDesde = Date.now() - new Date(dataInicio + 'T12:00:00Z').getTime();
            var mesesDesde = Math.ceil(msDesde / (30 * 24 * 60 * 60 * 1000));
            limit = Math.min(1000, mesesDesde + 6);
        }

        var base = '/api/v3/klines?interval=1M&limit=' + limit + '&symbol=';

        // [CRIPTO v1.3] USDTBRL sempre buscado de forma independente — não depende
        // de USDT estar na carteira. Necessário para o fallback de pares BRL mortos
        // (ex.: ENABRL deslistado em mar/2026, ATOMBRL morto desde 2023).
        var pedidos = [
            parBrl  ? binanceGet(base + parBrl)  : Promise.resolve(null),
            parUsdt ? binanceGet(base + parUsdt) : Promise.resolve(null),
            binanceGet(base + 'USDTBRL')
        ];

        return Promise.all(pedidos).then(function (k) {
            var klinesBrl     = k[0] || [];
            var klinesUsdt    = k[1] || [];
            var klinesUsdtBrl = k[2] || [];

            // Mapa USDTBRL por mês (sempre disponível via fetch independente)
            var dolarPorMes = {};
            klinesUsdtBrl.forEach(function (c) {
                var am = new Date(c[0]).toISOString().slice(0, 7);
                dolarPorMes[am] = Number(c[4]);
            });

            // Mapa BRL direto
            var mapaBrl = {};
            klinesBrl.forEach(function (c) {
                var am = new Date(c[0]).toISOString().slice(0, 7);
                var close = Number(c[4]);
                if (am && close > 0) mapaBrl[am] = close;
            });

            // Par BRL está vivo se tem dados do mês atual ou do mês anterior.
            // Par que existe no ticker list mas não tem negócios recentes (ex.: ENABRL)
            // retorna klines desatualizados — detectar e fazer fallback para USDT.
            var mesAtualCripto = new Date().toISOString().slice(0, 7);
            var mesPrevCripto  = _mesAnterior(mesAtualCripto);
            var brlVivo = parBrl && (mapaBrl[mesAtualCripto] || mapaBrl[mesPrevCripto]);

            // Par BRL vivo: usar diretamente
            if (brlVivo) return mapaBrl;

            // Fallback USDT × USDTBRL (independente de USDT estar na carteira)
            if (parUsdt) {
                var mapaUsdt = {};
                klinesUsdt.forEach(function (c) {
                    var am = new Date(c[0]).toISOString().slice(0, 7);
                    var close = Number(c[4]);
                    var taxa = dolarPorMes[am];
                    if (!taxa || !am || !(close > 0)) return;
                    mapaUsdt[am] = close * taxa;
                });
                return mapaUsdt;
            }

            // Par BRL morto e sem USDT disponível: retornar o que tiver de BRL
            return mapaBrl;
        });
    }).catch(function () { return {}; });
}

// [CONV v1] Busca o preço do token de origem na data da conversão (em BRL via USDT×USDTBRL).
// Hoje/futuro: ticker/price ao vivo; passado: klines diários para o dia exato.
function buscarPrecoConversaoNaData(ticker, dataISO, cb) {
    var token = tokenCripto(ticker);
    if (!token) { cb(null); return; }
    var hoje = hojeISO();
    if (dataISO >= hoje) {
        binanceGet('/api/v3/ticker/price').then(function (lista) {
            var porSimbolo = {};
            (lista || []).forEach(function (p) { porSimbolo[p.symbol] = Number(p.price); });
            var usdtBrl = porSimbolo['USDTBRL'] || 0;
            var precoUsdt = porSimbolo[token + 'USDT'] || 0;
            if (precoUsdt > 0 && usdtBrl > 0) { cb(precoUsdt * usdtBrl); return; }
            var precoBrl = porSimbolo[token + 'BRL'] || 0;
            cb(precoBrl > 0 ? precoBrl : null);
        }).catch(function () { cb(null); });
        return;
    }
    var startMs = new Date(dataISO + 'T12:00:00Z').getTime();
    var endMs = startMs + 86400000;
    var limQ = '&interval=1d&startTime=' + startMs + '&endTime=' + endMs + '&limit=1';
    Promise.all([
        binanceGet('/api/v3/klines?symbol=USDTBRL' + limQ),
        binanceGet('/api/v3/klines?symbol=' + token + 'USDT' + limQ),
    ]).then(function (k) {
        var closeUsdtBrl = k[0] && k[0][0] ? parseFloat(k[0][0][4]) : 0;
        var closeUsdt    = k[1] && k[1][0] ? parseFloat(k[1][0][4]) : 0;
        cb(closeUsdtBrl > 0 && closeUsdt > 0 ? closeUsdt * closeUsdtBrl : null);
    }).catch(function () { cb(null); });
}

// Roteador: decide a fonte pelo campo classe do ativo. dataInicio: 'YYYY-MM-DD' do primeiro lançamento.
function buscarPrecosMensais(ticker, classe, dataInicio) {
    if (classe === 'CRIPTO') return buscarPrecosMensaisCripto(ticker, dataInicio);
    if (classe === 'RENDA_FIXA') return Promise.resolve({});
    return buscarPrecosMensaisB3(ticker, dataInicio);
}

// [HIST v1] IBOV mensal acumulado localmente via chunks de 90 dias (mesma estratégia que B3).
function loadIBOVHist() {
    try { var r = armazem.get(IBOV_HIST_KEY); return r ? JSON.parse(r) : {}; } catch (e) { return {}; }
}
function saveIBOVHist(mapa) {
    try { armazem.set(IBOV_HIST_KEY, JSON.stringify(mapa)); } catch (e) {}
}
function loadIfixHist() {
    try { var r = armazem.get(IFIX_HIST_KEY); return r ? JSON.parse(r) : {}; } catch (e) { return {}; }
}
function saveIfixHist(mapa) {
    try { armazem.set(IFIX_HIST_KEY, JSON.stringify(mapa)); } catch (e) {}
}
function loadStockHist() {
    try { var r = armazem.get(STOCK_HIST_KEY); return r ? JSON.parse(r) : {}; } catch (e) { return {}; }
}
function saveStockHist(mapa) {
    try { armazem.set(STOCK_HIST_KEY, JSON.stringify(mapa)); } catch (e) {}
}
// [FECH v1] snapshot de cotações usadas em cada fechamento mensal { "YYYY-MM": { "TICKER": price, "IBOV": price } }
function loadCotacoesFechamento() {
    try { var r = armazem.get(FECHAMENTOS_KEY); return r ? JSON.parse(r) : {}; } catch (e) { return {}; }
}
function saveCotacoesFechamento(mapa) {
    try { armazem.set(FECHAMENTOS_KEY, JSON.stringify(mapa)); } catch (e) {}
}
function loadUsdBrlHist() {
    try { var r = armazem.get(USDBRL_HIST_KEY); return r ? JSON.parse(r) : {}; } catch (e) { return {}; }
}
function saveUsdBrlHist(mapa) {
    try { armazem.set(USDBRL_HIST_KEY, JSON.stringify(mapa)); } catch (e) {}
}

// Divide [dataInicio, dataFim] em janelas de até 90 dias (limite do plano free brapi).
// Retorna array de { s: 'YYYY-MM-DD', e: 'YYYY-MM-DD' }.
function gerarChunks(dataInicio, dataFim) {
    var chunks = [];
    var cur = new Date(dataInicio + 'T12:00:00Z');
    var fim = new Date(dataFim   + 'T12:00:00Z');
    while (cur < fim) {
        var prox = new Date(cur.getTime() + 90 * 24 * 60 * 60 * 1000);
        if (prox > fim) prox = new Date(fim);
        chunks.push({ s: cur.toISOString().slice(0, 10), e: prox.toISOString().slice(0, 10) });
        cur = prox;
    }
    return chunks;
}

// Agrega lista de candles diários (ordem DECRESCENTE — mais recente primeiro) em fechamentos mensais.
// Para cada mês: primeiro candle encontrado = fechamento do último pregão daquele mês = close correto.
// Meses fechados já no mapa nunca são sobrescritos; mês corrente sempre atualiza.
// mesPrev: mês anterior a mesAtual — também pode ser atualizado (captura o fechamento
// real do mês que acabou de fechar, corrigindo valores gravados mid-month).
function _agregarMensalDescendente(lista, mapa, mesAtual, mesPrev) {
    var vistos = {};
    lista.forEach(function (p) {
        var am = normalizarDataBrapi(p.date);
        if (!am || !p.close || vistos[am]) return;
        vistos[am] = true;
        if (am === mesAtual || am === mesPrev || !mapa[am]) mapa[am] = p.close;
    });
}

// Busca chunks via brapiFetch (fila serial) e mescla em mapa.
// sym: símbolo brapi (pode ser encodeURIComponent ou já encoded, ex: '%5EBVSP').
// mesPrev: permite sobrescrever o mês anterior (corrige closes mid-month gravados no mês corrente).
function _fetchChunksB3(sym, chunks, mapa, mesAtual, mesPrev) {
    var cadeia = Promise.resolve();
    chunks.forEach(function (chunk) {
        cadeia = cadeia.then(function () {
            var url = BRAPI_HISTORICAL_URL
                + '?symbols=' + sym
                + '&startDate=' + chunk.s
                + '&endDate='   + chunk.e
                + '&interval=1d&token=' + BRAPI_TOKEN;
            return brapiFetch(url, { headers: { Authorization: 'Bearer ' + BRAPI_TOKEN } })
                .then(function (resp) { return resp && resp.ok ? resp.json() : null; })
                .then(function (payload) {
                    if (!payload || payload.error) return;
                    var item = (payload.results || [])[0];
                    var lista = (item && item.data && item.data.historicalDataPrice) || [];
                    _agregarMensalDescendente(lista, mapa, mesAtual, mesPrev);
                })
                .catch(function () {});
        });
    });
    return cadeia;
}

// [HIST v1] buscarPrecosMensaisIBOV — mesma arquitetura de chunks que B3.
// dataInicio: 'YYYY-MM-DD' do lançamento mais antigo de qualquer ativo de bolsa do usuário.
// mesPrev incluído para corrigir closes mid-month gravados quando setembro era mesAtual.
function buscarPrecosMensaisIBOV(dataInicio) {
    var hist     = loadIBOVHist();
    var hoje     = hojeISO();
    var mesAtual = hoje.slice(0, 7);
    var mesPrev  = _mesAnterior(mesAtual);

    if (!dataInicio) {
        var d1a = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        dataInicio = d1a.toISOString().slice(0, 10);
    }

    var primMesNec = dataInicio.slice(0, 7);
    // _mesPrevOk: guarda em que mesAtual o mesPrev foi corrigido com o fechamento real.
    // Se não confirmado para o mês atual, força fetch de 90 dias para corrigir mesPrev
    // (caso tenha sido gravado mid-month quando ainda era mesAtual).
    var mesPrevOk  = hist['_mesPrevOk'] || null;
    var mesesCobr  = Object.keys(hist).filter(function(k) { return k[0] !== '_'; }).sort();
    var priMesCobr = mesesCobr[0] || null;
    var coberto    = priMesCobr && priMesCobr <= primMesNec && hist[mesAtual] && mesPrevOk === mesAtual;

    if (coberto) {
        _ibovMapaCache = hist;
        return Promise.resolve(hist);
    }

    var fetchInicio = dataInicio;
    if (priMesCobr && priMesCobr <= primMesNec && !hist[mesAtual]) {
        // mesAtual ausente: só precisa dos últimos 90 dias
        var d90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        fetchInicio = d90.toISOString().slice(0, 10);
    } else if (priMesCobr && priMesCobr <= primMesNec && mesPrevOk !== mesAtual) {
        // mesAtual presente mas mesPrev não confirmado: 90 dias para corrigir mesPrev
        var d90b = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        fetchInicio = d90b.toISOString().slice(0, 10);
    }
    var chunks = gerarChunks(fetchInicio, hoje);

    return _fetchChunksB3('%5EBVSP', chunks, hist, mesAtual, mesPrev).then(function () {
        hist['_mesPrevOk'] = mesAtual; // confirma que mesPrev foi atualizado neste mês
        if (Object.keys(hist).length) saveIBOVHist(hist);
        _ibovMapaCache = hist;
        return hist;
    }).catch(function () {
        _ibovMapaCache = hist;
        return hist;
    });
}

// [IFIX v1] buscarPrecosMensaisIFIX — mesma arquitetura de chunks que IBOV.
// Usa XFIX11 (ETF B3 que replica o IFIX) pois a brapi não expõe ^IFIX como índice.
// Sempre buscado — serve como referência comparativa independente da composição da carteira.
function buscarPrecosMensaisIFIX(dataInicio) {
    var hist     = loadIfixHist();
    var hoje     = hojeISO();
    var mesAtual = hoje.slice(0, 7);
    var mesPrev  = _mesAnterior(mesAtual);

    if (!dataInicio) {
        var d1a = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        dataInicio = d1a.toISOString().slice(0, 10);
    }

    var primMesNec = dataInicio.slice(0, 7);
    var mesPrevOk  = hist['_mesPrevOk'] || null;
    var mesesCobr  = Object.keys(hist).filter(function(k) { return k[0] !== '_'; }).sort();
    var priMesCobr = mesesCobr[0] || null;
    var coberto    = priMesCobr && priMesCobr <= primMesNec && hist[mesAtual] && mesPrevOk === mesAtual;

    if (coberto) {
        _ifixMapaCache = hist;
        return Promise.resolve(hist);
    }

    var fetchInicio = dataInicio;
    if (priMesCobr && priMesCobr <= primMesNec && !hist[mesAtual]) {
        var d90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        fetchInicio = d90.toISOString().slice(0, 10);
    } else if (priMesCobr && priMesCobr <= primMesNec && mesPrevOk !== mesAtual) {
        var d90b = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        fetchInicio = d90b.toISOString().slice(0, 10);
    }
    var chunks = gerarChunks(fetchInicio, hoje);

    return _fetchChunksB3('XFIX11', chunks, hist, mesAtual, mesPrev).then(function () {
        hist['_mesPrevOk'] = mesAtual;
        if (Object.keys(hist).length) saveIfixHist(hist);
        _ifixMapaCache = hist;
        return hist;
    }).catch(function () {
        _ifixMapaCache = hist;
        return hist;
    });
}

// [USDBRL v1] Histórico mensal USD-BRL via BCB SGS série 1 (mesmo provedor do CDI).
// API pública, sem token. Retorna o fechamento do último dia útil de cada mês.
// Meses fechados não sobrescritos; mês corrente sempre atualiza.
function buscarUsdBrlMensal(dataInicio) {
    var hist    = loadUsdBrlHist();
    var hoje    = hojeISO();
    var mesAtual = hoje.slice(0, 7);

    if (!dataInicio) {
        dataInicio = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }

    var primMesNec = dataInicio.slice(0, 7);
    var mesesCobr  = Object.keys(hist).sort();
    var coberto    = mesesCobr.length && mesesCobr[0] <= primMesNec && hist[mesAtual];

    if (coberto) return Promise.resolve(hist);

    // Formata YYYY-MM-DD → DD/MM/YYYY (padrão BCB)
    function fmtBCB(iso) {
        var p = iso.split('-');
        return p[2] + '/' + p[1] + '/' + p[0];
    }

    var fetchInicio = dataInicio;
    if (mesesCobr.length && mesesCobr[0] <= primMesNec && !hist[mesAtual]) {
        // histórico completo, só falta o mês corrente
        fetchInicio = mesAtual + '-01';
    }

    var url = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados?formato=json' +
              '&dataInicial=' + fmtBCB(fetchInicio) + '&dataFinal=' + fmtBCB(hoje);

    return fetch(url)
        .then(function (resp) { return resp.ok ? resp.json() : []; })
        .then(function (lista) {
            if (!Array.isArray(lista)) return hist;
            // BCB retorna em ordem crescente — constrói mapa acumulando (último por mês ganha)
            var mapaFetch = {};
            lista.forEach(function (e) {
                var p  = e.data.split('/');    // ["DD","MM","YYYY"]
                var am = p[2] + '-' + p[1];   // "YYYY-MM"
                var v  = parseFloat(e.valor);
                if (am && v) mapaFetch[am] = v; // último valor do mês sobrescreve = fechamento
            });
            var mesPrev = _mesAnterior(mesAtual);
            Object.keys(mapaFetch).forEach(function (am) {
                // mês corrente e mesPrev: sempre atualiza (corrige mid-month)
                // meses fechados já gravados: imutáveis
                if (am === mesAtual || am === mesPrev || !hist[am]) hist[am] = mapaFetch[am];
            });
            if (Object.keys(hist).length) saveUsdBrlHist(hist);
            return hist;
        })
        .catch(function () { return hist; });
}

// Caches de sessão: preços mensais IBOV e IFIX { "YYYY-MM": price }
// Gravados pelas funções buscarPrecosMensaisIBOV/IFIX acima.
var _ibovMapaCache = null;
var _ifixMapaCache = null;

/* =================================================================
   CDI  [CDI v1 · 11/10/2026]
   ================================================================= */

// Retorna cache CDI do dia ou null se não existir / expirado
function cdiCacheHoje() {
    try {
        var raw = armazem.get(CDI_CACHE_KEY);
        if (!raw) return null;
        var c = JSON.parse(raw);
        if (c && c.data === hojeISO()) return c;
    } catch (e) {}
    return null;
}

// Busca CDI diário mais recente no BCB (série SGS 12 — CDI over).
// Cache diário: uma requisição por dispositivo por dia.
// Retorna Promise<{ cdiDiario, cdiMesEst, data, fallback? }>
function buscarCDI() {
    var cache = cdiCacheHoje();
    if (cache) return Promise.resolve(cache);

    return fetch(BCB_CDI_LATEST_URL).then(function (r) {
        if (!r.ok) throw new Error('BCB ' + r.status);
        return r.json();
    }).then(function (json) {
        // retorno: [{ "data": "11/10/2026", "valor": "0.052900" }]
        var item = Array.isArray(json) && json[0];
        var cdiDiario = item ? Number(item.valor) : null;
        if (!cdiDiario) throw new Error('CDI sem valor');
        var cdiMesEst = (Math.pow(1 + cdiDiario / 100, 22) - 1) * 100;
        var obj = { data: hojeISO(), cdiDiario: cdiDiario, cdiMesEst: cdiMesEst };
        try { armazem.set(CDI_CACHE_KEY, JSON.stringify(obj)); } catch (e) {}
        return obj;
    }).catch(function () {
        // BCB indisponível: calcula a partir da última taxa salva em cache (ignora data),
        // ou usa referência interna baseada na Selic vigente.
        var ultimoCache = (function () {
            try { return JSON.parse(armazem.get(CDI_CACHE_KEY) || 'null'); } catch (e) { return null; }
        })();
        if (ultimoCache && ultimoCache.cdiDiario) {
            var cdiMesEst = (Math.pow(1 + ultimoCache.cdiDiario / 100, 22) - 1) * 100;
            return { data: hojeISO(), cdiDiario: ultimoCache.cdiDiario, cdiMesEst: cdiMesEst, fallback: true };
        }
        // Sem cache algum: Selic 10,65% a.a. → CDI diário ≈ 0,0402% (base out/2026)
        var ref = 0.0402;
        var cdiMesEst = (Math.pow(1 + ref / 100, 22) - 1) * 100;
        return { data: hojeISO(), cdiDiario: ref, cdiMesEst: cdiMesEst, fallback: true };
    });
}

// Busca CDI acumulado de um período via BCB SGS 12.
// BCB aceita datas no formato DD/MM/YYYY.
// dataInicioISO (opcional): 'YYYY-MM-DD' — quando fornecido, pro-rata desde essa data
// em vez do dia 1 do mês (usado no primeiroMes para refletir só os dias com carteira ativa).
// Retorna Promise<number|null> — percentual acumulado (ex: 0.8469)
function buscarCDIMesFechado(anoMes, dataInicioISO) {
    var partes = anoMes.split('-');
    var ano = parseInt(partes[0], 10);
    var mes = parseInt(partes[1], 10);
    var ultimoDia = new Date(ano, mes, 0).getDate();
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var dataIni;
    if (dataInicioISO) {
        // primeiroMes: CDI apenas a partir da data do primeiro lançamento
        var p = dataInicioISO.split('-');
        dataIni = p[2] + '/' + p[1] + '/' + p[0];
    } else {
        dataIni = '01/' + pad(mes) + '/' + ano;
    }
    var dataFim = pad(ultimoDia) + '/' + pad(mes) + '/' + ano;
    var url = BCB_CDI_PERIODO_URL + '&dataInicial=' + dataIni + '&dataFinal=' + dataFim;
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (json) {
        if (!Array.isArray(json) || !json.length) return null;
        // compõe taxa acumulada: ∏ (1 + taxa_diaria/100)
        var acum = json.reduce(function (prod, o) {
            return prod * (1 + Number(o.valor) / 100);
        }, 1);
        return (acum - 1) * 100;
    }).catch(function () { return null; });
}

/* =================================================================
   INDICADORES DA BOLSAI  [INDIC v1 · 28/09/2026]
   ================================================================= */

// Enriquecimento da página de detalhe de ativos de bolsa com dados da
// bolsai (usebolsai.com), plano GRATUITO. Testado pelo Junior em 28/09:
// a chave funciona chamando direto do navegador (CORS liberado), mas
// proventos (/dividends) e distribuições de FII exigem o plano Pro (403).
// O que o gratuito libera e usamos aqui:
//   FII   -> GET /fiis/{ticker}             P/VP, DY 12m, VP/cota, vacância,
//                                           inadimplência, cotistas, PL...
//   AÇÃO  -> GET /fundamentals/{ticker}     P/L, P/VP, ROE, margens, dívida
//            GET /stocks/{ticker}/stats     mín/máx 52 semanas, retorno no ano
//   BDR   -> GET /stocks/{ticker}/stats     (empresa estrangeira não entrega
//                                           balanço à CVM: sem fundamentos)
// Nada disso é em lote: 1 chamada por ticker (2 pra ação).
//
// ECONOMIA DE CHAMADAS (limite de 200/dia, zera à meia-noite UTC = 21h de
// Brasília): só busca quando a pessoa ABRE a página do ativo, e guarda a
// resposta até virar o dia UTC. Abriu o GGRC11 dez vezes no dia = 1 chamada.
// Respostas "não existe" (404) também ficam guardadas no dia, pra não
// insistir. Se vier 429 (limite estourado), pausa a bolsai até o reset.
// Erro de rede NÃO é guardado (tenta de novo na próxima abertura).
//
// CHAVE: fica no código como a da brapi, só pra uso local. Se rotacionar no
// dashboard da bolsai, troque o valor abaixo.
// Django: portar como market_data_bolsai.py, com o mesmo cache diário
// (cache do Django com timeout até a meia-noite UTC).

// [INDIC v1.2 · 28/09/2026] DESLIGADO POR ENQUANTO (decisão do Junior).
// O navegador não conseguiu falar com a bolsai abrindo o arquivo do disco
// (bloqueio de origem/CORS). Enquanto não decidirmos o caminho (servidor
// local, Worker intermediário ou só no Django), a página do ativo NÃO
// busca nem mostra indicadores: nenhuma chamada é feita. Todo o código
// continua aqui, pronto. Pra religar: INDICADORES_LIGADOS = true.
var INDICADORES_LIGADOS = false;

var BOLSAI_KEY = 'sk_ceeb263e72e26b6a58a54ce3b439679c58258aa9f2d166ee';
var BOLSAI_BASE = 'https://api.usebolsai.com/api/v1';
var BOLSAI_CACHE_KEY = 'DASH_FINANCE_BOLSAI_CACHE_V1';

function diaUTC() {
    return new Date().toISOString().slice(0, 10);
}

function lerCacheBolsai() {
    try {
        var raw = armazem.get(BOLSAI_CACHE_KEY);
        var c = raw ? JSON.parse(raw) : {};
        // cache de outro dia UTC não serve pra nada: começa limpo
        if (c.dia !== diaUTC()) c = { dia: diaUTC(), itens: {}, pausada: false };
        return c;
    } catch (e) {
        return { dia: diaUTC(), itens: {}, pausada: false };
    }
}

function salvarCacheBolsai(c) {
    try { armazem.set(BOLSAI_CACHE_KEY, JSON.stringify(c)); } catch (e) { /* segue sem cache */ }
}

// Resolve { ok: true, dados } | { ok: false, motivo } e cuida do cache.
function bolsaiGet(caminho) {
    var cache = lerCacheBolsai();
    if (Object.prototype.hasOwnProperty.call(cache.itens, caminho)) {
        return Promise.resolve(cache.itens[caminho]);
    }
    if (cache.pausada) {
        return Promise.resolve({ ok: false, motivo: 'limite' });
    }

    // [INDIC v1.1 · 28/09/2026] DUAS FORMAS DE CHAMAR
    // 1ª versão só mandava a chave no cabeçalho X-API-Key. Cabeçalho
    // customizado obriga o navegador a fazer uma checagem prévia (preflight
    // CORS), e no teste do Junior abrindo o arquivo direto do disco a
    // chamada foi barrada. Agora, se a forma com cabeçalho falhar na rede,
    // tenta a chave como parâmetro na URL (?api_key=), que a própria bolsai
    // aceita no /keys/usage e evita o preflight. A forma que funcionar fica
    // lembrada no cache do dia. Se as duas falharem, o motivo vira 'cors'.
    var cacheModo = lerCacheBolsai().modo;
    var tentativas = cacheModo === 'query' ? ['query'] : ['header', 'query'];

    function chamar(i) {
        var modo = tentativas[i];
        var url = BOLSAI_BASE + caminho;
        var opcoes = {};
        if (modo === 'header') opcoes.headers = { 'X-API-Key': BOLSAI_KEY };
        else url += (url.indexOf('?') === -1 ? '?' : '&') + 'api_key=' + encodeURIComponent(BOLSAI_KEY);

        return fetch(url, opcoes).then(function (resp) {
            if (modo === 'query' && cacheModo !== 'query') {
                var cm = lerCacheBolsai();
                cm.modo = 'query';
                salvarCacheBolsai(cm);
            }
            return resp;
        }, function (erro) {
            if (i + 1 < tentativas.length) return chamar(i + 1);
            erro.bloqueio = true;
            throw erro;
        });
    }

    return chamar(0).then(function (resp) {
        var c = lerCacheBolsai();
        if (resp.status === 429) {
            c.pausada = true;
            salvarCacheBolsai(c);
            return { ok: false, motivo: 'limite' };
        }
        if (resp.status === 404) {
            c.itens[caminho] = { ok: false, motivo: 'sem-dados' };
            salvarCacheBolsai(c);
            return c.itens[caminho];
        }
        if (resp.status === 403) {
            c.itens[caminho] = { ok: false, motivo: 'plano' };
            salvarCacheBolsai(c);
            return c.itens[caminho];
        }
        if (resp.status === 401) {
            return { ok: false, motivo: 'chave' };
        }
        if (!resp.ok) {
            return { ok: false, motivo: 'erro' };
        }
        return resp.json().then(function (dados) {
            var c2 = lerCacheBolsai();
            c2.itens[caminho] = { ok: true, dados: dados };
            salvarCacheBolsai(c2);
            return c2.itens[caminho];
        });
    }).catch(function (erro) {
        // fetch rejeitado nas duas formas: sem internet ou CORS (o navegador
        // não diz qual; se navigator.onLine é true, quase sempre é CORS)
        var offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        return { ok: false, motivo: offline ? 'rede' : 'cors' };
    });
}

// Decide o tipo pelo ativo cadastrado; se a pessoa chegou pelo ranking e
// não tem o ativo, deduz pelo ticker (final 11 costuma ser FII, mas unit
// de ação também termina em 11: aí tenta FII e, se não achar, ação).
function tipoIndicador(ticker) {
    var ativo = buscarAtivoPorTicker(ticker);
    if (ativo) {
        if (ativo.classe === 'FII') return 'FII';
        if (ativo.classe === 'BDR') return 'BDR';
        if (ativo.classe === 'ACAO') return 'ACAO';
        return null; // ETF, cripto e renda fixa: fora da bolsai
    }
    if (/11$/.test(ticker)) return 'FII?';
    if (/3[2-5]$|39$/.test(ticker)) return 'BDR';
    return 'ACAO';
}

function buscarIndicadores(ticker) {
    if (!INDICADORES_LIGADOS) return Promise.resolve(null); // [INDIC v1.2]
    var tipo = tipoIndicador(ticker);
    var t = encodeURIComponent(ticker);

    if (!tipo) return Promise.resolve(null);

    if (tipo === 'FII' || tipo === 'FII?') {
        return bolsaiGet('/fiis/' + t).then(function (r) {
            if (r.ok || tipo === 'FII') return { tipo: 'FII', fii: r };
            return buscarIndicadoresAcao(t); // era unit de ação
        });
    }
    if (tipo === 'BDR') {
        return bolsaiGet('/stocks/' + t + '/stats').then(function (r) {
            return { tipo: 'BDR', stats: r };
        });
    }
    return buscarIndicadoresAcao(t);
}

function buscarIndicadoresAcao(t) {
    return Promise.all([
        bolsaiGet('/fundamentals/' + t),
        bolsaiGet('/stocks/' + t + '/stats'),
    ]).then(function (r) {
        return { tipo: 'ACAO', fund: r[0], stats: r[1] };
    });
}

// --- formatação dos indicadores ---
function numOk(v) {
    return v !== null && v !== undefined && v !== '' && isFinite(Number(v));
}
function indPct(v) { return numOk(v) ? fmt2(v) + '%' : '—'; }
function indX(v) { return numOk(v) ? fmt2(v) : '—'; }
function indReais(v) { return numOk(v) ? 'R$ ' + fmtPreco(v) : '—'; }
function indGrande(v) { return numOk(v) ? 'R$ ' + formatValorGrande(Number(v)) : '—'; }
function indInt(v) { return numOk(v) ? fmt0(v) : '—'; }

function cartaoIndicador(rotulo, valor, dica) {
    return '<div class="ind-card"' + (dica ? ' title="' + escapeHtml(dica) + '"' : '') + '>' +
        '<span class="ind-rotulo">' + rotulo + '</span>' +
        '<span class="ind-valor">' + valor + '</span></div>';
}

function avisoIndicador(r) {
    var textos = {
        'sem-dados': 'A bolsai não tem dados desse ativo.',
        plano: 'Esse dado exige o plano Pro da bolsai.',
        limite: 'Limite diário da bolsai atingido. Volta a funcionar às 21h (meia-noite UTC).',
        chave: 'A chave da bolsai foi recusada. Se ela foi rotacionada, atualize BOLSAI_KEY no código.',
        rede: 'Sem conexão com a internet agora.',
        cors: 'O navegador bloqueou a conversa com a bolsai: ela não aceita chamadas vindas deste arquivo (aberto direto do disco). Os dados existem, o bloqueio é de origem.',
        erro: 'A bolsai respondeu com erro. Tenta de novo mais tarde.',
    };
    return '<p class="ind-aviso">' + (textos[r && r.motivo] || textos.erro) + '</p>';
}

// faixa mín/máx de 52 semanas com o preço atual marcado
function faixa52HTML(st) {
    if (!numOk(st.week_52_low) || !numOk(st.week_52_high) || !numOk(st.close)) return '';
    var min = Number(st.week_52_low), max = Number(st.week_52_high), atual = Number(st.close);
    var pos = max > min ? Math.min(Math.max((atual - min) / (max - min), 0), 1) * 100 : 50;
    return '<div class="ind-faixa">' +
        '<div class="ind-faixa-rotulos"><span>Mín. 52 sem. <strong>R$ ' + fmtPreco(min) + '</strong></span>' +
        '<span>Máx. 52 sem. <strong>R$ ' + fmtPreco(max) + '</strong></span></div>' +
        '<div class="ind-faixa-barra"><span class="ind-faixa-marca" style="left: ' + pos.toFixed(1) + '%;"></span></div>' +
        '<p class="ind-faixa-legenda">Fechamento de ' + formatDataBR(st.trade_date) + ': R$ ' + fmtPreco(atual) +
        ', a ' + fmt0(pos) + '% do caminho entre a mínima e a máxima do ano.</p></div>';
}

function statsCartoes(st) {
    return cartaoIndicador('Retorno no ano', numOk(st.ytd_return_pct)
        ? '<span class="' + (st.ytd_return_pct >= 0 ? 'ind-up' : 'ind-down') + '">' + (st.ytd_return_pct >= 0 ? '+' : '') + fmt2(st.ytd_return_pct) + '%</span>'
        : '—') +
        cartaoIndicador('Volume médio (52 sem.)', indInt(st.avg_volume_52w), 'Quantidade média de papéis negociados por dia');
}

function painelIndicadoresHTML(ind) {
    if (!ind) return '';
    var corpo = '';
    var titulo = 'Indicadores';
    var ref = '';

    if (ind.tipo === 'FII') {
        titulo = 'Indicadores do fundo';
        if (!ind.fii.ok) {
            corpo = avisoIndicador(ind.fii);
        } else {
            var f = ind.fii.dados;
            ref = f.reference_date ? 'Informe de ' + formatDataBR(f.reference_date) : '';
            corpo = '<div class="ind-grid cols-4">' +
                cartaoIndicador('P/VP', indX(f.pvp), 'Preço da cota dividido pelo valor patrimonial por cota') +
                cartaoIndicador('Dividend yield 12m', indPct(f.dividend_yield_ttm), 'Rendimentos dos últimos 12 meses sobre o preço atual') +
                cartaoIndicador('Valor patrimonial/cota', indReais(f.book_value_per_share)) +
                cartaoIndicador('Patrimônio líquido', indGrande(f.net_asset_value)) +
                cartaoIndicador('Vacância', indPct(f.vacancy_pct), 'Área sem inquilino (fundos de tijolo)') +
                cartaoIndicador('Inadimplência', indPct(f.delinquency_pct)) +
                cartaoIndicador('Cotistas', indInt(f.total_shareholders)) +
                cartaoIndicador('Imóveis', indInt(f.property_count)) +
                '</div>' +
                '<div class="ind-tags">' +
                (f.fund_type ? '<span class="ind-tag">' + escapeHtml(f.fund_type) + '</span>' : '') +
                (f.segment ? '<span class="ind-tag">' + escapeHtml(f.segment) + '</span>' : '') +
                (f.management_type ? '<span class="ind-tag">' + escapeHtml(f.management_type) + '</span>' : '') +
                (f.mandate ? '<span class="ind-tag">Mandato: ' + escapeHtml(f.mandate) + '</span>' : '') +
                '</div>' +
                (f.administrator ? '<p class="ind-nota">Administrador: ' + escapeHtml(f.administrator) + '</p>' : '') +
                (Array.isArray(f.top_properties) && f.top_properties.length
                    ? '<div class="ind-imoveis"><p class="ind-sub">Principais imóveis</p><ul>' +
                      f.top_properties.slice(0, 5).map(function (im) {
                          return '<li><span>' + escapeHtml(im.name || '') + '</span>' +
                              (numOk(im.revenue_pct) ? '<strong>' + fmt1(im.revenue_pct) + '% da receita</strong>' : '') + '</li>';
                      }).join('') + '</ul></div>'
                    : '');
        }
    } else if (ind.tipo === 'ACAO') {
        titulo = 'Indicadores da empresa';
        var partes = '';
        if (ind.stats.ok) partes += faixa52HTML(ind.stats.dados);
        if (ind.fund.ok) {
            var d = ind.fund.dados;
            ref = d.reference_date ? 'Balanço de ' + formatDataBR(d.reference_date) : '';
            partes += '<div class="ind-grid cols-4">' +
                cartaoIndicador('P/L', indX(d.pl), 'Preço dividido pelo lucro por ação') +
                cartaoIndicador('P/VP', indX(d.pvp), 'Preço dividido pelo valor patrimonial por ação') +
                cartaoIndicador('EV/EBITDA', indX(d.ev_ebitda)) +
                cartaoIndicador('ROE', indPct(d.roe), 'Lucro sobre o patrimônio líquido') +
                cartaoIndicador('Margem líquida', indPct(d.net_margin)) +
                cartaoIndicador('Margem EBITDA', indPct(d.ebitda_margin)) +
                cartaoIndicador('Dív. líq./EBITDA', indX(d.net_debt_ebitda), 'Quantos anos de EBITDA pagariam a dívida líquida') +
                cartaoIndicador('LPA', indReais(d.lpa), 'Lucro por ação') +
                cartaoIndicador('VPA', indReais(d.vpa), 'Valor patrimonial por ação') +
                cartaoIndicador('Valor de mercado', indGrande(d.market_cap)) +
                (ind.stats.ok ? statsCartoes(ind.stats.dados) : '') +
                '</div>';
        } else {
            if (ind.stats.ok) partes += '<div class="ind-grid">' + statsCartoes(ind.stats.dados) + '</div>';
            partes += avisoIndicador(ind.fund);
        }
        corpo = partes;
    } else if (ind.tipo === 'BDR') {
        titulo = 'Indicadores do BDR';
        if (ind.stats.ok) {
            corpo = faixa52HTML(ind.stats.dados) + '<div class="ind-grid">' + statsCartoes(ind.stats.dados) + '</div>' +
                '<p class="ind-nota">BDR representa empresa estrangeira, que não entrega balanço à CVM. Por isso só há dados de preço.</p>';
        } else {
            corpo = avisoIndicador(ind.stats);
        }
    }

    return '<section class="ind-painel">' +
        '<div class="ind-cabecalho"><h2>' + titulo + '</h2>' +
        '<span class="ind-fonte">bolsai' + (ref ? ' · ' + escapeHtml(ref) : '') + '</span></div>' +
        corpo + '</section>';
}
