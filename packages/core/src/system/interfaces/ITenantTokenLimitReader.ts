export interface ITenantTokenLimitReader {
  getById(tenantId: string): { readonly token_limit: number } | null;
}
