/* =================================================================
   GRÁFICOS — porte fiel de investments/charts.py (geometria SVG)
   ================================================================= */

function round1(n) { return Math.round(n * 10) / 10; }

function barPath(x, y, w, h, radius) {
    var r = Math.min(radius, h / 2, w / 2);
    if (r <= 0) return 'M' + x + ',' + (y + h) + ' L' + x + ',' + y + ' L' + (x + w) + ',' + y + ' L' + (x + w) + ',' + (y + h) + ' Z';
    return 'M' + x + ',' + (y + h) + ' ' +
        'L' + x + ',' + (y + r) + ' ' +
        'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + ' ' +
        'L' + (x + w - r) + ',' + y + ' ' +
        'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + ' ' +
        'L' + (x + w) + ',' + (y + h) + ' Z';
}

// opts: { lucroPrejuizo: número|null, saldoMercado: número|null }
// Quando fornecido, a última barra é dividida em custo (cor primária) + lucro (verde) ou prejuízo (vermelho)
function montarGraficoEvolucao(evolucao, opts) {
    if (!evolucao.length) return null;
    opts = opts || {};
    var largura = 520, altura = 180;
    var padEsq = 52, padDir = 8, padTopo = 20, padBaixo = 24;
    var areaLargura = largura - padEsq - padDir;
    var areaAltura = altura - padTopo - padBaixo;
    var baselineY = padTopo + areaAltura;

    // valorMax considera o saldo de mercado da última barra se disponível
    var valores = evolucao.map(function (e) { return e.valor; });
    var saldoMercadoUltimo = (opts.saldoMercado != null && opts.saldoMercado > 0) ? opts.saldoMercado : null;
    var valorMaxRef = Math.max.apply(null, valores);
    if (saldoMercadoUltimo && saldoMercadoUltimo > valorMaxRef) valorMaxRef = saldoMercadoUltimo;
    var valorMax = valorMaxRef;
    if (!(valorMax > 0)) valorMax = 1;

    // 4 linhas de grade entre 0 e max (valores arredondados "bonitos")
    var numLinhas = 4;
    var step = valorMax / numLinhas;
    var mag = Math.pow(10, Math.floor(Math.log10(step)));
    var stepBonito = Math.ceil(step / mag) * mag;

    var linhasGrade = [];
    for (var k = 1; k <= numLinhas; k++) {
        var val = stepBonito * k;
        if (val > valorMax * 1.15) break;
        var yLinha = baselineY - (val / valorMax) * areaAltura;
        if (yLinha < padTopo) break;
        linhasGrade.push({ val: val, y: parseFloat(yLinha.toFixed(1)) });
    }

    var n = evolucao.length;
    var gap = 4;
    var slot = n ? areaLargura / n : 0;
    var larguraBarra = n ? Math.max(Math.min(slot - gap, 24), 4) : 0;

    var barras = evolucao.map(function (item, i) {
        var ehUltima = i === n - 1;
        var custoBase = item.valor; // custo acumulado (sempre base da barra)
        var alturaCusto = valorMax ? (custoBase / valorMax) * areaAltura : 0;
        alturaCusto = Math.max(alturaCusto, 2);
        var x = padEsq + i * slot + (slot - larguraBarra) / 2;
        var yCusto = baselineY - alturaCusto;

        var barraObj = {
            pathCusto: barPath(round1(x), round1(yCusto), round1(larguraBarra), round1(alturaCusto), 4),
            xCentro: (x + larguraBarra / 2).toFixed(1),
            label: item.label,
            valor: item.valor,
            valorLabelY: (yCusto - 6).toFixed(1),
            pathExtra: null,
            extraTipo: null, // 'lucro' | 'prejuizo'
        };

        // Última barra: adiciona camada de lucro/prejuízo se disponível
        if (ehUltima && opts.lucroPrejuizo != null && Math.abs(opts.lucroPrejuizo) > 0.01) {
            var lucro = opts.lucroPrejuizo;
            if (lucro > 0) {
                // barra de lucro empilhada acima do custo
                var alturaLucro = (lucro / valorMax) * areaAltura;
                var yLucro = yCusto - alturaLucro;
                barraObj.pathExtra = barPath(round1(x), round1(yLucro), round1(larguraBarra), round1(alturaLucro), 4);
                barraObj.extraTipo = 'lucro';
                barraObj.valorLabelY = (yLucro - 6).toFixed(1);
                barraObj.valorDisplay = (custoBase + lucro);
            } else {
                // prejuízo: a barra de custo é reduzida visualmente (saldo = custo + prejuízo)
                var saldo = custoBase + lucro; // lucro < 0
                if (saldo > 0) {
                    var alturaSaldo = Math.max((saldo / valorMax) * areaAltura, 2);
                    var ySaldo = baselineY - alturaSaldo;
                    // parte da barra que representa o prejuízo (de ySaldo até yCusto)
                    var alturaPerda = alturaCusto - alturaSaldo;
                    if (alturaPerda > 0) {
                        barraObj.pathExtra = 'M' + round1(x) + ',' + round1(yCusto + alturaPerda) + ' L' + round1(x) + ',' + round1(yCusto) + ' L' + round1(x + larguraBarra) + ',' + round1(yCusto) + ' L' + round1(x + larguraBarra) + ',' + round1(yCusto + alturaPerda) + ' Z';
                        barraObj.extraTipo = 'prejuizo';
                    }
                }
            }
        }

        return barraObj;
    });

    return {
        width: largura, height: altura,
        baselineY: baselineY, labelY: altura - 6,
        axisX2: largura - padDir, padEsq: padEsq,
        barras: barras, linhasGrade: linhasGrade,
        temLucro: opts.lucroPrejuizo != null && opts.lucroPrejuizo > 0.01,
        temPrejuizo: opts.lucroPrejuizo != null && opts.lucroPrejuizo < -0.01,
    };
}

// Prepara os dados para Chart.js (barras empilhadas).
// evolucao: [{label, valor}] — custo acumulado mês a mês
// opts: { lucroPrejuizo, saldoMercado } — mesmo contrato de montarGraficoEvolucao
// Retorna null se vazio, ou { labels, datasets, cor } para uso direto no Chart.js
// [HIST v1] saldoPorMes opcional: { "YYYY-MM": valorMercado } — aplica ganho/perda por barra.
// Custo = verde forte, sempre na altura real. Lucro = verde claro acima. Prejuízo = vermelho na base.
function dadosChartJsEvolucao(evolucao, opts) {
    if (!evolucao.length) return null;
    opts = opts || {};
    var saldoPorMes = opts.saldoPorMes || {};

    var labels = evolucao.map(function (e) { return e.label; });
    var custos  = evolucao.map(function (e) { return e.valor; });
    var temMercado = evolucao.some(function (e) { return saldoPorMes[e.anoMes] != null; });

    // Dataset 1: custo aportado — verde forte, altura imutável
    var datasets = [{
        label: 'Custo aportado',
        data: custos,
        backgroundColor: 'rgba(22, 101, 52, 0.88)',
        borderRadius: 4,
        borderSkipped: false,
        order: 3,
    }];

    if (temMercado) {
        // Dataset 2: verde claro flutuante [custo → saldo] — meses com lucro
        var lucroData = evolucao.map(function (e) {
            var custo = e.valor;
            var saldo = saldoPorMes[e.anoMes] != null ? saldoPorMes[e.anoMes] : custo;
            return (saldo - custo) > 0.01 ? [custo, saldo] : null;
        });
        var lucroAmounts = evolucao.map(function (e) {
            var custo = e.valor;
            var saldo = saldoPorMes[e.anoMes] != null ? saldoPorMes[e.anoMes] : custo;
            return Math.max(0, saldo - custo);
        });

        // Dataset 3: vermelho flutuante [0 → perda] na base — meses com prejuízo
        var prejData = evolucao.map(function (e) {
            var custo = e.valor;
            var saldo = saldoPorMes[e.anoMes] != null ? saldoPorMes[e.anoMes] : custo;
            var perda = custo - saldo;
            return perda > 0.01 ? [0, perda] : null;
        });
        var prejAmounts = evolucao.map(function (e) {
            var custo = e.valor;
            var saldo = saldoPorMes[e.anoMes] != null ? saldoPorMes[e.anoMes] : custo;
            return Math.max(0, custo - saldo);
        });

        var temLucro = lucroData.some(function (d) { return d !== null; });
        var temPrej  = prejData.some(function (d) { return d !== null; });

        if (temLucro) {
            datasets.push({
                label: 'Lucro',
                data: lucroData,
                backgroundColor: 'rgba(74, 222, 128, 0.85)',
                borderRadius: 4,
                borderSkipped: false,
                amounts: lucroAmounts,
                order: 1,
            });
        }
        if (temPrej) {
            datasets.push({
                label: 'Prejuízo',
                data: prejData,
                backgroundColor: 'rgba(248, 113, 113, 0.85)',
                borderRadius: 4,
                borderSkipped: false,
                amounts: prejAmounts,
                order: 2,
            });
        }
    }

    return { labels: labels, datasets: datasets, noStack: true };
}

// Mesmo para proventos — sem camada extra, cor roxa
function dadosChartJsProventos(evolucao) {
    if (!evolucao.length) return null;
    return {
        labels: evolucao.map(function (e) { return e.label; }),
        datasets: [{
            label: 'Proventos recebidos',
            data: evolucao.map(function (e) { return e.valor; }),
            backgroundColor: 'rgba(107, 63, 194, 0.82)',
            borderRadius: 4,
            borderSkipped: false,
            stack: 'bar',
        }],
    };
}

// [FLUXO v1] Dados para o gráfico de barras agrupadas (lado a lado) de compras e vendas.
function dadosChartJsFluxo(fluxo) {
    return {
        labels: fluxo.map(function (f) { return f.label; }),
        isGrouped: true,
        datasets: [
            {
                label: 'Compras',
                data: fluxo.map(function (f) { return f.compras || null; }),
                backgroundColor: 'rgba(34,197,94,0.72)',
                borderColor: 'rgba(22,163,74,1)',
                borderWidth: 1,
                borderRadius: 3,
                borderSkipped: false,
            },
            {
                label: 'Vendas',
                data: fluxo.map(function (f) { return f.vendas || null; }),
                backgroundColor: 'rgba(239,68,68,0.65)',
                borderColor: 'rgba(220,38,38,1)',
                borderWidth: 1,
                borderRadius: 3,
                borderSkipped: false,
            },
        ],
    };
}

// Gera o HTML de um canvas + script inline de inicialização do Chart.js
// id: id único do canvas; dados: retorno de dadosChartJsEvolucao/Proventos
// formato: função de formatação de valor para os eixos ('R$ X' ou 'R$ X,XX')
// Fila de gráficos pendentes de inicialização.
// Scripts inline injetados via innerHTML não executam no browser — por isso
// o render apenas empurra a config aqui e o roteador chama inicializarCharts()
// depois de montar o HTML no DOM.
var _chartQueue = [];

function htmlChartJs(id, dados, formatoY, altura, tipo) {
    altura = altura || 200;
    tipo = tipo || 'bar';

    // guarda config na fila; será processada após o innerHTML ser aplicado
    _chartQueue.push({ id: id, dados: dados, formatoY: formatoY, tipo: tipo });

    return '<div class="chart-wrap" style="position:relative;height:' + altura + 'px;">' +
        '<canvas id="' + id + '" role="img" aria-label="Gráfico"></canvas>' +
        '</div>';
}

// [RENT v4] Série acumulada carteira × CDI a partir do historicoRentabilidade.
// Inclui MTD (mês corrente parcial) se fornecido. Todas as linhas partem de 0%
// O primeiro mês da carteira é a origem (0%); seu retorno entra no acumulado dos meses seguintes.
// Retorna null se não houver nenhum ponto válido.
function dadosChartJsRentabAcumulada(usuarioId, mtd, ibovMapa, filtro, ifixMapa) {
    var db = loadDB();
    var cIdChart = carteiraIdAtual();
    var todoHist = (db.historicoRentabilidade || []).filter(function (h) {
        return h.usuarioId === usuarioId && (!cIdChart || h.carteiraId === cIdChart);
    });
    todoHist.sort(function (a, b) { return a.mes < b.mes ? -1 : 1; });

    // Todos os meses com rentabilidade calculada (inclusive o primeiro — sem "formação")
    var hist = [];
    todoHist.forEach(function (h) {
        if (h.rentabilidade !== null && h.rentabilidade !== undefined) { hist.push(h); }
    });

    // Monta lista de pontos: fechados + MTD (se houver e ainda não fechado)
    var pontos = hist.slice();
    if (mtd && mtd.rentabilidade !== null && mtd.rentabilidade !== undefined) {
        var jaFechado = pontos.some(function (h) { return h.mes === mtd.mes; });
        if (!jaFechado) pontos.push(mtd);
    }

    // [PERIOD v1] filtro de período: recorta pontos e reseta a origem para 0%
    if (filtro && filtro !== 'tudo' && pontos.length) {
        var hoje = new Date();
        var cutoff;
        if (filtro === 'ytd') {
            cutoff = hoje.getFullYear() + '-01';
        } else {
            var nMeses = parseInt(filtro, 10); // 3, 6, 12
            var d = new Date(hoje.getFullYear(), hoje.getMonth() - nMeses + 1, 1);
            cutoff = d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
        }
        pontos = pontos.filter(function (h) { return h.mes >= cutoff; });
    }

    if (!pontos.length) return null;

    var MESES_ABR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    var labels = [];
    var serieCart = [];
    var serieCdi = [];
    var serieIbov = [];
    var serieIfix = [];
    var acumCart = 1;
    var acumCdi = 1;
    var acumIbov = 1;
    var acumIfix = 1;
    var temIbov = ibovMapa && Object.keys(ibovMapa).length > 0;
    var temIfix = ifixMapa && Object.keys(ifixMapa).filter(function(k){return k[0]!=='_';}).length > 0;

    // Origem = primeiro mês real da carteira a 0% (estilo Investidor10).
    // O retorno do primeiro mês entra no acumulado mas não gera ponto visual separado:
    // o segundo mês já mostra o acumulado que inclui o primeiro.
    var fp = pontos[0].mes.split('-');
    var origemLabel = MESES_ABR[parseInt(fp[1], 10) - 1] + '/' + fp[0].slice(2);
    labels.push(origemLabel);
    serieCart.push(0);
    serieCdi.push(0);
    if (temIbov) serieIbov.push(0);
    if (temIfix) serieIfix.push(0);

    pontos.forEach(function (h, idx) {
        // Acumula o retorno do mês (inclusive do primeiro)
        acumCart *= (1 + Number(h.rentabilidade) / 100);
        var cdi = (h.cdi !== null && h.cdi !== undefined) ? Number(h.cdi) : 0;
        acumCdi *= (1 + cdi / 100);
        if (temIbov) {
            var prevM = _mesAnterior(h.mes);
            var ibovFim = ibovMapa[h.mes];
            var ibovIni = ibovMapa[prevM];
            var ibovRet = (ibovFim && ibovIni) ? (ibovFim / ibovIni - 1) : 0;
            acumIbov *= (1 + ibovRet);
        }
        if (temIfix) {
            var prevMI = _mesAnterior(h.mes);
            var ifixFim = ifixMapa[h.mes];
            var ifixIni = ifixMapa[prevMI];
            var ifixRet = (ifixFim && ifixIni) ? (ifixFim / ifixIni - 1) : 0;
            acumIfix *= (1 + ifixRet);
        }
        // O primeiro mês É a origem (0%) — seu retorno só aparece no ponto seguinte
        if (idx === 0) return;
        var partes = h.mes.split('-');
        var label = MESES_ABR[parseInt(partes[1], 10) - 1] + '/' + partes[0].slice(2);
        if (h.parcial) label += '*';
        labels.push(label);
        serieCart.push(+( (acumCart - 1) * 100 ).toFixed(4));
        serieCdi.push(+( (acumCdi - 1) * 100 ).toFixed(4));
        if (temIbov) serieIbov.push(+( (acumIbov - 1) * 100 ).toFixed(4));
        if (temIfix) serieIfix.push(+( (acumIfix - 1) * 100 ).toFixed(4));
    });

    var datasets = [
        {
            label: 'Carteira',
            data: serieCart,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.10)',
            fill: true,
            tension: 0.25,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#2563eb',
            borderWidth: 2,
        },
        {
            label: 'CDI',
            data: serieCdi,
            borderColor: '#d97706',
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.25,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#d97706',
            borderWidth: 2,
            borderDash: [],
        },
    ];
    if (temIbov) {
        datasets.push({
            label: 'IBOV',
            data: serieIbov,
            borderColor: '#dc2626',
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.25,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#dc2626',
            borderWidth: 2,
            borderDash: [4, 3],
            hidden: true,
        });
    }
    if (temIfix) {
        datasets.push({
            label: 'IFIX',
            data: serieIfix,
            borderColor: '#16a34a',
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.25,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#16a34a',
            borderWidth: 2,
            borderDash: [2, 2],
            hidden: true,
        });
    }
    return { labels: labels, datasets: datasets };
}

function inicializarCharts() {
    if (!window.Chart || !_chartQueue.length) return;

    // [DARK v1] cores adaptadas ao tema ativo
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var gridColor   = isDark ? 'rgba(255,255,255,0.09)' : '#b0b7c3';
    var tickColorX  = isDark ? 'rgba(255,255,255,0.35)' : '#94a3b8';
    var tickColorY  = isDark ? 'rgba(255,255,255,0.35)' : '#64748b';
    var legendColor = isDark ? 'rgba(255,255,255,0.45)' : '#64748b';

    _chartQueue.forEach(function (item) {
        var el = document.getElementById(item.id);
        if (!el) return;

        var existing = Chart.getChart(el);
        if (existing) existing.destroy();

        var fmt = item.formatoY;
        var isLine = item.tipo === 'line';

        var cfg = {
            type: isLine ? 'line' : 'bar',
            data: { labels: item.dados.labels, datasets: item.dados.datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 300 },
                grouped: item.dados.isGrouped || !item.dados.noStack,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: item.dados.datasets.length > 1,
                        position: 'bottom',

                        labels: {
                            boxWidth: 10, boxHeight: 10,
                            borderRadius: 2, useBorderRadius: true,
                            padding: 14, color: legendColor,
                            font: { size: 11 },
                        },
                    },
                    tooltip: {
                        callbacks: {
                            filter: function (item) {
                                return item.raw !== null && item.raw !== undefined;
                            },
                            label: function (ctx) {
                                if (ctx.raw === null || ctx.raw === undefined) return null;
                                // Barras flutuantes de Lucro/Prejuízo com metadata de valor absoluto
                                if (ctx.dataset.amounts !== undefined) {
                                    var amt = ctx.dataset.amounts[ctx.dataIndex];
                                    if (!amt || amt < 0.01) return null;
                                    var sinal = ctx.dataset.label === 'Lucro' ? '+' : '−';
                                    var valor = amt.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                    return ' ' + ctx.dataset.label + ': R$ ' + sinal + valor;
                                }
                                return ' ' + ctx.dataset.label + ': ' + fmt(ctx.parsed.y);
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        stacked: !isLine && !item.dados.noStack && !item.dados.isGrouped,
                        grid: { display: false },
                        border: { display: false },
                        ticks: { color: tickColorX, font: { size: 10 } },
                    },
                    y: {
                        stacked: !isLine && !item.dados.noStack && !item.dados.isGrouped,
                        grid: { color: gridColor, lineWidth: 1, borderDash: [5, 3] },
                        border: { display: false, dash: [5, 3] },
                        ticks: {
                            color: tickColorY, font: { size: 10 },
                            maxTicksLimit: 6,
                            callback: function (v) { return fmt(v); },
                        },
                    },
                },
            },
        };

        new Chart(el, cfg);
    });

    _chartQueue = [];
}

function montarGraficoAlocacao(alocacao) {
    if (!alocacao.length) return null;
    var raio = 45, centro = 60;
    var circunferencia = 2 * Math.PI * raio;
    var gap = alocacao.length > 1 ? 2 : 0;

    var offsetAcumulado = 0;
    var fatias = alocacao.map(function (item) {
        var fracao = item.percentual / 100;
        var comprimento = Math.max(fracao * circunferencia - gap, 0);
        var fatia = {
            classe: item.classe, label: item.label, percentual: item.percentual, valor: item.valor,
            cor: CORES_CLASSE[item.classe],
            dasharray: comprimento.toFixed(2) + ' ' + (circunferencia - comprimento).toFixed(2),
            dashoffset: (-offsetAcumulado).toFixed(2),
        };
        offsetAcumulado += fracao * circunferencia;
        return fatia;
    });

    return { raio: raio, centro: centro, fatias: fatias, total: alocacao.reduce(function (s, i) { return s + i.valor; }, 0) };
}

// Estado transiente do gráfico de histórico interativo (página de detalhe do
// ativo) — guarda os pontos já em coordenadas de viewBox SVG, pra
// wireGraficoHistorico() achar o ponto mais próximo do mouse sem precisar
// serializar nada em atributo HTML. Só existe um gráfico desse por vez na
// tela, então uma variável de módulo é suficiente (mesmo padrão do
// drawerState).
var graficoHistoricoState = null;

// Gráfico de linha do histórico de preço — único gráfico interativo do
// projeto (os outros, barra/donut, só têm <title> nativo do navegador).
// Cor da linha = mesma paleta categórica de CORES_CLASSE (a linha de uma
// Ação usa o azul que já identifica "Ação" no donut/tabela de Posições —
// consistência de identidade visual, não uma cor nova).
function montarGraficoHistoricoHTML(historico, corLinha) {
    // [GRAF v2 · 28/09/2026] O viewBox era fixo em 640x260 e o SVG esticava
    // até a largura do painel (~1080px): o gráfico ficava com ~440px de
    // altura e os textos inflados. Agora a largura do desenho acompanha a
    // largura da tela no momento de desenhar, então a escala fica perto de
    // 1:1 (texto no tamanho normal) e a altura fica fixa e contida:
    // 240px no computador, 190px no celular.
    var larguraTela = window.innerWidth || 1000;
    var celular = larguraTela <= 768;
    var largura = Math.max(300, Math.min(larguraTela, 1180) - (celular ? 60 : 130));
    var altura = celular ? 190 : 300;
    var padEsq = 46, padDir = 12, padTopo = 16, padBaixo = 28;
    var areaLargura = largura - padEsq - padDir;
    var areaAltura = altura - padTopo - padBaixo;

    var closes = historico.map(function (p) { return p.close; });
    var minClose = Math.min.apply(null, closes);
    var maxClose = Math.max.apply(null, closes);
    if (minClose === maxClose) { minClose -= 1; maxClose += 1; }
    var folga = (maxClose - minClose) * 0.12;
    var yMin = minClose - folga, yMax = maxClose + folga;

    var n = historico.length;
    var pontos = historico.map(function (p, i) {
        var x = padEsq + (n === 1 ? areaLargura / 2 : (i / (n - 1)) * areaLargura);
        var y = padTopo + (1 - (p.close - yMin) / (yMax - yMin)) * areaAltura;
        var anterior = i > 0 ? historico[i - 1].close : null;
        var variacaoPct = anterior ? ((p.close - anterior) / anterior) * 100 : null;
        return { x: x, y: y, close: p.close, date: p.date, variacaoPct: variacaoPct };
    });

    graficoHistoricoState = { pontos: pontos, largura: largura, altura: altura };

    var linePath = pontos.map(function (p, i) {
        return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1);
    }).join(' ');

    // eixo Y: 4 marcas (mín, 1/3, 2/3, máx da escala já com folga)
    var yTicksHtml = [0, 1 / 3, 2 / 3, 1].map(function (f) {
        var valor = yMin + f * (yMax - yMin);
        var y = padTopo + (1 - f) * areaAltura;
        return '<line x1="' + padEsq + '" y1="' + y.toFixed(1) + '" x2="' + (largura - padDir) + '" y2="' + y.toFixed(1) + '" class="hist-grid"/>' +
            '<text x="' + (padEsq - 8) + '" y="' + (y + 3).toFixed(1) + '" class="hist-axis-label" text-anchor="end">' + fmtPreco(valor) + '</text>';
    }).join('');

    // eixo X: no máximo ~6 rótulos de data, sempre incluindo o último pregão.
    // Primeiro rótulo ancorado à esquerda e último à direita (não centralizado)
    // pra não vazar/cortar no viewBox — só os do meio podem centralizar.
    var maxLabels = celular ? 4 : 6; // [GRAF v2] menos datas no celular
    var passo = Math.max(1, Math.ceil(n / maxLabels));
    var xLabelsHtml = pontos.filter(function (p, i) { return i % passo === 0 || i === n - 1; })
        .map(function (p, idx, lista) {
            var ancora = 'middle';
            if (p === lista[0]) ancora = 'start';
            else if (p === lista[lista.length - 1]) ancora = 'end';
            return '<text x="' + p.x.toFixed(1) + '" y="' + (altura - 8) + '" class="hist-axis-label" text-anchor="' + ancora + '">' + formatDataCurta(p.date) + '</text>';
        }).join('');

    return '' +
        '<div class="hist-chart-wrap">' +
        '<svg viewBox="0 0 ' + largura + ' ' + altura + '" class="chart-svg hist-chart-svg" role="img" aria-label="Histórico de preço de fechamento">' +
        yTicksHtml +
        '<path d="' + linePath + '" class="hist-line" style="stroke: ' + corLinha + ';" fill="none"/>' +
        xLabelsHtml +
        '<line class="hist-crosshair" x1="0" y1="' + padTopo + '" x2="0" y2="' + (altura - padBaixo) + '" style="display:none;"></line>' +
        '<circle class="hist-dot" r="5" style="display:none; fill: ' + corLinha + ';"></circle>' +
        '<rect class="hist-hit-rect" x="' + padEsq + '" y="' + padTopo + '" width="' + areaLargura + '" height="' + areaAltura + '" fill="transparent"></rect>' +
        '</svg>' +
        '<div class="hist-tooltip" style="display:none;"></div>' +
        '</div>';
}

// Liga o crosshair/tooltip do gráfico de histórico — chamado manualmente
// logo depois de inserir o HTML da página de detalhe (não dá pra confiar só
// em delegação de evento aqui porque pointermove precisa do
// getBoundingClientRect() do SVG específico dessa página).
function wireGraficoHistorico() {
    var wrap = document.querySelector('.hist-chart-wrap');
    if (!wrap || !graficoHistoricoState) return;

    var svg = wrap.querySelector('.hist-chart-svg');
    var hitRect = wrap.querySelector('.hist-hit-rect');
    var crosshair = wrap.querySelector('.hist-crosshair');
    var dot = wrap.querySelector('.hist-dot');
    var tooltip = wrap.querySelector('.hist-tooltip');
    var estado = graficoHistoricoState;

    function atualizar(clientX) {
        var rect = svg.getBoundingClientRect();
        if (!rect.width) return;
        var relX = clientX - rect.left;
        var svgX = (relX / rect.width) * estado.largura;

        var maisProximo = estado.pontos[0], menorDist = Infinity;
        estado.pontos.forEach(function (p) {
            var d = Math.abs(p.x - svgX);
            if (d < menorDist) { menorDist = d; maisProximo = p; }
        });

        crosshair.setAttribute('x1', maisProximo.x);
        crosshair.setAttribute('x2', maisProximo.x);
        crosshair.style.display = '';
        dot.setAttribute('cx', maisProximo.x);
        dot.setAttribute('cy', maisProximo.y);
        dot.style.display = '';

        var pxX = (maisProximo.x / estado.largura) * rect.width;
        var pxY = (maisProximo.y / estado.altura) * rect.height;

        var variacaoHtml = '';
        if (maisProximo.variacaoPct != null) {
            var subiu = maisProximo.variacaoPct >= 0;
            variacaoHtml = '<div class="hist-tooltip-variacao ' + (subiu ? 'up' : 'down') + '">' +
                (subiu ? '+' : '') + fmt2(maisProximo.variacaoPct) + '% vs. dia anterior</div>';
        }
        tooltip.innerHTML =
            '<div class="hist-tooltip-data"></div>' +
            '<div class="hist-tooltip-valor"></div>' +
            variacaoHtml;
        tooltip.querySelector('.hist-tooltip-data').textContent = formatDataCurta(maisProximo.date);
        tooltip.querySelector('.hist-tooltip-valor').textContent = 'R$ ' + fmtPreco(maisProximo.close); // [CRIPTO v1]
        tooltip.style.display = '';

        var tooltipWidth = tooltip.offsetWidth || 130;
        var left = pxX - tooltipWidth / 2;
        left = Math.max(4, Math.min(left, rect.width - tooltipWidth - 4));
        var tooltipHeight = tooltip.offsetHeight || 56;
        var top = pxY - tooltipHeight - 12;
        if (top < 4) top = pxY + 14;
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    }

    function esconder() {
        crosshair.style.display = 'none';
        dot.style.display = 'none';
        tooltip.style.display = 'none';
    }

    hitRect.addEventListener('pointermove', function (ev) { atualizar(ev.clientX); });
    hitRect.addEventListener('pointerleave', esconder);
}
