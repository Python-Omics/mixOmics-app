import { test, expect, type Page } from '@playwright/test';

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
 * La app arranca en la pantalla de Inicio. Los tests del pipeline entran
 * primero por el CTA del hero en lugar de asumir que arrancan ahí.
 */
async function gotoPipeline(page: Page) {
  await page
    .getByRole('button', { name: 'Iniciar integración multiómica' })
    .click();
  await expect(page.getByText('Paso 1 · Cargar datos')).toBeVisible();
}

test.describe('Pythomics frontend — POC', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('carga la app con los 3 pasos en el sidebar', async ({ page }) => {
    await gotoPipeline(page);
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
    await gotoPipeline(page);
    await page.getByRole('button', { name: 'Abrir configuración' }).click();
    const dialog = page.getByRole('dialog', { name: 'Configuración' });
    await expect(dialog).toBeVisible();
    // El sidebar de secciones está presente con "Personalización" activa
    await expect(
      dialog.getByRole('navigation', { name: 'Secciones de configuración' }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Personalización' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('el selector de temas muestra los 5 temas disponibles', async ({
    page,
  }) => {
    await gotoPipeline(page);
    await page.getByRole('button', { name: 'Abrir configuración' }).click();
    const group = page.getByRole('radiogroup', { name: 'Tema de colores' });
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
    await page.getByRole('button', { name: 'Abrir configuración' }).click();
    const group = page.getByRole('radiogroup', { name: 'Tema de colores' });

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
    await page.getByRole('button', { name: 'Abrir configuración' }).click();
    await page
      .getByRole('radiogroup', { name: 'Tema de colores' })
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
    await page.getByRole('button', { name: 'Abrir configuración' }).click();
    const dialog = page.getByRole('dialog', { name: 'Configuración' });
    await expect(dialog).toContainText('Telehealth Night');
    await expect(dialog).toContainText('Próximamente');
    // No es un radio seleccionable
    await expect(dialog.getByRole('radio')).toHaveCount(5);
  });

  test('cierra el modal con el botón Cerrar', async ({ page }) => {
    await gotoPipeline(page);
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
    await gotoPipeline(page);
    await page.getByRole('button', { name: 'Abrir configuración' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Configuración' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: 'Configuración' }),
    ).not.toBeVisible();
  });

  

  test('el botón Siguiente está deshabilitado sin archivos', async ({
    page,
  }) => {
    await gotoPipeline(page);
    const next = page.getByRole('button', { name: /Siguiente/ });
    await expect(next).toBeVisible();
    await expect(next).toBeDisabled();
  });

  test('navega al paso 2 desde el sidebar', async ({ page }) => {
    await gotoPipeline(page);
    await page.getByRole('button', { name: 'Configurar modelo' }).click();
    await expect(
      page.getByText('Paso 2 · Configurar modelo'),
    ).toBeVisible();
  });

  test('navega al paso 3 desde el sidebar', async ({ page }) => {
    await gotoPipeline(page);
    await page.getByRole('button', { name: 'Resultados' }).click();
    await expect(page.getByText('Paso 3 · Resultados')).toBeVisible();
  });

  test('abre el modal de Tutorial desde el TopBar', async ({ page }) => {
    await gotoPipeline(page);
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
    await gotoPipeline(page);
    await page.getByRole('button', { name: 'Abrir tutorial' }).click();
    const link = page.getByRole('link', { name: /Documentación oficial/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://mixomics.org/');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
  });

  test('cierra el modal de Tutorial con tecla Escape', async ({ page }) => {
    await gotoPipeline(page);
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
    await gotoPipeline(page);
    await page.getByRole('button', { name: 'Probar datasets de ejemplo' }).click();
    const dialog = page.getByRole('dialog', { name: 'Probar con dataset de ejemplo' });
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

    await page.getByRole('button', { name: 'Probar datasets de ejemplo' }).click();
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
    await gotoPipeline(page);
    await page.getByRole('button', { name: 'Probar datasets de ejemplo' }).click();
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
    await gotoPipeline(page);
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
    await gotoPipeline(page);
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
      .getByRole('button', { name: 'Probar datasets de ejemplo' })
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

  test.describe('Pantalla de Inicio', () => {
    test('la app arranca en Inicio, sin el sidebar de pasos', async ({ page }) => {
      // Un solo h1 por pantalla
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pythomics');
      // Un solo landmark de contenido (Home y pipeline no coexisten)
      await expect(page.locator('#main-content')).toHaveCount(1);
      // La bajada del hero. Regex en vez de texto exacto: el copy es una
      // decisión de producto que cambia (ya pasó: "sin programación" ->
      // "e investigadores") y un assert literal rompe el suite en silencio.
      await expect(
        page.getByText(/Análisis multi-ómico local para biólogos/),
      ).toBeVisible();
      // El CTA
      const cta = page.getByRole('button', { name: 'Iniciar integración multiómica' });
      await expect(cta).toBeVisible();
      // El footer no debe expulsar al hero de la ventana (toBeVisible solo
      // exige bounding box, no estar dentro del viewport).
      await expect(cta).toBeInViewport();
      // Los 3 pasos del pipeline todavía no existen
      await expect(
        page.getByRole('button', { name: 'Cargar datos' }),
      ).not.toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Configurar modelo' }),
      ).not.toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Resultados' }),
      ).not.toBeVisible();
    });

    test('el CTA lleva al pipeline en el paso 1', async ({ page }) => {
      await page
        .getByRole('button', { name: 'Iniciar integración multiómica' })
        .click();
      await expect(page.getByText('Paso 1 · Cargar datos')).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Cargar datos' }),
      ).toBeVisible();
      // Home ya no está en pantalla
      await expect(
        page.getByRole('button', { name: 'Iniciar integración multiómica' }),
      ).not.toBeVisible();
    });

    test('Configuración se abre desde el header de Inicio', async ({ page }) => {
      await page.getByRole('button', { name: 'Abrir configuración' }).click();
      const dialog = page.getByRole('dialog', { name: 'Configuración' });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole('navigation', { name: 'Secciones de configuración' }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: 'Personalización' }),
      ).toHaveAttribute('aria-current', 'page');
    });

    test('el título Pythomics del sidebar vuelve a Inicio', async ({ page }) => {
      await gotoPipeline(page);
      await page.getByRole('button', { name: 'Pythomics' }).click();
      await expect(
        page.getByRole('button', { name: 'Iniciar integración multiómica' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Cargar datos' }),
      ).not.toBeVisible();
    });

    test('volver a Inicio y regresar conserva el paso actual', async ({
      page,
    }) => {
      await gotoPipeline(page);
      await page.getByRole('button', { name: 'Resultados' }).click();
      await expect(page.getByText('Paso 3 · Resultados')).toBeVisible();

      await page.getByRole('button', { name: 'Pythomics' }).click();
      await expect(
        page.getByRole('button', { name: 'Iniciar integración multiómica' }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Iniciar integración multiómica' })
        .click();

      // Sigue en Resultados, no vuelve al paso 1
      await expect(page.getByText('Paso 3 · Resultados')).toBeVisible();
    });

    test('volver a Inicio conserva los archivos cargados', async ({ page }) => {
      await gotoPipeline(page);
      await page.locator('#file-input').setInputFiles({
        name: 'demo.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('s1,s2,s3\n1.0,2.0,3.0\n4.0,5.0,6.0\n'),
      });
      await expect(
        page.getByRole('listitem').filter({ hasText: 'demo.csv' }),
      ).toBeVisible();

      await page.getByRole('button', { name: 'Pythomics' }).click();
      await gotoPipeline(page);

      await expect(
        page.getByRole('listitem').filter({ hasText: 'demo.csv' }),
      ).toBeVisible();
      await expect(page.getByText('1 archivo cargado')).toBeVisible();
    });

    test('el skip link de Inicio salta al contenido principal', async ({
      page,
    }) => {
      const skip = page.getByRole('link', { name: 'Saltar al contenido principal' });
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
        footer.getByRole('heading', { level: 2, name: 'Próximamente en Inicio' }),
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