import { test as base, expect, type Page } from '@playwright/test';
import { createIntl } from 'react-intl';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ApiCallRecord,
  ApiResponse,
  PyxAPI,
  UploadResponse,
} from '../../src/lib/types';
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

type MockWindow = {
  pyxAPI: PyxAPI;
  __apiCalls?: ApiCallRecord[];
  __fileTextCalled?: boolean;
};

type TestFixtures = {
  /** Respuesta alternativa para la subida del mock canónico. */
  uploadResponse: ApiResponse<unknown> | undefined;
  /**
   * Overrides del bloque devuelto por la subida del mock canónico.
   * Permite simular un bloque categórico (tabla de metadata).
   */
  block: Partial<UploadResponse['block']> | undefined;
};

const test = base.extend<TestFixtures>({
  uploadResponse: async ({}, use) => {
    await use(undefined);
  },
  block: async ({}, use) => {
    await use(undefined);
  },
});

const SUMMARY_UPLOAD_RESPONSE: ApiResponse<UploadResponse> = {
  ok: true,
  status: 201,
  data: {
    block: {
      name: 'Transcriptómica',
      filename: 'demo.csv',
      n_samples: 500,
      n_variables: 20000,
      n_numeric_variables: 20000,
      columns: ['gene_1'],
      sample_id_column: 'sample_id',
    },
    warnings: [],
    preview: {
      columns: ['sample_id', 'gene_1'],
      rows: [['S1', '1.25']],
    },
  },
};

const NON_NUMERIC_WARNING_RESPONSE: ApiResponse<UploadResponse> = {
  ok: true,
  status: 201,
  data: {
    block: {
      name: 'demo',
      filename: 'demo.csv',
      n_samples: 2,
      n_variables: 2,
      n_numeric_variables: 1,
      columns: ['feature_1', 'metadata'],
      sample_id_column: 'sample_id',
    },
    warnings: [
      {
        code: 'W_NON_NUMERIC_COLUMNS',
        message_key: 'ingest.warnings.nonNumericColumns',
        columns: ['metadata'],
        detail: {},
      },
    ],
    preview: { columns: ['sample_id'], rows: [['S1']] },
  },
};

const MISSING_VALUES_WARNING_RESPONSE: ApiResponse<unknown> = {
  ok: true,
  status: 201,
  data: {
    block: {
      name: 'demo',
      filename: 'demo.csv',
      n_samples: 3,
      n_variables: 2,
      n_numeric_variables: 2,
      columns: ['feature_1', 'feature_2'],
      sample_id_column: 'sample',
    },
    warnings: [
      {
        code: 'W_MISSING_VALUES',
        message_key: 'ingest.warnings.missingValues',
        columns: ['feature_2'],
        detail: { total_cells: 7, affected_columns: 1 },
      },
    ],
    preview: { columns: ['sample', 'feature_1'], rows: [['S1', '1.0']] },
  },
};

const UNKNOWN_BLOCK_ERROR_RESPONSE: ApiResponse<unknown> = {
  ok: false,
  status: 404,
  data: {
    error: {
      code: 'E_UNKNOWN_BLOCK',
      message_key: 'errors.unknownBlock',
      detail: { file: 'nutrimouse_gene.csv' },
    },
  },
};

const FASTAPI_DETAIL_ERROR_RESPONSE: ApiResponse<unknown> = {
  ok: false,
  status: 500,
  data: { detail: 'El archivo no existe.' },
};

const VALIDATION_ERROR_RESPONSE: ApiResponse<unknown> = {
  ok: false,
  status: 422,
  data: {
    detail: [
      {
        loc: ['body', 'filename'],
        msg: 'field required',
        type: 'value_error.missing',
      },
    ],
  },
};

const UNKNOWN_WARNING_RESPONSE: ApiResponse<UploadResponse> = {
  ok: true,
  status: 201,
  data: {
    block: {
      name: 'demo',
      filename: 'demo.csv',
      n_samples: 2,
      n_variables: 1,
      n_numeric_variables: 1,
      columns: ['feature_1'],
      sample_id_column: 'sample_id',
    },
    warnings: [
      {
        code: 'W_FUTURE_WARNING',
        message_key: 'ingest.warnings.futureWarning',
        detail: {},
      },
    ],
    preview: { columns: ['sample_id'], rows: [['S1']] },
  },
};

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
test.beforeEach(async ({ page, uploadResponse, block }) => {
  await page.addInitScript(installApiMock, { uploadResponse, block });
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

/**
 * Mockea los 3 assets del dataset nutrimouse: los 2 bloques numéricos y la
 * tabla de metadata (fenotipo).
 */
async function mockNutrimouseAssets(page: Page) {
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
  await page.route('**/datasets/nutrimouse_meta.csv', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/csv',
      body: 'sample,genotype,diet\n1,wt,lin\n2,wt,sun\n',
    });
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
    await expect(dialog.getByText('nutrimouse', { exact: true })).toBeVisible();
    await expect(dialog.getByText('srbct', { exact: true })).toBeVisible();
    await expect(dialog.getByText('breast.TCGA', { exact: true })).toBeVisible();
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
    // El modal también trae la tabla de metadata (fenotipo) del dataset.
    await page.route('**/datasets/srbct_meta.csv', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/csv',
        body: 'sample,class\nEWS.T1,EWS\nEWS.T2,EWS\n',
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

  test('cargar nutrimouse trae los 2 bloques (gene + lipid) y la tabla de metadata', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await mockNutrimouseAssets(page);

    await page
      .getByRole('button', { name: es['topbar.datasetsLabel'] })
      .click();
    await page
      .getByRole('button', { name: msg('datasets.loadLabel', { name: 'nutrimouse' }) })
      .click();

    // Los 3 archivos están en el FileList: los 2 bloques y el metadata.
    await expect(
      page.getByRole('listitem').filter({ hasText: 'nutrimouse_gene.csv' }),
    ).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'nutrimouse_lipid.csv' }),
    ).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'nutrimouse_meta.csv' }),
    ).toBeVisible();
    // El contador de archivos dice "3 archivos cargados"
    await expect(
      page.getByText(msg('load.filesCount', { count: 3 })),
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

  test.describe('resumen de ingesta del backend', () => {
    test.use({ uploadResponse: SUMMARY_UPLOAD_RESPONSE });

    test('la UI muestra el resumen devuelto por el backend', async ({
      page,
    }) => {
      await gotoPipeline(page);
      await uploadCsv(page, 'demo.csv');

      await expect(page.getByText('Transcriptómica')).toBeVisible();
      await expect(
        page.getByText(
          msg('ingest.dimensions', { samples: 500, variables: 20000 }),
        ),
      ).toBeVisible();
      await expect(
        page.getByRole('columnheader', { name: 'gene_1' }),
      ).toBeVisible();
      await expect(page.getByRole('cell', { name: '1.25' })).toBeVisible();
    });
  });

  /**
   * Clasificación del bloque.
   *
   * El backend informa hechos (`n_numeric_variables` = cuántas columnas son
   * numéricas por dtype), pero NO dice si el archivo es metadata: eso lo
   * declara el origen del archivo (el `metaFile` del catálogo de datasets).
   */
  test.describe('clasificación del bloque ingestado', () => {
    test('un bloque con todas sus variables numéricas muestra solo las dimensiones', async ({
      page,
    }) => {
      await gotoPipeline(page);
      await uploadCsv(page, 'demo.csv');

      // El mock por defecto devuelve un bloque 100% numérico.
      await expect(
        page.getByText(msg('ingest.dimensions', { samples: 2, variables: 1 })),
      ).toBeVisible();
      await expect(page.getByText(es['ingest.metadataBlock'])).toHaveCount(0);
      await expect(
        page.getByText(msg('ingest.numericVariables', { count: 1 })),
      ).toHaveCount(0);
    });

    test('el resumen muestra qué columna contiene los IDs de muestra', async ({
      page,
    }) => {
      await gotoPipeline(page);
      await uploadCsv(page, 'demo.csv');

      // Es la defensa más barata contra un archivo sin fila de
      // encabezado: si el nombre de la columna de IDs es un valor (por
      // ejemplo "S1"), el error se ve sin interpretar nada.
      await expect(
        page.getByText(msg('ingest.sampleIdColumn', { column: 'sample_id' })),
      ).toBeVisible();
    });

    test.describe('bloque mixto (numéricas + no numéricas)', () => {
      test.use({
        block: {
          n_variables: 4,
          n_numeric_variables: 3,
          columns: ['f1', 'f2', 'f3', 'metadata'],
        },
      });

      test('un bloque mixto muestra cuántas variables numéricas tiene', async ({
        page,
      }) => {
        await gotoPipeline(page);
        await uploadCsv(page, 'demo.csv');

        await expect(
          page.getByText(msg('ingest.numericVariables', { count: 3 })),
        ).toBeVisible();
        // No es la tabla de metadata: el rol no lo decide el dtype.
        await expect(page.getByText(es['ingest.metadataBlock'])).toHaveCount(0);
      });
    });

    test.describe('bloque sin variables numéricas', () => {
      test.use({
        block: {
          n_variables: 2,
          n_numeric_variables: 0,
          columns: ['categoria_1', 'categoria_2'],
        },
      });

      test('el conteo de variables numéricas no lo convierte en tabla de metadata', async ({
        page,
      }) => {
        await gotoPipeline(page);
        await uploadCsv(page, 'demo.csv');

        await expect(
          page.getByText(msg('ingest.numericVariables', { count: 0 })),
        ).toBeVisible();
        // La etiqueta de metadata la decide el ROL del archivo, no el
        // dtype de sus columnas.
        await expect(page.getByText(es['ingest.metadataBlock'])).toHaveCount(0);
      });
    });
  });

  test('el modal de ejemplos sube también el archivo de metadata', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await mockNutrimouseAssets(page);

    await page.getByRole('button', { name: es['topbar.datasetsLabel'] }).click();
    await page
      .getByRole('button', { name: msg('datasets.loadLabel', { name: 'nutrimouse' }) })
      .click();

    // El modal se cierra: todo el lote entró bien.
    await expect(
      page.getByRole('dialog', { name: es['datasets.title'] }),
    ).not.toBeVisible();

    // Se subieron los 3 archivos: los 2 bloques y el metadata, al final.
    await expect
      .poll(
        async () =>
          (await readApiCalls(page)).filter((c) => c.path === '/v1/archivos/')
            .length,
      )
      .toBe(3);

    const uploads = (await readApiCalls(page)).filter(
      (c) => c.path === '/v1/archivos/',
    );
    expect(uploads.map((u) => u.filename)).toEqual([
      'nutrimouse_gene.csv',
      'nutrimouse_lipid.csv',
      'nutrimouse_meta.csv',
    ]);

    // Y el metadata queda en la lista de archivos del proyecto.
    await expect(
      page.getByRole('listitem').filter({ hasText: 'nutrimouse_meta.csv' }),
    ).toBeVisible();
  });

  test('un archivo que falla no aborta el resto del lote', async ({ page }) => {
    await gotoPipeline(page);
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
    // La tabla de metadata falla: el resto del lote tiene que seguir.
    await page.route('**/datasets/nutrimouse_meta.csv', async (route) => {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
    });

    await page.getByRole('button', { name: es['topbar.datasetsLabel'] }).click();
    await page
      .getByRole('button', { name: msg('datasets.loadLabel', { name: 'nutrimouse' }) })
      .click();

    // El modal sigue abierto y reporta el archivo que falló.
    const dialog = page.getByRole('dialog', { name: es['datasets.title'] });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert')).toContainText('nutrimouse_meta.csv');

    // Pero los 2 bloques que sí entraron quedan en el FileList.
    const fileList = page.getByRole('list', { name: es['file.listLabel'] });
    await expect(
      fileList.getByRole('listitem').filter({ hasText: 'nutrimouse_gene.csv' }),
    ).toBeVisible();
    await expect(
      fileList.getByRole('listitem').filter({ hasText: 'nutrimouse_lipid.csv' }),
    ).toBeVisible();
    await expect(
      fileList.getByRole('listitem').filter({ hasText: 'nutrimouse_meta.csv' }),
    ).toHaveCount(0);
  });

  test('solo la tabla de metadata del dataset de ejemplo se anuncia como metadata', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await mockNutrimouseAssets(page);

    await page.getByRole('button', { name: es['topbar.datasetsLabel'] }).click();
    await page
      .getByRole('button', { name: msg('datasets.loadLabel', { name: 'nutrimouse' }) })
      .click();

    await expect(
      page.getByRole('dialog', { name: es['datasets.title'] }),
    ).not.toBeVisible();

    // El rol lo declara el catálogo del dataset (su `metaFile`), no el dtype
    // de las columnas: solo ese bloque lleva la etiqueta de metadata.
    await expect(page.getByText(es['ingest.metadataBlock'])).toHaveCount(1);
  });

  test.describe('warnings de ingesta', () => {
    test.use({ uploadResponse: NON_NUMERIC_WARNING_RESPONSE });

    test('un warning de ingesta se muestra traducido en español', async ({
      page,
    }) => {
      await gotoPipeline(page);
      await uploadCsv(page, 'demo.csv');

      const translated = msg('ingest.warnings.nonNumericColumns', {
        columns: 'metadata',
      });
      await expect(page.getByText(translated)).toBeVisible();
      await expect(
        page.getByText('ingest.warnings.nonNumericColumns'),
      ).toHaveCount(0);
    });

    test('un warning de ingesta se muestra traducido en inglés', async ({
      page,
    }) => {
      await seedLocale(page, 'en');
      await page.goto('/');
      await page.getByRole('button', { name: en['home.cta'] }).click();
      await uploadCsv(page, 'demo.csv');

      const translated = msg(
        'ingest.warnings.nonNumericColumns',
        { columns: 'metadata' },
        'en',
      );
      await expect(page.getByText(translated)).toBeVisible();
      await expect(
        page.getByText(
          msg('ingest.warnings.nonNumericColumns', { columns: 'metadata' }),
        ),
      ).toHaveCount(0);
    });
  });

  test.describe('warning de celdas faltantes', () => {
    test.use({ uploadResponse: MISSING_VALUES_WARNING_RESPONSE });

    test('muestra cuántas celdas faltan y en qué columnas', async ({
      page,
    }) => {
      await gotoPipeline(page);
      await uploadCsv(page, 'demo.csv');

      const translated = msg('ingest.warnings.missingValues', {
        count: 7,
        columns: 'feature_2',
      });
      await expect(page.getByText(translated)).toBeVisible();
      await expect(
        page.getByText('ingest.warnings.missingValues'),
      ).toHaveCount(0);
    });

    test('se muestra traducido en inglés', async ({ page }) => {
      await seedLocale(page, 'en');
      await page.goto('/');
      await page.getByRole('button', { name: en['home.cta'] }).click();
      await uploadCsv(page, 'demo.csv');

      const translated = msg(
        'ingest.warnings.missingValues',
        { count: 7, columns: 'feature_2' },
        'en',
      );
      await expect(page.getByText(translated)).toBeVisible();
    });
  });

  test.describe('warning de ingesta desconocido', () => {
    test.use({ uploadResponse: UNKNOWN_WARNING_RESPONSE });

    test('un message_key desconocido muestra un texto genérico', async ({
      page,
    }) => {
      await gotoPipeline(page);
      await uploadCsv(page, 'demo.csv');

      await expect(page.getByText(msg('ingest.warningGeneric'))).toBeVisible();
      await expect(
        page.getByText('ingest.warnings.futureWarning'),
      ).toHaveCount(0);
    });
  });

  test('la subida recibe una ruta y no el contenido del archivo', async ({
    page,
  }) => {
    await page.goto('/');
    await gotoPipeline(page);
    await uploadCsv(page, 'demo.csv');

    await expect
      .poll(
        async () =>
          (await readApiCalls(page)).filter((c) => c.filename === 'demo.csv')
            .length,
      )
      .toBe(1);

    const upload = (await readApiCalls(page)).find(
      (c) => c.filename === 'demo.csv',
    );
    expect(
      await page.evaluate(() => typeof window.pyxAPI.getPathForFile),
    ).toBe('function');
    expect(upload?.sourcePath).toBe('/tmp/pythomics-mock/demo.csv');
    expect(upload?.content).toBeUndefined();
    expect(
      await page.evaluate(
        () => (window as unknown as MockWindow).__fileTextCalled,
      ),
    ).toBe(false);
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
      // El splash se elimina 300 ms después del primer paint. Se captura el
      // pseudo-elemento en el instante en que aparece para no depender de
      // esa carrera al consultar el DOM más tarde.
      await page.addInitScript(() => {
        const w = window as unknown as { __splashTagline?: string | null };
        const observer = new MutationObserver(() => {
          const el = document.querySelector('#splash .tagline');
          if (!el) return;
          w.__splashTagline = getComputedStyle(el, '::before').content;
          observer.disconnect();
        });
        observer.observe(document, { childList: true, subtree: true });
      });
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      const tagline = await page.evaluate(
        () =>
          (window as unknown as { __splashTagline?: string | null })
            .__splashTagline ?? null,
      );
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
 * Errores del backend.
 *
 * El backend devuelve los errores de dominio en su propio sobre
 * (`{"error": {code, message_key, detail}}`): el renderer tiene que
 * consumirlo y traducirlo con su catálogo. Los dos formatos de FastAPI
 * (`detail` string y lista de validación 422) se conservan como fallback.
 *
 * Los textos assertados salen de los catálogos: un assert literal se
 * desincroniza apenas cambia el copy.
 */

test.describe('Errores del backend', () => {
  test.use({ uploadResponse: UNKNOWN_BLOCK_ERROR_RESPONSE });

  test('el sobre de error del backend se muestra traducido en la UI', async ({
    page,
  }) => {
    await page.goto('/');
    await gotoPipeline(page);
    await uploadCsv(page, 'demo.csv');

    // El mensaje sale del catálogo, interpolando el `detail` del backend.
    await expect(
      page.getByText(
        msg('errors.unknownBlock', { file: 'nutrimouse_gene.csv' }),
      ),
    ).toBeVisible();
    // Y no queda en blanco ni muestra la clave cruda.
    await expect(page.getByText('errors.unknownBlock')).toHaveCount(0);
  });

  test('el mismo error muestra textos distintos según el idioma', async ({
    page,
  }) => {
    await seedLocale(page, 'en');
    await page.goto('/');
    await page.getByRole('button', { name: en['home.cta'] }).click();
    await uploadCsv(page, 'demo.csv');

    // En inglés sale el texto de en.json.
    await expect(
      page.getByText(
        msg('errors.unknownBlock', { file: 'nutrimouse_gene.csv' }, 'en'),
      ),
    ).toBeVisible();
    // Y el de es.json no aparece por ninguna parte.
    await expect(
      page.getByText(
        msg('errors.unknownBlock', { file: 'nutrimouse_gene.csv' }),
      ),
    ).toHaveCount(0);
  });

  test.describe('fallback de FastAPI', () => {
    test.use({ uploadResponse: FASTAPI_DETAIL_ERROR_RESPONSE });

    test('el detail string sigue mostrando el texto', async ({ page }) => {
      await page.goto('/');
      await gotoPipeline(page);
      await uploadCsv(page, 'demo.csv');

      await expect(page.getByText('El archivo no existe.')).toBeVisible();
    });
  });

  test.describe('fallback de validación 422', () => {
    test.use({ uploadResponse: VALIDATION_ERROR_RESPONSE });

    test('la lista de detail sigue mostrando el texto', async ({ page }) => {
      await page.goto('/');
      await gotoPipeline(page);
      await uploadCsv(page, 'demo.csv');

      await expect(page.getByText('field required')).toBeVisible();
    });
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
