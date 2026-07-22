from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.shortcuts import render, redirect

from .forms import UserRegisterForm


@login_required(login_url='login')
def dashboard(request):
    return render(request, 'investments/dashboard.html')


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
