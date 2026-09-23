# AGENTS.md — Dash Finance

Contexto técnico para qualquer agente (ou dev) que for continuar este projeto.

## O que é

Sistema local de controle financeiro de investimentos, inspirado nas plataformas
Investidor10 e Smartfolio (meusdividendos). O usuário registra manualmente suas
compras e vendas de ativos (ações, FIIs, criptomoedas, renda fixa) e o sistema
deve calcular patrimônio, rentabilidade e comparações com índices (CDI, IBOV etc.),
eventualmente cruzando com cotações reais via uma API de mercado (o usuário já
possui uma chave de API para isso, ainda não integrada).

Uso é local e single-tenant por enquanto (sem plano de multiusuário/deploy público
no curto prazo), mas login/senha já existem para proteger os dados na máquina.

## Stack

- Python 3.14, Django 6.0.7 (`asgiref`, `sqlparse` como dependências transitivas).
- Dependências fixadas em `requirements.txt` (instalar com `pip install -r requirements.txt`
  dentro do `venv/`). Toda vez que uma dependência nova for instalada, rodar
  `pip freeze > requirements.txt` para manter o arquivo fiel ao que está em uso —
  é convenção fixa deste projeto, não só para o setup inicial.
- Banco: SQLite (`db.sqlite3` na raiz, ignorado via `.gitignore` — não versionado).
- Sem frontend framework: HTML + CSS puro servido via templates Django
  (`django.contrib.staticfiles`, sem bundler/build step). Interatividade mínima
  (abrir/fechar drawer) em JS vanilla puro, sem lib.
- Gráficos do dashboard são SVG montado à mão em Python (`charts.py`), não uma
  lib de gráficos — decisão deliberada para manter zero dependência de frontend.
  Ao evoluir os gráficos (ex.: cotação real, comparação com CDI/IBOV), usar a
  skill `dataviz` deste ambiente para manter consistência visual antes de manter
  esse approach manual crescendo sem critério.
- Ambiente: `venv/` na raiz. **Usar `python3`, não `python`**, ao rodar comandos
  (`python3 manage.py ...`) — é o binário que existe neste ambiente.

## Estrutura do projeto

```
dash_finance/          # projeto Django (settings, urls raiz, wsgi/asgi)
investments/           # único app até agora
  models.py            # Ativo, Transacao, Provento (Provento ainda sem UI/uso)
  services.py          # agregações puras em Python: KPIs, alocação por classe, evolução mensal
  charts.py            # monta a geometria SVG (barras + donut) a partir do que services.py calcula
  forms.py             # UserRegisterForm + TransacaoForm (cria Ativo on-the-fly se ticker for novo)
  views.py             # dashboard, transacoes (list+CRUD via drawer), transacao_excluir, register
  urls.py              # '', 'transacoes/', 'transacoes/<pk>/excluir/', 'login/', 'logout/', 'register/'
  templates/investments/
    base.html                 # template base (blocks: title, extra_css, content, extra_js) + drawer.js global
    login.html                 # tela de login (layout split-screen)
    register.html               # tela de cadastro (mesmo layout)
    dashboard.html               # dashboard "Resumo": KPIs reais + gráfico de evolução + donut de alocação
    transacoes.html               # tabela de lançamentos (CRUD) + botão "+ Novo lançamento"
    _drawer_transacao.html         # partial do formulário de lançamento, incluído por dashboard.html e transacoes.html
  static/investments/
    css/base.css         # design system único do projeto (ver abaixo)
    js/drawer.js          # abrir/fechar drawer (data-drawer-open/close), foco, ESC, overlay — vanilla JS
manage.py
requirements.txt       # dependências fixadas (manter atualizado com pip freeze)
.gitignore
README.md              # instalação, venv e como rodar o projeto
AGENTS.md              # este arquivo
```

Não há outros apps ainda. Todo o domínio (ativos, transações, proventos) está
dentro de `investments`; ainda não foi necessário quebrar em apps menores.

## Modelo de dados

- `Ativo`: ticker (upper+strip automático no `save()`, unique), classe
  (Ação/FII/Cripto/Renda fixa via `TextChoices`), moeda (BRL/USD).
- `Transacao`: usuário, ativo, tipo (Compra/Venda), quantidade e preço unitário
  em `DecimalField` de alta precisão (8 casas — pensado para cripto), taxas de
  corretagem, data. `CheckConstraint`s garantem quantidade/preço positivos e
  taxas não-negativas no nível do banco. `valor_total` é property (quantidade *
  preço + taxas).
- `Provento`: usuário, ativo, tipo (Dividendo/JCP/Rendimento), valor, data.
  **Modelado mas ainda sem form/view/tela** — próximo passo natural depois de
  proventos entrarem no roadmap de UI.
- Posição líquida por ativo (compras − vendas) é calculada em `services.py` a
  partir das transações brutas, não persistida em tabela própria.

## Rotas e autenticação

- `/` → `dashboard` (view protegida por `@login_required(login_url='login')`).
  GET renderiza KPIs + gráficos; POST cria uma transação via o drawer e
  redireciona de volta para `dashboard` (evita reenvio de formulário).
- `/transacoes/` → `transacoes` (login required). Lista todas as transações do
  usuário. Suporta criar (POST sem `transacao_id`), editar (`?editar=<pk>` abre
  o drawer pré-preenchido; POST com `transacao_id` faz update) e excluir via
  `/transacoes/<pk>/excluir/` (POST-only, `@require_POST`). Toda query já filtra
  por `usuario=request.user` — não há vazamento de dados entre usuários.
- `/login/` → `LoginView` padrão do Django, template `investments/login.html`.
- `/logout/` → `LogoutView`. **Importante:** desde o Django 4.1, `LogoutView` só
  aceita `POST` (GET dá 405). O botão "Sair" no dashboard é um `<form method="post">`
  com `{% csrf_token %}`, não um link — não trocar de volta para `<a href="{% url 'logout' %}">`.
- `/register/` → view custom (`views.register`) usando `UserRegisterForm`, redireciona
  para `login` com mensagem de sucesso via `django.contrib.messages`.
- `LOGIN_URL`, `LOGIN_REDIRECT_URL`, `LOGOUT_REDIRECT_URL` configurados em `settings.py`.

## Fluxo do drawer de lançamento

- `_drawer_transacao.html` é um partial incluído tanto por `dashboard.html`
  quanto por `transacoes.html` — mesmo formulário (`TransacaoForm`), mesma
  marcação, para não duplicar o CRUD de transação nas duas telas.
- Abertura/fechamento é 100% client-side via `drawer.js` (atributos
  `data-drawer-open="drawer-transacao"` / `data-drawer-close`), com overlay,
  `inert` no conteúdo da página, trava de scroll, foco no primeiro campo ao
  abrir e devolução de foco ao gatilho ao fechar (acessibilidade básica).
- Reabertura automática pelo servidor: se o form é submetido com erro, a view
  retorna `drawer_open=True` no contexto e o template já renderiza a classe
  `.open` no drawer — sem depender de JS para saber que deve reabrir.
- `TransacaoForm` recebe `ticker` (texto livre) + `classe_ativo` (opcional) além
  dos campos do model; no `save()`, faz `Ativo.objects.get_or_create` pelo
  ticker — cadastro de ativo é implícito ao lançar a primeira transação dele,
  não existe tela separada de cadastro de ativo.
- Os `labels` de todos os campos do `Meta` do `TransacaoForm` são explícitos
  (`labels = {...}`) — **não confiar no auto-label do Django** aqui: ele gera
  o label a partir do nome do campo Python sem acentuar (`preco_unitario` vira
  "Preco unitario", não "Preço unitário"). Qualquer campo novo no model que for
  exposto nesse form precisa de entrada correspondente em `labels`.

## Design system (`base.css`)

Reescrito do zero (a v1 tinha cara de "gerado por IA": sombras dramáticas, cantos
muito arredondados, fontes grandes demais). Princípios atuais, para manter
consistência em qualquer tela nova:

- **Tipografia compacta**: escala de `--text-xs` (12px) a `--text-2xl` (28px),
  definida em `rem` a partir da raiz de 16px (não mexer no `font-size` do `html`).
  Título de página (`.page-heading h1`) é ~22px, não 32px+.
- **Superfícies planas**: bordas hairline (`--color-border`) em vez de sombra
  pesada. Sombra só como reforço sutil (`--shadow-xs`/`--shadow-sm`), nunca como
  efeito principal. Exceção deliberada: o drawer usa uma sombra mais presente
  (`-24px 0 48px`) porque precisa se destacar como camada flutuante sobre a
  página — não é regressão para o clichê de "sombra pesada em card".
- **Raio de borda contido**: 8–14px (`--radius-sm/md/lg`). Nada de 20px+ em card
  de app financeiro.
- **Paleta**: indigo (`--color-primary #4338ca`) como acento único, verde/vermelho
  semânticos só para ganho/perda (`--color-success`/`--color-danger`), painel de
  marca do login em navy escuro (`--color-brand-panel-1/2`). Classes de ativo nos
  gráficos usam uma paleta própria fixa (`CORES_CLASSE` em `charts.py`: azul/Ação,
  laranja/FII, verde/Cripto, amarelo/Renda fixa) — a ordem das classes na legenda
  e no donut é sempre a mesma (`Ativo.Classe` na ordem declarada), não por
  tamanho, para a cor de cada classe não mudar conforme a carteira muda.
- **Auth**: layout split-screen (painel de marca à esquerda + formulário à
  direita), não card centralizado flutuante. Colapsa para coluna única em
  `max-width: 900px` (painel de marca escondido, formulário ocupa a tela toda).
- **App shell**: topbar com marca + abas de navegação horizontais (sublinhado no
  item ativo), não sidebar. Duas abas ativas hoje: Resumo (`dashboard`) e
  Lançamentos (`transacoes`). Abas de seções ainda não implementadas (Posições,
  Proventos, Patrimônio, Rentabilidade) devem seguir o mesmo padrão: aparecer
  como `<span class="nav-item disabled">`, propositalmente sem `href`, até a
  página existir de fato.
- **Drawer (slide-over)**: painel lateral direito (`min(520px, 92vw)`), não
  modal centralizado — usado para criar/editar lançamentos em vez de navegar
  para uma página separada. `prefers-reduced-motion` desliga a transição.
- **Tabela**: `.table-wrap`/`.table` para listagens densas (lançamentos) —
  hairline entre linhas, cabeçalho em uppercase/subtle, sem zebra striping.
- **Empty states**: `.empty-panel` com ilustração SVG simples (`currentColor` +
  opacidade) para painéis do dashboard sem dado ainda — usado tanto nos
  gráficos (antes do primeiro lançamento) quanto na tabela de lançamentos vazia.
- Todo HTML novo deve estender `investments/base.html` e usar as classes já
  existentes em `base.css` (`.card`/`.kpi-card`, `.button.primary/.ghost/.small`,
  `.field`, `.empty-panel`, `.table`, `.drawer*`) em vez de CSS inline por página
  — a única exceção hoje é o bloco `extra_css` do `dashboard.html`, específico
  dos gráficos SVG (não reutilizável em outra tela ainda).

## Débitos técnicos conhecidos (ainda não resolvidos, decisão pendente com o usuário)

- `SECRET_KEY` hardcoded em `settings.py` e `DEBUG = True` — aceitável enquanto for
  uso 100% local, mas não deve ir para produção/deploy sem revisar.
- `LANGUAGE_CODE = 'en-us'` em `settings.py`, mas toda a UI e mensagens são em
  pt-BR — inconsistência menor, não corrigida ainda.
- Sem testes (`tests.py` vazio) e sem CI configurado.
- `ALLOWED_HOSTS = []` — só serve em localhost por enquanto.
- KPIs de "Lucro/Prejuízo" e "Rentabilidade" no dashboard são placeholders (`—`)
  porque dependem de cotação de mercado real, ainda não integrada.
- `Provento` existe no model mas não tem form/view/tela — não entra em nenhum
  KPI ou gráfico ainda.
- Quantidade é exibida com 8 casas decimais fixas em toda a UI (tabela e drawer
  de edição), mesmo para ativos que não precisam dessa precisão (ex.: ações
  compradas em unidades inteiras) — pensado para cripto, mas polui a leitura de
  quantidades "redondas".

## Roadmap combinado com o usuário (ordem)

1. ~~Base visual (design system, correção de bugs de layout, fluxo de login/logout)~~ — feito.
2. ~~Modelar dados centrais (`Ativo`, `Transacao`, `Provento`)~~ — feito.
3. ~~Tela de lançamentos (CRUD de transações via drawer)~~ — feito.
4. ~~Dashboard com dados reais no lugar dos cards zerados~~ — feito para o que
   não depende de cotação (valor investido, posições, evolução, alocação).
5. **Próximo passo**: UI de proventos (dividendo/JCP/rendimento) — model já
   existe, falta form + tela, no mesmo padrão de `transacoes.html` (tabela +
   drawer).
6. Integração com a API de cotações (usuário já tem token) para calcular
   rentabilidade real e comparação com CDI/índices — desbloqueia os KPIs de
   Lucro/Prejuízo e Rentabilidade que hoje são `—`. Ao chegar em gráficos
   novos derivados disso, usar a skill `dataviz` deste ambiente.

## Preferências de trabalho observadas

- Comunicação e conteúdo de UI em português (pt-BR).
- Usuário valoriza design "clean" de verdade (não apenas "sem bagunça visual") —
  já rejeitou uma primeira iteração por parecer genérica/"IA" (sombras pesadas,
  cantos muito arredondados, fontes grandes, card de login centralizado). Antes de
  entregar mudanças visuais, vale considerar se foge desses clichês.
- Mudanças de UI devem ser verificadas rodando o servidor de verdade
  (Playwright/screenshot), não só lidas no código. Ao gerar dados de teste para
  isso, usar um usuário descartável (não os dados reais já no `db.sqlite3`) e
  limpar tudo (usuário, transações, ativos órfãos) ao final — o banco local não
  é só um fixture de teste, tem dado real do usuário.
- Este arquivo (AGENTS.md) deve refletir o estado real do working tree, inclusive
  o que ainda não foi commitado — não só o último commit. Ao fechar um bloco
  relevante do roadmap, atualizar a seção correspondente aqui no mesmo passo,
  não depois.
