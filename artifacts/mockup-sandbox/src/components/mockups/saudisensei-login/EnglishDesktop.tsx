import { Gateway, useGatewayLocale } from "./_Gateway";

export function EnglishDesktop() {
  const locale = useGatewayLocale("en");
  return <Gateway locale={locale} layout="desktop" />;
}

export default EnglishDesktop;
