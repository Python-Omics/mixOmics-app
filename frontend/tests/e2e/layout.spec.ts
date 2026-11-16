import { test, expect, type Page } from '@playwright/test';
import { installApiMock } from '../../playwright.config';
import es from '../../src/i18n/es.json' with { type: 'json' };

/**
 * El pipeline (Cargar → Configurar → Resultados) ocupa exactamente el
 * viewport y el scroll vive dentro de <main>. Si la página (body) llegara a
 * scrollear, al moverla aparecería un rectángulo vacío debajo del shell:
 * el fondo de la página, que no pertenece a ninguna pantalla.
 *
 * Hay dos formas de que la página crezca:
 *
 *   1. el shell mide más que el viewport (`h-screen`/`w-screen`, que no
 *      tienen en cuenta el ancho de los scrollbars);
 *   2. un elemento posicionado en `absolute` se escapa del `overflow` del
 *      área scrolleable y estira el documento.
 *
 * La segunda es la que rompía la pantalla de Configurar: los labels
 * `sr-only` de la grilla de keepX son `position: absolute` (así los define
 * Tailwind) y, sin un ancestro posicionado, su bloque contenedor es el
 * viewport — el `overflow: auto` de <main> no los recorta. El último de
 * los tres quedaba por debajo del borde inferior y el documento medía
 * 256 px más que la ventana: aparecía la segunda barra de scroll y, al
 * scrollear, el rectángulo vacío del que se quejó el operador.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(installApiMock, {
    uploadResponse: undefined,
    block: {
      n_samples: 120,
      n_variables: 800,
      n_numeric_variables: 800,
      columns: ['feature_1', 'feature_2', 'feature_3', 'feature_4', 'feature_5'],
    },
    jobStages: undefined,
    jobError: undefined,
  });
});

/**
 * Sube varios bloques por el dropzone.
 *
 * Los nombres replican el caso real del operador (los tres bloques de
 * `breast_TCGA`): el ancho de la grilla de keepX depende de cuántos
 * bloques hay.
 */
async function subirBloques(page: Page, nombres: string[]) {
  for (const nombre of nombres) {
    await page.locator('#file-input').setInputFiles({
      name: nombre,
      mimeType: 'text/csv',
      buffer: Buffer.from('s1,s2,s3\n1.0,2.0,3.0\n4.0,5.0,6.0\n'),
    });
  }
}

/**
 * Geometría de la página y del shell.
 *
 * `docScrollHeight`/`docScrollWidth` son el tamaño del documento: si
 * superan al viewport, la página tiene scroll propio (la barra externa
 * que el operador veía a la derecha de la interna).
 */
async function medirPagina(page: Page) {
  return page.evaluate(() => {
    const shell = document.querySelector('#root > div');
    const aside = document.querySelector('aside');
    const main = document.querySelector('main');
    const borde = (el: Element | null) =>
      el ? Math.round(el.getBoundingClientRect().bottom) : null;

    // ¿Puede la página scrollear de verdad?
    window.scrollTo(0, 9999);
    const scrollMax = window.scrollY;
    window.scrollTo(0, 0);

    return {
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      scrollY: window.scrollY,
      scrollMax,
      docScrollHeight: document.documentElement.scrollHeight,
      docScrollWidth: document.documentElement.scrollWidth,
      shellBottom: borde(shell),
      asideBottom: borde(aside),
      mainScrollable: (main?.scrollHeight ?? 0) > (main?.clientHeight ?? 0),
    };
  });
}

test('el pipeline no scrollea la pagina: no hay area vacia debajo', async ({
  page,
}) => {
  // Una ventana baja, como la de un portátil con la app maximized.
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto('/');

  await page.getByRole('button', { name: es['home.cta'] }).click();
  await subirBloques(page, ['demo.csv']);
  await page.getByRole('button', { name: es['load.next'] }).click();

  const medidas = await medirPagina(page);

  // La página no se scrollea ni se desborda en ninguna dimensión.
  expect(medidas.scrollY).toBe(0);
  expect(medidas.scrollMax).toBe(0);
  expect(medidas.docScrollHeight).toBe(medidas.innerHeight);
  expect(medidas.docScrollWidth).toBe(medidas.innerWidth);

  // El shell y el sidebar llegan hasta abajo del viewport.
  expect(medidas.shellBottom).toBe(medidas.innerHeight);
  expect(medidas.asideBottom).toBe(medidas.innerHeight);

  // Y el contenido largo scrollea dentro de <main>, no en la página.
  expect(medidas.mainScrollable).toBe(true);
});

/**
 * El caso reportado: Configurar con varios bloques y el DIABLO.
 *
 * Con el DIABLO aparece la grilla de keepX (una fila por bloque) y con
 * ella los labels `sr-only` de cada input. Antes del fix, el último de
 * esos labels se escapaba del recorte de <main> y el documento medía
 * 256 px más que la ventana: la página scrolleaba y, al hacerlo, se
 * veía el fondo del documento debajo del shell.
 */
test('la pantalla de Configurar no estira la pagina con la grilla de keepX', async ({
  page,
}) => {
  // La ventana del operador: 1904 × 990.
  await page.setViewportSize({ width: 1904, height: 990 });
  await page.goto('/');

  await page.getByRole('button', { name: es['home.cta'] }).click();
  await subirBloques(page, [
    'breast_TCGA_mrna.csv',
    'breast_TCGA_mirna.csv',
    'breast_TCGA_protein.csv',
  ]);
  await page.getByRole('button', { name: es['load.next'] }).click();

  // DIABLO: aparece la grilla de keepX, una fila por bloque.
  await page.getByRole('radio', { name: 'DIABLO' }).check();
  await page
    .getByLabel(es['configure.targetColumnLabel'])
    .selectOption('feature_1');
  await expect(page.getByRole('group', { name: /keepX/i })).toBeVisible();

  const medidas = await medirPagina(page);

  // El documento no crece: ni en alto ni en ancho.
  expect(medidas.docScrollHeight).toBe(medidas.innerHeight);
  expect(medidas.docScrollWidth).toBe(medidas.innerWidth);

  // Y la página no se deja scrollear (la barra externa del operador).
  expect(medidas.scrollMax).toBe(0);
  expect(medidas.scrollY).toBe(0);

  // El shell y el sidebar siguen llegando hasta abajo del viewport.
  expect(medidas.shellBottom).toBe(medidas.innerHeight);
  expect(medidas.asideBottom).toBe(medidas.innerHeight);

  // El contenido largo scrollea dentro de <main>, no en la página.
  expect(medidas.mainScrollable).toBe(true);
});
