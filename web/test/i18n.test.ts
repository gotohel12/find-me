import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLang, dirOf, translate, missingKeys } from '../src/i18n.ts';

test('language detection', () => {
  assert.equal(detectLang(['ar-SA', 'en'], null), 'ar');
  assert.equal(detectLang(['fr', 'en-GB'], null), 'en');
  assert.equal(detectLang(['de'], null), 'en');
  assert.equal(detectLang(['en'], 'ar'), 'ar', 'stored choice wins');
});

test('direction', () => {
  assert.equal(dirOf('ar'), 'rtl');
  assert.equal(dirOf('en'), 'ltr');
});

test('translate with variables and Arabic digits', () => {
  assert.equal(translate('en', 'home.streak', { n: 3 }), '3-day streak');
  assert.equal(translate('ar', 'home.streak', { n: 3 }), 'سلسلة ٣ يوم');
  assert.equal(translate('ar', 'app.name'), 'لقني');
  assert.equal(translate('en', 'no.such.key'), 'no.such.key');
});

test('Arabic and English have the same keys', () => {
  assert.deepEqual(missingKeys(), { ar: [], en: [] });
});

test('credit is present in both languages', () => {
  assert.equal(translate('ar', 'credit'), 'Developed by Mohsen ~ Danial');
  assert.equal(translate('en', 'copyright'), '© 2026 MD Studio. All rights reserved.');
});
