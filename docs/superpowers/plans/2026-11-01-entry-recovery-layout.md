# Recuperação de acesso na primeira tela

**Problema reproduzido:** em 320 × 568, `erro=restart` deixa Entrar entre y=563 e y=615. O aviso aparece separado dos controles, acima da apresentação comercial.

**Solução:** quando houver um dos três erros conhecidos, substituir a apresentação comercial por “Retome o acesso” e pelo aviso existente. Manter o aviso junto dos controles, com destaque lateral e descrição acessível no botão Entrar. A entrada normal, os textos de erro e os destinos existentes permanecem os mesmos.

## Plano

- [x] Reproduzir o problema na entrada pública e inspecionar os três estados.
- [x] Implementar a apresentação de recuperação, preservando formulário e conteúdo do aviso. Compactar também o título de recuperação em paisagem para que o fim do aviso fique visível.
- [x] Verificar alerta e controles inteiros em 320 × 568 e 568 × 320 para restart, denied e unavailable; validar returnTo e navegação por teclado.
- [x] Executar lint/build, 16 testes de onboarding (26,9 s) e 5 testes de sessão (7,5 s); revisão independente do diff final sem achados.
- [ ] Aprovar CI/release completos e verificar a publicação.

## Limites

- Alteração de apresentação, sem mudar a decisão de autenticação ou recuperação.
- Sem JavaScript adicional, API, dependências ou migrations.
- Conteúdo ampliado continua acessível por rolagem; sem altura fixa ou corte.
