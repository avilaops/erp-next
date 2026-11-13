# Pedido comercial e SMTP da plataforma

O usuário rejeitou o PDF atual de PV-000004 e solicitou corrigir a abertura do envio por e-mail. Depois definiu uma configuração SMTP central na plataforma, em Preferências. A automação do navegador deve continuar em segundo plano; scripts permanentes pertencem a scripts/, nunca a artifacts/.

## Evidência e objetivo

O PDF fornecido tem cinco páginas Letter rasterizadas, navegação do ERP e tabela cortada. Salvar PDF chama window.print() sobre a tela operacional. O log de produção confirmou permission denied for table sales_order_email_deliveries ao abrir o compositor.

Entregar um PDF A4 próprio, com texto selecionável, identidade do emitente, número e situação, cliente, itens com acabamentos, quantidades, preços registrados, totais, peso bruto, entrega e pagamento previstos. Paginar itens longos sem corte, repetir identificação/cabeçalho/rodapé e não exportar custos, margem, alçadas internas ou comissões. Rascunho não implica estoque reservado ou pagamento recebido.

## Escolhas de implementação

PDF gerado no backend a partir do snapshot autorizado do pedido, compartilhado pelo download e pelo anexo do e-mail. Biblioteca PDF estabelecida, fonte Unicode incorporada, sem motor de navegador no servidor. Corrigir somente CSS de impressão deixaria o resultado dependente do navegador; capturar a tela manteria os defeitos observados. A escolha pelo PDF vetorial no backend é de implementação e pode ser revista antes da integração.

SMTP único para pedidos, propostas e pacotes de documentos. Preferências → Sistema → E-mail (SMTP), configuração global acessível somente a administradores da plataforma. Campos: nome amigável, servidor, porta, STARTTLS/TLS, usuário, senha substituível sem leitura de volta, nome/e-mail do remetente, ativação. Configuração persistida prevalece imediatamente sobre o ambiente; registro desativado não volta ao ambiente silenciosamente. Ambiente é compatibilidade de inicialização, não um segundo serviço de envio. Não alterar n8n: o usuário escolheu configurar na plataforma.

Senha cifrada pelo mecanismo de segredos já existente, com contexto vinculado ao servidor/usuário/modo. Mudança do destino exige nova senha. Revisão/If-Match, validação local/servidor e confirmação após falha. Não expor segredo na resposta, logs, auditoria ou OpenAPI de leitura; não realizar envio real de teste nem preencher credenciais inventadas. STARTTLS e TLS validam certificado; não oferecer transporte sem criptografia.

## Restrições e aceite

- Manter RLS por empresa e conceder apenas SELECT/INSERT/UPDATE nas tabelas de entregas. Não conceder acesso público, superusuário ou bypass de RLS.
- Download autenticado, empresa e revisão conferidas; sem HTML/PDF arbitrário enviado pelo navegador para o SMTP.
- Preservar idempotência e estados de envio incerto. SMTP indisponível não grava tentativa como se tivesse enviado.
- Dados do pedido real são somente leitura na verificação. Nenhum novo pedido, confirmação, cancelamento, e-mail real ou emissão fiscal como teste.
- Testes com usuário SQL restrito, autorização global, segredos, concorrência e envios simulados; navegador com fixtures, A4 e múltiplas páginas com extração de texto e inspeção visual. Build local e publicação com health/versionamento conferidos.
- Preservar PDF original, docs/Resumo.md e scripts/browser/ existentes; serviços locais3002/8083/55441 e PostgreSQL de testes55443.
