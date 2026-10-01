// Translation lookup usable from both server and client code. (The React
// context lives in i18n.tsx, a client module; server components import this.)

import { en, type MessageKey } from "./dict/en";
import { fr } from "./dict/fr";
import type { Lang } from "./types";

export type { MessageKey };

const DICTS: Record<Lang, Record<MessageKey, string>> = { en, fr };

export type Vars = Record<string, string | number>;

export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const template = DICTS[lang][key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}
