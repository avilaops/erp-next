import { DurableObject } from 'cloudflare:workers';
import { createRuntimeClass, routeRuntimeRequest } from './runtime-core.mjs';

export class ErpRuntime extends createRuntimeClass(DurableObject) {}
export default { fetch: routeRuntimeRequest };
