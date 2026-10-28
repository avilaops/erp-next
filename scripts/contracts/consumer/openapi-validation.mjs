import SwaggerParser from '@apidevtools/swagger-parser';

export async function validateOpenApi(document) {
  try {
    await SwaggerParser.validate(structuredClone(document), {
      resolve: { file: false, http: false },
      dereference: { circular: 'ignore' },
    });
  } catch { throw new Error('INVALID_OPENAPI'); }
}
