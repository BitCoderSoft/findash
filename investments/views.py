from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, render, redirect
from django.views.decorators.http import require_POST

from .charts import CORES_CLASSE, montar_grafico_alocacao, montar_grafico_evolucao
from .forms import TransacaoForm, UserRegisterForm
from .market_data import BrapiError, buscar_cotacoes
from .models import Transacao
from .services import (
    alocacao_por_classe,
    aplicar_cotacoes,
    aplicar_cotacoes_lista,
    calcular_kpis,
    calcular_kpis_mercado,
    destaques_carteira,
    evolucao_mensal,
    posicoes_atuais,
    posicoes_por_classe,
)


@login_required(login_url='login')
def dashboard(request):
    drawer_open = False

    if request.method == 'POST':
        form = TransacaoForm(request.POST, usuario=request.user)
        if form.is_valid():
            form.save(usuario=request.user)
            messages.success(request, 'Transação registrada com sucesso.')
            return redirect('dashboard')
        drawer_open = True
    else:
        form = TransacaoForm(usuario=request.user)

    posicoes = posicoes_atuais(request.user)
    tickers = [p['ativo'].ticker for p in posicoes]
    cotacoes = {}
    if tickers:
        try:
            cotacoes = buscar_cotacoes(tickers)
        except BrapiError as exc:
            messages.warning(request, f'Não foi possível buscar cotação de mercado agora: {exc}')

    aplicar_cotacoes_lista(posicoes, cotacoes)

    kpis = calcular_kpis(request.user)
    kpis.update(calcular_kpis_mercado(posicoes))
    if kpis['lucro_prejuizo'] is not None:
        kpis['saldo_atual'] = kpis['valor_investido'] + kpis['lucro_prejuizo']
    else:
        kpis['saldo_atual'] = kpis['valor_investido']

    context = {
        'form': form,
        'drawer_open': drawer_open,
        'kpis': kpis,
        'evolucao_chart': montar_grafico_evolucao(evolucao_mensal(request.user)),
        'alocacao_chart': montar_grafico_alocacao(alocacao_por_classe(request.user)),
    }
    return render(request, 'investments/dashboard.html', context)


@login_required(login_url='login')
def posicoes(request):
    drawer_open = False

    if request.method == 'POST':
        form = TransacaoForm(request.POST, usuario=request.user)
        if form.is_valid():
            form.save(usuario=request.user)
            messages.success(request, 'Transação registrada com sucesso.')
            return redirect('posicoes')
        drawer_open = True
    else:
        form = TransacaoForm(usuario=request.user)

    grupos = posicoes_por_classe(request.user)
    for grupo in grupos:
        grupo['cor'] = CORES_CLASSE[grupo['classe']]

    tickers = [p['ativo'].ticker for grupo in grupos for p in grupo['posicoes']]
    cotacoes = {}
    if tickers:
        try:
            cotacoes = buscar_cotacoes(tickers)
        except BrapiError as exc:
            messages.warning(request, f'Não foi possível buscar cotação de mercado agora: {exc}')

    aplicar_cotacoes(grupos, cotacoes)

    context = {
        'form': form,
        'drawer_open': drawer_open,
        'grupos': grupos,
        'destaques': destaques_carteira(grupos),
        'kpis': calcular_kpis(request.user),
    }
    return render(request, 'investments/posicoes.html', context)


@login_required(login_url='login')
def transacoes(request):
    editar_id = request.GET.get('editar')
    instance = None
    initial = {}

    if editar_id:
        instance = get_object_or_404(Transacao, pk=editar_id, usuario=request.user)
        initial = {'ticker': instance.ativo.ticker, 'classe_ativo': instance.ativo.classe}

    drawer_open = bool(editar_id)

    if request.method == 'POST':
        transacao_id = request.POST.get('transacao_id')
        post_instance = None
        if transacao_id:
            post_instance = get_object_or_404(Transacao, pk=transacao_id, usuario=request.user)

        form = TransacaoForm(request.POST, instance=post_instance, usuario=request.user)
        if form.is_valid():
            form.save(usuario=request.user)
            messages.success(request, 'Transação salva com sucesso.')
            return redirect('transacoes')
        drawer_open = True
    else:
        form = TransacaoForm(instance=instance, initial=initial, usuario=request.user)

    context = {
        'form': form,
        'drawer_open': drawer_open,
        'transacoes': Transacao.objects.filter(usuario=request.user).select_related('ativo'),
    }
    return render(request, 'investments/transacoes.html', context)


@login_required(login_url='login')
@require_POST
def transacao_excluir(request, pk):
    transacao = get_object_or_404(Transacao, pk=pk, usuario=request.user)
    transacao.delete()
    messages.success(request, 'Transação excluída.')
    return redirect('transacoes')


def register(request):
    if request.method == 'POST':
        form = UserRegisterForm(request.POST)
        if form.is_valid():
            form.save()
            messages.success(request, 'Conta criada com sucesso. Faça login.')
            return redirect('login')
    else:
        form = UserRegisterForm()

    return render(request, 'investments/register.html', {'form': form})
