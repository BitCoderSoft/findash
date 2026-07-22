from django.contrib import admin

from .models import Ativo, Provento, Transacao


@admin.register(Ativo)
class AtivoAdmin(admin.ModelAdmin):
    list_display = ('ticker', 'nome', 'classe', 'moeda')
    list_filter = ('classe', 'moeda')
    search_fields = ('ticker', 'nome')


@admin.register(Transacao)
class TransacaoAdmin(admin.ModelAdmin):
    list_display = ('usuario', 'ativo', 'tipo', 'quantidade', 'preco_unitario', 'data')
    list_filter = ('tipo', 'ativo__classe')
    search_fields = ('ativo__ticker', 'usuario__username')
    date_hierarchy = 'data'


@admin.register(Provento)
class ProventoAdmin(admin.ModelAdmin):
    list_display = ('usuario', 'ativo', 'tipo', 'valor', 'data')
    list_filter = ('tipo', 'ativo__classe')
    search_fields = ('ativo__ticker', 'usuario__username')
    date_hierarchy = 'data'
