import SwaggerParser from '@apidevtools/swagger-parser';

export async function validateOpenApi(document) {
  try {
    await SwaggerParser.validate(structuredClone(document), {
      resolve: { file: false, http: false },
      dereference: { circular: 'ignore' },
    });
  } catch (error) {
    const failure = new Error('INVALID_OPENAPI');
    failure.details = Array.isArray(error.details) ? error.details.map(({instancePath,keyword,schemaPath})=>({instancePath,keyword,schemaPath})) : [];
    throw failure;
  }
}
