import { test, expect } from '@playwright/test';

/**
 * Tests E2E de la POC del frontend.
 *
 * Apuntan al dev server de Vite (no a Electron) con `window.pyxAPI`
 * mockeado. No se valida la integración con el backend — eso es
 * responsabilidad de tests con `_electron` cuando se implemente.
 *
 * Solo se prueban los botones e interacciones principales.
 */

test.describe('Pythomics frontend — POC', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('carga la app con los 3 pasos en el sidebar', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pythomics');
    await expect(
      page.getByRole('button', { name: 'Cargar datos' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Configurar modelo' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Resultados' }),
    ).toBeVisible();
  });

  test('abre el modal de Configuración desde el sidebar', async ({ page }) => {
    await page.getByRole('button', { name: 'Abrir configuración' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Configuración' }),
    ).toBeVisible();
    await expect(
      page.getByText('Cargar tu API key de un proveedor de IA (BYOK)'),
    ).toBeVisible();
  });

  test('cierra el modal con el botón Cerrar', async ({ page }) => {
    await page.getByRole('button', { name: 'Abrir configuración' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Configuración' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Configuración' }),
    ).not.toBeVisible();
  });

  test('cierra el modal con tecla Escape', async ({ page }) => {
    await page.getByRole('button', { name: 'Abrir configuración' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Configuración' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: 'Configuración' }),
    ).not.toBeVisible();
  });

  test('abre y cierra el panel de logs', async ({ page }) => {
    await page
      .getByRole('button', { name: 'Mostrar logs del backend' })
      .click();
    await expect(
      page.getByRole('region', { name: 'Logs del backend' }),
    ).toBeVisible();

    await page
      .getByRole('button', { name: 'Ocultar logs del backend' })
      .click();
    await expect(
      page.getByRole('region', { name: 'Logs del backend' }),
    ).not.toBeVisible();
  });

  test('el botón Siguiente está deshabilitado sin archivos', async ({
    page,
  }) => {
    const next = page.getByRole('button', { name: /Siguiente/ });
    await expect(next).toBeVisible();
    await expect(next).toBeDisabled();
  });

  test('navega al paso 2 desde el sidebar', async ({ page }) => {
    await page.getByRole('button', { name: 'Configurar modelo' }).click();
    await expect(
      page.getByText('Paso 2 · Configurar modelo'),
    ).toBeVisible();
  });

  test('navega al paso 3 desde el sidebar', async ({ page }) => {
    await page.getByRole('button', { name: 'Resultados' }).click();
    await expect(page.getByText('Paso 3 · Resultados')).toBeVisible();
  });

  test('abre el modal de Tutorial desde el TopBar', async ({ page }) => {
    await page.getByRole('button', { name: 'Abrir tutorial' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Tutorial' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '¿Qué es esto?' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '¿Cómo usar?' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Más información' }),
    ).toBeVisible();
  });

  test('el link a mixOmics apunta a la documentación oficial', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Abrir tutorial' }).click();
    const link = page.getByRole('link', { name: /Documentación oficial/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://mixomics.org/');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
  });

  test('cierra el modal de Tutorial con tecla Escape', async ({ page }) => {
    await page.getByRole('button', { name: 'Abrir tutorial' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Tutorial' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: 'Tutorial' }),
    ).not.toBeVisible();
  });

  test('abre el modal de datasets de ejemplo desde el TopBar', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Probar con dataset de ejemplo' }).click();
    const dialog = page.getByRole('dialog', { name: 'Probar con dataset de ejemplo' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('nutrimouse')).toBeVisible();
    await expect(dialog.getByText('srbct')).toBeVisible();
    await expect(dialog.getByText('breast.TCGA')).toBeVisible();
  });

  test('cargar srbct desde el modal lo agrega al FileList y cierra el modal', async ({
    page,
  }) => {
    await page.route('**/datasets/srbct_gene.csv', async (route) => {
      const fakeCsv = 'sample_1,sample_2\n1.2,3.4\n5.6,7.8\n';
      await route.fulfill({
        status: 200,
        contentType: 'text/csv',
        body: fakeCsv,
      });
    });

    await page.getByRole('button', { name: 'Probar con dataset de ejemplo' }).click();
    await page.getByRole('button', { name: 'Cargar dataset srbct' }).click();

    // El modal se cierra
    await expect(
      page.getByRole('dialog', { name: 'Probar con dataset de ejemplo' }),
    ).not.toBeVisible();
    // El archivo aparece en el FileList
    await expect(
      page.getByRole('listitem').filter({ hasText: 'srbct_gene.csv' }),
    ).toBeVisible();
    // El botón Siguiente se habilita
    await expect(page.getByRole('button', { name: /Siguiente/ })).toBeEnabled();
  });

  test('el modal de datasets de ejemplo se cierra con Escape', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Probar con dataset de ejemplo' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Probar con dataset de ejemplo' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: 'Probar con dataset de ejemplo' }),
    ).not.toBeVisible();
  });

  test('el Tutorial tiene la sección ¿Por dónde empezar? con botón', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Abrir tutorial' }).click();
    const dialog = page.getByRole('dialog', { name: 'Tutorial' });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('heading', { name: '¿Por dónde empezar?' }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Abrir datasets de ejemplo' }),
    ).toBeVisible();
  });

  test('el botón ¿Por dónde empezar? abre el modal de datasets', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Abrir tutorial' }).click();
    await page.getByRole('button', { name: 'Abrir datasets de ejemplo' }).click();
    // El modal de Tutorial se cierra
    await expect(page.getByRole('dialog', { name: 'Tutorial' })).not.toBeVisible();
    // Se abre el modal de datasets
    await expect(
      page.getByRole('dialog', { name: 'Probar con dataset de ejemplo' }),
    ).toBeVisible();
  });

  test('cargar nutrimouse trae los 2 bloques (gene + lipid) en paralelo', async ({
    page,
  }) => {
    // Mockeamos los 2 fetches en paralelo
    await page.route('**/datasets/nutrimouse_gene.csv', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/csv',
        body: 'g1,g2,g3\n1.0,2.0,3.0\n4.0,5.0,6.0\n',
      });
    });
    await page.route('**/datasets/nutrimouse_lipid.csv', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/csv',
        body: 'l1,l2\n0.1,0.2\n0.3,0.4\n',
      });
    });

    await page
      .getByRole('button', { name: 'Probar con dataset de ejemplo' })
      .click();
    await page
      .getByRole('button', { name: 'Cargar dataset nutrimouse' })
      .click();

    // Ambos archivos están en el FileList
    await expect(
      page.getByRole('listitem').filter({ hasText: 'nutrimouse_gene.csv' }),
    ).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'nutrimouse_lipid.csv' }),
    ).toBeVisible();
    // El contador de archivos dice "2 archivos cargados"
    await expect(page.getByText('2 archivos cargados')).toBeVisible();
  });
});