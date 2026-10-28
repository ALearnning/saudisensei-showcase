export const interfaceLocales = ["ar", "en"] as const;
export type InterfaceLocale = typeof interfaceLocales[number];
export const defaultInterfaceLocale: InterfaceLocale = "ar";
