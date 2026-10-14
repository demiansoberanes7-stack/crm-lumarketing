/**
 * Ficha de producto para el chat, ordenada y separada:
 * nombre, precio, disponibilidad, descripción, ficha técnica y sitio.
 */
type ProductCardInput = {
  name: string;
  price: number;
  currency: string;
  stock: number | null;
  shortDescription: string | null;
  longDescription: string | null;
  websiteUrl: string | null;
};

export function stockLabel(stock: number | null): string {
  if (stock === null) return "Consultar disponibilidad";
  if (stock <= 0) return "Agotado por el momento";
  return `${stock} pieza${stock === 1 ? "" : "s"} disponible${stock === 1 ? "" : "s"}`;
}

export function renderProductCard(product: ProductCardInput): string {
  const lines = [
    `*${product.name}*`,
    `Precio: ${formatPrice(product)}`,
    `Disponibilidad: ${stockLabel(product.stock)}`,
  ];
  appendDetails(lines, product);
  return lines.join("\n");
}

/**
 * Ficha de producto para COMPARTIR con un contacto desde el Inventario.
 * Igual que `renderProductCard` pero SIN la cantidad de piezas: el operador
 * decide si quiere hablar de disponibilidad, así que no se filtra sola.
 */
export function renderProductShare(product: ProductCardInput): string {
  const lines = [`*${product.name}*`, `Precio: ${formatPrice(product)}`];
  appendDetails(lines, product);
  return lines.join("\n");
}

function formatPrice(product: ProductCardInput): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: product.currency,
  }).format(product.price / 100);
}

function appendDetails(lines: string[], product: ProductCardInput): void {
  if (product.shortDescription) lines.push("", product.shortDescription);
  if (product.longDescription) lines.push("", product.longDescription);
  if (product.websiteUrl) lines.push("", `Sitio: ${product.websiteUrl}`);
}
