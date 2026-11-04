/* =================================================================
   ARMAZENAMENTO [STORE v1 · 28/09/2026]
   ================================================================= */

// Por que existe: dentro do preview do claude.ai o localStorage é
// bloqueado (o iframe roda em sandbox). saveDB() e setSession() chamavam
// localStorage.setItem sem try/catch, a exceção estourava no meio do
// submit e cadastro/login simplesmente não aconteciam, sem mensagem.
//
// Agora TODO acesso a armazenamento passa por `armazem` (get/set/remove,
// síncrono, mesma cara do localStorage). Por baixo ele escolhe um de três
// modos, na ordem:
//   'local'   -> localStorage normal (arquivo aberto direto no navegador)
//   'claude'  -> preview do claude.ai com window.storage disponível: os
//                dados ficam num espelho em memória (leitura síncrona) e
//                cada gravação do banco e da sessão é repassada, em segundo
//                plano, pro window.storage, que persiste entre sessões
//   'memoria' -> nada disponível: funciona, mas some ao recarregar
// Os caches de cotação/histórico/ranking não são repassados ao
// window.storage (só memória), pra não gastar a cota de requisições dele.
//
// Regra pra código novo: NUNCA usar localStorage direto. Sempre armazem.
// Django: não se aplica (lá o banco é o SQLite).

var CHAVES_PERSISTENTES = {};  // preenchida logo abaixo, depois das chaves existirem
var espelho = {};
var modoArmazenamento = 'memoria';

function localStorageFunciona() {
    try {
        var k = '__dash_teste__';
        localStorage.setItem(k, '1');
        localStorage.removeItem(k);
        return true;
    } catch (e) {
        return false;
    }
}

if (localStorageFunciona()) {
    modoArmazenamento = 'local';
} else if (window.storage && typeof window.storage.get === 'function') {
    modoArmazenamento = 'claude';
}

CHAVES_PERSISTENTES[DB_KEY] = true;
CHAVES_PERSISTENTES[SESSION_KEY] = true;

var armazem = {
    get: function (k) {
        if (modoArmazenamento === 'local') return localStorage.getItem(k);
        return Object.prototype.hasOwnProperty.call(espelho, k) ? espelho[k] : null;
    },

    set: function (k, v) {
        if (modoArmazenamento === 'local') {
            localStorage.setItem(k, v);
            return;
        }
        espelho[k] = String(v);
        if (modoArmazenamento === 'claude' && CHAVES_PERSISTENTES[k]) {
            // fire-and-forget: a tela não espera a gravação remota
            Promise.resolve()
                .then(function () { return window.storage.set(k, String(v), false); })
                .catch(function (e) { console.warn('[STORE] falha ao gravar', k, e); });
        }
    },

    remove: function (k) {
        if (modoArmazenamento === 'local') {
            localStorage.removeItem(k);
            return;
        }
        delete espelho[k];
        if (modoArmazenamento === 'claude' && CHAVES_PERSISTENTES[k]) {
            Promise.resolve()
                .then(function () { return window.storage.delete(k, false); })
                .catch(function () { /* chave já não existia */ });
        }
    },
};

// No modo 'claude', antes do primeiro render, puxa banco e sessão do
// window.storage pro espelho. get() de chave inexistente lança erro
// (comportamento documentado da API), por isso cada uma tem seu catch.
function carregarArmazenamento() {
    if (modoArmazenamento !== 'claude') return Promise.resolve();
    var chaves = Object.keys(CHAVES_PERSISTENTES);
    return Promise.all(chaves.map(function (k) {
        return window.storage.get(k, false)
            .then(function (r) { if (r && r.value != null) espelho[k] = r.value; })
            .catch(function () { /* ainda não existe */ });
    }));
}

// Faixa discreta no rodapé avisando onde os dados estão ficando, só quando
// NÃO é o localStorage normal (fora do preview ela nem aparece).
function mostrarAvisoArmazenamento() {
    if (modoArmazenamento === 'local') return;
    var aviso = document.createElement('div');
    aviso.className = 'aviso-armazenamento';
    aviso.textContent = modoArmazenamento === 'claude'
        ? 'Preview do Claude: seus dados ficam salvos no armazenamento deste artefato, não no navegador.'
        : 'Modo temporário: este ambiente bloqueia armazenamento. Nada será salvo ao recarregar.';
    document.body.appendChild(aviso);
}
