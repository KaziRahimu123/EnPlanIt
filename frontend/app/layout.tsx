import type { Metadata } from "next";
import "./globals.css";
import NavBar from "@/components/NavBar";
import ConditionalSpaceBackground from "@/components/ConditionalSpaceBackground";
import { Auth0Provider } from "@auth0/nextjs-auth0/client";
import { RoleProvider } from "@/lib/RoleContext";

export const metadata: Metadata = {
  title: "EnPlanIt — Space Mission Intelligence & Digital Twin",
  description: "Enlighten your mission. Plan it to perfection. Interactive space mission digital twin and scenario analysis platform.",
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scanlines">
      <body className="min-h-screen flex flex-col" suppressHydrationWarning>
        {/* Fixed deep-space environment — suppressed on homepage (GlobalSpaceBackground renders there instead) */}
        <ConditionalSpaceBackground />
        <Auth0Provider>
          <RoleProvider>
            <NavBar />
            <main className="flex-1 relative z-0">{children}</main>
            <footer className="border-t border-[var(--border)] py-3 text-center text-[var(--text-muted)]" style={{ fontSize: "var(--text-2xs)", letterSpacing: "var(--ls-wide)" }}>
              EnPlanIt &copy; {new Date().getFullYear()} &mdash; Enlighten your mission. Plan it to perfection.
            </footer>
          </RoleProvider>
        </Auth0Provider>
      </body>
    </html>
  );
}
