import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ListaPedidos — Separação",
  description: "Aplicativo de separação de pedidos a partir de planilhas.",
  manifest: "/listapedidos/manifest.webmanifest"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}