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
  (`django.contrib.staticfiles`, sem bundler/build step).
- Ambiente: `venv/` na raiz. **Usar `python3`, não `python`**, ao rodar comandos
  (`python3 manage.py ...`) — é o binário que existe neste ambiente.

## Estrutura do projeto

```
dash_finance/          # projeto Django (settings, urls raiz, wsgi/asgi)
investments/           # único app até agora
  models.py            # vazio — próximo passo é modelar Ativo/Transação/Provento
  views.py             # dashboard (login_required) + register
  forms.py             # UserRegisterForm (UserCreationForm + email obrigatório)
  urls.py              # '', 'login/', 'logout/', 'register/'
  templates/investments/
    base.html           # template base (blocks: title, extra_css, content)
    login.html           # tela de login (layout split-screen)
    register.html         # tela de cadastro (mesmo layout)
    dashboard.html        # dashboard "Resumo" com topbar + nav + KPIs
  static/investments/css/base.css   # design system único do projeto (ver abaixo)
manage.py
requirements.txt       # dependências fixadas (manter atualizado com pip freeze)
.gitignore
README.md              # instalação, venv e como rodar o projeto
AGENTS.md              # este arquivo
```

Não há outros apps ainda. Quando entrar o modelo de dados de ativos/transações,
avaliar se cabe dentro de `investments` ou se compensa quebrar em apps menores
(ex.: `ativos`, `lancamentos`, `cotacoes`) — ainda não decidido.

## Rotas e autenticação

- `/` → `dashboard` (view protegida por `@login_required(login_url='login')`).
- `/login/` → `LoginView` padrão do Django, template `investments/login.html`.
- `/logout/` → `LogoutView`. **Importante:** desde o Django 4.1, `LogoutView` só
  aceita `POST` (GET dá 405). O botão "Sair" no dashboard é um `<form method="post">`
  com `{% csrf_token %}`, não um link — não trocar de volta para `<a href="{% url 'logout' %}">`.
- `/register/` → view custom (`views.register`) usando `UserRegisterForm`, redireciona
  para `login` com mensagem de sucesso via `django.contrib.messages`.
- `LOGIN_URL`, `LOGIN_REDIRECT_URL`, `LOGOUT_REDIRECT_URL` configurados em `settings.py`.

## Design system (`base.css`)

Reescrito do zero (a v1 tinha cara de "gerado por IA": sombras dramáticas, cantos
muito arredondados, fontes grandes demais). Princípios atuais, para manter
consistência em qualquer tela nova:

- **Tipografia compacta**: escala de `--text-xs` (12px) a `--text-2xl` (28px),
  definida em `rem` a partir da raiz de 16px (não mexer no `font-size` do `html`).
  Título de página (`.page-heading h1`) é ~22px, não 32px+.
- **Superfícies planas**: bordas hairline (`--color-border`) em vez de sombra
  pesada. Sombra só como reforço sutil (`--shadow-xs`/`--shadow-sm`), nunca como
  efeito principal.
- **Raio de borda contido**: 8–14px (`--radius-sm/md/lg`). Nada de 20px+ em card
  de app financeiro.
- **Paleta**: indigo (`--color-primary #4338ca`) como acento único, verde/vermelho
  semânticos só para ganho/perda (`--color-success`/`--color-danger`), painel de
  marca do login em navy escuro (`--color-brand-panel-1/2`).
- **Auth**: layout split-screen (painel de marca à esquerda + formulário à
  direita), não card centralizado flutuante. Colapsa para coluna única em
  `max-width: 900px`.
- **App shell**: topbar com marca + abas de navegação horizontais (sublinhado no
  item ativo), não sidebar. Abas de seções ainda não implementadas (Posições,
  Proventos, Patrimônio, Rentabilidade, Lançamentos) aparecem como `<span
  class="nav-item disabled">` — propositalmente sem `href`, para não criar links
  quebrados até as páginas existirem.
- Todo HTML novo deve estender `investments/base.html` e usar as classes já
  existentes em `base.css` (`.card`/`.kpi-card`, `.button.primary/.ghost`,
  `.field`, `.empty-panel`, etc.) em vez de CSS inline por página.

## Débitos técnicos conhecidos (ainda não resolvidos, decisão pendente com o usuário)

- `SECRET_KEY` hardcoded em `settings.py` e `DEBUG = True` — aceitável enquanto for
  uso 100% local, mas não deve ir para produção/deploy sem revisar.
- `LANGUAGE_CODE = 'en-us'` em `settings.py`, mas toda a UI e mensagens são em
  pt-BR — inconsistência menor, não corrigida ainda.
- Sem testes (`tests.py` vazio) e sem CI configurado.
- `ALLOWED_HOSTS = []` — só serve em localhost por enquanto.

## Roadmap combinado com o usuário (ordem)

1. ~~Base visual (design system, correção de bugs de layout, fluxo de login/logout)~~ — feito.
2. **Próximo passo**: modelar dados centrais em `investments/models.py` —
   `Ativo` (ticker, classe: Ação/FII/Cripto/Renda Fixa), `Transacao` (compra/venda,
   quantidade, preço, data, ativo, usuário), `Provento` (dividendo/JCP, valor, data).
3. Tela de lançamentos (CRUD de transações) — alimenta todo o resto.
4. Dashboard com dados reais no lugar dos cards zerados atuais.
5. Integração com a API de cotações (usuário já tem token) para calcular
   rentabilidade real e comparação com CDI/índices — é aqui que entram as
   "ferramentas próprias" de análise que motivaram o projeto. Ao chegar em
   gráficos, usar a skill `dataviz` deste ambiente para manter consistência visual.

## Preferências de trabalho observadas

- Comunicação e conteúdo de UI em português (pt-BR).
- Usuário valoriza design "clean" de verdade (não apenas "sem bagunça visual") —
  já rejeitou uma primeira iteração por parecer genérica/"IA" (sombras pesadas,
  cantos muito arredondados, fontes grandes, card de login centralizado). Antes de
  entregar mudanças visuais, vale considerar se foge desses clichês.
- Mudanças de UI devem ser verificadas rodando o servidor de verdade (Playwright/
  screenshot), não só lidas no código.
