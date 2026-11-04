/* =================================================================
   ENGINE DE RENTABILIDADE — fechamento mensal, MTD, patrimônio histórico
   Extraído do IIFE de index.html para escopo global.
   Dependências: constantes.js, armazem.js, data.js, utils.js, market.js
   ================================================================= */

/* =================================================================
   RENTABILIDADE MENSAL A MERCADO [RENT v2 · 11/10/2026]

   Fórmula oficial:
     Rentabilidade = (PF − PI − AportesLíquidos + Proventos) / PI
   Onde:
     PI = patrimônio a valor de mercado no último dia do mês anterior
     PF = patrimônio a valor de mercado no último dia do mês
     AportesLíquidos = capital que entrou/saiu nesse mês (COMPRA/APORTE/ENTRADA
                       menos VENDA/SAIDA em valor financeiro)
     Proventos = PROVENTO + RENDIMENTO_RF recebidos no mês (não alteram
                 a posição; sem somá-los, a queda ex-dividendo distorceria o %
   Fonte de preços:
     B3 → buscarPrecosMensaisB3 (chunks startDate/endDate 90d, interval=1d, plano free)
     Cripto → buscarPrecosMensaisCripto (Binance klines interval=1M)
     RF → custo acumulado (sem fonte de cotação de mercado)
   Fallback se não tiver preço → preço médio (custo/qtd) da posição naquela data
   ================================================================= */

// Último dia de calendar de um anoMes "YYYY-MM" → string "YYYY-MM-DD"
function _ultimoDiaDoMes(anoMes) {
    var ano = parseInt(anoMes.slice(0, 4), 10);
    var mes = parseInt(anoMes.slice(5, 7), 10);
    var d = new Date(ano, mes, 0).getDate();
    return anoMes + '-' + (d < 10 ? '0' : '') + d;
}

// Patrimônio a valor de mercado no último dia do anoMes, dado um mapa de
// preços mensais: { ticker: { "YYYY-MM": close } }
// Para Renda Fixa, usa custo acumulado (APORTE + RENDIMENTO_RF − SAIDA).
function patrimonioNaData(usuarioId, anoMes, precosMensaisPorTicker) {
    var db = loadDB();
    var ativosPorId = ativosPorIdDe(db);
    var dataLimite = _ultimoDiaDoMes(anoMes);

    var cIdPN = carteiraIdAtual();
    // Posições de ativos que têm motor (ACAO/FII/BDR/CRIPTO)
    var txsMotor = ordenarTransacoes(
        (db.transacoes || []).filter(function (t) {
            return t.usuarioId === usuarioId && (!cIdPN || t.carteiraId === cIdPN)
                && t.data <= dataLimite
                && t.tipo !== 'PROVENTO' && t.tipo !== 'APORTE' && t.tipo !== 'RENDIMENTO_RF';
        })
    );
    var carteira = processarCarteira(txsMotor, ativosPorId);
    var posicoes = carteira.posicoes;

    var total = 0;

    // Ativos processados pelo motor
    Object.keys(posicoes).forEach(function (ativoId) {
        var pos = posicoes[ativoId];
        if (!pos.ativo || pos.quantidade <= QTD_EPSILON) return;
        var ticker = pos.ativo.ticker;
        var classe = pos.ativo.classe;
        if (classe === 'RENDA_FIXA') return; // tratado abaixo

        var precosMes = precosMensaisPorTicker[ticker];
        var preco = precosMes ? (precosMes[anoMes] || null) : null;

        if (preco !== null && preco > 0) {
            total += pos.quantidade * preco;
        } else {
            // Fallback: preço médio de custo
            var pm = pos.qtdComCusto > 0 ? pos.custoTotal / pos.qtdComCusto : 0;
            total += pos.quantidade * pm;
        }
    });

    // Renda fixa: custo acumulado (APORTE) + rendimentos − resgates até a data
    var ativosRF = (db.ativos || []).filter(function (a) { return a.classe === 'RENDA_FIXA'; });
    ativosRF.forEach(function (ativo) {
        var saldoRF = (db.transacoes || []).filter(function (t) {
            return t.usuarioId === usuarioId && (!cIdPN || t.carteiraId === cIdPN)
                && t.ativoId === ativo.id && t.data <= dataLimite;
        }).reduce(function (s, t) {
            if (t.tipo === 'APORTE')        return s + Number(t.valor || 0);
            if (t.tipo === 'RENDIMENTO_RF') return s + Number(t.valor || 0);
            if (t.tipo === 'SAIDA')         return s - Number(t.valor || 0);
            if (t.tipo === 'RESGATE')       return s - Number(t.valor || 0);
            return s;
        }, 0);
        if (saldoRF > 0) total += saldoRF;
    });

    return total;
}

// Soma PROVENTO (dividendos/juros distribuídos) recebidos no mês.
// RENDIMENTO_RF não entra aqui: já está no saldo de patrimonioNaData().
// [RENT v5 · 13/10/2026] Corrige dupla-contagem: RENDIMENTO_RF era somado
// tanto no patrimônio final (via patrimonioNaData) quanto aqui, inflando ~0,8 p.p./mês.
function proventosNoMes(usuarioId, anoMes) {
    var db = loadDB();
    var cIdPM = carteiraIdAtual();
    var ini = anoMes + '-01';
    var fim = _ultimoDiaDoMes(anoMes);
    return (db.transacoes || []).filter(function (t) {
        return t.usuarioId === usuarioId && (!cIdPM || t.carteiraId === cIdPM)
            && t.tipo === 'PROVENTO'
            && t.data >= ini && t.data <= fim;
    }).reduce(function (s, t) { return s + Number(t.valor || 0); }, 0);
}

// Fluxos líquidos de capital no mês: dinheiro novo que entrou menos o que saiu.
// Não inclui conversão/stake/entrada (sem custo de capital).
// Não inclui proventos (tratados separadamente na fórmula).
function aportesLiquidosNoMes(usuarioId, anoMes) {
    var db = loadDB();
    var cIdAL = carteiraIdAtual();
    var ativosPorId = ativosPorIdDe(db);
    var ini = anoMes + '-01';
    var fim = _ultimoDiaDoMes(anoMes);
    return (db.transacoes || []).filter(function (t) {
        return t.usuarioId === usuarioId && (!cIdAL || t.carteiraId === cIdAL)
            && t.data >= ini && t.data <= fim;
    }).reduce(function (s, t) {
        var ativo = ativosPorId[t.ativoId];
        if (t.tipo === 'COMPRA')  return s + (Number(t.quantidade) * Number(t.precoUnitario) + (Number(t.corretagemTaxas) || 0));
        if (t.tipo === 'APORTE')  return s + Number(t.valor || 0); // RF
        if (t.tipo === 'VENDA')   return s - (Number(t.quantidade) * Number(t.precoUnitario) - (Number(t.corretagemTaxas) || 0));
        if (t.tipo === 'SAIDA')   return s - Number(t.valor || 0); // cripto saindo
        if (t.tipo === 'RESGATE') return s - Number(t.valor || 0); // RF resgatado
        return s;
        // ENTRADA, STAKE, CONVERSAO, PROVENTO, RENDIMENTO_RF → sem fluxo de capital
    }, 0);
}

// [RENT v4 · 11/10/2026] Calcula rentabilidade a valor de mercado de um mês fechado.
// Usa Modified Dietz simplificado (aportes líquidos ponderados a meio do mês).
//
// Fórmula:
//   numerador   = PatrimonioFim − PatrimonioInicio − AportesLiquidos + Proventos
//   denominador = PatrimonioInicio + AportesLiquidos × 0,5
//   rentabilidade = numerador / denominador × 100
//
// Mês de formação: SOMENTE quando não havia patrimônio no início do mês
// (carteira ainda não existia). Aportes grandes em carteira já existente
// usam Dietz e mostram %.
function rentabilidadeCarteiraMes(usuarioId, anoMes, precosMensaisPorTicker) {
    var ano = parseInt(anoMes.slice(0, 4), 10);
    var mes = parseInt(anoMes.slice(5, 7), 10);
    var anoMesAnterior;
    if (mes === 1) { anoMesAnterior = (ano - 1) + '-12'; }
    else { anoMesAnterior = ano + '-' + (mes - 1 < 10 ? '0' : '') + (mes - 1); }

    var patrimonioFim = patrimonioNaData(usuarioId, anoMes, precosMensaisPorTicker);
    if (patrimonioFim <= 0) return null;

    var patrimonioInicio = patrimonioNaData(usuarioId, anoMesAnterior, precosMensaisPorTicker);
    var aportes  = aportesLiquidosNoMes(usuarioId, anoMes);
    var proventos = proventosNoMes(usuarioId, anoMes);

    // Primeiro mês da carteira (PI = 0): Modified Dietz com denominador = aportes × 0,5.
    // O retorno é real (ex: -5,31% se o ativo caiu desde a compra até o fechamento do mês).
    if (patrimonioInicio <= 0) {
        var denomPrim = aportes * 0.5;
        if (denomPrim <= 0) return null; // sem aportes, sem base de cálculo
        var numPrim = patrimonioFim - aportes + proventos;
        return {
            rentabilidade: (numPrim / denomPrim) * 100,
            primeiroMes: true,
            patrimonioInicio: 0,
            patrimonioFim: patrimonioFim,
            aportesLiquidos: aportes,
            proventos: proventos,
        };
    }

    // Modified Dietz: aportes líquidos com peso 0,5 (meio do mês)
    var numerador = patrimonioFim - patrimonioInicio - aportes + proventos;
    var denominador = patrimonioInicio + aportes * 0.5;
    if (denominador <= 0) return null;
    var rentabilidade = (numerador / denominador) * 100;

    return {
        rentabilidade: rentabilidade,
        primeiroMes: false,
        patrimonioInicio: patrimonioInicio,
        patrimonioFim: patrimonioFim,
        aportesLiquidos: aportes,
        proventos: proventos,
    };
}

// [RENT v4] Cache de MTD (mês corrente parcial) — 1× por abertura do app
var _mtdCache = null;

function _anoMesAtual() {
    var h = new Date();
    return h.getFullYear() + '-' + (h.getMonth() + 1 < 10 ? '0' : '') + (h.getMonth() + 1);
}

// Patrimônio a valor de mercado AGORA (cotações ao vivo + RF contábil)
function patrimonioMercadoAtual(usuarioId, cotacoes) {
    var db = loadDB();
    var cIdMA = carteiraIdAtual();
    var ativosPorId = ativosPorIdDe(db);
    var hojeISO = new Date().toISOString().slice(0, 10);
    var txsMotor = ordenarTransacoes(
        (db.transacoes || []).filter(function (t) {
            return t.usuarioId === usuarioId && (!cIdMA || t.carteiraId === cIdMA)
                && t.data <= hojeISO
                && t.tipo !== 'PROVENTO' && t.tipo !== 'APORTE' && t.tipo !== 'RENDIMENTO_RF';
        })
    );
    var posicoes = processarCarteira(txsMotor, ativosPorId).posicoes;
    var total = 0;
    Object.keys(posicoes).forEach(function (ativoId) {
        var pos = posicoes[ativoId];
        if (!pos.ativo || pos.quantidade <= QTD_EPSILON) return;
        if (pos.ativo.classe === 'RENDA_FIXA') return;
        var cot = cotacoes && cotacoes[pos.ativo.ticker];
        var preco = (cot && cot.precoAtual > 0) ? cot.precoAtual : null;
        if (preco !== null) {
            total += pos.quantidade * preco;
        } else {
            var pm = pos.qtdComCusto > 0 ? pos.custoTotal / pos.qtdComCusto : 0;
            total += pos.quantidade * pm;
        }
    });
    (db.ativos || []).filter(function (a) { return a.classe === 'RENDA_FIXA'; }).forEach(function (ativo) {
        var saldoRF = (db.transacoes || []).filter(function (t) {
            return t.usuarioId === usuarioId && (!cIdMA || t.carteiraId === cIdMA)
                && t.ativoId === ativo.id && t.data <= hojeISO;
        }).reduce(function (s, t) {
            if (t.tipo === 'APORTE')        return s + Number(t.valor || 0);
            if (t.tipo === 'RENDIMENTO_RF') return s + Number(t.valor || 0);
            if (t.tipo === 'SAIDA')         return s - Number(t.valor || 0);
            if (t.tipo === 'RESGATE')       return s - Number(t.valor || 0);
            return s;
        }, 0);
        if (saldoRF > 0) total += saldoRF;
    });
    return total;
}

// Calcula MTD do mês corrente (1× por sessão). Não grava no histórico.
// Retorna { mes, rentabilidade, cdi, parcial: true, ... } ou null.
function obterMTD(usuarioId, cotacoes, cdiHoje) {
    var anoMes = _anoMesAtual();
    if (_mtdCache && _mtdCache.usuarioId === usuarioId && _mtdCache.mes === anoMes) {
        return _mtdCache;
    }

    var ano = parseInt(anoMes.slice(0, 4), 10);
    var mes = parseInt(anoMes.slice(5, 7), 10);
    var anoMesAnterior = mes === 1 ? (ano - 1) + '-12' : ano + '-' + (mes - 1 < 10 ? '0' : '') + (mes - 1);

    // Início: patrimônio no fim do mês anterior, calculado dinamicamente com stockHist
    // (não usa patrimonioFim do histórico — pode estar desatualizado por transações retroativas)
    var patrimonioInicio = patrimonioNaData(usuarioId, anoMesAnterior, loadStockHist());
    if (patrimonioInicio <= 0) {
        // Fallback: tenta o valor armazenado no histórico
        var db = loadDB();
        var cIdMTD = carteiraIdAtual();
        var histPrev = (db.historicoRentabilidade || []).filter(function (h) {
            return h.usuarioId === usuarioId && (!cIdMTD || h.carteiraId === cIdMTD) && h.mes === anoMesAnterior;
        })[0];
        patrimonioInicio = histPrev && histPrev.patrimonioFim != null ? Number(histPrev.patrimonioFim) : 0;
    }

    if (patrimonioInicio <= 0) {
        _mtdCache = null;
        return null; // ainda em formação
    }

    var patrimonioFim = patrimonioMercadoAtual(usuarioId, cotacoes || {});
    if (patrimonioFim <= 0) {
        _mtdCache = null;
        return null;
    }

    var aportes = aportesLiquidosNoMes(usuarioId, anoMes);
    var proventos = proventosNoMes(usuarioId, anoMes);
    var numerador = patrimonioFim - patrimonioInicio - aportes + proventos;
    var denominador = patrimonioInicio + aportes * 0.5;
    if (denominador <= 0) {
        _mtdCache = null;
        return null;
    }
    var rentabilidade = (numerador / denominador) * 100;

    // CDI parcial: capitaliza o diário pelos dias decorridos (aprox. du = dia × 22/30)
    var dia = new Date().getDate();
    var duAprox = Math.max(1, Math.min(22, Math.round(dia * 22 / 30)));
    var cdiParcial = null;
    if (cdiHoje && cdiHoje.cdiDiario) {
        cdiParcial = (Math.pow(1 + Number(cdiHoje.cdiDiario) / 100, duAprox) - 1) * 100;
    }

    _mtdCache = {
        usuarioId: usuarioId,
        mes: anoMes,
        rentabilidade: rentabilidade,
        cdi: cdiParcial,
        parcial: true,
        primeiroMes: false,
        patrimonioInicio: patrimonioInicio,
        patrimonioFim: patrimonioFim,
        aportesLiquidos: aportes,
        proventos: proventos,
    };
    return _mtdCache;
}

// [RENT v2 · 11/10/2026] Fecha todos os meses anteriores ao corrente que ainda
// não foram fechados. Agora async: busca preços históricos na brapi/Binance
// antes de calcular a rentabilidade de cada mês. Retorna Promise<number> com
// a quantidade de meses novos salvos (0 = nada de novo).
function fecharMesAnteriorSeNecessario(usuarioId) {
    var hoje = new Date();
    var db = loadDB();

    // [HIST v2] Migração v6: recalcula com rentabilidade real no primeiro mês (PI=0 via Dietz).
    // [CDI v2] Migração v7: CDI do primeiroMes pro-rateado desde a data real do 1º lançamento.
    // [RENT v5] Migração v8: corrige dupla-contagem de RENDIMENTO_RF (retirado de proventosNoMes).
    if (!db.historicoRentabilidadeVersao || db.historicoRentabilidadeVersao < 8) {
        db.historicoRentabilidade = [];
        db.historicoRentabilidadeVersao = 8;
        saveDB(db);
    }

    db.historicoRentabilidade = db.historicoRentabilidade || [];

    var cIdFech = carteiraIdAtual();
    // Descobre o mês mais antigo com transação deste usuário/carteira
    var txs = (db.transacoes || []).filter(function (t) {
        return t.usuarioId === usuarioId && (!cIdFech || t.carteiraId === cIdFech) && t.data;
    });
    if (!txs.length) return Promise.resolve(0);
    txs.sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    var primeiraTx = txs[0].data;

    var anoInicio = parseInt(primeiraTx.slice(0, 4), 10);
    var mesInicio = parseInt(primeiraTx.slice(5, 7), 10);
    var anoFim = hoje.getFullYear();
    var mesFim = hoje.getMonth(); // 0-based = mês anterior ao atual

    // Coleta meses pendentes
    var pendentes = [];
    for (var ano = anoInicio; ano <= anoFim; ano++) {
        var mStart = (ano === anoInicio) ? mesInicio : 1;
        var mEnd   = (ano === anoFim)   ? mesFim    : 12;
        for (var mes = mStart; mes <= mEnd; mes++) {
            var anoMes = ano + '-' + (mes < 10 ? '0' : '') + mes;
            var jaFechou = db.historicoRentabilidade.some(function (h) {
                return h.usuarioId === usuarioId && (!cIdFech || h.carteiraId === cIdFech) && h.mes === anoMes;
            });
            if (!jaFechou) pendentes.push(anoMes);
        }
    }
    if (!pendentes.length) return Promise.resolve(0);

    // Descobre todos os tickers com posição em algum dos meses pendentes
    var dbNow = loadDB();
    var ativosPorId = ativosPorIdDe(dbNow);
    var tickersComClasse = [];
    var vistos = {};
    // Mapeia ativoId → data mínima de transação do usuário/carteira
    var minDataPorAtivo = {};
    (dbNow.transacoes || []).forEach(function (t) {
        if (t.usuarioId !== usuarioId || !t.data) return;
        if (cIdFech && t.carteiraId !== cIdFech) return;
        if (!minDataPorAtivo[t.ativoId] || t.data < minDataPorAtivo[t.ativoId]) {
            minDataPorAtivo[t.ativoId] = t.data;
        }
    });
    (dbNow.ativos || []).forEach(function (a) {
        if (!vistos[a.ticker]) {
            vistos[a.ticker] = true;
            tickersComClasse.push({ ticker: a.ticker, classe: a.classe, dataInicio: minDataPorAtivo[a.id] || null });
        }
    });

    // Busca preços mensais de todos os tickers em paralelo
    // (brapi ainda serializa via brapiFilaPromise por ticker, cripto não)
    var promessasPrecos = tickersComClasse.map(function (tc) {
        return buscarPrecosMensais(tc.ticker, tc.classe, tc.dataInicio).then(function (mapa) {
            return { ticker: tc.ticker, mapa: mapa };
        });
    });

    // [FECH v1] também busca IBOV e USDBRL para incluir no snapshot de fechamento
    var primeiraDataB3 = null;
    var primeiraDataQualquer = null;
    tickersComClasse.forEach(function (tc) {
        if (tc.dataInicio && (!primeiraDataQualquer || tc.dataInicio < primeiraDataQualquer)) primeiraDataQualquer = tc.dataInicio;
        if (tc.classe !== 'CRIPTO' && tc.classe !== 'RENDA_FIXA' && tc.dataInicio) {
            if (!primeiraDataB3 || tc.dataInicio < primeiraDataB3) primeiraDataB3 = tc.dataInicio;
        }
    });
    var promessaIBOV   = primeiraDataB3        ? buscarPrecosMensaisIBOV(primeiraDataB3)           : Promise.resolve({});
    var promessaIFIX   = buscarPrecosMensaisIFIX(primeiraDataB3 || primeiraDataQualquer);           // [IFIX v1] sempre buscado
    // [USDBRL v1] taxa de câmbio mensal para referência em relatórios externos
    var promessaUsdBrl = primeiraDataQualquer   ? buscarUsdBrlMensal(primeiraDataQualquer)          : Promise.resolve({});

    return Promise.all([Promise.all(promessasPrecos), promessaIBOV, promessaUsdBrl, promessaIFIX]).then(function (ambos) {
        var resultados  = ambos[0];
        var ibovMapa    = ambos[1] || {};
        var usdBrlMapa  = ambos[2] || {};
        var ifixMapa    = ambos[3] || {};
        var precosMensaisPorTicker = {};
        resultados.forEach(function (r) { precosMensaisPorTicker[r.ticker] = r.mapa; });

        // Fecha cada mês pendente em série (processo síncrono depois dos fetches)
        var chain = Promise.resolve(0);
        pendentes.forEach(function (am) {
            chain = chain.then(function (novos) {
                var resultado = rentabilidadeCarteiraMes(usuarioId, am, precosMensaisPorTicker);
                if (!resultado) return novos; // sem patrimônio neste mês

                // primeiroMes: CDI pro-rateado desde a data real do 1º lançamento
                var cdiDataInicio = resultado.primeiroMes ? primeiraTx : undefined;
                return buscarCDIMesFechado(am, cdiDataInicio).then(function (cdi) {
                    if (cdi === null) {
                        var ultimoCache = (function () {
                            try { return JSON.parse(armazem.get(CDI_CACHE_KEY) || 'null'); } catch (e) { return null; }
                        })();
                        var ref = (ultimoCache && ultimoCache.cdiDiario) ? ultimoCache.cdiDiario : 0.0402;
                        cdi = (Math.pow(1 + ref / 100, 22) - 1) * 100;
                    }

                    var dbSave = loadDB();
                    dbSave.historicoRentabilidade = dbSave.historicoRentabilidade || [];
                    var jaSalvou = dbSave.historicoRentabilidade.some(function (h) {
                        return h.usuarioId === usuarioId && (!cIdFech || h.carteiraId === cIdFech) && h.mes === am;
                    });
                    if (!jaSalvou) {
                        var entradaHist = {
                            mes: am,
                            usuarioId: usuarioId,
                            rentabilidade: resultado.rentabilidade,
                            cdi: cdi,
                            primeiroMes: resultado.primeiroMes || undefined,
                            patrimonioInicio: resultado.patrimonioInicio,
                            patrimonioFim: resultado.patrimonioFim,
                            aportesLiquidos: resultado.aportesLiquidos,
                            proventos: resultado.proventos,
                        };
                        if (cIdFech) entradaHist.carteiraId = cIdFech;
                        dbSave.historicoRentabilidade.push(entradaHist);
                        saveDB(dbSave);
                        if (typeof supLogado === 'function' && supLogado()) supUpsertHistorico(entradaHist); // [SUP v1]

                        // [FECH v1] snapshot das cotações usadas neste fechamento
                        var fechamentos = loadCotacoesFechamento();
                        if (!fechamentos[am]) {
                            var snap = {};
                            Object.keys(precosMensaisPorTicker).forEach(function (tk) {
                                var p = precosMensaisPorTicker[tk][am];
                                if (p) snap[tk] = p;
                            });
                            if (ibovMapa[am])   snap['IBOV']   = ibovMapa[am];
                            if (ifixMapa[am])   snap['IFIX']   = ifixMapa[am];
                            if (usdBrlMapa[am]) snap['USDBRL'] = usdBrlMapa[am];
                            fechamentos[am] = snap;
                            saveCotacoesFechamento(fechamentos);
                        }

                        return novos + 1;
                    }
                    return novos;
                });
            });
        });
        // [FECH v1] preenche snapshots retroativos para meses já fechados sem snapshot,
        // usando os preços já buscados nesta mesma execução — sem re-fetch.
        return chain.then(function (novos) {
            var fechAtual = loadCotacoesFechamento();
            var dbFinal = loadDB();
            var temNovo = false;
            (dbFinal.historicoRentabilidade || []).forEach(function (h) {
                if (h.usuarioId !== usuarioId) return;
                if (cIdFech && h.carteiraId !== cIdFech) return;
                if (fechAtual[h.mes]) {
                    // Snapshot existe: atualizar IBOV/USDBRL se o valor mudou
                    var ibovNovo   = ibovMapa[h.mes];
                    var ifixNovo   = ifixMapa[h.mes];
                    var usdBrlNovo = usdBrlMapa[h.mes];
                    if (ibovNovo   && fechAtual[h.mes]['IBOV']   !== ibovNovo)   { fechAtual[h.mes]['IBOV']   = ibovNovo;   temNovo = true; }
                    if (ifixNovo   && fechAtual[h.mes]['IFIX']   !== ifixNovo)   { fechAtual[h.mes]['IFIX']   = ifixNovo;   temNovo = true; }
                    if (usdBrlNovo && fechAtual[h.mes]['USDBRL'] !== usdBrlNovo) { fechAtual[h.mes]['USDBRL'] = usdBrlNovo; temNovo = true; }
                    return;
                }
                var snap = {};
                Object.keys(precosMensaisPorTicker).forEach(function (tk) {
                    var p = precosMensaisPorTicker[tk][h.mes];
                    if (p) snap[tk] = p;
                });
                if (ibovMapa[h.mes])   snap['IBOV']   = ibovMapa[h.mes];
                if (ifixMapa[h.mes])   snap['IFIX']   = ifixMapa[h.mes];
                if (usdBrlMapa[h.mes]) snap['USDBRL'] = usdBrlMapa[h.mes];
                if (Object.keys(snap).length > 0) {
                    fechAtual[h.mes] = snap;
                    temNovo = true;
                }
            });
            if (temNovo) saveCotacoesFechamento(fechAtual);
            return novos;
        });
    });
}

// [FECH v2] Completa snapshots de meses já fechados com preços cripto que estejam faltando.
// Roda em background após fecharMesAnteriorSeNecessario. Detecta tickers cripto sem preço
// em algum snapshot existente e faz fetch (com fallback USDT independente). Idempotente:
// se o ticker já está no snapshot, é ignorado. Executa no máximo uma vez por ticker
// por mês (na abertura seguinte ao fechamento do mês).
function completarCotacoesFechamentoCripto(usuarioId) {
    var db = loadDB();
    var cIdCC = carteiraIdAtual();
    var fechamentos = loadCotacoesFechamento();
    var historico = (db.historicoRentabilidade || []).filter(function (h) {
        return h.usuarioId === usuarioId && (!cIdCC || h.carteiraId === cIdCC);
    });
    if (!historico.length) return Promise.resolve();

    // Mapa ativoId → ativo
    var ativoMap = {};
    (db.ativos || []).forEach(function (a) { ativoMap[a.id] = a; });

    // Tickers cripto desta carteira com dataInicio (primeira transação)
    var criptoInfo = {}; // { ticker: dataInicio }
    (db.transacoes || []).filter(function (t) {
        return t.usuarioId === usuarioId && (!cIdCC || t.carteiraId === cIdCC);
    }).forEach(function (t) {
        var a = ativoMap[t.ativoId];
        if (!a || a.classe !== 'CRIPTO') return;
        if (!criptoInfo[a.ticker] || t.data < criptoInfo[a.ticker]) criptoInfo[a.ticker] = t.data;
    });

    if (!Object.keys(criptoInfo).length) return Promise.resolve();

    // Verificar quais tickers faltam em algum snapshot fechado existente
    var tickersFaltando = {};
    historico.forEach(function (h) {
        var snap = fechamentos[h.mes];
        if (!snap) return; // snapshot não existe: será criado por fecharMesAnteriorSeNecessario
        Object.keys(criptoInfo).forEach(function (ticker) {
            if (snap[ticker] === undefined) tickersFaltando[ticker] = criptoInfo[ticker];
        });
    });

    if (!Object.keys(tickersFaltando).length) return Promise.resolve();

    var promessas = Object.keys(tickersFaltando).map(function (ticker) {
        return buscarPrecosMensaisCripto(ticker, tickersFaltando[ticker])
            .then(function (mapa) { return { ticker: ticker, mapa: mapa }; })
            .catch(function () { return { ticker: ticker, mapa: {} }; });
    });

    return Promise.all(promessas).then(function (resultados) {
        var fechAtual = loadCotacoesFechamento(); // reload para evitar race
        var temNovo = false;
        resultados.forEach(function (r) {
            historico.forEach(function (h) {
                if (!fechAtual[h.mes] || fechAtual[h.mes][r.ticker] !== undefined) return;
                var p = r.mapa[h.mes];
                if (p) { fechAtual[h.mes][r.ticker] = p; temNovo = true; }
            });
        });
        if (temNovo) saveCotacoesFechamento(fechAtual);
    }).catch(function () {});
}

// [USDBRL v1] Roda no boot independente de fecharMesAnteriorSeNecessario.
// Busca histórico USD-BRL e preenche snapshots de cotacoesFechamento que ainda não têm USDBRL.
function completarUsdBrlFechamento(usuarioId) {
    var db = loadDB();
    var cIdUB = carteiraIdAtual();
    var historico = (db.historicoRentabilidade || []).filter(function (h) {
        return h.usuarioId === usuarioId && (!cIdUB || h.carteiraId === cIdUB);
    });
    if (!historico.length) return Promise.resolve();

    // data mais antiga de qualquer transação desta carteira
    var minData = null;
    (db.transacoes || []).forEach(function (t) {
        if (t.usuarioId === usuarioId && (!cIdUB || t.carteiraId === cIdUB)
            && t.data && (!minData || t.data < minData)) minData = t.data;
    });

    return buscarUsdBrlMensal(minData).then(function (usdBrlMapa) {
        if (!Object.keys(usdBrlMapa).length) return;
        var fechAtual = loadCotacoesFechamento();
        var temNovo = false;
        historico.forEach(function (h) {
            if (!fechAtual[h.mes]) return;
            var v = usdBrlMapa[h.mes];
            if (v && fechAtual[h.mes]['USDBRL'] !== v) {
                fechAtual[h.mes]['USDBRL'] = v;
                temNovo = true;
            }
        });
        if (temNovo) saveCotacoesFechamento(fechAtual);
    }).catch(function () {});
}

// [FECH v1] Preenche cotacoesFechamento para meses já fechados usando apenas dados em cache
// (stockHist + ibovHist). Roda no boot, sem fetch. Cripto fica vazio até o próximo fechamento.
function popularCotacoesFechamentoRetroativo(usuarioId) {
    var db = loadDB();
    var cIdRet = carteiraIdAtual();
    var fechamentos = loadCotacoesFechamento();
    var sh = loadStockHist();
    var ih = loadIBOVHist();
    var ifh = loadIfixHist();
    var uh = loadUsdBrlHist();
    var temNovo = false;
    (db.historicoRentabilidade || []).forEach(function (h) {
        if (h.usuarioId !== usuarioId) return;
        if (cIdRet && h.carteiraId !== cIdRet) return;
        if (fechamentos[h.mes]) return;
        var snap = {};
        Object.keys(sh).forEach(function (tk) { var p = sh[tk][h.mes]; if (p) snap[tk] = p; });
        if (ih[h.mes])  snap['IBOV']   = ih[h.mes];
        if (ifh[h.mes]) snap['IFIX']   = ifh[h.mes];
        if (uh[h.mes])  snap['USDBRL'] = uh[h.mes];
        if (Object.keys(snap).length > 0) { fechamentos[h.mes] = snap; temNovo = true; }
    });
    if (temNovo) saveCotacoesFechamento(fechamentos);
}
