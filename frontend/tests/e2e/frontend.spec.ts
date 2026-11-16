import { test as base, expect, type Page } from '@playwright/test';
import { createIntl } from 'react-intl';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ApiCallRecord,
  ApiResponse,
  JobError,
  ProgressStage,
  PyxAPI,
  UploadResponse,
} from '../../src/lib/types';
import {
  installApiMock,
  MOCK_DATASET_ID,
  MOCK_JOB_ID,
  type ApiResponseRecord,
} from '../../playwright.config';
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
  __apiResponses?: ApiResponseRecord[];
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
  /**
   * Etapas por las que pasa el job en cada consulta de polling.
   * Sin valor, el mock recorre el ciclo completo del pipeline.
   */
  jobStages: ProgressStage[] | undefined;
  /** Si viene, el job termina en `failed` con ese error. */
  jobError: JobError | undefined;
};

const test = base.extend<TestFixtures>({
  uploadResponse: async ({}, use) => {
    await use(undefined);
  },
  block: async ({}, use) => {
    await use(undefined);
  },
  jobStages: async ({}, use) => {
    await use(undefined);
  },
  jobError: async ({}, use) => {
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

const MISSING_VALUES_ERROR_RESPONSE: ApiResponse<unknown> = {
  ok: false,
  status: 400,
  data: {
    error: {
      code: 'E_MISSING_VALUES',
      message_key: 'errors.missingValues',
      detail: {
        file: 'demo.csv',
        total_cells: 7,
        affected_columns: 1,
        columns: ['feature_2'],
      },
    },
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
test.beforeEach(async ({ page, uploadResponse, block, jobStages, jobError }) => {
  await page.addInitScript(installApiMock, {
    uploadResponse,
    block,
    jobStages,
    jobError,
  });
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

  test.describe('error de celdas faltantes', () => {
    test.use({ uploadResponse: MISSING_VALUES_ERROR_RESPONSE });

    test('muestra cuántas celdas faltan y por qué no se puede cargar', async ({
      page,
    }) => {
      await gotoPipeline(page);
      await uploadCsv(page, 'demo.csv');

      const translated = msg('errors.missingValues', {
        file: 'demo.csv',
        total_cells: 7,
      });
      await expect(page.getByText(translated)).toBeVisible();
      await expect(page.getByText('errors.missingValues')).toHaveCount(0);
    });

    test('se muestra traducido en inglés', async ({ page }) => {
      await seedLocale(page, 'en');
      await page.goto('/');
      await page.getByRole('button', { name: en['home.cta'] }).click();
      await uploadCsv(page, 'demo.csv');

      const translated = msg(
        'errors.missingValues',
        { file: 'demo.csv', total_cells: 7 },
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
 * Rol del archivo en el proyecto (`block` ↔ `metadata`).
 *
 * El usuario decide si el archivo que sube aporta variables al modelo o si
 * es la tabla de metadata (fenotipo). El rol NO lo deduce el dtype: una
 * tabla de metadata puede tener todas sus columnas numéricas.
 *
 * Cuando el rol cambia, la receta guardada en el backend queda vieja: el
 * identificador de la receta se limpia para que la próxima visita a
 * Configurar cree una receta nueva con los roles correctos.
 */
test.describe('Rol del archivo en el proyecto', () => {
  /** Cuenta las recetas creadas (POST /v1/datasets/). */
  async function countRecipes(page: Page): Promise<number> {
    return (await readApiCalls(page)).filter(
      (c) => c.method === 'POST' && c.path === '/v1/datasets/',
    ).length;
  }

  /** Bodies de las recetas creadas, en orden. */
  async function recipeBodies(page: Page): Promise<unknown[]> {
    return (await readApiCalls(page))
      .filter((c) => c.method === 'POST' && c.path === '/v1/datasets/')
      .map((c) => c.body);
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('el usuario marca un archivo subido como tabla de metadata', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await uploadCsv(page, 'demo.csv');

    // Al principio es un bloque de variables: no lleva la etiqueta de metadata.
    await expect(page.getByText(es['ingest.metadataBlock'])).toHaveCount(0);

    const marcar = page.getByRole('button', {
      name: es['ingest.markAsMetadata'],
    });
    await expect(marcar).toBeVisible();
    await marcar.click();

    // Aparece la etiqueta de metadata del estudio.
    await expect(page.getByText(es['ingest.metadataBlock'])).toBeVisible();

    // Y el control ofrece la acción contraria.
    await expect(
      page.getByRole('button', { name: es['ingest.markAsBlock'] }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: es['ingest.markAsMetadata'] }),
    ).toHaveCount(0);
  });

  test('el usuario devuelve el archivo al rol de bloque de variables', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await uploadCsv(page, 'demo.csv');

    await page
      .getByRole('button', { name: es['ingest.markAsMetadata'] })
      .click();
    await expect(page.getByText(es['ingest.metadataBlock'])).toBeVisible();

    await page.getByRole('button', { name: es['ingest.markAsBlock'] }).click();

    // La etiqueta de metadata desaparece.
    await expect(page.getByText(es['ingest.metadataBlock'])).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: es['ingest.markAsMetadata'] }),
    ).toBeVisible();
  });

  test('el control de rol es un botón real, con foco y activable con teclado', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await uploadCsv(page, 'demo.csv');

    const marcar = page.getByRole('button', {
      name: es['ingest.markAsMetadata'],
    });
    // `aria-pressed` comunica que el archivo todavía NO es metadata.
    await expect(marcar).toHaveAttribute('aria-pressed', 'false');

    await marcar.focus();
    await expect(marcar).toBeFocused();

    await page.keyboard.press('Enter');

    await expect(page.getByText(es['ingest.metadataBlock'])).toBeVisible();
    await expect(
      page.getByRole('button', { name: es['ingest.markAsBlock'] }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('cambiar el rol limpia la receta guardada y crea una receta nueva', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await uploadCsv(page, 'demo.csv');

    // Primera visita a Configurar: la receta se crea con el rol inicial.
    await page.getByRole('button', { name: es['load.next'] }).click();
    await expect(page.getByText(es['topbar.step.configure'])).toBeVisible();
    await expect.poll(() => countRecipes(page)).toBe(1);
    expect(await recipeBodies(page)).toEqual([
      { blocks: [{ name: 'demo.csv', role: 'block' }] },
    ]);

    // Vuelta a la pantalla de carga para cambiar el rol del archivo.
    await page.getByRole('button', { name: es['nav.load'] }).click();
    await expect(page.getByText(es['topbar.step.load'])).toBeVisible();
    await page
      .getByRole('button', { name: es['ingest.markAsMetadata'] })
      .click();
    await expect(page.getByText(es['ingest.metadataBlock'])).toBeVisible();

    // Nueva visita a Configurar: la receta vieja quedó obsoleta, así que se
    // crea una nueva con el rol correcto.
    await page.getByRole('button', { name: es['nav.configure'] }).click();
    await expect(page.getByText(es['topbar.step.configure'])).toBeVisible();
    await expect.poll(() => countRecipes(page)).toBe(2);
    expect(await recipeBodies(page)).toEqual([
      { blocks: [{ name: 'demo.csv', role: 'block' }] },
      { blocks: [{ name: 'demo.csv', role: 'metadata' }] },
    ]);
  });

  test('sin cambiar el rol la receta se recupera, no se crea otra', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await uploadCsv(page, 'demo.csv');

    await page.getByRole('button', { name: es['load.next'] }).click();
    await expect(page.getByText(es['topbar.step.configure'])).toBeVisible();
    await expect.poll(() => countRecipes(page)).toBe(1);

    // Ida y vuelta a la pantalla de carga, sin tocar el rol.
    await page.getByRole('button', { name: es['nav.load'] }).click();
    await expect(page.getByText(es['topbar.step.load'])).toBeVisible();
    await page.getByRole('button', { name: es['nav.configure'] }).click();
    await expect(page.getByText(es['topbar.step.configure'])).toBeVisible();

    // La receta existente se recupera (GET), no se crea otra (POST).
    await expect
      .poll(
        async () =>
          (await readApiCalls(page)).filter(
            (c) => c.method === 'GET' && c.path.startsWith('/v1/datasets/'),
          ).length,
      )
      .toBeGreaterThan(0);
    expect(await countRecipes(page)).toBe(1);
  });

  test('el control de rol se muestra traducido en inglés', async ({ page }) => {
    await seedLocale(page, 'en');
    await page.goto('/');
    await page.getByRole('button', { name: en['home.cta'] }).click();
    await uploadCsv(page, 'demo.csv');

    await expect(
      page.getByRole('button', { name: en['ingest.markAsMetadata'] }),
    ).toBeVisible();

    await page
      .getByRole('button', { name: en['ingest.markAsMetadata'] })
      .click();

    await expect(
      page.getByRole('button', { name: en['ingest.markAsBlock'] }),
    ).toBeVisible();
    await expect(page.getByText(en['ingest.metadataBlock'])).toBeVisible();
  });

  test('cambiar el rol de un archivo no toca el rol de los demás', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await uploadCsv(page, 'demo.csv');
    await uploadCsv(page, 'demo2.csv');

    // Cada archivo tiene su propio resumen: se localizan por el nombre del
    // bloque (el encabezado), no por el texto del botón.
    const seccion = (nombre: string) =>
      page
        .getByRole('region', { name: es['ingest.summaryTitle'] })
        .filter({
          has: page.getByRole('heading', { name: nombre, exact: true }),
        });

    await seccion('demo.csv')
      .getByRole('button', { name: es['ingest.markAsMetadata'] })
      .click();

    await expect(
      seccion('demo.csv').getByText(es['ingest.metadataBlock']),
    ).toBeVisible();
    await expect(
      seccion('demo2.csv').getByText(es['ingest.metadataBlock']),
    ).toHaveCount(0);
  });

  test('el control de rol también funciona con la tabla de metadata de un dataset de ejemplo', async ({
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

    // El rol lo declara el catálogo del dataset: solo la tabla de metadata
    // lo trae.
    await expect(page.getByText(es['ingest.metadataBlock'])).toHaveCount(1);

    const seccionMeta = page
      .getByRole('region', { name: es['ingest.summaryTitle'] })
      .filter({
        has: page.getByRole('heading', {
          name: 'nutrimouse_meta.csv',
          exact: true,
        }),
      });
    await seccionMeta
      .getByRole('button', { name: es['ingest.markAsBlock'] })
      .click();

    // Al volver a ser un bloque de variables, la etiqueta desaparece.
    await expect(page.getByText(es['ingest.metadataBlock'])).toHaveCount(0);

    // Y la receta se crea con los roles actualizados.
    await page.getByRole('button', { name: es['load.next'] }).click();
    await expect(page.getByText(es['topbar.step.configure'])).toBeVisible();
    await expect.poll(() => countRecipes(page)).toBe(1);
    expect(await recipeBodies(page)).toEqual([
      {
        blocks: [
          { name: 'nutrimouse_gene.csv', role: 'block' },
          { name: 'nutrimouse_lipid.csv', role: 'block' },
          { name: 'nutrimouse_meta.csv', role: 'block' },
        ],
      },
    ]);
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
 * Lee el registro de respuestas que sirvió el mock de Playwright.
 *
 * Lo consulta el test de costura: las compara con el contrato compartido
 * con el backend real.
 */
async function readApiResponses(page: Page): Promise<ApiResponseRecord[]> {
  return page.evaluate(
    () => (window as unknown as MockWindow).__apiResponses ?? [],
  );
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

/**
 * Configurar y ejecutar contra el contrato real del backend (T10).
 *
 * La pantalla Configurar tiene tres secciones (L23): dataset, alineación y
 * modelo. El flujo es el que exige el backend: crear la receta, calcular la
 * alineación, confirmarla, fijar la variable de clase y encolar el modelo.
 * El job se consulta por polling y su resultado se muestra en la pantalla de
 * resultados.
 */
test.describe('Configurar y ejecutar contra el contrato real', () => {
  // El job termina en la segunda consulta: los tests que no necesitan ver el
  // progreso no esperan.
  test.use({ jobStages: ['queued'] });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  /** Sube un bloque y llega a la pantalla de configuración. */
  async function gotoConfigure(page: Page) {
    await gotoPipeline(page);
    await uploadCsv(page, 'demo.csv');
    await page.getByRole('button', { name: es['load.next'] }).click();
    await expect(page.getByText(es['topbar.step.configure'])).toBeVisible();
  }

  /** Espera a que la receta esté creada y devuelve las llamadas registradas. */
  async function waitForDataset(page: Page): Promise<ApiCallRecord[]> {
    await expect
      .poll(
        async () =>
          (await readApiCalls(page)).filter((c) => c.path === '/v1/datasets/')
            .length,
      )
      .toBe(1);
    return readApiCalls(page);
  }

  /** Confirma la alineación y espera el POST de confirmación. */
  async function confirmAlignment(page: Page, bloques = ['demo.csv']) {
    await page.getByRole('button', { name: es['configure.alignmentConfirm'] }).click();
    await expect
      .poll(async () => {
        const aligns = (await readApiCalls(page)).filter((c) =>
          c.path.includes('/align/'),
        );
        return aligns[aligns.length - 1]?.body;
      })
      .toEqual({ blocks: bloques, confirmed: true });
  }

  /** Encola el modelo y espera a llegar a la pantalla de resultados. */
  async function runModel(page: Page) {
    const ejecutar = page.getByRole('button', { name: es['configure.run'] });
    await expect(ejecutar).toBeEnabled();
    await ejecutar.click();
    await expect(page.getByText(es['topbar.step.results'])).toBeVisible();
  }

  test('crea la receta con los bloques del proyecto y calcula la alineación', async ({
    page,
  }) => {
    await gotoConfigure(page);

    const calls = await waitForDataset(page);
    const create = calls.find((c) => c.path === '/v1/datasets/');
    // La receta se crea UNA vez: el rol lo declara el origen del archivo.
    expect(create?.body).toEqual({
      blocks: [{ name: 'demo.csv', role: 'block' }],
    });

    // La alineación se calcula sola, sin confirmar.
    await expect
      .poll(
        async () =>
          (await readApiCalls(page)).filter((c) => c.path.includes('/align/'))
            .length,
      )
      .toBe(1);
    const align = (await readApiCalls(page)).find((c) =>
      c.path.includes('/align/'),
    );
    expect(align?.body).toEqual({ blocks: ['demo.csv'], confirmed: false });

    // La sección DATASET muestra el bloque con su forma.
    const seccionDataset = page.getByRole('region', {
      name: es['configure.datasetTitle'],
    });
    await expect(
      page.getByRole('heading', { name: es['configure.datasetTitle'] }),
    ).toBeVisible();
    await expect(
      seccionDataset.getByText('demo.csv', { exact: true }),
    ).toBeVisible();
    await expect(
      seccionDataset.getByText(
        msg('ingest.dimensions', { samples: 2, variables: 1 }),
      ),
    ).toBeVisible();

    // Y la sección ALINEACIÓN informa cuántas muestras sobreviven.
    await expect(
      page.getByRole('heading', { name: es['configure.alignmentTitle'] }),
    ).toBeVisible();
    await expect(
      page.getByText(msg('configure.alignmentCommon', { count: 1 })),
    ).toBeVisible();
  });

  test('la ejecución está bloqueada hasta que el usuario confirma la alineación', async ({
    page,
  }) => {
    await gotoConfigure(page);
    await waitForDataset(page);

    const ejecutar = page.getByRole('button', { name: es['configure.run'] });
    await expect(ejecutar).toBeDisabled();
    await expect(page.getByText(es['configure.alignmentNeedConfirm'])).toBeVisible();

    await confirmAlignment(page);

    await expect(ejecutar).toBeEnabled();
    await expect(page.getByText(es['configure.alignmentConfirmed'])).toBeVisible();
  });

  test('ejecuta el modelo contra la receta y navega a los resultados', async ({
    page,
  }) => {
    await gotoConfigure(page);
    await waitForDataset(page);
    await confirmAlignment(page);
    await runModel(page);

    const calls = await readApiCalls(page);
    const model = calls.find((c) => c.path === '/v1/model/');
    expect(model?.method).toBe('POST');
    expect(model?.body).toMatchObject({
      dataset_id: MOCK_DATASET_ID,
      model_type: 'PCA',
      n_components: 2,
    });
    // Toda operación aleatoria lleva semilla (RB-6).
    expect(
      typeof (model?.body as { seed?: unknown } | undefined)?.seed,
    ).toBe('number');

    // El job se consulta por polling hasta un estado terminal.
    await expect
      .poll(
        async () =>
          (await readApiCalls(page)).filter((c) =>
            c.path.startsWith('/v1/jobs/'),
          ).length,
      )
      .toBeGreaterThan(0);
  });

  test('el resultado muestra las figuras, los biomarcadores y las correlaciones', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await uploadCsv(page, 'demo.csv');
    await uploadCsv(page, 'demo2.csv');
    await page.getByRole('button', { name: es['load.next'] }).click();
    await expect(page.getByText(es['topbar.step.configure'])).toBeVisible();

    await waitForDataset(page);
    await confirmAlignment(page, ['demo.csv', 'demo2.csv']);
    await runModel(page);

    // La figura se pide por el canal de figuras y se muestra como blob: URL.
    const img = page.getByRole('img');
    await expect(img).toHaveAttribute('src', /^blob:/);
    await expect
      .poll(async () =>
        (await readApiCalls(page)).some((c) =>
          c.path.includes(`/v1/files/${MOCK_JOB_ID}/scores_demo.png`),
        ),
      )
      .toBe(true);

    // Los biomarcadores se listan.
    const tablaBiomarcadores = page.getByRole('region', {
      name: es['biomarkers.title'],
    });
    await expect(
      page.getByRole('heading', { name: es['biomarkers.title'] }),
    ).toBeVisible();
    await expect(
      tablaBiomarcadores.getByRole('cell', { name: 'feature_1' }),
    ).toBeVisible();

    // La varianza explicada se muestra.
    await expect(
      page.getByRole('heading', { name: es['results.varianceTitle'] }),
    ).toBeVisible();

    // Los loadings y los scores también: son el resultado numérico del
    // modelo (RF-4), no solo la tabla de biomarcadores.
    const seccionLoadings = page.getByRole('region', {
      name: es['results.loadingsTitle'],
    });
    await expect(
      seccionLoadings.getByRole('cell', { name: 'feature_1' }),
    ).toBeVisible();
    const seccionScores = page.getByRole('region', {
      name: es['results.scoresTitle'],
    });
    await expect(seccionScores).toBeVisible();
    await expect(
      seccionScores.getByRole('columnheader', { name: 'comp 1' }),
    ).toBeVisible();

    // Las correlaciones se indexan por par de bloques.
    const seccionCorrelaciones = page.getByRole('region', {
      name: es['results.correlationsTitle'],
    });
    await expect(
      page.getByRole('heading', { name: es['results.correlationsTitle'] }),
    ).toBeVisible();
    await expect(
      seccionCorrelaciones.getByText('demo.csv|demo2.csv', { exact: true }),
    ).toBeVisible();

    // Y la trazabilidad del análisis.
    const seccionTrazabilidad = page.getByRole('region', {
      name: es['results.provenanceTitle'],
    });
    await expect(
      page.getByRole('heading', { name: es['results.provenanceTitle'] }),
    ).toBeVisible();
    await expect(
      seccionTrazabilidad.getByText('0.1.0a1', { exact: false }),
    ).toBeVisible();
  });

  test('un biomarcador sin estabilidad se muestra sin valor', async ({ page }) => {
    await gotoConfigure(page);
    await waitForDataset(page);
    await confirmAlignment(page);
    await runModel(page);

    const fila = page
      .getByRole('region', { name: es['biomarkers.title'] })
      .getByRole('row', { name: /feature_1/ });
    await expect(fila).toBeVisible();
    // `stability` puede venir `null`: la celda muestra el guion largo.
    // Las columnas son: variable, bloque, componente, loading, estabilidad.
    await expect(fila.getByRole('cell').nth(4)).toHaveText('—');
  });

  test('la variable de clase se fija en la receta y viaja en la solicitud', async ({
    page,
  }) => {
    await gotoConfigure(page);
    await waitForDataset(page);

    await page.getByLabel(es['configure.targetColumnLabel']).selectOption('feature_1');

    await expect
      .poll(async () => {
        const calls = await readApiCalls(page);
        const target = calls.find((c) => c.path.includes('/target/'));
        return target?.body;
      })
      .toEqual({ block: 'demo.csv', column: 'feature_1' });

    await confirmAlignment(page);
    await runModel(page);

    const model = (await readApiCalls(page)).find((c) => c.path === '/v1/model/');
    expect(model?.body).toMatchObject({
      target: { block: 'demo.csv', column: 'feature_1' },
    });
  });

  test.describe('cancelación', () => {
    // El job se queda en curso: la cancelación tiene que alcanzarlo antes
    // de que termine.
    test.use({
      jobStages: [
        'load',
        'load',
        'load',
        'load',
        'load',
        'load',
        'load',
        'load',
      ],
    });

    test('cancelar el análisis deja el job en estado cancelado', async ({
      page,
    }) => {
      await gotoConfigure(page);
      await waitForDataset(page);
      await confirmAlignment(page);
      await runModel(page);

      await page.getByRole('button', { name: es['results.cancel'] }).click();

      await expect(page.getByText(es['results.cancelled'])).toBeVisible();
      const deleteCalls = (await readApiCalls(page)).filter(
        (c) => c.method === 'DELETE' && c.path.startsWith('/v1/jobs/'),
      );
      expect(deleteCalls.length).toBe(1);
      expect(deleteCalls[0].path).toBe(`/v1/jobs/${MOCK_JOB_ID}/`);
    });
  });

  test.describe('job fallido', () => {
    // El backend responde con el sobre de error uniforme.
    test.use({
      jobError: {
        code: 'E_ANALYSIS_FAILED',
        message_key: 'errors.analysisFailed',
        detail: {},
      },
    });

    test('un job fallido muestra el error traducido del backend', async ({
      page,
    }) => {
      await gotoConfigure(page);
      await waitForDataset(page);
      await confirmAlignment(page);
      await runModel(page);

      await expect(page.getByText(msg('errors.analysisFailed'))).toBeVisible();
      // La clave cruda nunca se muestra.
      await expect(page.getByText('errors.analysisFailed')).toHaveCount(0);
    });
  });

  test('el polling se detiene cuando el job llega a un estado terminal', async ({
    page,
  }) => {
    await gotoConfigure(page);
    await waitForDataset(page);
    await confirmAlignment(page);
    await runModel(page);

    // El resultado aparece: el job terminó.
    await expect(
      page.getByRole('heading', { name: es['biomarkers.title'] }),
    ).toBeVisible();

    const consultas = async () =>
      (await readApiCalls(page)).filter((c) => c.path.startsWith('/v1/jobs/'))
        .length;
    const antes = await consultas();
    await page.waitForTimeout(1500);
    expect(await consultas()).toBe(antes);
  });

  test('el selector de modelos solo ofrece PCA y DIABLO', async ({ page }) => {
    await gotoConfigure(page);
    await waitForDataset(page);

    const opciones = page
      .getByRole('radiogroup', { name: es['model.typeLabel'] })
      .getByRole('radio');
    await expect(opciones).toHaveCount(2);
    await expect(opciones.nth(0)).toHaveAttribute('value', 'PCA');
    await expect(opciones.nth(1)).toHaveAttribute('value', 'DIABLO');
    // El sPLS-DA está diferido (S6): no se ofrece.
    await expect(page.getByRole('radio', { name: 'sPLS-DA' })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'PLS-DA' })).toHaveCount(0);
  });

  test('un dataset de ejemplo que sugiere sPLS-DA queda en PCA', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await page.route('**/datasets/srbct_gene.csv', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/csv',
        body: 'sample_1,sample_2\n1.2,3.4\n5.6,7.8\n',
      });
    });
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
    await expect(
      page.getByRole('dialog', { name: es['datasets.title'] }),
    ).not.toBeVisible();

    await page.getByRole('button', { name: es['load.next'] }).click();
    await expect(page.getByText(es['topbar.step.configure'])).toBeVisible();

    // El catálogo sugiere sPLS-DA para este dataset, pero el contrato del
    // backend no lo acepta (S6): el selector queda en PCA.
    const opciones = page
      .getByRole('radiogroup', { name: es['model.typeLabel'] })
      .getByRole('radio');
    await expect(opciones).toHaveCount(2);
    await expect(opciones.nth(0)).toBeChecked();
    await expect(opciones.nth(1)).not.toBeChecked();
  });

  test('la pantalla Configurar se muestra traducida en inglés', async ({ page }) => {
    await seedLocale(page, 'en');
    await page.goto('/');
    await page.getByRole('button', { name: en['home.cta'] }).click();
    await uploadCsv(page, 'demo.csv');
    await page.getByRole('button', { name: en['load.next'] }).click();

    await expect(
      page.getByRole('heading', { name: en['configure.datasetTitle'] }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: en['configure.alignmentTitle'] }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: en['configure.modelTitle'], exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: en['configure.alignmentConfirm'] }),
    ).toBeVisible();
  });
});

/**
 * Etapas del progreso (S30).
 *
 * El progreso es POR ETAPA y sin porcentaje: la barra es indeterminada y
 * lleva la etiqueta de la etapa. Cada test simula una etapa distinta para
 * comprobar que la UI la muestra.
 */
const JOB_STAGES: ProgressStage[] = [
  'queued',
  'load',
  'align',
  'preprocess',
  'fit',
  'transform',
  'figures',
];

for (const stage of JOB_STAGES) {
  test.describe(`etapa del progreso: ${stage}`, () => {
    // La etapa se repite: el polling avanza recién después de varias
    // consultas, así la etiqueta no desaparece entre medio.
    test.use({ jobStages: [stage, stage, stage, stage] });

    test.beforeEach(async ({ page }) => {
      await page.goto('/');
    });

    test(`la barra indeterminada muestra la etapa ${stage}`, async ({ page }) => {
      await gotoPipeline(page);
      await uploadCsv(page, 'demo.csv');
      await page.getByRole('button', { name: es['load.next'] }).click();
      await expect(page.getByText(es['topbar.step.configure'])).toBeVisible();

      await expect
        .poll(
          async () =>
            (await readApiCalls(page)).filter((c) => c.path === '/v1/datasets/')
              .length,
        )
        .toBe(1);

      await page.getByRole('button', { name: es['configure.alignmentConfirm'] }).click();
      await expect
        .poll(async () => {
          const aligns = (await readApiCalls(page)).filter((c) =>
            c.path.includes('/align/'),
          );
          return aligns[aligns.length - 1]?.body;
        })
        .toEqual({ blocks: ['demo.csv'], confirmed: true });

      const ejecutar = page.getByRole('button', { name: es['configure.run'] });
      await expect(ejecutar).toBeEnabled();
      await ejecutar.click();
      await expect(page.getByText(es['topbar.step.results'])).toBeVisible();

      // Barra indeterminada: sin `aria-valuenow`.
      const barra = page.getByRole('progressbar');
      await expect(barra).toBeVisible();
      await expect(barra).not.toHaveAttribute('aria-valuenow', /.*/);

      // Y la etiqueta de la etapa.
      await expect(page.getByText(msg(`job.stage.${stage}`))).toBeVisible();
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Costura con el backend real: el contrato compartido
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ruta del contrato compartido con el backend real.
 *
 * El archivo vive en `backend/tests/contract.json`: es el único lugar del
 * repo donde los dos lados (este test y `backend/tests/test_contract_seam.py`)
 * pueden leerlo. Declara los cuerpos canónicos que manda el renderer y los
 * campos de la respuesta que el renderer lee.
 *
 * Los dos lados lo comprueban contra su realidad: este test contra el **mock**
 * y el test del backend contra la **API real**. Si el mock y el backend se
 * separan, el contrato deja de ser el punto de encuentro y los dos tests
 * fallan.
 */
function rutaContrato(): string {
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(
    aqui,
    '..',
    '..',
    '..',
    'backend',
    'tests',
    'contract.json',
  );
}

type ContractKind =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'enum';

type ContractField = {
  path: string;
  kind: ContractKind;
  values?: string[];
  pattern?: string;
  key_pattern?: string;
  nullable?: boolean;
};

type ContractMatch = { method: string; path: string };

type ContractResponse = {
  descripcion?: string;
  match: ContractMatch[];
  filtro?: { campo: string; valores: string[] };
  fields: ContractField[];
};

type Contract = {
  version: number;
  escenario: { archivos: string[] };
  placeholders: Record<string, { tipo: string; descripcion: string }>;
  requests: Array<{
    name: string;
    method: string;
    path: string;
    status: number;
    body: Record<string, unknown>;
  }>;
  responses: Record<string, ContractResponse>;
};

let contratoCache: Contract | null = null;

/** Lee (una sola vez) el contrato compartido con el backend. */
function leerContrato(): Contract {
  if (!contratoCache) {
    const ruta = rutaContrato();
    if (!existsSync(ruta)) {
      throw new Error(`No se encuentra el contrato compartido en ${ruta}.`);
    }
    contratoCache = JSON.parse(readFileSync(ruta, 'utf8')) as Contract;
  }
  return contratoCache;
}

/** El cuerpo canónico de una petición del contrato. */
function cuerpoCanonico(
  contrato: Contract,
  nombre: string,
): Record<string, unknown> {
  const encontrada = contrato.requests.find((r) => r.name === nombre);
  if (!encontrada) {
    throw new Error(`El contrato no define la petición '${nombre}'.`);
  }
  return encontrada.body;
}

/**
 * Resuelve una ruta de campo del contrato sobre un cuerpo.
 *
 * La sintaxis son segmentos separados por punto; un segmento terminado en
 * `[]` significa "cada elemento de la lista".
 */
function resolverCamino(
  camino: string,
  cuerpo: unknown,
): { existe: boolean; valores: unknown[] } {
  let actuales: unknown[] = [cuerpo];

  for (const segmento of camino.split('.')) {
    const esLista = segmento.endsWith('[]');
    const clave = esLista ? segmento.slice(0, -2) : segmento;
    const siguientes: unknown[] = [];

    for (const actual of actuales) {
      if (
        typeof actual !== 'object' ||
        actual === null ||
        Array.isArray(actual)
      ) {
        return { existe: false, valores: [] };
      }
      const registro = actual as Record<string, unknown>;
      if (!(clave in registro)) {
        return { existe: false, valores: [] };
      }
      const hijo = registro[clave];
      if (esLista) {
        if (!Array.isArray(hijo)) {
          return { existe: false, valores: [] };
        }
        siguientes.push(...hijo);
      } else {
        siguientes.push(hijo);
      }
    }

    actuales = siguientes;
  }

  return { existe: true, valores: actuales };
}

/** ¿El valor tiene el tipo que declara el contrato? */
function cumpleTipo(valor: unknown, kind: string): boolean {
  switch (kind) {
    case 'string':
      return typeof valor === 'string';
    case 'integer':
      return typeof valor === 'number' && Number.isInteger(valor);
    case 'number':
      return typeof valor === 'number';
    case 'boolean':
      return typeof valor === 'boolean';
    case 'array':
      return Array.isArray(valor);
    case 'object':
      return (
        typeof valor === 'object' && valor !== null && !Array.isArray(valor)
      );
    case 'enum':
      return typeof valor === 'string';
    default:
      return true;
  }
}

/**
 * Los errores que tiene un cuerpo frente a los campos del contrato.
 *
 * Cada error dice que campo falla y por que: un campo que no existe, un
 * tipo que no coincide, un valor fuera de la lista permitida o un nombre
 * que no cumple el patron.
 */
function erroresDeCampos(
  campos: ContractField[],
  cuerpo: unknown,
): string[] {
  const errores: string[] = [];

  for (const campo of campos) {
    const { existe, valores } = resolverCamino(campo.path, cuerpo);

    if (!existe) {
      errores.push(`falta el campo '${campo.path}'`);
      continue;
    }

    for (const valor of valores) {
      if (valor === null) {
        if (campo.nullable) continue;
        errores.push(`el campo '${campo.path}' es null`);
        continue;
      }

      if (!cumpleTipo(valor, campo.kind)) {
        errores.push(
          `el campo '${campo.path}' es ${typeof valor} y el contrato pide ${campo.kind}`,
        );
        continue;
      }

      if (campo.kind === 'enum' && campo.values && !campo.values.includes(valor as string)) {
        errores.push(
          `el campo '${campo.path}' vale ${String(valor)} y no esta en ${campo.values.join(', ')}`,
        );
      }

      if (campo.pattern && !new RegExp(campo.pattern).test(String(valor))) {
        errores.push(
          `el campo '${campo.path}' vale ${String(valor)} y no cumple ${campo.pattern}`,
        );
      }

      if (campo.key_pattern) {
        const claves = Object.keys(valor as Record<string, unknown>);
        for (const clave of claves) {
          if (!new RegExp(campo.key_pattern).test(clave)) {
            errores.push(
              `la clave '${clave}' de '${campo.path}' no cumple ${campo.key_pattern}`,
            );
          }
        }
      }
    }
  }

  return errores;
}

/** Escapa los caracteres especiales de una expresion regular. */
function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * ¿La ruta de una petición coincide con el patrón del contrato?
 *
 * El `*` del patron matchea un segmento entero de la ruta.
 */
function coincideRuta(ruta: string, patron: string): boolean {
  const partes = patron.split('*').map(escaparRegex);
  return new RegExp(`^${partes.join('[^/]+')}$`).test(ruta);
}

/** ¿La respuesta sirve para alguno de los patrones del contrato? */
function coincideCon(
  respuesta: ApiResponseRecord,
  patrones: ContractMatch[],
): boolean {
  return patrones.some(
    (patron) =>
      respuesta.method === patron.method &&
      coincideRuta(respuesta.path, patron.path),
  );
}

/**
 * ¿La respuesta pasa el filtro del contrato?
 *
 * El filtro decide a que respuestas se aplica una entrada: el job
 * terminado y el job en curso son dos formas distintas de la misma
 * respuesta.
 */
function pasaFiltro(
  respuesta: ApiResponseRecord,
  filtro?: { campo: string; valores: string[] },
): boolean {
  if (!filtro) return true;
  const data = respuesta.data as Record<string, unknown> | undefined;
  const valor = data?.[filtro.campo];
  return typeof valor === 'string' && filtro.valores.includes(valor);
}

/**
 * Los placeholders de un cuerpo canónico: campo -> nombre del placeholder.
 *
 * Un placeholder es un string que empieza con `$` (por ejemplo
 * `$dataset_id`): lo que el backend real pone en ese campo depende de la
 * corrida, así que se compara la forma, no el valor.
 */
function placeholdersDelBody(
  canonico: Record<string, unknown>,
  contrato: Contract,
): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const [campo, valor] of Object.entries(canonico)) {
    if (typeof valor === 'string' && valor in contrato.placeholders) {
      mapa[campo] = valor;
    }
  }
  return mapa;
}

/** Reemplaza por su placeholder los campos que el contrato declara variables. */
function normalizar(
  cuerpo: unknown,
  mapa: Record<string, string>,
): unknown {
  if (Array.isArray(cuerpo)) {
    return cuerpo.map((item) => normalizar(item, mapa));
  }
  if (cuerpo && typeof cuerpo === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(
      cuerpo as Record<string, unknown>,
    )) {
      salida[clave] = mapa[clave] ? mapa[clave] : normalizar(valor, mapa);
    }
    return salida;
  }
  return cuerpo;
}

/** ¿El valor cumple el tipo que el contrato declara para el placeholder? */
function cumpleTipoDeclarado(valor: unknown, tipo: string): boolean {
  switch (tipo) {
    case 'string':
      return typeof valor === 'string' && valor.length > 0;
    case 'integer':
      return typeof valor === 'number' && Number.isInteger(valor);
    case 'number':
      return typeof valor === 'number';
    default:
      return true;
  }
}

/**
 * Costura entre el renderer y el backend real (T11a).
 *
 * Los E2E de este archivo corren contra el **mock** y el smoke corre contra
 * el **backend real** pero no pasa por las pantallas. Nadie mira a los dos
 * juntos: si el contrato cambia de forma, el mock y el backend divergen y los
 * E2E siguen en verde mintiendo.
 *
 * Estos tests usan el **contrato compartido** (`backend/tests/contract.json`),
 * que es el único lugar donde están los cuerpos canónicos y los campos de
 * la respuesta. El test del backend reproduce esos cuerpos contra la API
 * real; estos assertan que el renderer manda exactamente esos cuerpos y que
 * el mock responde con esos campos.
 */
test.describe('Costura con el backend real (contrato compartido)', () => {
  // El mock informa las columnas reales de la tabla de phenotypes: la
  // columna de clase del contrato es una de ellas.
  test.use({
    block: { columns: ['genotype', 'diet'] },
    jobStages: ['queued'],
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  /**
   * Recorre el pipeline completo con el dataset de ejemplo del escenario:
   * carga, receta, alineación, variable de clase y modelo.
   *
   * El modelo se elige a mano: el catalogo de ejemplos sugiere DIABLO para
   * el nutrimouse, así que sin esta elección el cuerpo sería siempre el
   * del DIABLO.
   */
  async function flujoCompleto(page: Page, modelo: 'PCA' | 'DIABLO') {
    await gotoPipeline(page);
    await mockNutrimouseAssets(page);
    await page
      .getByRole('button', { name: es['topbar.datasetsLabel'] })
      .click();
    await page
      .getByRole('button', {
        name: msg('datasets.loadLabel', { name: 'nutrimouse' }),
      })
      .click();
    await expect(
      page.getByRole('dialog', { name: es['datasets.title'] }),
    ).not.toBeVisible();

    await page.getByRole('button', { name: es['load.next'] }).click();
    await expect(page.getByText(es['topbar.step.configure'])).toBeVisible();

    // La receta se crea sola, con los bloques del proyecto.
    await esperarLlamada(
      page,
      (c) => c.method === 'POST' && c.path === '/v1/datasets/',
    );

    // La alineación se calcula sola (todavía sin confirmar).
    await esperarLlamada(
      page,
      (c) => c.method === 'POST' && /\/align\/$/.test(c.path),
    );

    // El usuario elige el modelo.
    await page
      .getByRole('radiogroup', { name: es['model.typeLabel'] })
      .getByRole('radio', { name: modelo })
      .check();

    // Y la variable de clase.
    await page
      .getByLabel(es['configure.targetColumnLabel'])
      .selectOption('genotype');
    await esperarLlamada(
      page,
      (c) => c.method === 'POST' && /\/target\/$/.test(c.path),
    );

    // Y confirma la alineación.
    await page
      .getByRole('button', { name: es['configure.alignmentConfirm'] })
      .click();
    await esperarLlamada(
      page,
      (c) =>
        c.method === 'POST' &&
        /\/align\/$/.test(c.path) &&
        (c.body as { confirmed?: boolean } | undefined)?.confirmed === true,
    );

    // Encola el modelo.
    const ejecutar = page.getByRole('button', { name: es['configure.run'] });
    await expect(ejecutar).toBeEnabled();
    await ejecutar.click();
    await expect(page.getByText(es['topbar.step.results'])).toBeVisible();

    // Y el job se consulta por polling.
    await esperarLlamada(
      page,
      (c) => c.method === 'GET' && /^\/v1\/jobs\/.+\/$/.test(c.path),
    );

    // Y llega a un estado terminal: el mock sirve la respuesta terminada y
    // el polling se detiene. Sin esta espera, la respuesta final podria no
    // estar registrada todavía y la comprobación sería una carrera.
    await esperarJobTerminado(page);
  }

  /** Espera a que el mock sirva la respuesta de un job terminado. */
  async function esperarJobTerminado(page: Page) {
    await expect
      .poll(async () =>
        (await readApiResponses(page)).some(
          (r) =>
            r.path.startsWith('/v1/jobs/') &&
            (r.data as { status?: string } | undefined)?.status ===
              'completed',
        ),
      )
      .toBe(true);
  }

  /** Espera a que aparezca una llamada que cumpla el filtro. */
  async function esperarLlamada(
    page: Page,
    filtro: (c: ApiCallRecord) => boolean,
  ) {
    await expect
      .poll(async () => (await readApiCalls(page)).filter(filtro).length)
      .toBeGreaterThan(0);
  }

  test('el renderer manda exactamente los cuerpos canónicos del contrato', async ({
    page,
  }) => {
    const contrato = leerContrato();
    await flujoCompleto(page, 'PCA');

    const llamadas = await readApiCalls(page);

    // La receta: los bloques del proyecto, cada uno con su rol.
    const crear = llamadas.find(
      (c) => c.method === 'POST' && c.path === '/v1/datasets/',
    );
    expect(crear?.body).toEqual(cuerpoCanonico(contrato, 'createDataset'));

    // La alineación: se calcula sola y después la confirma el usuario.
    const alineaciones = llamadas.filter(
      (c) => c.method === 'POST' && /\/align\/$/.test(c.path),
    );
    expect(alineaciones.length).toBeGreaterThanOrEqual(2);
    expect(alineaciones[0]?.body).toEqual(
      cuerpoCanonico(contrato, 'alignDataset'),
    );
    expect(alineaciones[alineaciones.length - 1]?.body).toEqual(
      cuerpoCanonico(contrato, 'confirmAlignment'),
    );

    // La variable de clase.
    const target = llamadas.find(
      (c) => c.method === 'POST' && /\/target\/$/.test(c.path),
    );
    expect(target?.body).toEqual(cuerpoCanonico(contrato, 'setDatasetTarget'));

    // Y el modelo: con el identificador de la receta y la semilla, que el
    // contrato declara como variables (el valor depende de la corrida).
    const modelo = llamadas.find(
      (c) => c.method === 'POST' && c.path === '/v1/model/',
    );
    const canonico = cuerpoCanonico(contrato, 'runModelPca');
    const mapa = placeholdersDelBody(canonico, contrato);
    const cuerpoModelo = (modelo?.body ?? {}) as Record<string, unknown>;

    expect(Object.keys(mapa).length).toBeGreaterThan(0);
    for (const [campo, placeholder] of Object.entries(mapa)) {
      expect(
        cumpleTipoDeclarado(
          cuerpoModelo[campo],
          contrato.placeholders[placeholder].tipo,
        ),
        `el campo '${campo}' no cumple el tipo de '${placeholder}'`,
      ).toBe(true);
    }
    expect(normalizar(cuerpoModelo, mapa)).toEqual(canonico);
  });

  test('el modelo DIABLO viaja con el cuerpo canónico del contrato', async ({
    page,
  }) => {
    const contrato = leerContrato();
    await flujoCompleto(page, 'DIABLO');

    const llamadas = await readApiCalls(page);
    const modelo = llamadas
      .filter((c) => c.method === 'POST' && c.path === '/v1/model/')
      .pop();
    const canonico = cuerpoCanonico(contrato, 'runModelDiablo');
    const mapa = placeholdersDelBody(canonico, contrato);
    const cuerpoModelo = (modelo?.body ?? {}) as Record<string, unknown>;

    for (const [campo, placeholder] of Object.entries(mapa)) {
      expect(
        cumpleTipoDeclarado(
          cuerpoModelo[campo],
          contrato.placeholders[placeholder].tipo,
        ),
        `el campo '${campo}' no cumple el tipo de '${placeholder}'`,
      ).toBe(true);
    }
    expect(normalizar(cuerpoModelo, mapa)).toEqual(canonico);
  });

  test('las respuestas que sirve el mock cumplen el contrato compartido', async ({
    page,
  }) => {
    const contrato = leerContrato();
    await flujoCompleto(page, 'PCA');

    const respuestas = await readApiResponses(page);
    expect(respuestas.length).toBeGreaterThan(0);

    for (const [nombre, entrada] of Object.entries(contrato.responses)) {
      const encontradas = respuestas.filter(
        (r) =>
          coincideCon(r, entrada.match) && pasaFiltro(r, entrada.filtro),
      );
      expect(
        encontradas.length,
        `el mock no sirvió ninguna respuesta para '${nombre}'`,
      ).toBeGreaterThan(0);

      for (const respuesta of encontradas) {
        const errores = erroresDeCampos(entrada.fields, respuesta.data);
        expect(
          errores,
          `la respuesta '${nombre}' (${respuesta.method} ${respuesta.path}) no cumple el contrato:\n${errores.join('\n')}`,
        ).toEqual([]);
      }
    }
  });

  test('toda respuesta que sirve el mock esta cubierta por el contrato', async ({
    page,
  }) => {
    const contrato = leerContrato();
    await flujoCompleto(page, 'PCA');

    const respuestas = await readApiResponses(page);
    for (const respuesta of respuestas) {
      const cubierta = Object.values(contrato.responses).some(
        (entrada) =>
          coincideCon(respuesta, entrada.match) &&
          pasaFiltro(respuesta, entrada.filtro),
      );
      expect(
        cubierta,
        `la respuesta ${respuesta.method} ${respuesta.path} no esta cubierta por el contrato`,
      ).toBe(true);
    }
  });
});
