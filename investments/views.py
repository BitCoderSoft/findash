from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.shortcuts import render, redirect

from .forms import TransacaoForm, UserRegisterForm
from .services import calcular_kpis


@login_required(login_url='login')
def dashboard(request):
    drawer_open = False

    if request.method == 'POST':
        form = TransacaoForm(request.POST)
        if form.is_valid():
            form.save(usuario=request.user)
            messages.success(request, 'Transação registrada com sucesso.')
            return redirect('dashboard')
        drawer_open = True
    else:
        form = TransacaoForm()

    context = {
        'form': form,
        'drawer_open': drawer_open,
        'kpis': calcular_kpis(request.user),
    }
    return render(request, 'investments/dashboard.html', context)


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
