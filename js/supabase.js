// ================================================================
// js/supabase.js — Bloco 7: integração Supabase
// ================================================================
// Dependências: CONSTANTES, ARMAZEM, data.js (loadDB)
// Carregado após engine.js, antes do IIFE
//
// Padrão offline-first:
//   - localStorage = cache local (leitura instantânea no boot)
//   - Supabase      = fonte da verdade confirmada em background
//
// Nenhuma função aqui toca o DOM. Funções de UI ficam no IIFE.

var SUPABASE_URL = 'https://qybjimzagdtzvmkrtapr.supabase.co';
var SUPABASE_KEY = 'sb_publishable_tYMF26RwtjYRIRiEh-8u_A_GUcr6hy_';

var supabaseClient   = null;
var _usuarioSupabase = null;   // user object do Supabase Auth
var _resolverBootAuth = null;
var _bootAuthPronto   = null;  // Promise — resolve quando onAuthStateChange disparar

// Chama no início do boot (antes de qualquer await em _bootAuthPronto).
function iniciarSupabase() {
    _bootAuthPronto = new Promise(function (resolve) {
        _resolverBootAuth = resolve;
    });

    if (typeof window.supabase === 'undefined') {
        console.warn('[Supabase] biblioteca não encontrada — modo offline');
        _resolverBootAuth();
        _resolverBootAuth = null;
        return;
    }

    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    supabaseClient.auth.onAuthStateChange(function (evento, sessao) {
        _usuarioSupabase = sessao ? sessao.user : null;
        if (_resolverBootAuth) {
            _resolverBootAuth();
            _resolverBootAuth = null;
        }
    });
}

// true se o cliente está pronto e o usuário está autenticado no Supabase
function supLogado() {
    return !!(supabaseClient && _usuarioSupabase);
}

// ----------------------------------------------------------------
// Mapeamento: objeto local (camelCase) → row Supabase (snake_case)
// ----------------------------------------------------------------

function _carteiraRow(c, uuid) {
    return {
        id:         String(c.id),
        usuario_id: uuid,
        nome:       c.nome,
        criado_em:  c.criadoEm ? new Date(c.criadoEm).toISOString() : new Date().toISOString(),
    };
}

function _ativoRow(a, uuid) {
    // 'mercado' não é armazenado no ativo local — deriva da classe
    var mercado = (typeof mercadoDaClasse === 'function') ? mercadoDaClasse(a.classe) : 'BOLSA';
    return {
        id:         String(a.id),
        usuario_id: uuid,
        ticker:     a.ticker,
        classe:     a.classe,
        mercado:    mercado,
        criado_em:  a.criadoEm ? new Date(a.criadoEm).toISOString() : new Date().toISOString(),
    };
}

function _transacaoRow(t, uuid) {
    var row = {
        id:             String(t.id),
        usuario_id:     uuid,
        ativo_id:       String(t.ativoId),
        carteira_id:    String(t.carteiraId),
        tipo:           t.tipo,
        data:           t.data,
        quantidade:     t.quantidade,
        preco_unitario: t.precoUnitario != null ? t.precoUnitario : null,
        taxas:          t.taxas || 0,
        descricao:      t.descricao  || null,
        criado_em:      t.criadoEm ? new Date(t.criadoEm).toISOString() : new Date().toISOString(),
    };
    if (t.ativoDestinoId   != null) row.ativo_destino_id    = String(t.ativoDestinoId);
    if (t.quantidadeDestino != null) row.quantidade_destino = t.quantidadeDestino;
    if (t.valor   != null) row.valor   = t.valor;   // RF (APORTE/RENDIMENTO_RF/RESGATE) e PROVENTO
    if (t.subtipo != null) row.subtipo = t.subtipo; // PROVENTO
    return row;
}

function _objetivoRow(o, uuid) {
    return {
        id:            String(o.id),
        usuario_id:    uuid,
        carteira_id:   String(o.carteiraId),
        nome:          o.nome,
        tipo:          o.tipo || 'PATRIMONIO',
        alvo:          o.alvo,
        aporte_mensal: o.aporteMensal != null ? o.aporteMensal : null,
        criado_em:     o.criadoEm    ? new Date(o.criadoEm).toISOString()    : new Date().toISOString(),
        concluido_em:  o.concluidoEm ? new Date(o.concluidoEm).toISOString() : null,
    };
}

function _histRow(h, uuid) {
    return {
        usuario_id:       uuid,
        carteira_id:      String(h.carteiraId),
        mes:              h.mes,
        rentabilidade:    h.rentabilidade    != null ? h.rentabilidade    : null,
        cdi:              h.cdi              != null ? h.cdi              : null,
        patrimonio_inicio: h.patrimonioInicio != null ? h.patrimonioInicio : null,
        patrimonio_fim:   h.patrimonioFim    != null ? h.patrimonioFim    : null,
        aportes_liquidos: h.aportesLiquidos  != null ? h.aportesLiquidos  : null,
        proventos:        h.proventos        != null ? h.proventos        : null,
        primeiro_mes:     !!h.primeiroMes,
        versao:           h.versao           != null ? h.versao           : null,
    };
}

function _balRow(carteiraId, dados, uuid) {
    return {
        carteira_id:   String(carteiraId),
        usuario_id:    uuid,
        classes:       dados.classes || null,
        notas:         dados.notas   || {},
        atualizado_em: new Date().toISOString(),
    };
}

// ----------------------------------------------------------------
// Upsert / delete individuais (chamados após cada saveDB)
// ----------------------------------------------------------------

function supUpsertCarteira(c) {
    if (!supLogado()) return Promise.resolve();
    return supabaseClient.from('carteiras').upsert(_carteiraRow(c, _usuarioSupabase.id))
        .then(function (r) { if (r.error) console.warn('[Supabase] carteira:', r.error.message); });
}

function supUpsertAtivo(a) {
    if (!supLogado()) return Promise.resolve();
    return supabaseClient.from('ativos').upsert(_ativoRow(a, _usuarioSupabase.id))
        .then(function (r) { if (r.error) console.warn('[Supabase] ativo:', r.error.message); });
}

function supUpsertTransacao(t) {
    if (!supLogado()) return Promise.resolve();
    return supabaseClient.from('transacoes').upsert(_transacaoRow(t, _usuarioSupabase.id))
        .then(function (r) { if (r.error) console.warn('[Supabase] transacao:', r.error.message); });
}

function supDeleteTransacao(id) {
    if (!supLogado()) return Promise.resolve();
    return supabaseClient.from('transacoes')
        .delete().eq('id', String(id)).eq('usuario_id', _usuarioSupabase.id)
        .then(function (r) { if (r.error) console.warn('[Supabase] del transacao:', r.error.message); });
}

function supUpsertObjetivo(o) {
    if (!supLogado()) return Promise.resolve();
    return supabaseClient.from('objetivos').upsert(_objetivoRow(o, _usuarioSupabase.id))
        .then(function (r) { if (r.error) console.warn('[Supabase] objetivo:', r.error.message); });
}

function supDeleteObjetivo(id) {
    if (!supLogado()) return Promise.resolve();
    return supabaseClient.from('objetivos')
        .delete().eq('id', String(id)).eq('usuario_id', _usuarioSupabase.id)
        .then(function (r) { if (r.error) console.warn('[Supabase] del objetivo:', r.error.message); });
}

function supUpsertHistorico(h) {
    if (!supLogado()) return Promise.resolve();
    return supabaseClient.from('historico_rentabilidade')
        .upsert(_histRow(h, _usuarioSupabase.id), { onConflict: 'usuario_id,carteira_id,mes' })
        .then(function (r) { if (r.error) console.warn('[Supabase] historico:', r.error.message); });
}

function supUpsertBalanceamento(carteiraId, dados) {
    if (!supLogado()) return Promise.resolve();
    return supabaseClient.from('balanceamentos')
        .upsert(_balRow(carteiraId, dados, _usuarioSupabase.id))
        .then(function (r) { if (r.error) console.warn('[Supabase] balanceamento:', r.error.message); });
}

// ----------------------------------------------------------------
// carregarBancoSupabase — passo 2 do two-step loading
// Retorna: false | 'MIGRACAO_PENDENTE' | true (dados baixados — re-renderizar)
// ----------------------------------------------------------------
function carregarBancoSupabase(usuarioIdLocal) {
    if (!supLogado()) return Promise.resolve(false);
    var uuid = _usuarioSupabase.id;

    return supabaseClient.from('transacoes')
        .select('id', { count: 'exact', head: true })
        .eq('usuario_id', uuid)
        .then(function (res) {
            if (res.error) { console.warn('[Supabase] load:', res.error.message); return false; }

            var cloudCount = res.count || 0;
            var db         = loadDB();
            var localCount = (db.transacoes || []).filter(function (t) {
                return String(t.usuarioId) === String(usuarioIdLocal);
            }).length;

            if (cloudCount === 0 && localCount > 0) return 'MIGRACAO_PENDENTE';
            if (cloudCount > 0 && localCount === 0) return _baixarBancoSupabase(usuarioIdLocal, uuid);
            return false; // local já tem dados → offline-first, local vence
        })
        .catch(function (e) {
            console.warn('[Supabase] offline:', e && e.message);
            return false;
        });
}

// ----------------------------------------------------------------
// _baixarBancoSupabase — baixa todos os dados da nuvem para o localStorage
// Chamado quando dispositivo novo (localCount = 0, cloudCount > 0)
// ----------------------------------------------------------------
function _baixarBancoSupabase(usuarioIdLocal, uuid) {
    return Promise.all([
        supabaseClient.from('carteiras')               .select('*').eq('usuario_id', uuid),
        supabaseClient.from('ativos')                  .select('*').eq('usuario_id', uuid),
        supabaseClient.from('transacoes')              .select('*').eq('usuario_id', uuid),
        supabaseClient.from('objetivos')               .select('*').eq('usuario_id', uuid),
        supabaseClient.from('historico_rentabilidade') .select('*').eq('usuario_id', uuid),
        supabaseClient.from('balanceamentos')          .select('*').eq('usuario_id', uuid),
    ]).then(function (results) {
        var erros = results.filter(function (r) { return r.error; });
        if (erros.length) {
            erros.forEach(function (r) { console.warn('[Supabase] download:', r.error.message); });
            return false;
        }

        var carteirasRows = results[0].data || [];
        var ativosRows    = results[1].data || [];
        var txsRows       = results[2].data || [];
        var objsRows      = results[3].data || [];
        var histRows      = results[4].data || [];
        var balsRows      = results[5].data || [];

        var db = loadDB();
        db.carteiras              = db.carteiras              || [];
        db.ativos                 = db.ativos                 || [];
        db.transacoes             = db.transacoes             || [];
        db.objetivos              = db.objetivos              || [];
        db.historicoRentabilidade = db.historicoRentabilidade || [];
        db.balanceamentos         = db.balanceamentos         || {};

        // Carteiras
        carteirasRows.forEach(function (row) {
            var id = Number(row.id);
            if (!db.carteiras.some(function (c) { return c.id === id; })) {
                db.carteiras.push({
                    id:         id,
                    usuarioId:  usuarioIdLocal,
                    nome:       row.nome,
                    criadoEm:   row.criado_em ? new Date(row.criado_em).getTime() : Date.now(),
                });
            }
        });

        // Ativos (sem usuarioId — são globais no localStorage)
        ativosRows.forEach(function (row) {
            var id = Number(row.id);
            if (!db.ativos.some(function (a) { return a.id === id; })) {
                db.ativos.push({
                    id:       id,
                    ticker:   row.ticker,
                    classe:   row.classe,
                    criadoEm: row.criado_em ? new Date(row.criado_em).getTime() : Date.now(),
                });
            }
        });

        // Transações
        txsRows.forEach(function (row) {
            var id = Number(row.id);
            if (!db.transacoes.some(function (t) { return t.id === id; })) {
                var t = {
                    id:            id,
                    usuarioId:     usuarioIdLocal,
                    ativoId:       Number(row.ativo_id),
                    carteiraId:    Number(row.carteira_id),
                    tipo:          row.tipo,
                    data:          row.data,
                    quantidade:    row.quantidade,
                    precoUnitario: row.preco_unitario,
                    taxas:         row.taxas || 0,
                    criadoEm:      row.criado_em ? new Date(row.criado_em).getTime() : Date.now(),
                };
                if (row.ativo_destino_id  != null) t.ativoDestinoId   = Number(row.ativo_destino_id);
                if (row.quantidade_destino != null) t.quantidadeDestino = row.quantidade_destino;
                if (row.descricao)                  t.descricao        = row.descricao;
                if (row.valor     != null)          t.valor            = Number(row.valor);
                if (row.subtipo)                    t.subtipo          = row.subtipo;
                db.transacoes.push(t);
            }
        });

        // Objetivos
        objsRows.forEach(function (row) {
            var id = Number(row.id);
            if (!db.objetivos.some(function (o) { return o.id === id; })) {
                db.objetivos.push({
                    id:           id,
                    usuarioId:    usuarioIdLocal,
                    carteiraId:   Number(row.carteira_id),
                    tipo:         row.tipo         || 'PATRIMONIO',
                    classe:       row.classe        || null,
                    nome:         row.nome          || '',
                    alvo:         row.alvo,
                    aporteMensal: row.aporte_mensal != null ? row.aporte_mensal : null,
                    criadoEm:     row.criado_em     ? new Date(row.criado_em).getTime()    : Date.now(),
                    concluidoEm:  row.concluido_em  ? row.concluido_em : null,
                });
            }
        });

        // Histórico de rentabilidade
        histRows.forEach(function (row) {
            var cid = Number(row.carteira_id);
            var jaTem = db.historicoRentabilidade.some(function (h) {
                return h.usuarioId === usuarioIdLocal && h.carteiraId === cid && h.mes === row.mes;
            });
            if (!jaTem) {
                var h = {
                    mes:              row.mes,
                    usuarioId:        usuarioIdLocal,
                    carteiraId:       cid,
                    rentabilidade:    row.rentabilidade,
                    cdi:              row.cdi,
                    patrimonioInicio: row.patrimonio_inicio,
                    patrimonioFim:    row.patrimonio_fim,
                    aportesLiquidos:  row.aportes_liquidos,
                    proventos:        row.proventos,
                    versao:           row.versao,
                };
                if (row.primeiro_mes) h.primeiroMes = true;
                db.historicoRentabilidade.push(h);
            }
        });

        // Balanceamentos
        balsRows.forEach(function (row) {
            var cid = Number(row.carteira_id);
            if (!db.balanceamentos[cid]) {
                db.balanceamentos[cid] = {
                    classes: row.classes || null,
                    notas:   row.notas   || {},
                };
            }
        });

        // Recalcular nextId para evitar colisões
        var todosIds = [0];
        (db.users      || []).forEach(function (e) { todosIds.push(e.id); });
        (db.carteiras  || []).forEach(function (e) { todosIds.push(e.id); });
        (db.ativos     || []).forEach(function (e) { todosIds.push(e.id); });
        (db.transacoes || []).forEach(function (e) { todosIds.push(e.id); });
        (db.objetivos  || []).forEach(function (e) { todosIds.push(e.id); });
        db.nextId = Math.max.apply(null, todosIds) + 1;

        // Preservar versão do histórico para não apagar na migração
        db.historicoRentabilidadeVersao = 8;

        saveDB(db);
        console.log('[Supabase] banco carregado da nuvem: ' + txsRows.length + ' transação(ões)');
        return true;
    }).catch(function (e) {
        console.error('[Supabase] download erro:', e && e.message);
        return false;
    });
}

// ----------------------------------------------------------------
// migrarLocalParaSupabase — envia todo o localStorage → Supabase
// Chamado pelo banner de migração no IIFE (primeira abertura).
// usuarioIdLocal: inteiro do localStorage (ex: 1)
// ----------------------------------------------------------------
function migrarLocalParaSupabase(usuarioIdLocal) {
    if (!supLogado()) return Promise.resolve(false);
    var uuid = _usuarioSupabase.id;
    var db   = loadDB();
    var sid  = String(usuarioIdLocal);

    // Filtra cada entidade pelo usuário local
    var carteiras = (db.carteiras || []).filter(function (c) {
        return String(c.usuarioId) === sid;
    });
    // ativos não têm usuarioId — todos pertencem ao usuário único desta instância
    var ativos = db.ativos || [];
    var txs    = (db.transacoes || []).filter(function (t) {
        return String(t.usuarioId) === sid;
    });
    var objs   = (db.objetivos || []).filter(function (o) {
        return String(o.usuarioId) === sid;
    });
    var hist   = (db.historicoRentabilidade || []).filter(function (h) {
        return String(h.usuarioId) === sid;
    });

    // Balanceamentos indexados por carteiraId
    var cidsProprios = carteiras.map(function (c) { return String(c.id); });
    var bals         = db.balanceamentos || {};
    var rowsBal      = cidsProprios.reduce(function (acc, cid) {
        if (bals[cid]) acc.push(_balRow(cid, bals[cid], uuid));
        return acc;
    }, []);

    // IDs de ativos referenciados por este usuário (para não enviar ativos órfãos)
    var ativosIds = txs.reduce(function (s, t) {
        s[String(t.ativoId)] = true;
        if (t.ativoDestinoId != null) s[String(t.ativoDestinoId)] = true;
        return s;
    }, {});
    var ativosFiltrados = ativos.filter(function (a) { return ativosIds[String(a.id)]; });

    // Envio em série respeitando FKs: carteiras → ativos → transacoes → rest
    var chain = Promise.resolve({ error: null });

    if (carteiras.length) chain = chain.then(function (r) {
        if (r.error) throw r.error;
        return supabaseClient.from('carteiras')
            .upsert(carteiras.map(function (c) { return _carteiraRow(c, uuid); }));
    });
    if (ativosFiltrados.length) chain = chain.then(function (r) {
        if (r.error) throw r.error;
        return supabaseClient.from('ativos')
            .upsert(ativosFiltrados.map(function (a) { return _ativoRow(a, uuid); }));
    });
    if (txs.length) chain = chain.then(function (r) {
        if (r.error) throw r.error;
        return supabaseClient.from('transacoes')
            .upsert(txs.map(function (t) { return _transacaoRow(t, uuid); }));
    });
    if (objs.length) chain = chain.then(function (r) {
        if (r.error) throw r.error;
        return supabaseClient.from('objetivos')
            .upsert(objs.map(function (o) { return _objetivoRow(o, uuid); }));
    });
    if (hist.length) chain = chain.then(function (r) {
        if (r.error) throw r.error;
        return supabaseClient.from('historico_rentabilidade')
            .upsert(hist.map(function (h) { return _histRow(h, uuid); }),
                    { onConflict: 'usuario_id,carteira_id,mes' });
    });
    if (rowsBal.length) chain = chain.then(function (r) {
        if (r.error) throw r.error;
        return supabaseClient.from('balanceamentos').upsert(rowsBal);
    });

    return chain
        .then(function (r) { if (r && r.error) throw r.error; return true; })
        .catch(function (e) { console.error('[Supabase] migração:', e && e.message); return false; });
}
