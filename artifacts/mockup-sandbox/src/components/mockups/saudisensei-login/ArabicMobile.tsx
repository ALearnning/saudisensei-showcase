import { Gateway, useGatewayLocale } from "./_Gateway";

export function ArabicMobile() {
  const locale = useGatewayLocale("ar");
  return <Gateway locale={locale} layout="mobile" />;
}

export default ArabicMobile;
