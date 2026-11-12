# Referências técnicas

[Voltar às telas](../README.md)

As instruções de uso ficam nos [guias por tela](../README.md). Os contratos técnicos específicos de uma tela estão na pasta `referencias` ao lado do respectivo guia.

## Manutenção do projeto

- [CONTEUDO-E-CONTRATOS](CONTEUDO-E-CONTRATOS.md)
- [CONTEXTO-FUNCIONALIDADES](CONTEXTO-FUNCIONALIDADES.md)
- [CONTRATOS-ACOES-P0](CONTRATOS-ACOES-P0.md)
- [LANGFUSE](LANGFUSE.md)
- [OPENAPI-CI](OPENAPI-CI.md)
- [PLATFORM-TENANT-ADMINISTRATION](PLATFORM-TENANT-ADMINISTRATION.md)
- [siscomex-local-evaluation](siscomex-local-evaluation.md)
- [Planejamento das operações](PLANO-OPERACOES-ERP.mdx).

## Organização e conferência

- [Mapa de rotas e guias](mapa-telas.csv): relaciona cada `page.tsx` ao guia responsável; lista rotas, não atesta operações executadas.
- [Caminhos anteriores e atuais](movimentacoes.json): permite localizar os documentos reorganizados e conferir sua preservação.
- [Verificação do projeto](../../verification/README.md): operações, fontes e verificações existentes.

Para conferir links, fontes e cobertura das telas:

```powershell
python scripts/docs/check.py
```

Ao acrescentar uma tela, atualize o guia e o mapa. Ao mover um arquivo, atualize seus consumidores, inclusive o catálogo de verificação. Não publique dados pessoais, credenciais ou cópias privadas da operação nestes documentos.
