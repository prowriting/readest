import { expect, test } from '../fixtures/base';
import { rememberCloudLogin } from '../fixtures/preferences';

test('a remembered cloud session does not block the local library when signed out', async ({
  page,
  context,
}) => {
  await page.goto('/library');
  await page.getByRole('heading', { name: 'Start your library', exact: true }).waitFor();
  await context.route('**/guest-library-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
      body: '<p>Prepare remembered cloud preference.</p>',
    }),
  );
  await page.goto('/guest-library-test');
  await rememberCloudLogin(page, true);
  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  await expect(
    page.getByRole('heading', { name: 'Start your library', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/library$/);
});
