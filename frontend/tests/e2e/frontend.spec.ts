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
    await expect(page.getByText('Pythomics', { exact: true })).toBeVisible();
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
});