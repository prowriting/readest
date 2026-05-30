export type BookCodeResult = {
  code: string;
  title: string;
  author: string;
  coverUrl: string;
  format: string;
  readingTimeMin: number;
  readingTimeMax: number;
  pages: number;
  words: number;
  downloadUrl: string;
};

// TODO: replace with real API call to https://api.bookarc.app/codes/:code
export async function fetchBookByCode(code: string): Promise<BookCodeResult | null> {
  // Stub: always returns a found book for any non-empty code
  if (!code) return null;
  return {
    code,
    title: 'The Angel of Dickens',
    author: 'Mary Dodds',
    coverUrl: '',
    format: 'EPUB',
    readingTimeMin: 5,
    readingTimeMax: 7,
    pages: 275,
    words: 76000,
    downloadUrl: '',
  };
}
