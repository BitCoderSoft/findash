/* =================================================================
   CAMADA DE DADOS (armazem faz o papel do db.sqlite3; ver STORE v1)
   ================================================================= */

function loadDB() {
    try {
        var raw = armazem.get(DB_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) { /* localStorage indisponível/corrompido — recomeça do zero */ }
    return { users: [], ativos: [], transacoes: [], nextId: 1 };
}

function saveDB(db) {
    armazem.set(DB_KEY, JSON.stringify(db));
}

function getSession() {
    try {
        var raw = armazem.get(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function setSession(userId, carteiraId) {
    armazem.set(SESSION_KEY, JSON.stringify({ userId: userId, carteiraId: carteiraId || null }));
}

function clearSession() {
    armazem.remove(SESSION_KEY);
}

function currentUser() {
    var session = getSession();
    if (!session) return null;
    var db = loadDB();
    var user = null;
    for (var i = 0; i < db.users.length; i++) {
        if (db.users[i].id === session.userId) { user = db.users[i]; break; }
    }
    return user;
}

// [MULTI v1] retorna o carteiraId ativo da sessão, ou null se não houver sessão
function carteiraIdAtual() {
    var sess = getSession();
    return (sess && sess.carteiraId) ? sess.carteiraId : null;
}

// [MULTI v1] retorna todas as carteiras do usuário
function carteirasDoUsuario(usuarioId) {
    var db = loadDB();
    return (db.carteiras || []).filter(function (c) { return c.usuarioId === usuarioId; })
        .sort(function (a, b) { return a.criadoEm - b.criadoEm; });
}

// [MULTI v1] cria uma nova carteira e retorna o objeto criado
function criarCarteira(usuarioId, nome) {
    var db = loadDB();
    db.carteiras = db.carteiras || [];
    var carteira = { id: db.nextId++, usuarioId: usuarioId, nome: nome || 'Nova carteira', criadoEm: Date.now() };
    db.carteiras.push(carteira);
    saveDB(db);
    if (typeof supLogado === 'function' && supLogado()) supUpsertCarteira(carteira); // [SUP v1]
    return carteira;
}

// [MULTI v1] renomeia uma carteira; retorna ok/erro
function renomearCarteira(carteiraId, novoNome) {
    if (!novoNome || !novoNome.trim()) return { ok: false, erro: 'Nome não pode ficar vazio.' };
    var db = loadDB();
    var c = (db.carteiras || []).filter(function (x) { return x.id === carteiraId; })[0];
    if (!c) return { ok: false, erro: 'Carteira não encontrada.' };
    c.nome = novoNome.trim();
    saveDB(db);
    if (typeof supLogado === 'function' && supLogado()) supUpsertCarteira(c); // [SUP v1]
    return { ok: true };
}

// [MULTI v1] migração one-shot: cria "Principal" para cada usuário que não tem carteira
// e taggeia transações/objetivos/histRentabilidade existentes com o carteiraId dela.
// Também migra chave de balanceamentos de userId → carteiraId.
function migrarParaMultiCarteira() {
    var db = loadDB();
    if (!db.users || !db.users.length) return;
    db.carteiras = db.carteiras || [];
    var alterou = false;
    db.users.forEach(function (u) {
        var temCarteira = db.carteiras.some(function (c) { return c.usuarioId === u.id; });
        if (temCarteira) return;
        var cId = db.nextId++;
        db.carteiras.push({ id: cId, usuarioId: u.id, nome: 'Principal', criadoEm: u.criadoEm || Date.now() });
        // Taggar transacoes
        (db.transacoes || []).forEach(function (t) {
            if (t.usuarioId === u.id && !t.carteiraId) { t.carteiraId = cId; alterou = true; }
        });
        // Taggar objetivos
        (db.objetivos || []).forEach(function (o) {
            if (o.usuarioId === u.id && !o.carteiraId) { o.carteiraId = cId; alterou = true; }
        });
        // Taggar historicoRentabilidade
        (db.historicoRentabilidade || []).forEach(function (h) {
            if (h.usuarioId === u.id && !h.carteiraId) { h.carteiraId = cId; alterou = true; }
        });
        // Migrar balanceamentos: key userId → key carteiraId
        db.balanceamentos = db.balanceamentos || {};
        if (db.balanceamentos[u.id] && !db.balanceamentos[cId]) {
            db.balanceamentos[cId] = db.balanceamentos[u.id];
            alterou = true;
        }
        alterou = true;
    });
    if (alterou) saveDB(db);
}

// Hash bem simples (NÃO criptográfico) só pra não guardar senha em texto puro
// no localStorage — mesmo espírito do SECRET_KEY hardcoded / DEBUG=True que o
// projeto Django aceita por ser 100% local. Não reaproveitar essa senha em
// nenhum serviço de verdade.
function hashSenha(senha) {
    var s = 'dashfinance:' + senha;
    var hash = 0;
    for (var i = 0; i < s.length; i++) {
        hash = (hash * 31 + s.charCodeAt(i)) | 0;
    }
    return 'h' + Math.abs(hash).toString(36) + ':' + s.length;
}

/* =================================================================
   AUTENTICAÇÃO (porte de forms.UserRegisterForm + views.register/login)
   ================================================================= */

function criarUsuario(username, email, senha1, senha2) {
    var erros = {};
    var db = loadDB();

    username = (username || '').trim();
    if (!username) erros.username = 'Este campo é obrigatório.';
    else if (db.users.some(function (u) { return u.username === username; })) {
        erros.username = 'Já existe um usuário com esse nome.';
    }

    if (!email) erros.email = 'Este campo é obrigatório.';

    if (!senha1) erros.password1 = 'Este campo é obrigatório.';
    else if (senha1.length < 8) erros.password1 = 'Esta senha é muito curta. Ela precisa conter pelo menos 8 caracteres.';
    else if (/^\d+$/.test(senha1)) erros.password1 = 'Esta senha é inteiramente numérica.';

    if (senha1 && senha2 && senha1 !== senha2) erros.password2 = 'Os dois campos de senha não correspondem.';

    if (Object.keys(erros).length) return { ok: false, erros: erros };

    var user = { id: db.nextId++, username: username, email: email, passwordHash: hashSenha(senha1), criadoEm: Date.now() };
    db.users.push(user);
    // [MULTI v1] toda conta nova ganha uma carteira "Principal" automaticamente
    db.carteiras = db.carteiras || [];
    var carteiraInicial = { id: db.nextId++, usuarioId: user.id, nome: 'Principal', criadoEm: Date.now() };
    db.carteiras.push(carteiraInicial);
    saveDB(db);
    return { ok: true, user: user, carteiraId: carteiraInicial.id };
}

function autenticar(username, senha) {
    var db = loadDB();
    var user = db.users.filter(function (u) { return u.username === username; })[0];
    if (!user) return null;
    if (user.passwordHash !== hashSenha(senha)) return null;
    return user;
}

/* =================================================================
   SERVICES — porte fiel de investments/services.py
   ================================================================= */

// [CRIPTO v2 · 28/09/2026] PERNAS DE UMA TRANSAÇÃO
// Com Entrada, Saída e Conversão, "compra soma, venda subtrai" deixou de
// bastar. Toda regra de saldo agora olha as PERNAS: cada transação vira uma
// ou duas variações de quantidade por ativo.
//   COMPRA / ENTRADA -> +quantidade no ativo
//   VENDA  / SAIDA   -> -quantidade no ativo
//   CONVERSAO        -> -quantidade na origem  e  +quantidadeDestino no destino
// Quem precisa de saldo (validação, lista de vendáveis, saldo de hoje) usa
// esta função. Quem precisa de CUSTO usa processarCarteira(), mais abaixo.
function pernasDaTransacao(t) {
    switch (t.tipo) {
        case 'COMPRA':
        case 'ENTRADA':
        case 'STAKE': // [STAKE v1] rendimento de staking: soma quantidade sem custo
            return [{ ativoId: t.ativoId, delta: t.quantidade }];
        case 'VENDA':
        case 'SAIDA':
            return [{ ativoId: t.ativoId, delta: -t.quantidade }];
        case 'CONVERSAO':
            return [
                { ativoId: t.ativoId, delta: -t.quantidade },
                { ativoId: t.ativoDestinoId, delta: t.quantidadeDestino },
            ];
    }
    return [];
}

// [MOTOR v2 · 28/09/2026 / CRIPTO v2] ORDEM CANÔNICA DOS LANÇAMENTOS
// Única função que decide a ordem de processamento. Preço médio, evolução
// mensal e validação TÊM que usar a mesma ordem, senão a validação aprova
// uma coisa e o cálculo processa outra.
// Critério: data -> prioridade no mesmo dia -> criadoEm -> id.
// Prioridade no dia: o que ENTRA (compra, entrada) vem antes da conversão,
// que vem antes do que SAI (venda, saída). Assim a ordem em que a pessoa
// digitou lançamentos do mesmo dia não muda o resultado: comprou DOGE,
// converteu em SOL e vendeu SOL no mesmo dia funciona em qualquer ordem
// de digitação.
var PRIORIDADE_NO_DIA = { COMPRA: 0, ENTRADA: 0, STAKE: 0, CONVERSAO: 1, VENDA: 2, SAIDA: 2, PROVENTO: 3 }; // [STAKE v1]

function ordenarTransacoes(lista) {
    return lista.slice().sort(function (a, b) {
        if (a.data < b.data) return -1;
        if (a.data > b.data) return 1;

        var pa = PRIORIDADE_NO_DIA[a.tipo] || 0;
        var pb = PRIORIDADE_NO_DIA[b.tipo] || 0;
        if (pa !== pb) return pa - pb;

        if (a.criadoEm !== b.criadoEm) return a.criadoEm - b.criadoEm;
        return a.id - b.id;
    });
}

// [CRIPTO v2] O CORAÇÃO DO CÁLCULO DE CUSTO
// Processa as transações (já ordenadas) e devolve a posição de cada ativo e
// quanto cada transação mudou o custo total da carteira. Regras:
//   COMPRA    -> soma quantidade e custo (qtd x preço + taxas)
//   ENTRADA   -> soma SÓ quantidade. Custo zero, sempre (decisão do Junior:
//                mineração, recompensa, airdrop, presente. Transferência
//                entre carteiras próprias não se lança: aqui não há
//                separação por carteira, tudo é um saldo único por ativo)
//   VENDA     -> tira quantidade e o custo proporcional pelo preço médio
//                (método brasileiro, o preço da venda não entra no custo)
//   SAIDA     -> igual à venda: é uma venda que não devolveu reais
//                (taxa de rede, envio a terceiros, perda)
//   CONVERSAO -> tira da origem pelo preço médio, e ESSE MESMO custo entra
//                no destino. Nenhuma cotação em reais participa. O custo
//                total da carteira não muda, só troca de ativo.
// deltaCusto[idTransacao] alimenta a evolução mensal.
//
// [CRIPTO v2.1 · 28/09/2026] PREÇO MÉDIO DE COMPRA
// Junior testou com dados reais: a entrada gratuita derrubava o preço médio
// (ETH comprado a 14.033,60 aparecia com PM 13.757,78). Correção: além da
// quantidade total, cada posição agora sabe quanto dela TEM CUSTO
// (qtdComCusto). O preço médio exibido é custo ÷ qtdComCusto, então a
// entrada gratuita aumenta a quantidade mas NÃO mexe no PM, igual ao
// CoinMarketCap.
// O que NÃO mudou: custo total (valor investido) e a baixa proporcional.
// Numa venda/saída/conversão, a parte com custo e a parte gratuita saem na
// mesma proporção, então o PM de compra continua igual depois da baixa
// (como no método brasileiro). Numa conversão, a fração com custo que saiu
// da origem vira fração com custo no destino.
// A rentabilidade passou a ser calculada pelo VALOR (valor atual ÷ custo),
// não pelo PM: assim o ganho das moedas gratuitas continua aparecendo nela.
function processarCarteira(transacoesOrdenadas, ativosPorId) {
    var posicoes = {};
    var deltaCusto = {};
    var realizado = {}; // [CONV v1] ganho/perda fiscal realizado por CONVERSAO com precoUnitario

    function pos(ativoId) {
        if (!posicoes[ativoId]) {
            posicoes[ativoId] = { ativo: ativosPorId[ativoId], quantidade: 0, custoTotal: 0, qtdComCusto: 0 };
        }
        return posicoes[ativoId];
    }

    // tira `q` da posição de forma proporcional (custo e parte com custo
    // saem na mesma fração). Devolve { custo, qtdComCusto } que saíram.
    function baixar(p, q) {
        var fracao = p.quantidade > 0 ? Math.min(q / p.quantidade, 1) : 0;
        var custo = p.custoTotal * fracao;
        var comCusto = p.qtdComCusto * fracao;
        p.quantidade -= q;
        p.custoTotal -= custo;
        p.qtdComCusto -= comCusto;

        // [MOTOR v2] resíduo de ponto flutuante: abaixo da tolerância, zera
        // de vez (senão 0,1 + 0,2 - 0,3 deixava uma posição "fantasma")
        if (Math.abs(p.quantidade) < QTD_EPSILON) {
            custo += p.custoTotal;
            comCusto += p.qtdComCusto;
            p.quantidade = 0;
            p.custoTotal = 0;
            p.qtdComCusto = 0;
        }
        return { custo: custo, qtdComCusto: comCusto };
    }

    transacoesOrdenadas.forEach(function (t) {
        var delta = 0;

        if (t.tipo === 'COMPRA') {
            var p = pos(t.ativoId);
            delta = t.quantidade * t.precoUnitario + (t.corretagemTaxas || 0);
            p.quantidade += t.quantidade;
            p.custoTotal += delta;
            p.qtdComCusto += t.quantidade;
        } else if (t.tipo === 'ENTRADA' || t.tipo === 'STAKE') {
            // [STAKE v1] stake idêntico à entrada: soma quantidade sem mexer no custo nem no PM
            pos(t.ativoId).quantidade += t.quantidade;
        } else if (t.tipo === 'VENDA' || t.tipo === 'SAIDA') {
            delta = -baixar(pos(t.ativoId), t.quantidade).custo;
        } else if (t.tipo === 'CONVERSAO') {
            var saiu = baixar(pos(t.ativoId), t.quantidade);
            var destino = pos(t.ativoDestinoId);
            destino.quantidade += t.quantidadeDestino;
            if (t.precoUnitario) {
                // [CONV v1] Realização fiscal: destino entra pelo valor de mercado
                var valorConv = t.quantidade * t.precoUnitario;
                realizado[t.id] = valorConv - saiu.custo;
                destino.custoTotal += valorConv;
                destino.qtdComCusto += t.quantidadeDestino;
            } else {
                // Legado: custo migra sem realização fiscal
                destino.custoTotal += saiu.custo;
                var fracaoComCusto = t.quantidade > 0 ? saiu.qtdComCusto / t.quantidade : 0;
                destino.qtdComCusto += t.quantidadeDestino * fracaoComCusto;
            }
        }

        deltaCusto[t.id] = delta;
    });

    return { posicoes: posicoes, deltaCusto: deltaCusto, realizado: realizado };
}

function ativosPorIdDe(db) {
    var mapa = {};
    db.ativos.forEach(function (a) { mapa[a.id] = a; });
    return mapa;
}

// [MOTOR v2] Tolerância pra comparação de quantidade em ponto flutuante.
var QTD_EPSILON = 1e-9;

// [MOTOR v2 / CRIPTO v2] Percorre as transações (já ordenadas) e devolve a
// primeira perna NEGATIVA do ativo que ficaria sem saldo, ou null.
// `quantidade` é o que aquela perna tentou tirar; `disponivel`, o que havia.
function primeiroFuroDeSaldo(transacoesOrdenadas, ativoId) {
    var saldo = 0;
    for (var i = 0; i < transacoesOrdenadas.length; i++) {
        var t = transacoesOrdenadas[i];
        var pernas = pernasDaTransacao(t);
        for (var j = 0; j < pernas.length; j++) {
            var perna = pernas[j];
            if (perna.ativoId !== ativoId) continue;

            if (perna.delta < 0 && -perna.delta > saldo + QTD_EPSILON) {
                return { transacao: t, disponivel: Math.max(saldo, 0), quantidade: -perna.delta };
            }
            saldo += perna.delta;
        }
    }
    return null;
}

// [MOTOR v2 · 28/09/2026 / CRIPTO v2] VALIDAÇÃO CRONOLÓGICA
// Simula a carteira COM a alteração aplicada e checa se alguma baixa
// (venda, saída ou origem de conversão), em qualquer data, fica sem saldo.
// alteracao = { editId, novo } pra salvar; { excluirId } pra excluir.
// Ativo ainda não cadastrado usa id fictício ('NOVO' / 'NOVO_DESTINO').
// Checa todos os ativos tocados pelas pernas da transação original e da
// nova (numa conversão, origem e destino).
function verificarCronologia(usuarioId, alteracao) {
    var db = loadDB();
    var cId = carteiraIdAtual();
    var idRemovido = alteracao.editId || alteracao.excluirId || null;

    var lista = db.transacoes.filter(function (t) {
        return t.usuarioId === usuarioId && (!cId || t.carteiraId === cId) && t.id !== idRemovido;
    });

    var afetados = [];
    function marcar(t) {
        pernasDaTransacao(t).forEach(function (p) {
            if (afetados.indexOf(p.ativoId) === -1) afetados.push(p.ativoId);
        });
    }

    if (idRemovido) {
        var original = db.transacoes.filter(function (t) { return t.id === idRemovido; })[0];
        if (original) marcar(original);
    }
    if (alteracao.novo) {
        lista.push(alteracao.novo);
        marcar(alteracao.novo);
    }

    var ordenadas = ordenarTransacoes(lista);
    for (var i = 0; i < afetados.length; i++) {
        var furo = primeiroFuroDeSaldo(ordenadas, afetados[i]);
        if (furo) {
            furo.ativoId = afetados[i];
            furo.ehANova = furo.transacao === alteracao.novo;
            return furo;
        }
    }
    return null;
}

// Frase curta pra mensagem de erro: "a venda de 10 GGRC11 em 23/09/2026"
var NOME_DA_BAIXA = { VENDA: 'a venda', SAIDA: 'a saída', CONVERSAO: 'a conversão' };

function descreverFuro(furo, ticker) {
    return (NOME_DA_BAIXA[furo.transacao.tipo] || 'o lançamento') + ' de ' +
        formatarQuantidadeLivre(furo.quantidade) + ' ' + ticker +
        ' em ' + formatDataBR(furo.transacao.data);
}

// Porte de _custo_medio_por_ativo(usuario). [CRIPTO v2] agora é só um
// atalho pra processarCarteira(), que conhece os 5 tipos.
function custoMedioPorAtivo(usuarioId) {
    var db = loadDB();
    var cId = carteiraIdAtual();
    var transacoes = ordenarTransacoes(
        db.transacoes.filter(function (t) { return t.usuarioId === usuarioId && (!cId || t.carteiraId === cId); })
    );
    return processarCarteira(transacoes, ativosPorIdDe(db)).posicoes;
}

// [PROV v1] total de proventos por ativo: { ativoId: { total, qtd, ultimo } }
function proventosPorAtivo(usuarioId) {
    var db = loadDB();
    var cId = carteiraIdAtual();
    var mapa = {};
    db.transacoes.forEach(function (t) {
        if (t.usuarioId !== usuarioId || t.tipo !== 'PROVENTO') return;
        if (cId && t.carteiraId !== cId) return;
        var m = mapa[t.ativoId] || (mapa[t.ativoId] = { total: 0, qtd: 0, ultimo: null });
        m.total += Number(t.valor) || 0;
        m.qtd += 1;
        if (!m.ultimo || t.data > m.ultimo) m.ultimo = t.data;
    });
    return mapa;
}

function totalProventos(usuarioId) {
    var mapa = proventosPorAtivo(usuarioId);
    return Object.keys(mapa).reduce(function (s, k) { return s + mapa[k].total; }, 0);
}

// [RF v1] Posições de Renda Fixa: { ativoId: { ativo, aportado, rendimento, saldo, yield } }
function posicoesRF(usuarioId) {
    var db = loadDB();
    var cId = carteiraIdAtual();
    var ativosPorId = ativosPorIdDe(db);
    var mapa = {};
    db.transacoes.forEach(function (t) {
        if (t.usuarioId !== usuarioId) return;
        if (cId && t.carteiraId !== cId) return;
        var ativo = ativosPorId[t.ativoId];
        if (!ativo || ativo.classe !== 'RENDA_FIXA') return;
        if (!mapa[t.ativoId]) mapa[t.ativoId] = { ativo: ativo, aportado: 0, rendimento: 0, resgatado: 0 };
        if (t.tipo === 'APORTE')        mapa[t.ativoId].aportado   += Number(t.valor) || 0;
        if (t.tipo === 'RENDIMENTO_RF') mapa[t.ativoId].rendimento += Number(t.valor) || 0;
        if (t.tipo === 'RESGATE')       mapa[t.ativoId].resgatado  += Number(t.valor) || 0;
    });
    return Object.keys(mapa).map(function (k) {
        var p = mapa[k];
        p.saldo = p.aportado + p.rendimento - p.resgatado;
        p.yieldPct = p.aportado > 0 ? (p.rendimento / p.aportado) * 100 : 0;
        return p;
    }).sort(function (a, b) { return b.aportado - a.aportado; });
}

// [RF v1] saldo líquido de RF (aportado + rendimento − resgatado); entra no valorInvestido.
function totalAportadoRF(usuarioId) {
    return posicoesRF(usuarioId).reduce(function (s, p) { return s + Math.max(0, p.saldo); }, 0);
}

// Porte de quantidade_disponivel: saldo líquido de HOJE (sem olhar datas).
// Usada pela lista de ativos vendáveis e pra sugerir quantidade.
// [CRIPTO v2] soma as pernas, então entende entrada, saída e conversão.
function quantidadeDisponivel(usuarioId, ativoId, excluirTransacaoId) {
    var db = loadDB();
    var cId = carteiraIdAtual();
    var quantidade = 0;
    db.transacoes.forEach(function (t) {
        if (t.usuarioId !== usuarioId) return;
        if (cId && t.carteiraId !== cId) return;
        if (excluirTransacaoId && t.id === excluirTransacaoId) return;
        pernasDaTransacao(t).forEach(function (p) {
            if (p.ativoId === ativoId) quantidade += p.delta;
        });
    });
    return quantidade;
}

// Porte de posicoes_atuais(usuario).
function posicoesAtuais(usuarioId) {
    var posicoes = custoMedioPorAtivo(usuarioId);
    var abertas = Object.keys(posicoes).map(function (k) { return posicoes[k]; }).filter(function (p) { return p.quantidade > 0; });
    var total = abertas.reduce(function (s, p) { return s + p.custoTotal; }, 0);

    var resultado = abertas.map(function (p) {
        // [CRIPTO v2.1] PM de compra: só a parte da quantidade que tem custo
        var qtdComCusto = p.qtdComCusto > QTD_EPSILON ? p.qtdComCusto : 0;
        return {
            ativo: p.ativo,
            quantidade: p.quantidade,
            qtdSemCusto: Math.max(p.quantidade - qtdComCusto, 0),
            precoMedio: qtdComCusto > 0 ? p.custoTotal / qtdComCusto : 0,
            valorInvestido: p.custoTotal,
            percentual: total > 0 ? (p.custoTotal / total) * 100 : 0,
        };
    });
    resultado.sort(function (a, b) { return b.valorInvestido - a.valorInvestido; });
    return resultado;
}

// Porte de posicoes_por_classe(usuario): reagrupa posicoesAtuais(), não
// recalcula nada — mesma fonte de verdade.
function posicoesPorClasse(usuarioId) {
    var posicoes = posicoesAtuais(usuarioId);
    if (!posicoes.length) return [];

    var totalCarteira = posicoes.reduce(function (s, p) { return s + p.valorInvestido; }, 0);
    var porClasse = {};
    posicoes.forEach(function (p) {
        var classe = p.ativo.classe;
        if (!porClasse[classe]) porClasse[classe] = { classe: classe, posicoes: [], valorTotal: 0 };
        porClasse[classe].posicoes.push(p);
        porClasse[classe].valorTotal += p.valorInvestido;
    });

    var resultado = [];
    CLASSES_ORDEM.forEach(function (classe) {
        var grupo = porClasse[classe];
        if (grupo) {
            grupo.label = CLASSES[classe];
            grupo.percentual = totalCarteira > 0 ? (grupo.valorTotal / totalCarteira) * 100 : 0;
            grupo.cor = CORES_CLASSE[classe];
            resultado.push(grupo);
        }
    });
    return resultado;
}

// Porte de aplicar_cotacoes_lista(posicoes, cotacoes).
// [CRIPTO v2] posição com custo zero (só entradas, ex.: cripto minerada)
// tem cotação e valor atual, mas NÃO tem rentabilidade percentual (não se
// divide por zero). Ela ganha custoZero = true e a tela mostra isso no
// lugar da porcentagem. Antes ela aparecia como "sem cotação".
function aplicarCotacoesLista(posicoes, cotacoes) {
    posicoes.forEach(function (p) {
        // [RF v1] posição de Renda Fixa não tem cotação de mercado; saldo já calculado
        if (p._isRF) { p.custoZero = false; return; }

        var cot = cotacoes[p.ativo.ticker];
        p.custoZero = false;

        if (cot) {
            p.cotacao = cot;
            p.precoAtual = cot.precoAtual;
            p.valorAtual = cot.precoAtual * p.quantidade;

            if (p.valorInvestido > 0) {
                // [CRIPTO v2.1] pelo valor, não pelo PM (ver PREÇO MÉDIO DE COMPRA)
                p.rentabilidadePercentual = ((p.valorAtual - p.valorInvestido) / p.valorInvestido) * 100;
                p.lucro = p.rentabilidadePercentual > 0;
            } else {
                p.rentabilidadePercentual = null;
                p.custoZero = true;
                p.lucro = p.valorAtual > 0;
            }
        } else {
            p.cotacao = null;
            p.precoAtual = null;
            p.valorAtual = null;
            p.rentabilidadePercentual = null;
            p.lucro = null;
        }
    });
    return posicoes;
}

function temValorAtual(p) {
    return p.valorAtual !== null && p.valorAtual !== undefined;
}

// Porte de calcular_kpis_mercado(posicoes).
// [CRIPTO v2] entra no lucro toda posição com valor atual, inclusive as de
// custo zero (o valor inteiro delas é ganho).
function calcularKpisMercado(posicoes) {
    var avaliadas = posicoes.filter(temValorAtual);
    var base = { avaliadas: avaliadas.length, semCotacao: posicoes.length - avaliadas.length };
    if (!avaliadas.length) return Object.assign({}, base, { lucroPrejuizo: null, rentabilidade: null });

    var valorInvestido = avaliadas.reduce(function (s, p) { return s + p.valorInvestido; }, 0);
    var valorAtual = avaliadas.reduce(function (s, p) { return s + p.valorAtual; }, 0);
    var lucroPrejuizo = valorAtual - valorInvestido;

    return Object.assign({}, base, {
        lucroPrejuizo: lucroPrejuizo,
        rentabilidade: valorInvestido > 0 ? (lucroPrejuizo / valorInvestido) * 100 : 0,
    });
}

// Porte de destaques_carteira(grupos).
// [CRIPTO v2] melhor/pior comparam PORCENTAGEM, então só entram posições
// com custo (as de custo zero não têm %). "No lucro" conta todas com valor
// atual, e custo zero com valor conta como lucro.
function destaquesCarteira(grupos) {
    var todas = [];
    grupos.forEach(function (g) { todas = todas.concat(g.posicoes); });
    var comValor = todas.filter(temValorAtual);
    var comPercentual = comValor.filter(function (p) { return p.rentabilidadePercentual !== null; });

    var base = {
        total: todas.length,
        avaliadas: comValor.length,
        semCotacao: todas.length - comValor.length,
    };
    if (!comValor.length) return Object.assign({}, base, { melhor: null, pior: null, noLucro: 0, percentualNoLucro: 0 });

    var melhor = null, pior = null;
    comPercentual.forEach(function (p) {
        if (!melhor || p.rentabilidadePercentual > melhor.rentabilidadePercentual) melhor = p;
        if (!pior || p.rentabilidadePercentual < pior.rentabilidadePercentual) pior = p;
    });
    var noLucro = comValor.filter(function (p) { return p.lucro; }).length;

    return Object.assign({}, base, {
        melhor: melhor,
        pior: pior,
        noLucro: noLucro,
        percentualNoLucro: (noLucro / comValor.length) * 100,
    });
}

// Porte de aplicar_cotacoes(grupos, cotacoes).
function aplicarCotacoes(grupos, cotacoes) {
    grupos.forEach(function (g) { aplicarCotacoesLista(g.posicoes, cotacoes); });
    return grupos;
}

// Porte de calcular_kpis(usuario).
function calcularKpis(usuarioId) {
    var posicoes = custoMedioPorAtivo(usuarioId);
    var abertas = Object.keys(posicoes).map(function (k) { return posicoes[k]; }).filter(function (p) { return p.quantidade > 0; });
    var valorInvestido = abertas.reduce(function (s, p) { return s + p.custoTotal; }, 0);
    // [RF v1] soma o aportado em renda fixa no total investido
    valorInvestido += totalAportadoRF(usuarioId);
    var numPosicoes = abertas.length + posicoesRF(usuarioId).filter(function (p) { return p.saldo > 0; }).length;
    return { valorInvestido: valorInvestido, numPosicoes: numPosicoes, lucroPrejuizo: null, rentabilidade: null };
}

// Porte de alocacao_por_classe(usuario).
function alocacaoPorClasse(usuarioId) {
    var posicoes = custoMedioPorAtivo(usuarioId);
    var valorPorClasse = {};
    Object.keys(posicoes).forEach(function (k) {
        var p = posicoes[k];
        if (p.quantidade > 0 && p.custoTotal > 0) {
            var classe = p.ativo.classe;
            valorPorClasse[classe] = (valorPorClasse[classe] || 0) + p.custoTotal;
        }
    });
    // [RF v1] incluir Renda Fixa no gráfico de alocação
    var rfTotal = totalAportadoRF(usuarioId);
    if (rfTotal > 0) valorPorClasse['RENDA_FIXA'] = (valorPorClasse['RENDA_FIXA'] || 0) + rfTotal;
    var total = Object.keys(valorPorClasse).reduce(function (s, k) { return s + valorPorClasse[k]; }, 0);
    if (total <= 0) return [];

    var resultado = [];
    CLASSES_ORDEM.forEach(function (classe) {
        var valor = valorPorClasse[classe];
        if (valor) resultado.push({ classe: classe, label: CLASSES[classe], valor: valor, percentual: (valor / total) * 100 });
    });
    return resultado;
}

// Porte de evolucao_mensal(usuario): custo de aquisição acumulado mês a mês,
// preenchendo meses sem lançamento com o acumulado do mês anterior.
// [CRIPTO v2] o custo de cada transação vem de processarCarteira() (mesma
// regra do preço médio). Entrada e conversão não mudam o custo total, então
// não mexem no gráfico; saída tira custo como a venda.
// [RF v1] APORTEs de Renda Fixa entram como delta positivo no mês correspondente.
function evolucaoMensal(usuarioId) {
    var db = loadDB();
    var cId = carteiraIdAtual();
    var ativosPorId = ativosPorIdDe(db);
    var transacoes = ordenarTransacoes(
        db.transacoes.filter(function (t) { return t.usuarioId === usuarioId && (!cId || t.carteiraId === cId); })
    );
    var deltaCusto = processarCarteira(transacoes, ativosPorId).deltaCusto;

    var deltasPorMes = {}; // chave "ANO-MES" -> delta
    // Rastreia APORTE acumulado por ativo de RF para limitar dedução do RESGATE.
    // RESGATE inclui principal + rendimentos; só o principal entrou como custo,
    // então deduzir o valor cheio criaria custo negativo (lucro fantasma no gráfico).
    var aporteAcumRF = {};
    transacoes.forEach(function (t) {
        var partes = t.data.split('-');
        var chave = partes[0] + '-' + parseInt(partes[1], 10);
        // APORTEs de RF: delta positivo; RESGATEs de RF: delta negativo limitado ao APORTE
        var ativo = ativosPorId[t.ativoId];
        if (t.tipo === 'APORTE' && ativo && ativo.classe === 'RENDA_FIXA') {
            var v = Number(t.valor) || 0;
            aporteAcumRF[t.ativoId] = (aporteAcumRF[t.ativoId] || 0) + v;
            deltasPorMes[chave] = (deltasPorMes[chave] || 0) + v;
        } else if (t.tipo === 'RESGATE' && ativo && ativo.classe === 'RENDA_FIXA') {
            var acum = aporteAcumRF[t.ativoId] || 0;
            var deducao = Math.min(Number(t.valor) || 0, acum);
            aporteAcumRF[t.ativoId] = acum - deducao;
            deltasPorMes[chave] = (deltasPorMes[chave] || 0) - deducao;
        } else {
            deltasPorMes[chave] = (deltasPorMes[chave] || 0) + (deltaCusto[t.id] || 0);
        }
    });

    var chaves = Object.keys(deltasPorMes);
    if (!chaves.length) return [];

    function parseChave(c) { var p = c.split('-'); return { ano: parseInt(p[0], 10), mes: parseInt(p[1], 10) }; }
    function antes(a, b) { return a.ano < b.ano || (a.ano === b.ano && a.mes < b.mes); }
    function depois(a, b) { return a.ano > b.ano || (a.ano === b.ano && a.mes > b.mes); }

    var min = parseChave(chaves[0]), max = parseChave(chaves[0]);
    chaves.forEach(function (c) {
        var atual = parseChave(c);
        if (antes(atual, min)) min = atual;
        if (depois(atual, max)) max = atual;
    });

    var hoje = new Date();
    var hojeChave = { ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 };
    var ultimo = depois(hojeChave, max) ? hojeChave : max;

    var resultado = [];
    var acumulado = 0;
    var ano = min.ano, mes = min.mes;
    while (ano < ultimo.ano || (ano === ultimo.ano && mes <= ultimo.mes)) {
        var chaveAtual = ano + '-' + mes;
        acumulado += deltasPorMes[chaveAtual] || 0;
        resultado.push({ label: MESES_PT[mes - 1] + '/' + String(ano).slice(2), valor: acumulado, anoMes: ano + '-' + (mes < 10 ? '0' : '') + mes });
        mes += 1;
        if (mes > 12) { mes = 1; ano += 1; }
    }
    return resultado;
}

// Busca o ativo pelo ticker (case-sensitive, já normalizado em maiúsculas).
// Usada por market.js — precisa ser global (data.js carrega antes de market.js).
function buscarAtivoPorTicker(ticker) {
    if (!ticker) return null;
    var db = loadDB();
    return db.ativos.filter(function (a) { return a.ticker === ticker; })[0] || null;
}
// [FLUXO v1] Fluxo mensal de aportes e retiradas: compras vs vendas por mês.
// Compras: COMPRA (qty×preço+taxas) + APORTE RF (t.valor)
// Vendas:  VENDA (qty×preço) + RESGATE RF (t.valor)
// Excluídos: ENTRADA, STAKE, CONVERSAO, SAIDA (não são fluxo de caixa direto),
//            PROVENTO, RENDIMENTO_RF (não movimentam posição de capital)
function fluxoMensalAportes(usuarioId) {
    var db = loadDB();
    var cId = carteiraIdAtual();
    var ativosPorId = ativosPorIdDe(db);
    var transacoes = db.transacoes.filter(function (t) {
        return t.usuarioId === usuarioId && (!cId || t.carteiraId === cId);
    });
    if (!transacoes.length) return [];

    var comprasPorMes = {}, vendasPorMes = {};
    transacoes.forEach(function (t) {
        var partes = t.data.split('-');
        var chave = partes[0] + '-' + parseInt(partes[1], 10);
        var ativo = ativosPorId[t.ativoId];
        if (!ativo) return;

        if (t.tipo === 'COMPRA') {
            var v = (Number(t.quantidade) || 0) * (Number(t.precoUnitario) || 0) + (Number(t.taxas) || 0);
            comprasPorMes[chave] = (comprasPorMes[chave] || 0) + v;
        } else if (t.tipo === 'APORTE' && ativo.classe === 'RENDA_FIXA') {
            comprasPorMes[chave] = (comprasPorMes[chave] || 0) + (Number(t.valor) || 0);
        } else if (t.tipo === 'VENDA') {
            var vv = (Number(t.quantidade) || 0) * (Number(t.precoUnitario) || 0);
            vendasPorMes[chave] = (vendasPorMes[chave] || 0) + vv;
        } else if (t.tipo === 'RESGATE' && ativo.classe === 'RENDA_FIXA') {
            vendasPorMes[chave] = (vendasPorMes[chave] || 0) + (Number(t.valor) || 0);
        }
    });

    var todosChaves = {};
    Object.keys(comprasPorMes).forEach(function (k) { todosChaves[k] = true; });
    Object.keys(vendasPorMes).forEach(function (k) { todosChaves[k] = true; });
    var chaves = Object.keys(todosChaves);
    if (!chaves.length) return [];

    function parseChave(c) { var p = c.split('-'); return { ano: parseInt(p[0], 10), mes: parseInt(p[1], 10) }; }
    function antes(a, b) { return a.ano < b.ano || (a.ano === b.ano && a.mes < b.mes); }
    function depois(a, b) { return a.ano > b.ano || (a.ano === b.ano && a.mes > b.mes); }

    var min = parseChave(chaves[0]), max = parseChave(chaves[0]);
    chaves.forEach(function (c) {
        var atual = parseChave(c);
        if (antes(atual, min)) min = atual;
        if (depois(atual, max)) max = atual;
    });

    var resultado = [];
    var ano = min.ano, mes = min.mes;
    while (ano < max.ano || (ano === max.ano && mes <= max.mes)) {
        var chaveAtual = ano + '-' + mes;
        var compras = comprasPorMes[chaveAtual] || 0;
        var vendas = vendasPorMes[chaveAtual] || 0;
        if (compras > 0 || vendas > 0) {
            resultado.push({
                anoMes: ano + '-' + (mes < 10 ? '0' : '') + mes,
                label: MESES_PT[mes - 1] + '/' + String(ano).slice(2),
                compras: compras,
                vendas: vendas,
            });
        }
        mes += 1;
        if (mes > 12) { mes = 1; ano += 1; }
    }
    return resultado;
}

