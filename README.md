# Dash Finance

Sistema local de controle financeiro de investimentos, inspirado nas
plataformas Investidor10 e Smartfolio. Permite registrar compras e vendas de
ativos (ações, FIIs, criptomoedas, renda fixa) e acompanhar patrimônio,
rentabilidade e métricas de carteira em um dashboard próprio — com o objetivo
de, no futuro, cruzar essas posições com cotações reais de mercado e apoiar
decisões de investimento com dados, não só análise manual.

Uso local e single-tenant por enquanto: login/senha protegem os dados na
máquina, mas não há plano de deploy público no curto prazo.

## Stack

- Python 3.14 + Django 6.0.7
- SQLite (`db.sqlite3`, local e ignorado pelo git)
- HTML + CSS puro via templates Django (sem bundler de frontend)

## Instalação

Pré-requisito: Python 3.14 instalado. O projeto usa `python3` (não `python`)
em todos os comandos abaixo.

```bash
# 1. Criar e ativar o ambiente virtual (se ainda não existir)
python3 -m venv venv
source venv/bin/activate

# 2. Instalar as dependências
pip install -r requirements.txt

# 3. Aplicar as migrations (cria o db.sqlite3 local)
python3 manage.py migrate

# 4. Criar um usuário (ou usar a tela de cadastro em /register/)
python3 manage.py createsuperuser
```

## Rodando o projeto

```bash
source venv/bin/activate
python3 manage.py runserver
```

Acesse `http://127.0.0.1:8000/` — redireciona para `/login/` se não estiver
autenticado.

## Mantendo o `requirements.txt` atualizado

Sempre que uma dependência nova for instalada no `venv`, atualizar o arquivo
para refletir exatamente o que está em uso:

```bash
source venv/bin/activate
pip freeze > requirements.txt
```

## Documentação adicional

Ver [AGENTS.md](AGENTS.md) para contexto técnico completo: estrutura do
projeto, convenções de design, débitos técnicos conhecidos e roadmap.
