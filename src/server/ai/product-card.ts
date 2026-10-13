/**
 * Ficha de producto para el chat, ordenada y separada:
 * nombre, precio, disponibilidad, descripción, ficha técnica, sitio e imagen.
 */
type ProductCardInput = {
  name: string;
  price: number;
  currency: string;
  stock: number | null;
  shortDescription: string | null;
  longDescription: string | null;
  imageUrl: string | null;
  websiteUrl: string | null;
};

export function stockLabel(stock: number | null): string {
  if (stock === null) return "Consultar disponibilidad";
  if (stock <= 0) return "Agotado por el momento";
  return `${stock} pieza${stock === 1 ? "" : "s"} disponible${stock === 1 ? "" : "s"}`;
}

export function renderProductCard(product: ProductCardInput, mainUrl: string): string {
  const price = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: product.currency,
  }).format(product.price / 100);
  const lines = [
    `*${product.name}*`,
    `Precio: ${price}`,
    `Disponibilidad: ${stockLabel(product.stock)}`,
  ];
  if (product.shortDescription) lines.push("", product.shortDescription);
  if (product.longDescription) lines.push("", product.longDescription);
  if (product.websiteUrl) lines.push("", `Sitio: ${product.websiteUrl}`);
  if (product.imageUrl) lines.push("", `Imagen de referencia: ${mainUrl}${product.imageUrl}`);
  return lines.join("\n");
}
