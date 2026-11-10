const { UI_MESSAGES } = require('../src/common/i18n/messages.js');

const languageFields = { 'zh-Hans': 'zhHans', 'zh-Hant': 'zhHant', en: 'en' };

function localizeDialogOptions(options, language) {
  const field = Object.hasOwn(languageFields, language) ? languageFields[language] : 'en';
  const translate = key => Object.hasOwn(UI_MESSAGES, key) ? UI_MESSAGES[key][field] : key;
  return {
    ...options,
    title: translate(options.title),
    ...(options.filters && { filters: options.filters.map(filter => ({ ...filter, name: translate(filter.name) })) })
  };
}

module.exports = { localizeDialogOptions };
