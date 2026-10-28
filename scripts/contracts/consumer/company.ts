import type { paths } from './generated.js';

type ReadCompany = paths['/api/v1/company']['get']['responses'][200]['content']['application/json'];
type UpdateCompany = NonNullable<paths['/api/v1/company']['put']['requestBody']>['content']['application/json'];
type SavedCompany = paths['/api/v1/company']['put']['responses'][200]['content']['application/json'];

export function editCompany(current: ReadCompany): { etag: string; body: UpdateCompany } {
  const revision: number = current.revision;
  const tenant: string = current.tenantId;
  const editable: boolean = current.canEdit;
  if (!editable || tenant.length === 0) throw new Error('Company is not editable');
  return { etag: `"${revision}"`, body: current.data };
}

export function displaySavedCompany(saved: SavedCompany): string {
  const name: string = saved.data.legalName;
  return `${name} (${saved.revision})`;
}
