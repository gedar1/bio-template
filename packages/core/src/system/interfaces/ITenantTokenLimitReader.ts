export interface TenantTokenLimit {
  readonly token_limit: number;
}

export interface ITenantTokenLimitReader {
  getById(tenantId: string): TenantTokenLimit | null;
}
