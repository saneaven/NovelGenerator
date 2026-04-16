export function isAdminMemoryDiagnosticsEnabled(): boolean {
  return (import.meta.env.VITE_ADMIN_MEMORY_DIAGNOSTICS_ENABLED as string | undefined) === '1';
}
