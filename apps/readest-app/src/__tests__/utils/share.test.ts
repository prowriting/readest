import { describe, it, expect } from 'vitest';
import { buildShareUrl, parseShareDeepLink } from '@/utils/share';

describe('buildShareUrl', () => {
  it('builds the canonical https URL for a token', () => {
    expect(buildShareUrl('aBcDeFgHiJkLmNoPqRsTuV')).toBe(
      'https://web.bookarc.app/s/aBcDeFgHiJkLmNoPqRsTuV',
    );
  });
});

describe('parseShareDeepLink', () => {
  const VALID_TOKEN = 'aBcDeFgHiJkLmNoPqRsTuV';

  it('parses bookarc://share/{token}', () => {
    expect(parseShareDeepLink(`bookarc://share/${VALID_TOKEN}`)).toEqual({ token: VALID_TOKEN });
  });

  it('parses https://web.bookarc.app/s/{token}', () => {
    expect(parseShareDeepLink(`https://web.bookarc.app/s/${VALID_TOKEN}`)).toEqual({
      token: VALID_TOKEN,
    });
  });

  it('parses *.bookarc.app subdomains for preview deploys', () => {
    expect(parseShareDeepLink(`https://staging.bookarc.app/s/${VALID_TOKEN}`)).toEqual({
      token: VALID_TOKEN,
    });
  });

  it('parses legacy readest://share/{token} (backward compat)', () => {
    expect(parseShareDeepLink(`readest://share/${VALID_TOKEN}`)).toEqual({ token: VALID_TOKEN });
  });

  it('parses legacy https://web.readest.com/s/{token} (backward compat)', () => {
    expect(parseShareDeepLink(`https://web.readest.com/s/${VALID_TOKEN}`)).toEqual({
      token: VALID_TOKEN,
    });
  });

  it('rejects tokens of the wrong length', () => {
    expect(parseShareDeepLink('bookarc://share/short')).toBeNull();
    expect(parseShareDeepLink(`bookarc://share/${VALID_TOKEN}extra`)).toBeNull();
  });

  it('rejects tokens with disallowed characters', () => {
    // Underscore and hyphen are explicitly NOT in the alphabet.
    const bad = 'aBcDeFgHiJkLmNoPqRsTu-';
    expect(parseShareDeepLink(`bookarc://share/${bad}`)).toBeNull();
  });

  it('rejects URLs from third-party hosts', () => {
    expect(parseShareDeepLink(`https://evil.example.com/s/${VALID_TOKEN}`)).toBeNull();
  });

  it('rejects bookarc:// URLs whose host is not "share"', () => {
    expect(parseShareDeepLink(`bookarc://book/${VALID_TOKEN}`)).toBeNull();
    expect(parseShareDeepLink(`bookarc://annotation/${VALID_TOKEN}`)).toBeNull();
  });

  it('rejects nested or extra path segments', () => {
    expect(parseShareDeepLink(`https://web.bookarc.app/s/${VALID_TOKEN}/extra`)).toBeNull();
    expect(parseShareDeepLink(`https://web.bookarc.app/extra/s/${VALID_TOKEN}`)).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(parseShareDeepLink('')).toBeNull();
    expect(parseShareDeepLink('not-a-url')).toBeNull();
    expect(parseShareDeepLink('ftp://web.bookarc.app/s/' + VALID_TOKEN)).toBeNull();
  });
});
