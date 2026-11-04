import Image from "next/image";

/**
 * The partner's identity above the headline (logo, name, optional line), so a
 * candidate coming from the partner's post recognises where they landed.
 * Without a logo, a square with the name's initial keeps the layout.
 */
export function PartnerBrand({
  name,
  tagline,
  logoSrc,
}: {
  name: string;
  tagline: string | null;
  logoSrc: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      {logoSrc ? (
        // Already resized server-side to 256px; skip the image optimizer.
        <Image
          src={logoSrc} alt="" width={44} height={44} unoptimized priority
          className="size-11 shrink-0 rounded-lg border bg-white object-contain"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-lg font-semibold text-primary"
        >
          {name.trim().charAt(0).toUpperCase()}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{name}</p>
        {tagline && <p className="truncate text-xs text-muted-foreground">{tagline}</p>}
      </div>
    </div>
  );
}
