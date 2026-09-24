from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, render, redirect
from django.views.decorators.http import require_POST

from .charts import montar_grafico_alocacao, montar_grafico_evolucao
from .forms import TransacaoForm, UserRegisterForm
from .models import Transacao
from .services import alocacao_por_classe, calcular_kpis, evolucao_mensal, posicoes_atuais


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

    context = {
        'form': form,
        'drawer_open': drawer_open,
        'kpis': calcular_kpis(request.user),
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

    context = {
        'form': form,
        'drawer_open': drawer_open,
        'posicoes': posicoes_atuais(request.user),
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
