import { en, type TranslationKey } from "./en";
import { it } from "./it";

export type Locale = "en" | "it";

const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = { en, it };

export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "it", label: "Italiano" },
];

export type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

export function translator(locale: Locale): Translate {
  const dict = DICTIONARIES[locale] ?? en;
  return (key, vars) => {
    const template = dict[key] ?? en[key] ?? key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in vars ? String(vars[name]) : match,
    );
  };
}

export function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  return navigator.language?.toLowerCase().startsWith("it") ? "it" : "en";
}

export type { TranslationKey };
