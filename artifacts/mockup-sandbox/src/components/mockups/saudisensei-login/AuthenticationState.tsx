import { Gateway, useGatewayLocale } from "./_Gateway";

export function AuthenticationState() {
  const locale = useGatewayLocale("ar");
  return <Gateway locale={locale} layout="desktop" state="failure" allowStateReview />;
}

export default AuthenticationState;
