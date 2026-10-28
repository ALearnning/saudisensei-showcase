import { DM_Sans } from "next/font/google";
const sans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-login-en" });

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <div className={`sslg-route ${sans.variable}`}>{children}</div>;
}
