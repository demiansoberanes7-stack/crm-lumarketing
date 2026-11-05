import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  COST_LINES_MAX,
  COST_MAX_QUANTITY,
  COST_MAX_UNIT_PRICE_CENTS,
  COST_NAME_MAX,
  COST_UNIT_MAX,
} from "@/lib/catalog/cost";
import { getProductCosts, replaceProductCosts } from "@/server/catalog/costs";

export const dynamic = "force-dynamic";

/**
 * Receta de costos de un producto.
 *
 * `GET` devuelve las líneas con todo lo derivado ya calculado (costo por línea,
 * total, % de mezcla, % del costo, margen) y el costo plano de `service_cost` si
 * lo hay. `PUT` reemplaza la lista entera: `{ lines: [] }` es «este producto ya
 * no tiene receta», no un error.
 *
 * El cuerpo habla en **centavos**, como `POST /api/catalog`: quien convierte los
 * decimales del input es el componente, y la conversión ocurre una sola vez.
 */

type _Params = { params: Promise<{ id: string }> };

/** GET — la receta con sus totales */
export const GET = withAuth(async (session, _req: Request, { params }: _Params) => {
  const { id } = await params;
  const result = await getProductCosts(session.organizationId, id);
  if (!result.ok) {
    return apiError(404, result.code, result.message);
  }
  return Response.json({
    product: result.product,
    lines: result.cost.lines,
    totals: result.cost.totals,
    flatCostCents: result.flatCostCents,
  });
});

const costLineSchema = z.object({
  /**
   * Se acepta pero se ignora: el reemplazo regenera las ids. Existe en el
   * contrato para que el cliente pueda reutilizar la forma de la fila sin
   * mentirle con un campo fantasma.
   */
  id: z.string().max(255).nullish(),
  name: z.string().min(1).max(COST_NAME_MAX),
  // `.positive()`, no `.min(0)`: la `CHECK` de 0090 rechaza cantidad 0, y una
  // validación que deja pasar lo que la base de datos va a tirar produce 500.
  quantity: z.number().finite().positive().max(COST_MAX_QUANTITY),
  unit: z.string().trim().min(1).max(COST_UNIT_MAX),
  unitPriceCents: z.number().int().min(0).max(COST_MAX_UNIT_PRICE_CENTS),
});

const putSchema = z.object({
  lines: z.array(costLineSchema).max(COST_LINES_MAX),
});

/** PUT — reemplazar la receta */
export const PUT = withAuth(async (session, req: Request, { params }: _Params) => {
  const { id } = await params;
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const result = await replaceProductCosts({
    organizationId: session.organizationId,
    productId: id,
    lines: body.data.lines,
  });
  if (!result.ok) {
    return apiError(404, result.code, result.message);
  }
  return Response.json({
    ok: true,
    lines: result.cost.lines,
    totals: result.cost.totals,
    flatCostCents: result.flatCostCents,
  });
});
