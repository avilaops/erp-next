import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';
import { FiscalClient, FiscalError, UUID } from './client.mjs';

export function createFiscalMcp(client) {
  const server = new McpServer({ name: 'avila-erp-fiscal', version: '1.0.0' }, {
    instructions: 'Opera na empresa configurada no processo. 202 não é autorização. Consulte status antes de reconciliar; não repita emissão com nova chave. Escritas exigem confirmação explícita do usuário.',
  });
  const id = z.string().regex(UUID);
  const document = { id };
  const command = { id, revision: z.number().int().safe().min(1), idempotencyKey: id, confirm: z.literal(true) };

  function register(name, description, fields, method, readOnly = true) {
    server.registerTool(name, {
      description, inputSchema: z.strictObject(fields),
      annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: true, openWorldHint: true },
    }, async args => {
      try {
        const result = await client[method](args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        const result = error instanceof FiscalError ? error.toJSON() : { code: 'integration_failed' };
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      }
    });
  }

  register('fiscal_readiness', 'Verifica configuração e bloqueios fiscais; não altera documentos.', {}, 'readiness');
  register('fiscal_nfe_draft', 'Lê o rascunho existente e sua revisão.', document, 'draft');
  register('fiscal_nfe_status', 'Lê o estado persistido. Não consulta a SEFAZ nem transmite XML.', document, 'status');
  register('fiscal_nfe_xml', 'Lê XML preservado. A existência do XML assinado não comprova autorização.', document, 'xml');
  register('fiscal_nfe_pdf', 'Gera DANFE pelo serviço existente a partir do XML; retorna PDF em base64.', document, 'pdf');
  if (client.allowWrites) {
    register('fiscal_nfe_issue', 'EMITE NF-e em homologação. Exige confirmação explícita, revisão e UUID estável para a operação. Não use para consultar status.', command, 'issue', false);
    register('fiscal_nfe_consult_sefaz', 'RECONCILIA documento com a SEFAZ e altera estado persistido. Exige confirmação explícita; use fiscal_nfe_status para leitura.', command, 'consult', false);
  }
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { await createFiscalMcp(FiscalClient.fromEnv()).connect(new StdioServerTransport()); }
  catch (error) {
    console.error(JSON.stringify(error instanceof FiscalError ? error.toJSON() : { code: 'mcp_start_failed' }));
    process.exitCode = 1;
  }
}
