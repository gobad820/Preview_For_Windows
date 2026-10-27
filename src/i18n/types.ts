/** A message: plain text with `{name}` placeholders, or a function for plurals and word order. */
export type Params = Readonly<Record<string, string | number>>;
export type Message = string | ((p: Params) => string);

/** The UI languages. */
export type Locale = 'en' | 'ko';
/** The Settings choice: follow Windows, or a fixed UI language. */
export type Language = 'system' | Locale;
