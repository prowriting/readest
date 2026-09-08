import { getAPIBaseUrl, getAuthorBaseUrl } from '@/services/environment';

export class BookCodeError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'BookCodeError';
  }
}

export type BookCodeResult = {
  giftId: string;
  code: string;
  book: {
    title: string;
    author: string;
    coverImageUrl: string | null;
    description: string;
    format: string;
    requestAnalytics?: boolean;
    collectAnnotations?: boolean;
    appOnlyReading?: boolean;
  };
  downloadRef: string;
  expiresAt: string;
};

export type BookDownloadProgress = {
  receivedBytes: number;
  totalBytes: number | null;
};

export async function fetchBookByCode(code: string): Promise<BookCodeResult> {
  const apiBaseUrl = getAPIBaseUrl();
  const res = await fetch(`${apiBaseUrl}/claim/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.toLowerCase().trim() }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new BookCodeError(res.status, text || `HTTP ${res.status}`);
  }
  const result = (await res.json()) as BookCodeResult;
  if (result.book.coverImageUrl) {
    result.book.coverImageUrl = new URL(result.book.coverImageUrl, getAuthorBaseUrl()).toString();
  }
  return result;
}

export async function downloadGiftBook(
  downloadRef: string,
  onProgress?: (progress: BookDownloadProgress) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(
    `${getAPIBaseUrl()}/claim/download?ref=${encodeURIComponent(downloadRef)}`,
  );
  if (!res.ok) {
    throw new BookCodeError(res.status, `Download failed: HTTP ${res.status}`);
  }
  if (!onProgress || !res.body) return res.arrayBuffer();

  const contentLength = Number.parseInt(res.headers.get('Content-Length') ?? '', 10);
  const totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedBytes += value.byteLength;
    onProgress({ receivedBytes, totalBytes });
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

export async function confirmGiftRedemption(downloadRef: string): Promise<void> {
  try {
    await fetch(`${getAPIBaseUrl()}/claim/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadRef }),
    });
  } catch (err) {
    console.error('Gift confirm failed (book already saved):', err);
  }
}
