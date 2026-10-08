const tags: Record<string, string> = {
  arabic: "ar", chinese: "zh", czech: "cs", danish: "da", dutch: "nl", english: "en", finnish: "fi",
  french: "fr", german: "de", greek: "el", hebrew: "he", hindi: "hi", hungarian: "hu", italian: "it",
  japanese: "ja", korean: "ko", norwegian: "no", polish: "pl", portuguese: "pt", romanian: "ro",
  russian: "ru", slovak: "sk", spanish: "es", swedish: "sv", turkish: "tr", ukrainian: "uk",
};

/** Maps the configured language name (for example "Polish") to an HTML lang tag when it is known. */
export function languageTag(language: string | undefined): string | undefined {
  if (!language) return undefined;
  if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language)) return language;
  return tags[language.trim().toLowerCase()];
}
