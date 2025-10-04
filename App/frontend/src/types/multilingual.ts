export type LanguageData<T = unknown> = Record<string, T>;

export interface LanguageDataEntry<T = unknown> {
  language: string;
  data: T;
}
