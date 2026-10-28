import { Gateway, useGatewayLocale } from "./_Gateway";

export function ArabicDesktop() {
  const locale = useGatewayLocale("ar");
  return <Gateway locale={locale} layout="desktop" />;
}

export default ArabicDesktop;
