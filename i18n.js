const i18n = require('i18next');
const Backend = require('i18next-http-backend');
const LanguageDetector = require('i18next-browser-languagedetector');
const i18nextMiddleware = require('i18next-http-middleware');

i18n
  .use(Backend)
  .use(LanguageDetector)
  .use(i18nextMiddleware.LanguageDetector)
  .init({
    fallbackLng: 'en',
    backend: {
      loadPath: '/locales/{{lng}}/translation.json'
    },
    preload: ['en', 'es', 'hi'], // List of languages to preload
    saveMissing: true
  });

module.exports = i18n;
