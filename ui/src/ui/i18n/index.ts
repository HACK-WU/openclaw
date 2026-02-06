/**
 * Internationalization (i18n) module for OpenClaw UI
 *
 * Usage:
 *   import { t, setLocale, getLocale } from './i18n/index.ts';
 *   t('nav.skills')  // => "Skills" or "技能"
 */

import { en } from "./locales/en.ts";
import { zhCN } from "./locales/zh-CN.ts";

export type LocaleCode = "en" | "zh-CN";

export type TranslationKey = keyof typeof en;

const locales: Record<LocaleCode, Record<string, string>> = {
  en,
  "zh-CN": zhCN,
};

let currentLocale: LocaleCode = "en";

/**
 * Check if running in browser environment
 */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined";
}

/**
 * Detect browser language and return matching locale
 */
export function detectLocale(): LocaleCode {
  if (!isBrowser()) {
    return "en";
  }

  const browserLang =
    navigator.language || (navigator as { userLanguage?: string }).userLanguage || "en";
  const lang = browserLang.toLowerCase();

  if (lang.startsWith("zh")) {
    return "zh-CN";
  }

  return "en";
}

/**
 * Initialize locale from browser settings or localStorage
 */
export function initLocale(): LocaleCode {
  if (!isBrowser()) {
    return currentLocale;
  }

  const stored = localStorage.getItem("openclaw-locale") as LocaleCode | null;
  if (stored && locales[stored]) {
    currentLocale = stored;
  } else {
    currentLocale = detectLocale();
  }
  return currentLocale;
}

/**
 * Get current locale
 */
export function getLocale(): LocaleCode {
  return currentLocale;
}

/**
 * Set current locale and persist to localStorage
 */
export function setLocale(locale: LocaleCode): void {
  if (locales[locale]) {
    currentLocale = locale;
    if (isBrowser()) {
      localStorage.setItem("openclaw-locale", locale);
    }
  }
}

/**
 * Get all available locales
 */
export function getAvailableLocales(): { code: LocaleCode; name: string }[] {
  return [
    { code: "en", name: "English" },
    { code: "zh-CN", name: "简体中文" },
  ];
}

/**
 * Translate a key to the current locale
 * Supports interpolation: t('hello', { name: 'World' }) with key "hello": "Hello, {name}!"
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const translations = locales[currentLocale] || locales.en;
  let text = translations[key] ?? locales.en[key] ?? key;

  if (params) {
    for (const [paramKey, value] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${paramKey}\\}`, "g"), String(value));
    }
  }

  return text;
}

/**
 * Check if a translation key exists
 */
export function hasTranslation(key: string): boolean {
  const translations = locales[currentLocale] || locales.en;
  return key in translations || key in locales.en;
}
