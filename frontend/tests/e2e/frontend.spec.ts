import { test, expect, type Page } from '@playwright/test';
import { createIntl } from 'react-intl';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApiCallRecord } from '../../src/lib/types';
import { installApiMock } from '../../playwright.config';
import es from '../../src/i18n/es.json' with { type: 'json' };
import en from '../../src/i18n/en.json' with { type: 'json' };

/**
 * Formatea un mensaje del catálogo.
 *
 * Necesario para los labels con plural ICU (el radiogroup de temas, el
 * contador de archivos) y para los que interpolan valores (el nombre del
 * archivo, el nombre del dataset): no son literales fijos.
 */
function msg(
  key: string,
  values?: Record<string, string | number>,
  locale: 'es' | 'en' = 'es',
): string {
  const intl = createIntl({
    locale,
    messages: locale === 'en' ? en : es,
  });
  return intl.formatMessage({ id: key }, values);
}

/** Label accesible del grupo de temas: "Tema de colores · 5 disponibles". */
const THEME_GROUP_LABEL = msg('theme.groupLabel', { count: 5 });

/**
 * Tests E2E de la POC del frontend.
 *
 * Apuntan al dev server de Vite (no a Electron) con `window.pyxAPI`
 * mockeado. No se valida la integración con el backend — eso es
 * responsabilidad de tests con `_electron` cuando se implemente.
 *
 * Solo se prueban los botones e interacciones principales.
 */

/**
 * Inyecta el mock del preload de Electron (`window.pyxAPI`) en cada página.
 *
 * Va como `beforeEach` de archivo para que corra antes de cualquier
 * navegación: el init script se aplica a los documentos que se carguen
 * después de instalarlo.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(installApiMock);
});

/**
 * La app arranca en la pantalla de Inicio. Los tests del pipeline entran
 * primero por el CTA del hero en lugar de asumir que arrancan ahí.
 */
async function gotoPipeline(page: Page) {
  await page.getByRole('button', { name: es['home.cta'] }).click();
  await expect(page.getByText(es['topbar.step.load'])).toBeVisible();
}

/**
 * Sube un CSV de prueba por el dropzone.
 */
async function uploadCsv(page: Page, name: string) {
  await page.locator('#file-input').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from('s1,s2,s3\n1.0,2.0,3.0\n4.0,5.0,6.0\n'),
  });
}

test.describe('Pythomics frontend — POC', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('carga la app con los 3 pasos en el sidebar', async ({ page }) => {
    await gotoPipeline(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pythomics');
    await expect(
      page.getByRole('button', { name: es['nav.load'] }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: es['nav.configure'] }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: es['nav.results'] }),
    ).toBeVisible();
  });

  test('abre el modal de Configuración desde el sidebar', async ({ page }) => {
    await gotoPipeline(page);
    await page.getByRole('button', { name: es['nav.openSettings'] }).click();
    const dialog = page.getByRole('dialog', { name: es['settings.title'] });
    await expect(dialog).toBeVisible();
    // El sidebar de secciones está presente con "Personalización" activa
    await expect(
      dialog.getByRole('navigation', { name: es['settings.sectionsLabel'] }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: es['settings.personalization'] }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('el selector de temas muestra los 5 temas disponibles', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await page.getByRole('button', { name: es['nav.openSettings'] }).click();
    const group = page.getByRole('radiogroup', { name: THEME_GROUP_LABEL });
    await expect(group).toBeVisible();
    await expect(group.getByRole('radio')).toHaveCount(5);
    await expect(group).toContainText('Pharmacy Fresh');
    await expect(group).toContainText('Sterile Aqua');
    await expect(group).toContainText('Minted Hygiene');
    await expect(group).toContainText('Soft Bandage');
    await expect(group).toContainText('Immunity Citrus');
  });

  test('cambiar el tema actualiza data-theme y persiste en localStorage', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await page.getByRole('button', { name: es['nav.openSettings'] }).click();
    const group = page.getByRole('radiogroup', { name: THEME_GROUP_LABEL });

    // El default es Pharmacy Fresh
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'pharmacy-fresh');

    // Cambiar a Sterile Aqua
    await group.getByRole('radio').filter({ hasText: 'Sterile Aqua' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sterile-aqua');

    // Persistido en localStorage
    const stored = await page.evaluate(() => localStorage.getItem('pythomics.theme'));
    expect(stored).toBe('sterile-aqua');

    // Y sobrevive a un reload (anti-FOUC lo aplica antes del paint)
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sterile-aqua');
  });

  test('el tema cambia efectivamente el CSS del body', async ({ page }) => {
    await gotoPipeline(page);
    const bgDefault = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor,
    );
    await page.getByRole('button', { name: es['nav.openSettings'] }).click();
    await page
      .getByRole('radiogroup', { name: THEME_GROUP_LABEL })
      .getByRole('radio')
      .filter({ hasText: 'Sterile Aqua' })
      .click();
    await page.keyboard.press('Escape');

    const bgSterile = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor,
    );
    // #f9fffb vs #eaf7fb — deben diferir
    expect(bgSterile).not.toBe(bgDefault);
  });

  test('Telehealth Night aparece como Próximamente, no seleccionable', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await page.getByRole('button', { name: es['nav.openSettings'] }).click();
    const dialog = page.getByRole('dialog', { name: es['settings.title'] });
    await expect(dialog).toContainText('Telehealth Night');
    await expect(dialog).toContainText(es['theme.upcoming']);
    // No es un radio seleccionable: los únicos radios son los 5 temas.
    const themeGroup = dialog.getByRole('radiogroup', {
      name: THEME_GROUP_LABEL,
    });
    await expect(themeGroup.getByRole('radio')).toHaveCount(5);
  });

  test('cierra el modal con el botón Cerrar', async ({ page }) => {
    await gotoPipeline(page);
    await page.getByRole('button', { name: es['nav.openSettings'] }).click();
    await expect(
      page.getByRole('dialog', { name: es['settings.title'] }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: es['settings.close'], exact: true })
      .click();
    await expect(
      page.getByRole('dialog', { name: es['settings.title'] }),
    ).not.toBeVisible();
  });

  test('cierra el modal con tecla Escape', async ({ page }) => {
    await gotoPipeline(page);
    await page.getByRole('button', { name: es['nav.openSettings'] }).click();
    await expect(
      page.getByRole('dialog', { name: es['settings.title'] }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: es['settings.title'] }),
    ).not.toBeVisible();
  });

  

  test('el botón Siguiente está deshabilitado sin archivos', async ({
    page,
  }) => {
    await gotoPipeline(page);
    const next = page.getByRole('button', { name: es['load.next'] });
    await expect(next).toBeVisible();
    await expect(next).toBeDisabled();
  });

  test('navega al paso 2 desde el sidebar', async ({ page }) => {
    await gotoPipeline(page);
    await page.getByRole('button', { name: es['nav.configure'] }).click();
    await expect(
      page.getByText(es['topbar.step.configure']),
    ).toBeVisible();
  });

  test('navega al paso 3 desde el sidebar', async ({ page }) => {
    await gotoPipeline(page);
    await page.getByRole('button', { name: es['nav.results'] }).click();
    await expect(page.getByText(es['topbar.step.results'])).toBeVisible();
  });

  test('abre el modal de Tutorial desde el TopBar', async ({ page }) => {
    await gotoPipeline(page);
    await page.getByRole('button', { name: es['topbar.tutorialLabel'] }).click();
    await expect(
      page.getByRole('dialog', { name: es['tutorial.title'] }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: es['tutorial.whatIsThis'] }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: es['tutorial.howTo'] }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: es['tutorial.moreInfo'] }),
    ).toBeVisible();
  });

  test('el link a mixOmics apunta a la documentación oficial', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await page.getByRole('button', { name: es['topbar.tutorialLabel'] }).click();
    const link = page.getByRole('link', { name: es['tutorial.docsLink'] });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://mixomics.org/');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
  });

  test('cierra el modal de Tutorial con tecla Escape', async ({ page }) => {
    await gotoPipeline(page);
    await page.getByRole('button', { name: es['topbar.tutorialLabel'] }).click();
    await expect(
      page.getByRole('dialog', { name: es['tutorial.title'] }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: es['tutorial.title'] }),
    ).not.toBeVisible();
  });

  test('abre el modal de datasets de ejemplo desde el TopBar', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await page.getByRole('button', { name: es['topbar.datasetsLabel'] }).click();
    const dialog = page.getByRole('dialog', { name: es['datasets.title'] });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('nutrimouse')).toBeVisible();
    await expect(dialog.getByText('srbct')).toBeVisible();
    await expect(dialog.getByText('breast.TCGA')).toBeVisible();
  });

  test('cargar srbct desde el modal lo agrega al FileList y cierra el modal', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await page.route('**/datasets/srbct_gene.csv', async (route) => {
      const fakeCsv = 'sample_1,sample_2\n1.2,3.4\n5.6,7.8\n';
      await route.fulfill({
        status: 200,
        contentType: 'text/csv',
        body: fakeCsv,
      });
    });

    await page.getByRole('button', { name: es['topbar.datasetsLabel'] }).click();
    await page
      .getByRole('button', { name: msg('datasets.loadLabel', { name: 'srbct' }) })
      .click();

    // El modal se cierra
    await expect(
      page.getByRole('dialog', { name: es['datasets.title'] }),
    ).not.toBeVisible();
    // El archivo aparece en el FileList
    await expect(
      page.getByRole('listitem').filter({ hasText: 'srbct_gene.csv' }),
    ).toBeVisible();
    // El botón Siguiente se habilita
    await expect(page.getByRole('button', { name: es['load.next'] })).toBeEnabled();
  });

  test('el modal de datasets de ejemplo se cierra con Escape', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await page.getByRole('button', { name: es['topbar.datasetsLabel'] }).click();
    await expect(
      page.getByRole('dialog', { name: es['datasets.title'] }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: es['datasets.title'] }),
    ).not.toBeVisible();
  });

  test('el Tutorial tiene la sección ¿Por dónde empezar? con botón', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await page.getByRole('button', { name: es['topbar.tutorialLabel'] }).click();
    const dialog = page.getByRole('dialog', { name: es['tutorial.title'] });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('heading', { name: es['tutorial.whereToStart'] }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: es['tutorial.tryDatasetsLabel'] }),
    ).toBeVisible();
  });

  test('el botón ¿Por dónde empezar? abre el modal de datasets', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await page.getByRole('button', { name: es['topbar.tutorialLabel'] }).click();
    await page.getByRole('button', { name: es['tutorial.tryDatasetsLabel'] }).click();
    // El modal de Tutorial se cierra
    await expect(
      page.getByRole('dialog', { name: es['tutorial.title'] }),
    ).not.toBeVisible();
    // Se abre el modal de datasets
    await expect(
      page.getByRole('dialog', { name: es['datasets.title'] }),
    ).toBeVisible();
  });

  test('cargar nutrimouse trae los 2 bloques (gene + lipid) en paralelo', async ({
    page,
  }) => {
    await gotoPipeline(page);
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
      .getByRole('button', { name: es['topbar.datasetsLabel'] })
      .click();
    await page
      .getByRole('button', { name: msg('datasets.loadLabel', { name: 'nutrimouse' }) })
      .click();

    // Ambos archivos están en el FileList
    await expect(
      page.getByRole('listitem').filter({ hasText: 'nutrimouse_gene.csv' }),
    ).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'nutrimouse_lipid.csv' }),
    ).toBeVisible();
    // El contador de archivos dice "2 archivos cargados"
    await expect(
      page.getByText(msg('load.filesCount', { count: 2 })),
    ).toBeVisible();
  });

  test.describe('Pantalla de Inicio', () => {
    test('la app arranca en Inicio, sin el sidebar de pasos', async ({ page }) => {
      // Un solo h1 por pantalla
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pythomics');
      // Un solo landmark de contenido (Home y pipeline no coexisten)
      await expect(page.locator('#main-content')).toHaveCount(1);
      // La bajada del hero. El copy vive en el catálogo: se lee de `es.json`
      // para que un cambio de texto no rompa el suite en silencio.
      await expect(page.getByText(es['home.tagline'])).toBeVisible();
      // El CTA
      const cta = page.getByRole('button', { name: es['home.cta'] });
      await expect(cta).toBeVisible();
      // El footer no debe expulsar al hero de la ventana (toBeVisible solo
      // exige bounding box, no estar dentro del viewport).
      await expect(cta).toBeInViewport();
      // Los 3 pasos del pipeline todavía no existen
      await expect(
        page.getByRole('button', { name: es['nav.load'] }),
      ).not.toBeVisible();
      await expect(
        page.getByRole('button', { name: es['nav.configure'] }),
      ).not.toBeVisible();
      await expect(
        page.getByRole('button', { name: es['nav.results'] }),
      ).not.toBeVisible();
    });

    test('el CTA lleva al pipeline en el paso 1', async ({ page }) => {
      await page.getByRole('button', { name: es['home.cta'] }).click();
      await expect(page.getByText(es['topbar.step.load'])).toBeVisible();
      await expect(
        page.getByRole('button', { name: es['nav.load'] }),
      ).toBeVisible();
      // Home ya no está en pantalla
      await expect(
        page.getByRole('button', { name: es['home.cta'] }),
      ).not.toBeVisible();
    });

    test('Configuración se abre desde el header de Inicio', async ({ page }) => {
      await page.getByRole('button', { name: es['home.openSettings'] }).click();
      const dialog = page.getByRole('dialog', { name: es['settings.title'] });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole('navigation', { name: es['settings.sectionsLabel'] }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: es['settings.personalization'] }),
      ).toHaveAttribute('aria-current', 'page');
    });

    test('el título Pythomics del sidebar vuelve a Inicio', async ({ page }) => {
      await gotoPipeline(page);
      await page.getByRole('button', { name: 'Pythomics' }).click();
      await expect(
        page.getByRole('button', { name: es['home.cta'] }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: es['nav.load'] }),
      ).not.toBeVisible();
    });

    test('volver a Inicio y regresar conserva el paso actual', async ({
      page,
    }) => {
      await gotoPipeline(page);
      await page.getByRole('button', { name: es['nav.results'] }).click();
      await expect(page.getByText(es['topbar.step.results'])).toBeVisible();

      await page.getByRole('button', { name: 'Pythomics' }).click();
      await expect(
        page.getByRole('button', { name: es['home.cta'] }),
      ).toBeVisible();
      await page.getByRole('button', { name: es['home.cta'] }).click();

      // Sigue en Resultados, no vuelve al paso 1
      await expect(page.getByText(es['topbar.step.results'])).toBeVisible();
    });

    test('volver a Inicio conserva los archivos cargados', async ({ page }) => {
      await gotoPipeline(page);
      await uploadCsv(page, 'demo.csv');
      await expect(
        page.getByRole('listitem').filter({ hasText: 'demo.csv' }),
      ).toBeVisible();

      await page.getByRole('button', { name: 'Pythomics' }).click();
      await gotoPipeline(page);

      await expect(
        page.getByRole('listitem').filter({ hasText: 'demo.csv' }),
      ).toBeVisible();
      await expect(
        page.getByText(msg('load.filesCount', { count: 1 })),
      ).toBeVisible();
    });

    test('el skip link de Inicio salta al contenido principal', async ({
      page,
    }) => {
      const skip = page.getByRole('link', { name: es['app.skipToContent'] });
      await expect(skip).toHaveCount(1);
      // Invisible hasta recibir foco (sr-only: caja de 1px)
      const box = await skip.boundingBox();
      expect(box?.height ?? 0).toBeLessThanOrEqual(1);

      await page.keyboard.press('Tab');
      await expect(skip).toBeFocused();

      await page.keyboard.press('Enter');
      await expect(page.locator('#main-content')).toBeFocused();
    });

    test('la franja de roadmap lista los candidatos y no los presenta como botones', async ({
      page,
    }) => {
      const footer = page.getByRole('contentinfo');
      await expect(footer).toBeVisible();
      await expect(
        footer.getByRole('heading', { level: 2, name: es['home.roadmap.title'] }),
      ).toBeVisible();

      // Lista informativa, no interactiva: ni botones ni links.
      const items = footer.getByRole('listitem');
      await expect(items).toHaveCount(6);
      await expect(footer.getByRole('button')).toHaveCount(0);
      await expect(footer.getByRole('link')).toHaveCount(0);

      // El copy de la roadmap es una decisión de producto que cambia seguido,
      // así que NO se asserta literal: ya rompió el suite dos veces (el copy del
      // hero y esta lista). Lo que importa es que cada item tenga texto real.
      const texts = await items.allTextContents();
      expect(texts).toHaveLength(6);
      for (const t of texts) {
        expect(t.trim().length).toBeGreaterThan(0);
      }
    });
  });
});

/**
 * Rutas reales del backend.
 *
 * El mock de Playwright registra cada llamada en `window.__apiCalls`, así que
 * estos tests assertan sobre el path exacto que usa el frontend. No son
 * tautológicos: fallan si el frontend vuelve a POSTear a /v1/cargar/ o si
 * borra por path en vez de por query param.
 */
test.describe('Rutas contra el backend real', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('al cargar un CSV sube el archivo contra /v1/archivos/', async ({ page }) => {
    await gotoPipeline(page);

    await page.locator('#file-input').setInputFiles({
      name: 'demo.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('s1,s2,s3\n1.0,2.0,3.0\n4.0,5.0,6.0\n'),
    });

    await expect
      .poll(
        async () =>
          (await readApiCalls(page)).filter((c) => c.filename === 'demo.csv')
            .length,
      )
      .toBe(1);

    const calls = await readApiCalls(page);
    const upload = calls.find((c) => c.filename === 'demo.csv');
    expect(upload?.method).toBe('POST');
    expect(upload?.path).toBe('/v1/archivos/');
    // /v1/cargar/ ya no existe en el backend: no debe aparecer ninguna llamada.
    expect(calls.some((c) => c.path.startsWith('/v1/cargar/'))).toBe(false);
  });

  test('el borrado de un archivo usa el query param nombre_archivo', async ({ page }) => {
    await gotoPipeline(page);

    await page.locator('#file-input').setInputFiles({
      name: 'demo.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('s1,s2,s3\n1.0,2.0,3.0\n4.0,5.0,6.0\n'),
    });
    await expect(
      page.getByRole('listitem').filter({ hasText: 'demo.csv' }),
    ).toBeVisible();

    await page
      .getByRole('button', { name: msg('file.removeLabel', { filename: 'demo.csv' }) })
      .click();

    await expect
      .poll(
        async () =>
          (await readApiCalls(page)).filter((c) => c.method === 'DELETE').length,
      )
      .toBe(1);

    const del = (await readApiCalls(page)).find((c) => c.method === 'DELETE');
    expect(del?.path).toBe('/v1/archivos/?nombre_archivo=demo.csv');
  });

  test('el borrado escapa los caracteres especiales del nombre', async ({ page }) => {
    await gotoPipeline(page);

    await page.locator('#file-input').setInputFiles({
      name: 'mis datos.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('s1,s2,s3\n1.0,2.0,3.0\n'),
    });
    await expect(
      page.getByRole('listitem').filter({ hasText: 'mis datos.csv' }),
    ).toBeVisible();

    await page
      .getByRole('button', { name: msg('file.removeLabel', { filename: 'mis datos.csv' }) })
      .click();

    await expect
      .poll(
        async () =>
          (await readApiCalls(page)).filter((c) => c.method === 'DELETE').length,
      )
      .toBe(1);

    const del = (await readApiCalls(page)).find((c) => c.method === 'DELETE');
    expect(del?.path).toBe('/v1/archivos/?nombre_archivo=mis%20datos.csv');
  });
});

/**
 * Internacionalización.
 *
 * La UI es bilingüe (es/en) y la preferencia vive en
 * `localStorage['pythomics.locale']`. Estos tests cubren el selector de
 * idioma de Configuración, el cambio de idioma y la persistencia.
 *
 * Los strings salen de los catálogos (`es.json` / `en.json`): un assert
 * literal se desincroniza apenas cambia el copy.
 */
test.describe('Internacionalización', () => {
  test('el selector de idioma existe en Configuración y muestra Español como activo', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: es['home.openSettings'] }).click();
    const dialog = page.getByRole('dialog', { name: es['settings.title'] });
    await expect(dialog).toBeVisible();

    const group = dialog.getByRole('radiogroup', {
      name: es['settings.languageHeading'],
    });
    await expect(group).toBeVisible();
    // Un radio por idioma.
    await expect(group.getByRole('radio')).toHaveCount(2);

    // El nombre del idioma va en su propia lengua, también en la UI en español.
    const spanish = group.getByRole('radio', { name: 'Español' });
    const english = group.getByRole('radio', { name: 'English' });
    await expect(spanish).toHaveAttribute('aria-checked', 'true');
    await expect(spanish).toContainText(es['theme.active']);
    await expect(english).toHaveAttribute('aria-checked', 'false');
    // "Español" no se traduce a "Spanish".
    await expect(group.getByRole('radio', { name: 'Spanish' })).toHaveCount(0);
  });

  test('cambiar a English traduce la UI', async ({ page }) => {
    // La preferencia se siembra ANTES del goto: el provider tiene que
    // arrancar directamente en inglés.
    await seedLocale(page, 'en');
    await page.goto('/');
    await expect(page.getByRole('button', { name: en['home.cta'] })).toBeVisible();

    // Abrir Configuración (ya en inglés) y volver a español.
    await page.getByRole('button', { name: en['home.openSettings'] }).click();
    await expect(
      page.getByRole('dialog', { name: en['settings.title'] }),
    ).toBeVisible();
    await page
      .getByRole('dialog', { name: en['settings.title'] })
      .getByRole('radio', { name: 'Español' })
      .click();
    await expect(
      page.getByRole('dialog', { name: es['settings.title'] }),
    ).toBeVisible();

    // Elegir "English" traduce la UI de vuelta.
    await page
      .getByRole('dialog', { name: es['settings.title'] })
      .getByRole('radio', { name: 'English' })
      .click();
    await expect(
      page.getByRole('dialog', { name: en['settings.title'] }),
    ).toBeVisible();

    // Cerrar el modal: el CTA de Inicio dice el texto de en.json.
    await page.getByRole('button', { name: en['settings.close'], exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: en['home.cta'] })).toBeVisible();
  });

  test('la preferencia de idioma persiste entre recargas', async ({ page }) => {
    await seedLocale(page, 'en');
    await page.goto('/');
    await expect(page.getByRole('button', { name: en['home.cta'] })).toBeVisible();
    expect(await readLocale(page)).toBe('en');

    // Recarga: la UI sigue en inglés y la preferencia no se pierde.
    await page.reload();
    await expect(page.getByRole('button', { name: en['home.cta'] })).toBeVisible();
    expect(await readLocale(page)).toBe('en');

    // Un cambio hecho desde la UI también sobrevive a la recarga.
    await page.getByRole('button', { name: en['home.openSettings'] }).click();
    await page
      .getByRole('dialog', { name: en['settings.title'] })
      .getByRole('radio', { name: 'Español' })
      .click();
    expect(await readLocale(page)).toBe('es');

    await page.reload();
    await expect(page.getByRole('button', { name: es['home.cta'] })).toBeVisible();
    expect(await readLocale(page)).toBe('es');
  });

  test('el idioma por defecto es español', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: es['home.cta'] })).toBeVisible();
    // Sin preferencia sembrada, la app no escribe nada en localStorage.
    expect(await readLocale(page)).toBeNull();
  });
});

/**
 * Plurals ICU y formato regional.
 *
 * El contador de archivos y la hora de carga dependen del idioma activo:
 * los plurales se resuelven con ICU y la hora con el formateador de
 * react-intl (que usa el idioma del provider, no un locale fijo).
 */
test.describe('Plurales y formato regional', () => {
  test('el contador de archivos pluraliza en español', async ({ page }) => {
    await page.goto('/');
    await gotoPipeline(page);

    // Un archivo: singular.
    await uploadCsv(page, 'demo.csv');
    await expect(
      page.getByText(msg('load.filesCount', { count: 1 })),
    ).toBeVisible();

    // Dos archivos: plural.
    await uploadCsv(page, 'demo2.csv');
    await expect(
      page.getByText(msg('load.filesCount', { count: 2 })),
    ).toBeVisible();
  });

  test('el contador de archivos pluraliza en inglés', async ({ page }) => {
    // La preferencia se siembra ANTES del goto: el provider arranca en inglés.
    await seedLocale(page, 'en');
    await page.goto('/');
    await expect(page.getByRole('button', { name: en['home.cta'] })).toBeVisible();
    await page.getByRole('button', { name: en['home.cta'] }).click();

    await uploadCsv(page, 'demo.csv');
    await expect(
      page.getByText(msg('load.filesCount', { count: 1 }, 'en')),
    ).toBeVisible();

    await uploadCsv(page, 'demo2.csv');
    await expect(
      page.getByText(msg('load.filesCount', { count: 2 }, 'en')),
    ).toBeVisible();
  });

  test('la hora de carga usa el formato del idioma activo', async ({ page }) => {
    await page.goto('/');
    await gotoPipeline(page);
    await uploadCsv(page, 'demo.csv');

    const item = page.getByRole('listitem').filter({ hasText: 'demo.csv' });
    await expect(item).toBeVisible();
    const text = await item.innerText();
    // Formato español: 24 h, sin AM/PM.
    expect(text).toMatch(/\d{1,2}:\d{2}/);
    expect(text).not.toMatch(/AM|PM/);
  });

  test('la hora de carga cambia a formato inglés', async ({ page }) => {
    await seedLocale(page, 'en');
    await page.goto('/');
    await expect(page.getByRole('button', { name: en['home.cta'] })).toBeVisible();
    await page.getByRole('button', { name: en['home.cta'] }).click();
    await uploadCsv(page, 'demo.csv');

    const item = page.getByRole('listitem').filter({ hasText: 'demo.csv' });
    await expect(item).toBeVisible();
    const text = await item.innerText();
    // Formato inglés: 12 h con AM/PM (ya no hay locale fijo 'es-CL').
    expect(text).toMatch(/\d{1,2}:\d{2}\s?[AP]M/);
  });
});

/**
 * Siembra la preferencia de idioma ANTES de la primera navegación, para que
 * el provider arranque directamente en ese idioma (el catálogo `en.json` se
 * carga de forma diferida).
 *
 * Solo siembra si no hay valor: si no, el init script reescribiría la
 * preferencia en cada navegación y la persistencia no se podría verificar.
 */
async function seedLocale(page: Page, locale: 'es' | 'en') {
  await page.addInitScript((value) => {
    try {
      if (window.localStorage.getItem('pythomics.locale') === null) {
        window.localStorage.setItem('pythomics.locale', value);
      }
    } catch {
      // localStorage bloqueado (modo privado): el test falla después.
    }
  }, locale);
}

/** Lee la preferencia de idioma persistida. */
async function readLocale(page: Page): Promise<string | null> {
  return page.evaluate(() => window.localStorage.getItem('pythomics.locale'));
}

/** Lee el registro de llamadas al backend que arma el mock de Playwright. */
async function readApiCalls(page: Page): Promise<ApiCallRecord[]> {
  return page.evaluate(() => window.__apiCalls ?? []);
}

/**
 * Anti-FOUC y CSP.
 *
 * El anti-FOUC tiene que aplicar el tema persistido ANTES de que React
 * monte; si no, hay un flash visible en cada arranque. Y la CSP no debe
 * bloquear ningún script de la app (la build de producción se rompía entera
 * porque el origen file:// es opaco y 'self' no matcheaba).
 */
test.describe('Anti-FOUC y CSP', () => {
  test.beforeEach(async ({ page }) => {
    // Semilla la preferencia y registra el instante en que se aplica el
    // tema vs. el instante en que React monta.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('pythomics.theme', 'sterile-aqua');
      } catch {
        // localStorage bloqueado (modo privado): el test falla después.
      }

      const w = window as unknown as {
        __themeSetAt: number | null;
        __rootMountedAt: number | null;
      };
      w.__themeSetAt = null;
      w.__rootMountedAt = null;

      const obs = new MutationObserver(() => {
        if (
          w.__themeSetAt === null &&
          document.documentElement?.hasAttribute('data-theme')
        ) {
          w.__themeSetAt = performance.now();
        }
        const root = document.getElementById('root');
        if (w.__rootMountedAt === null && root && root.childElementCount > 0) {
          w.__rootMountedAt = performance.now();
        }
      });
      // Se observa `document` (no documentElement): el init script corre
      // antes de que exista <html>, así que observar el elemento fallaría.
      obs.observe(document, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    });

    await page.goto('/');
  });

  test('aplica el tema persistido ANTES de que React monte', async ({ page }) => {
    const { themeSetAt, rootMountedAt } = await page.evaluate(() => ({
      themeSetAt: (window as unknown as { __themeSetAt: number | null }).__themeSetAt,
      rootMountedAt: (window as unknown as { __rootMountedAt: number | null }).__rootMountedAt,
    }));

    expect(themeSetAt).not.toBeNull();
    expect(rootMountedAt).not.toBeNull();
    // El tema se aplicó antes del montaje: no hay flash.
    expect(themeSetAt!).toBeLessThan(rootMountedAt!);
    // Y aplicó el valor persistido, no el default.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sterile-aqua');
  });

  test('la CSP no bloquea ningún script de la app', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (msg) => {
      if (/Content Security Policy|Refused to/i.test(msg.text())) {
        violations.push(msg.text());
      }
    });

    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pythomics');
    expect(violations).toEqual([]);
  });
});

/**
 * Anti-FOUC del idioma, del título de la ventana y del splash.
 *
 * La preferencia se aplica en un script externo del <head>, antes de que
 * React monte. El título usa la misma fuente de verdad que los catálogos y
 * el tagline del splash se resuelve con CSS para que tampoco dependa de
 * React.
 */
test.describe('Anti-FOUC de idioma, título y splash', () => {
  /**
   * Registra cuándo se aplican el idioma y el título frente al montaje de
   * React. Interceptar el setter de `document.title` permite comprobar el
   * idioma español también: su valor estático no genera una mutación que
   * MutationObserver pueda detectar.
   */
  async function trackPreMountState(
    page: Page,
    locale: 'es' | 'en',
    title: string,
  ) {
    await page.addInitScript(
      ({ expectedLocale, expectedTitle }) => {
        const w = window as unknown as {
          __localeSetAt: number | null;
          __titleSetAt: number | null;
          __rootMountedAt: number | null;
        };
        w.__localeSetAt = null;
        w.__titleSetAt = null;
        w.__rootMountedAt = null;

        const titleDescriptor = Object.getOwnPropertyDescriptor(
          Document.prototype,
          'title',
        );
        if (!titleDescriptor?.get || !titleDescriptor.set) {
          throw new Error('No se pudo instrumentar document.title');
        }
        Object.defineProperty(document, 'title', {
          configurable: true,
          get() {
            return titleDescriptor.get!.call(document);
          },
          set(value: string) {
            titleDescriptor.set!.call(document, value);
            if (value === expectedTitle) {
              w.__titleSetAt = performance.now();
            }
          },
        });

        const obs = new MutationObserver(() => {
          if (
            w.__localeSetAt === null &&
            document.documentElement?.getAttribute('data-locale') ===
              expectedLocale
          ) {
            w.__localeSetAt = performance.now();
          }
          const root = document.getElementById('root');
          if (w.__rootMountedAt === null && root && root.childElementCount > 0) {
            w.__rootMountedAt = performance.now();
          }
        });
        obs.observe(document, {
          attributes: true,
          childList: true,
          subtree: true,
        });
      },
      { expectedLocale: locale, expectedTitle: title },
    );
  }

  test('aplica el idioma persistido ANTES de que React monte', async ({
    page,
  }) => {
    await seedLocale(page, 'en');
    await trackPreMountState(page, 'en', en['app.title']);
    await page.goto('/');

    const { localeSetAt, rootMountedAt } = await page.evaluate(() => {
      const w = window as unknown as {
        __localeSetAt: number | null;
        __rootMountedAt: number | null;
      };
      return {
        localeSetAt: w.__localeSetAt,
        rootMountedAt: w.__rootMountedAt,
      };
    });

    expect(localeSetAt).not.toBeNull();
    expect(rootMountedAt).not.toBeNull();
    expect(localeSetAt!).toBeLessThan(rootMountedAt!);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('data-locale', 'en');
  });

  for (const locale of ['en', 'es'] as const) {
    test(`el título de la página sigue al idioma (${locale})`, async ({
      page,
    }) => {
      const expectedTitle =
        locale === 'en' ? en['app.title'] : es['app.title'];
      await seedLocale(page, locale);
      await trackPreMountState(page, locale, expectedTitle);
      await page.goto('/');

      await expect(page).toHaveTitle(expectedTitle);

      const { titleSetAt, rootMountedAt } = await page.evaluate(() => {
        const w = window as unknown as {
          __titleSetAt: number | null;
          __rootMountedAt: number | null;
        };
        return {
          titleSetAt: w.__titleSetAt,
          rootMountedAt: w.__rootMountedAt,
        };
      });

      expect(titleSetAt).not.toBeNull();
      expect(rootMountedAt).not.toBeNull();
      expect(titleSetAt!).toBeLessThan(rootMountedAt!);
    });
  }

  for (const locale of ['en', 'es'] as const) {
    test(`el tagline del splash sigue al idioma (${locale})`, async ({
      page,
    }) => {
      await seedLocale(page, locale);
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      const tagline = await page.evaluate(() => {
        const el = document.querySelector('#splash .tagline');
        return el ? getComputedStyle(el, '::before').content : null;
      });
      const expectedTagline =
        locale === 'en'
          ? en['app.splashTagline']
          : es['app.splashTagline'];

      expect(tagline).not.toBeNull();
      expect(tagline).toContain(expectedTagline);
    });
  }

  test('los textos estáticos coinciden con el catálogo', async ({ page }) => {
    await page.goto('/');

    const staticTaglines = await page.evaluate(() => {
      const el = document.querySelector('#splash .tagline');
      return {
        es: el?.getAttribute('data-tagline-es'),
        en: el?.getAttribute('data-tagline-en'),
      };
    });
    expect(staticTaglines.es).toBe(es['app.splashTagline']);
    expect(staticTaglines.en).toBe(en['app.splashTagline']);

    const initSource = await page.evaluate(async () => {
      const response = await fetch('/app-init.js');
      if (!response.ok) {
        throw new Error(`No se pudo leer app-init.js: ${response.status}`);
      }
      return response.text();
    });
    expect(initSource).toContain(es['app.title']);
    expect(initSource).toContain(en['app.title']);
  });
});

/**
 * El guardián de i18n es la puerta que hace efectiva la regla "todo texto
 * visible al usuario vive en los catálogos". Corre también dentro de
 * `npm run build`; este test lo verifica en la suite.
 */
test.describe('Guardián de i18n', () => {
  test('no hay texto visible hardcodeado en el renderer', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const frontend = path.resolve(here, '..', '..');

    const result = spawnSync('node', ['scripts/check-i18n.mjs'], {
      cwd: frontend,
      encoding: 'utf8',
    });

    expect(
      result.status,
      `El guardián de i18n encontró problemas:\n${result.stdout}${result.stderr}`,
    ).toBe(0);
  });
});
