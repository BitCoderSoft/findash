from decimal import Decimal

from django import forms
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User

from .models import Ativo, Transacao
from .services import quantidade_disponivel


def _formatar_quantidade(valor):
    """Remove zeros e ponto decimal supérfluos (Decimal sempre vem com 8 casas)."""
    texto = format(valor, 'f')
    if '.' in texto:
        texto = texto.rstrip('0').rstrip('.')
    return texto


class UserRegisterForm(UserCreationForm):
    email = forms.EmailField(required=True, label='Email')

    class Meta:
        model = User
        fields = ['username', 'email', 'password1', 'password2']
        labels = {
            'username': 'Nome de usuário',
            'password1': 'Senha',
            'password2': 'Repetir senha',
        }


class TransacaoForm(forms.ModelForm):
    ticker = forms.CharField(label='Ticker', max_length=20)
    classe_ativo = forms.ChoiceField(
        label='Classe do ativo', choices=Ativo.Classe.choices, required=False,
        help_text='Só é usado se o ticker ainda não existir no catálogo.',
    )

    class Meta:
        model = Transacao
        fields = ['tipo', 'quantidade', 'preco_unitario', 'data', 'corretagem_taxas']
        widgets = {
            'data': forms.DateInput(format='%Y-%m-%d', attrs={'type': 'date'}),
        }
        labels = {
            'tipo': 'Tipo',
            'quantidade': 'Quantidade',
            'preco_unitario': 'Preço unitário',
            'data': 'Data',
            'corretagem_taxas': 'Corretagem e taxas',
        }

    field_order = ['ticker', 'classe_ativo', 'tipo', 'quantidade', 'preco_unitario', 'data', 'corretagem_taxas']

    def __init__(self, *args, usuario=None, **kwargs):
        self.usuario = usuario
        super().__init__(*args, **kwargs)

    def clean_ticker(self):
        return self.cleaned_data['ticker'].upper().strip()

    def clean(self):
        cleaned_data = super().clean()
        ticker = cleaned_data.get('ticker')
        classe_ativo = cleaned_data.get('classe_ativo')
        tipo = cleaned_data.get('tipo')
        quantidade = cleaned_data.get('quantidade')

        if ticker and not classe_ativo and not Ativo.objects.filter(ticker=ticker).exists():
            self.add_error('classe_ativo', 'Obrigatório para cadastrar um ativo novo.')

        if ticker and tipo == Transacao.Tipo.VENDA and quantidade and self.usuario:
            ativo = Ativo.objects.filter(ticker=ticker).first()
            disponivel = (
                quantidade_disponivel(self.usuario, ativo, excluir_transacao_id=self.instance.pk)
                if ativo else Decimal('0')
            )
            if quantidade > disponivel:
                self.add_error(
                    'quantidade',
                    f'Você não pode vender mais do que possui: {_formatar_quantidade(disponivel)} '
                    f'unidade(s) de {ticker} disponível(is) hoje. Este projeto ainda não trabalha '
                    'com venda a descoberto.',
                )

        return cleaned_data

    def clean_quantidade(self):
        quantidade = self.cleaned_data['quantidade']
        if quantidade <= 0:
            raise forms.ValidationError('A quantidade deve ser maior que zero.')
        return quantidade

    def clean_preco_unitario(self):
        preco_unitario = self.cleaned_data['preco_unitario']
        if preco_unitario <= 0:
            raise forms.ValidationError('O preço unitário deve ser maior que zero.')
        return preco_unitario

    def clean_corretagem_taxas(self):
        corretagem_taxas = self.cleaned_data.get('corretagem_taxas') or Decimal('0')
        if corretagem_taxas < 0:
            raise forms.ValidationError('As taxas não podem ser negativas.')
        return corretagem_taxas

    def save(self, usuario, commit=True):
        ativo, _ = Ativo.objects.get_or_create(
            ticker=self.cleaned_data['ticker'],
            defaults={
                'classe': self.cleaned_data.get('classe_ativo') or Ativo.Classe.ACAO,
            },
        )
        self.instance.ativo = ativo
        self.instance.usuario = usuario
        return super().save(commit=commit)
