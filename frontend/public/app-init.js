/**
 * Anti-FOUC: aplica tema, idioma y título ANTES del primer paint.
 *
 * Sin este script, el navegador pinta primero los valores por defecto y
 * luego React los reemplaza, produciendo flashes visibles al arrancar.
 *
 * Va en un archivo externo (y no inline en index.html) porque la CSP tiene
 * `script-src 'self'` sin `'unsafe-inline'`: un script inline queda
 * bloqueado, mientras que un archivo del mismo origen está permitido.
 *
 * El idioma también se aplica aquí: I18nProvider solo puede leer la
 * preferencia cuando React monta, demasiado tarde para evitar el flash.
 */
(function () {
  var DEFAULT_THEME = 'pharmacy-fresh';
  var VALID_THEMES = [
    'pharmacy-fresh',
    'sterile-aqua',
    'minted-hygiene',
    'soft-bandage',
    'immunity-citrus',
  ];
  var DEFAULT_LANG = 'es';
  var VALID_LANGS = ['es', 'en'];

  // Títulos de la app. Deben coincidir con las claves `app.title` de los
  // catálogos: hay un test que lo verifica.
  var TITLES = {
    es: 'Pythomics — Análisis multi-ómico',
    en: 'Pythomics — Multi-omics analysis',
  };

  // 1) Tema
  var theme = DEFAULT_THEME;
  try {
    var storedTheme = localStorage.getItem('pythomics.theme');
    if (VALID_THEMES.indexOf(storedTheme) !== -1) theme = storedTheme;
  } catch (e) { /* localStorage bloqueado (modo privado) */ }
  document.documentElement.setAttribute('data-theme', theme);

  // 2) Idioma
  var lang = DEFAULT_LANG;
  try {
    var storedLang = localStorage.getItem('pythomics.locale');
    if (VALID_LANGS.indexOf(storedLang) !== -1) lang = storedLang;
  } catch (e) { /* localStorage bloqueado */ }
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('data-locale', lang);

  // 3) Título de la ventana. Este script va DESPUÉS del <title> en el
  //    <head>, así que el parser ya lo dejó puesto y esto lo sobrescribe.
  try {
    document.title = TITLES[lang];
  } catch (e) { /* document.title no disponible */ }
})();
