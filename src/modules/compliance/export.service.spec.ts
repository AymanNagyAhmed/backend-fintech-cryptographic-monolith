import { ExportService } from './export.service.js';

describe('ExportService helpers', () => {
  it('constructs with dependencies', () => {
    const svc = new ExportService(
      { auditEvent: { findMany: vi.fn() }, treeHead: { findFirst: vi.fn() } } as never,
      { record: vi.fn() } as never,
      { find: vi.fn() } as never,
      { putExportZip: vi.fn().mockResolvedValue(null) } as never,
      { get: vi.fn() } as never,
    );
    expect(svc).toBeInstanceOf(ExportService);
  });
});
