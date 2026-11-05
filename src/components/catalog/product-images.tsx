"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ImageOff, Star, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProductImageDto } from "@/lib/catalog/dto";

/**
 * Tira de fotos de un producto, dentro del modal de alta/edición.
 *
 * Sube **al instante**, no al pulsar «Guardar cambios»: el producto ya existe
 * cuando se edita, y un archivo pendiente en memoria que se pierde al cerrar el
 * modal es la peor forma de fallar una subida. Por eso el modal de creación no
 * la muestra —no hay `product_id` al que colgar la fila— y lo dice en pantalla
 * en vez de dejar un botón que no hace nada.
 */

/** Lo que el `<input accept>` ofrece; la validación real va por firma de bytes en el servidor. */
const ACCEPT = ".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif";

type Props = {
  productId: string | null;
  productName: string;
};

export function ProductImages({ productId, productName }: Props) {
  const [images, setImages] = useState<ProductImageDto[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ProductImageDto | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const refetch = useCallback(async () => {
    if (!productId) return;
    const res = await fetch(`/api/catalog/${productId}/images`).catch(() => null);
    if (!res?.ok) {
      setFailed(true);
      return;
    }
    const data = (await res.json()) as { images: ProductImageDto[] };
    setImages(data.images);
    setFailed(false);
  }, [productId]);

  useEffect(() => {
    setImages([]);
    setFailed(false);
    setError(null);
    void refetch();
  }, [refetch]);

  async function upload(files: FileList | null) {
    if (!productId || !files || files.length === 0) return;
    setBusy(true);
    setError(null);
    // De una en una: el servidor decide el tope por producto y hay que respetar
    // el orden en que el usuario las eligió.
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/catalog/${productId}/images`, {
        method: "POST",
        body: form,
      }).catch(() => null);
      if (!res?.ok) {
        const data = (await res?.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(
          data?.error?.message ??
            `No se pudo subir «${file.name}». Comprueba el formato y el tamaño.`
        );
        setBusy(false);
        await refetch();
        return;
      }
      const created = (await res.json()) as { image: ProductImageDto };
      setImages((prev) => [...prev, created.image]);
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function patch(body: Record<string, unknown>) {
    if (!productId) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/catalog/${productId}/images`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError("No se pudo actualizar la tira de fotos.");
      void refetch();
      return;
    }
    const data = (await res.json()) as { images: ProductImageDto[] };
    setImages(data.images);
  }

  async function remove(image: ProductImageDto) {
    if (!productId) return;
    setBusy(true);
    const res = await fetch(`/api/catalog/images/${image.id}`, { method: "DELETE" }).catch(
      () => null
    );
    setBusy(false);
    if (!res?.ok) {
      setError("No se pudo quitar la foto.");
      return;
    }
    setImages((prev) => prev.filter((i) => i.id !== image.id));
    if (zoom?.id === image.id) setZoom(null);
  }

  function onDragEnd(event: DragEndEvent) {
    const from = event.active.id;
    const to = event.over?.id;
    if (!to || from === to) return;
    const currentIndex = images.findIndex((i) => i.id === from);
    const targetIndex = images.findIndex((i) => i.id === to);
    if (currentIndex < 0 || targetIndex < 0) return;
    const next = images.slice();
    const [moved] = next.splice(currentIndex, 1);
    next.splice(targetIndex, 0, moved!);
    setImages(next);
    void patch({ orderedIds: next.map((i) => i.id) });
  }

  if (!productId) {
    return (
      <p className="rounded-md border border-dashed p-3 text-xs text-text-3">
        Guarda el producto para poder añadirle fotos. Sin fila de producto no hay
        dónde enlazarlas.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-text-3">
          {images.length === 0
            ? "Sin fotos todavía."
            : `${images.length} foto${images.length === 1 ? "" : "s"} · arrastra para reordenar`}
        </span>
        <label className="cursor-pointer">
          <span className="sr-only">Seleccionar imágenes del producto</span>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            disabled={busy}
            onChange={(e) => void upload(e.target.files)}
          />
          <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium hover:bg-accent">
            <Upload className="h-3.5 w-3.5" strokeWidth={1.8} />
            {busy ? "Subiendo…" : "Añadir fotos"}
          </span>
        </label>
      </div>

      {failed ? (
        <p className="rounded-md bg-subtle p-2 text-xs text-text-2">
          No se pudieron leer las fotos de este producto.{" "}
          <button
            type="button"
            className="font-medium text-brand-text underline"
            onClick={() => {
              setFailed(false);
              void refetch();
            }}
          >
            Reintentar
          </button>
        </p>
      ) : images.length > 0 ? (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <ul className="flex flex-wrap gap-2">
            {images.map((image, index) => (
              <ImageTile
                key={image.id}
                image={image}
                index={index}
                alt={image.altText ?? productName}
                onZoom={() => setZoom(image)}
                onPrimary={() => void patch({ primaryId: image.id })}
                onRemove={() => void remove(image)}
                disabled={busy}
              />
            ))}
          </ul>
        </DndContext>
      ) : null}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {zoom && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-6"
          onClick={() => setZoom(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Foto ampliada de ${productName}`}
        >
          <figure className="max-h-full max-w-3xl overflow-auto rounded-xl border bg-card p-3 shadow-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element -- la sube el negocio ya comprimida y vive en MEDIA_DIR; el optimizador la recodificaría en cada petición. */}
            <img
              src={zoom.url}
              alt={zoom.altText ?? productName}
              className="mx-auto max-h-[70dvh] w-auto rounded-md object-contain"
            />
            <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-text-3">
              <span>
                {zoom.width && zoom.height ? `${zoom.width}×${zoom.height} · ` : ""}
                {formatKb(zoom.bytes)}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setZoom(null)}>
                Cerrar
              </Button>
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}

function formatKb(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function ImageTile({
  image,
  index,
  alt,
  onZoom,
  onPrimary,
  onRemove,
  disabled,
}: {
  image: ProductImageDto;
  index: number;
  alt: string;
  onZoom: () => void;
  onPrimary: () => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: image.id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: image.id });

  return (
    <li
      ref={(node) => {
        setNodeRef(node);
        setDropRef(node);
      }}
      className={cn(
        "relative w-28 rounded-md border bg-card p-1",
        isDragging && "opacity-40",
        isOver && "ring-2 ring-brand",
        image.isPrimary && "border-brand-soft bg-brand-tint"
      )}
    >
      <div
        {...listeners}
        {...attributes}
        className="cursor-grab touch-none"
        aria-label={`Mover la foto ${index + 1} de ${alt}`}
      >
        {/* El cajón se reserva con la proporción real: sin width/height el
            navegador no lo sabe y el cuadro brinca al cargar. */}
        <ImageFrame image={image} alt={alt} onZoom={onZoom} />
      </div>

      <div className="mt-1 flex items-center justify-between gap-1">
        {image.isPrimary ? (
          <Badge variant="success" className="text-[10px]">
            Principal
          </Badge>
        ) : (
          <button
            type="button"
            onClick={onPrimary}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-sm px-1 text-[10px] text-text-3 hover:bg-accent"
            title="Marcar como principal"
          >
            <Star className="h-3 w-3" strokeWidth={1.8} />
            Portada
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="rounded-sm p-1 text-text-3 hover:bg-accent hover:text-destructive"
          aria-label={`Quitar la foto ${index + 1} de ${alt}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

function ImageFrame({
  image,
  alt,
  onZoom,
}: {
  image: ProductImageDto;
  alt: string;
  onZoom: () => void;
}) {
  const [broken, setBroken] = useState(false);

  // Archivo perdido (volumen vaciado en un redeploy, restauración a medias): la
  // rejilla se queda con su hueco y dice lo que falta. Un producto sin foto no
  // puede verse como un producto roto.
  if (broken) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-sm bg-subtle">
        <ImageOff className="h-5 w-5 text-text-3" aria-hidden />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onZoom}
      className="block w-full overflow-hidden rounded-sm bg-subtle"
      style={
        image.width && image.height
          ? { aspectRatio: `${image.width} / ${image.height}` }
          : { aspectRatio: "1 / 1" }
      }
      title="Ver ampliada"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- al reordenar la tira cambian las URLs de sitio en sitio; con el optimizador cada arrastre invalidaría su caché. */}
      <img
        src={image.url}
        alt={alt}
        width={image.width ?? undefined}
        height={image.height ?? undefined}
        loading="lazy"
        onError={() => setBroken(true)}
        className="h-full w-full object-cover"
      />
    </button>
  );
}
