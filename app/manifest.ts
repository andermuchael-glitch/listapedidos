import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ListaPedidos",
    short_name: "ListaPedidos",
    description: "Separação de pedidos a partir de planilhas",
    start_url: "/listapedidos/",
    display: "standalone",
    background_color: "#f4f7f5",
    theme_color: "#16784a",
    lang: "pt-BR",
    icons: [{ src: "/listapedidos/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }]
  };
}
