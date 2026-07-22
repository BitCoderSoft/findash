from django.conf import settings
from django.db import models
from django.db.models import Q


class Ativo(models.Model):
    class Classe(models.TextChoices):
        ACAO = 'ACAO', 'Ação'
        FII = 'FII', 'FII'
        CRIPTO = 'CRIPTO', 'Criptomoeda'
        RENDA_FIXA = 'RENDA_FIXA', 'Renda fixa'

    class Moeda(models.TextChoices):
        BRL = 'BRL', 'Real'
        USD = 'USD', 'Dólar'

    ticker = models.CharField(max_length=20, unique=True)
    nome = models.CharField(max_length=150, blank=True)
    classe = models.CharField(max_length=20, choices=Classe.choices)
    moeda = models.CharField(max_length=3, choices=Moeda.choices, default=Moeda.BRL)
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['ticker']

    def __str__(self):
        return self.ticker

    def save(self, *args, **kwargs):
        self.ticker = self.ticker.upper().strip()
        super().save(*args, **kwargs)


class Transacao(models.Model):
    class Tipo(models.TextChoices):
        COMPRA = 'COMPRA', 'Compra'
        VENDA = 'VENDA', 'Venda'

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='transacoes',
    )
    ativo = models.ForeignKey(Ativo, on_delete=models.PROTECT, related_name='transacoes')
    tipo = models.CharField(max_length=10, choices=Tipo.choices)
    quantidade = models.DecimalField(max_digits=20, decimal_places=8)
    preco_unitario = models.DecimalField(max_digits=18, decimal_places=8)
    data = models.DateField()
    corretagem_taxas = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-data']
        indexes = [
            models.Index(fields=['usuario', 'ativo']),
        ]
        constraints = [
            models.CheckConstraint(condition=Q(quantidade__gt=0), name='transacao_quantidade_positiva'),
            models.CheckConstraint(condition=Q(preco_unitario__gt=0), name='transacao_preco_positivo'),
            models.CheckConstraint(condition=Q(corretagem_taxas__gte=0), name='transacao_taxas_nao_negativas'),
        ]

    def __str__(self):
        return f'{self.get_tipo_display()} {self.ativo} ({self.data})'

    @property
    def valor_total(self):
        return self.quantidade * self.preco_unitario + self.corretagem_taxas


class Provento(models.Model):
    class Tipo(models.TextChoices):
        DIVIDENDO = 'DIVIDENDO', 'Dividendo'
        JCP = 'JCP', 'JCP'
        RENDIMENTO = 'RENDIMENTO', 'Rendimento'

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='proventos',
    )
    ativo = models.ForeignKey(Ativo, on_delete=models.PROTECT, related_name='proventos')
    tipo = models.CharField(max_length=10, choices=Tipo.choices)
    valor = models.DecimalField(max_digits=18, decimal_places=8)
    data = models.DateField()
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-data']
        indexes = [
            models.Index(fields=['usuario', 'ativo']),
        ]
        constraints = [
            models.CheckConstraint(condition=Q(valor__gt=0), name='provento_valor_positivo'),
        ]

    def __str__(self):
        return f'{self.get_tipo_display()} {self.ativo} ({self.data})'
