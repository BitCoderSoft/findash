/* =================================================================
   UTILITÁRIOS — datas, formatação numérica, escape HTML
   ================================================================= */

// Retorna o mês anterior a "YYYY-MM" como "YYYY-MM"
function _mesAnterior(anoMes) {
    var p = anoMes.split('-');
    var ano = parseInt(p[0], 10), mes = parseInt(p[1], 10) - 1;
    if (mes < 1) { mes = 12; ano--; }
    return ano + '-' + (mes < 10 ? '0' : '') + mes;
}

/* =================================================================
   FORMATAÇÃO — notação do real: vírgula nos decimais, ponto nos milhares
   ================================================================= */

// [FMT v1 · 28/09/2026] Separador de milhar. Antes seguia o floatformat do
// Django, que não agrupa: "R$ 444699,60". Agora "R$ 444.699,60", pedido do
// Junior (com cripto os números grandes ficaram frequentes).
// Toda formatação numérica passa por formatarBR(); fmt0/fmt1/fmt2 são só
// atalhos. ATENÇÃO: o resultado é texto pra EXIBIR. Nunca usar em value de
// <input type="number"> nem em coordenada de SVG (lá o ponto seria lido como
// decimal). Pra campo de formulário existe numeroParaCampo().
function agruparMilhar(inteiro) {
    return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatarBR(n, casas) {
    n = Number(n) || 0;
    var s = Math.abs(n).toFixed(casas);
    var partes = s.split('.');
    partes[0] = agruparMilhar(partes[0]);
    // "-0,00" não existe: só põe o sinal se o valor arredondado não for zero
    var negativo = n < 0 && Number(s) !== 0;
    return (negativo ? '-' : '') + partes.join(',');
}

function fmt2(n) { return formatarBR(n, 2); }
function fmt1(n) { return formatarBR(n, 1); }
function fmt0(n) { return formatarBR(Math.round(Number(n) || 0), 0); }
function fmt4(n) { return formatarBR(n, 4); } // [CDI v1] para exibir taxa diária do CDI

// [CRIPTO v1 · 28/09/2026] Preço unitário com casas adaptativas. Acima de
// R$ 1 continua igual ao fmt2 (ações e FIIs não mudam nada). Abaixo disso
// mostra 4 algarismos significativos: DOGE sai "0,8712" e não "0,87", e
// um token de R$ 0,00001234 não vira "0,00". Usar SÓ em preço unitário
// (preço médio, preço atual, gráfico); totais em reais seguem com fmt2.
function fmtPreco(n) {
    n = Number(n) || 0;
    var abs = Math.abs(n);
    if (abs >= 1 || abs === 0) return fmt2(n);
    var casas = Math.min(10, Math.max(2, 3 - Math.floor(Math.log10(abs))));
    var s = n.toFixed(casas).replace(/0+$/, '');
    var partes = s.split('.');
    if (!partes[1] || partes[1].length < 2) s = n.toFixed(2);
    return s.replace('.', ',');
}

// Pros valores de ranking (market cap, liquidez em R$) — números na casa dos
// bilhões não cabem em "R$ 649623747413,00". Abrevia igual o resto do
// mercado financeiro brasileiro faz (B/M/mil).
function formatValorGrande(n) {
    n = Number(n) || 0;
    var abs = Math.abs(n);
    if (abs >= 1e9) return fmt2(n / 1e9) + ' B';
    if (abs >= 1e6) return fmt2(n / 1e6) + ' M';
    if (abs >= 1e3) return fmt2(n / 1e3) + ' mil';
    return fmt2(n);
}

// Porte do filtro de template quantidade_fmt: inteiro pra Ação/FII (B3 não
// fraciona ação/cota), decimal sem zero à direita pro resto.
function formatQuantidade(qtd, classe) {
    if (CLASSES_INTEIRAS[classe]) return fmt0(qtd);
    // [FMT v1] 8 casas no máximo, sem zeros sobrando, com milhar agrupado
    var s = Number(qtd).toFixed(8);
    if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    var partes = s.split('.');
    partes[0] = partes[0].replace(/^(-?)(\d+)$/, function (m, sinal, dig) { return sinal + agruparMilhar(dig); });
    return partes.join(',');
}

// Porte de forms._formatar_quantidade: usado nas mensagens de erro de venda.
// [FMT v1 · 28/09/2026] Deixou de ser fiel ao Python (que mostrava "0.5",
// com ponto) e passou a usar a notação do real como o resto da tela.
function formatarQuantidadeLivre(valor) {
    return formatQuantidade(valor, null);
}

// Retorna a data de hoje no formato 'YYYY-MM-DD' (sem deslocar por fuso).
function hojeISO() {
    var d = new Date();
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

// [MOTOR v2 · 28/09/2026] 'AAAA-MM-DD' (formato salvo nas transações) ->
// 'DD/MM/AAAA'. Só manipula string, sem Date, pra não deslocar o dia por fuso.
function formatDataBR(isoData) {
    var p = String(isoData || '').split('-');
    if (p.length !== 3) return String(isoData || '');
    return p[2] + '/' + p[1] + '/' + p[0];
}

// `date` do endpoint historical vem em segundos UNIX (UTC) — usa getUTC* pra
// não deslocar o dia por causa do fuso local.
function formatDataCurta(unixSegundos) {
    var d = new Date(unixSegundos * 1000);
    var dia = String(d.getUTCDate()).padStart(2, '0');
    var mes = String(d.getUTCMonth() + 1).padStart(2, '0');
    return dia + '/' + mes;
}
