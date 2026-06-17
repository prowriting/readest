import { getAPIBaseUrl } from '@/services/environment';

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
    coverImageUrl: string;
    description: string;
    format: string;
  };
  downloadRef: string;
  expiresAt: string;
};

export async function fetchBookByCode(code: string): Promise<BookCodeResult> {
  const res = await fetch(`${getAPIBaseUrl()}/claim/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.toLowerCase().trim() }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new BookCodeError(res.status, text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<BookCodeResult>;
}

export async function downloadGiftBook(downloadRef: string): Promise<ArrayBuffer> {
  const res = await fetch(
    `${getAPIBaseUrl()}/claim/download?ref=${encodeURIComponent(downloadRef)}`,
  );
  if (!res.ok) {
    throw new BookCodeError(res.status, `Download failed: HTTP ${res.status}`);
  }
  return res.arrayBuffer();
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
