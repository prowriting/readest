import { useEffect, useRef, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { Book } from '@/types/book';
import { getUserLang } from '@/utils/misc';
import { isWebAppPlatform } from '@/services/environment';

import libraryEn from '@/data/demo/library.en.json';
import libraryZh from '@/data/demo/library.zh.json';

const libraries = {
  en: libraryEn,
  zh: libraryZh,
};

// Seeding the web library with sample books (Hamlet, etc. from library.*.json)
// is disabled for now — it also injected demo books into existing users'
// libraries on a fresh browser. Flip back to true to restore it.
const DEMO_BOOKS_ENABLED = false;

interface DemoBooks {
  library: string[];
}

export const useDemoBooks = () => {
  const { envConfig } = useEnv();
  const [books, setBooks] = useState<Book[]>([]);
  const isLoading = useRef(false);

  useEffect(() => {
    if (isLoading.current) return;
    isLoading.current = true;

    const userLang = getUserLang() as keyof typeof libraries;
    const fetchDemoBooks = async () => {
      try {
        const appService = await envConfig.getAppService();
        const demoBooks = libraries[userLang] || (libraries.en as DemoBooks);
        const books = await Promise.all(
          demoBooks.library.map((url) => appService.importBook(url, [], { saveBook: false })),
        );
        setBooks(books.filter((book) => book !== null) as Book[]);
      } catch (error) {
        console.error('Failed to import demo books:', error);
      }
    };

    const demoBooksFetchedFlag = localStorage.getItem('demoBooksFetched');
    if (DEMO_BOOKS_ENABLED && isWebAppPlatform() && !demoBooksFetchedFlag) {
      fetchDemoBooks();
      localStorage.setItem('demoBooksFetched', 'true');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return books;
};
