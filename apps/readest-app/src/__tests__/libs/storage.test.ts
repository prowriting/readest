import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// getAPIBaseUrl() is evaluated at module load in libs/storage, so the
// environment mock has to be in place before the module is imported.
vi.mock('@/services/environment', () => ({
  getAPIBaseUrl: () => 'https://reader.bookarc.app/api',
  isWebAppPlatform: vi.fn(() => true),
}));

vi.mock('@/utils/fetch', () => ({
  fetchWithAuth: vi.fn(async () => ({
    json: async () => ({
      uploadUrl: 'https://acct.blob.core.windows.net/readest/users/u1/books/h/book.epub?sig=x',
    }),
  })),
}));

vi.mock('@/utils/access', () => ({
  getUserID: vi.fn(async () => 'u1'),
}));

vi.mock('@/utils/transfer', () => ({
  webUpload: vi.fn(async () => undefined),
  tauriUpload: vi.fn(async () => ''),
  webDownload: vi.fn(),
  tauriDownload: vi.fn(),
}));

const { isWebAppPlatform } = await import('@/services/environment');
const { webUpload, tauriUpload } = await import('@/utils/transfer');
const { uploadFile, uploadReplicaFile } = await import('@/libs/storage');

describe('uploadFile — Azure Blob PUT headers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isWebAppPlatform).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Azure's "Put Blob" REST operation rejects a PUT to a SAS URL with HTTP 400
  // unless the x-ms-blob-type header is present. S3/R2 presigned PUTs (what the
  // upstream Readest client targeted) don't need it, which is why it was missing.
  test('web upload sends x-ms-blob-type: BlockBlob', async () => {
    const file = new File(['content'], 'book.epub');
    await uploadFile(file, '/local/book.epub');

    expect(webUpload).toHaveBeenCalledTimes(1);
    const headers = vi.mocked(webUpload).mock.calls[0]![3];
    expect(headers).toMatchObject({ 'x-ms-blob-type': 'BlockBlob' });
  });

  test('tauri upload sends x-ms-blob-type: BlockBlob', async () => {
    vi.mocked(isWebAppPlatform).mockReturnValue(false);
    const file = new File(['content'], 'book.epub');
    await uploadFile(file, '/local/book.epub');

    expect(tauriUpload).toHaveBeenCalledTimes(1);
    const headers = vi.mocked(tauriUpload).mock.calls[0]![4] as unknown as Record<string, string>;
    expect(headers).toMatchObject({ 'x-ms-blob-type': 'BlockBlob' });
  });

  test('replica upload also sends x-ms-blob-type: BlockBlob (web)', async () => {
    const file = new File(['content'], 'dict.zip');
    await uploadReplicaFile(file, '/local/dict.zip', 'replicas/dict/id/dict.zip', 'dict', 'id');

    expect(webUpload).toHaveBeenCalledTimes(1);
    const headers = vi.mocked(webUpload).mock.calls[0]![3];
    expect(headers).toMatchObject({ 'x-ms-blob-type': 'BlockBlob' });
  });
});
