import { en, type MessageKey } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

export type Locale = "en" | "zh-CN";
export type MessageParameters = Readonly<Record<string, string | number>>;

const LOCALE_STORAGE_KEY = "pi-web.locale";
const LOCALE_CHANGE_EVENT = "pi-web-locale-change";
const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, "zh-CN": zhCN };

let currentLocale: Locale | undefined;

export function locale(): Locale {
  if (currentLocale === undefined) {
    currentLocale = readStoredLocale() ?? browserLocale();
    applyDocumentLanguage(currentLocale);
  }
  return currentLocale;
}

export function setLocale(nextLocale: Locale): void {
  currentLocale = nextLocale;
  applyDocumentLanguage(nextLocale);
  try {
    globalThis.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
  globalThis.dispatchEvent(new CustomEvent(LOCALE_CHANGE_EVENT));
}

export function subscribeLocaleChange(listener: () => void): () => void {
  globalThis.addEventListener(LOCALE_CHANGE_EVENT, listener);
  return () => { globalThis.removeEventListener(LOCALE_CHANGE_EVENT, listener); };
}

export function t(key: MessageKey, parameters: MessageParameters = {}): string {
  const message = dictionaries[locale()][key] ?? en[key] ?? key;
  const parameterNames = Object.keys(parameters);
  if (parameterNames.length === 0) return message;
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = parameters[name];
    return value === undefined ? placeholder : String(value);
  });
}

function readStoredLocale(): Locale | undefined {
  try {
    const stored = globalThis.localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored === "en" || stored === "zh-CN" ? stored : undefined;
  } catch {
    return undefined;
  }
}

function browserLocale(): Locale {
  const language = typeof navigator === "undefined" ? undefined : navigator.language;
  return language?.toLowerCase().startsWith("zh") === true ? "zh-CN" : "en";
}

function applyDocumentLanguage(nextLocale: Locale): void {
  try {
    document.documentElement.setAttribute("lang", nextLocale);
  } catch {
    // Not running in a DOM context (e.g. unit tests).
  }
}
