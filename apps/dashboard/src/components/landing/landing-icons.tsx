import { cn } from "@/lib/utils";

/**
 * Option icons for the landing's choose screen. Both render in a square box of
 * the same size and take `currentColor`, so the two cards line up exactly.
 */

/** WhatsApp-style mark: outlined speech bubble, solid disc, handset knocked out. */
export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={cn("shrink-0", className)}>
      <path
        d="M11.2 38.1A20.5 20.5 0 1 1 17 42.3L4.5 45.5Z"
        fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"
      />
      <circle cx="25.5" cy="24" r="15.5" fill="currentColor" />
      <path
        // Lucide's phone handset, filled, centred on the disc.
        transform="translate(15.6 14.1) scale(0.83)"
        fill="white"
        d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
      />
    </svg>
  );
}

/** The CV illustration (public/icon-cv.png) as a mask, so it takes `currentColor`. */
export function CvIcon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block shrink-0 bg-current [mask:url(/icon-cv.png)_center/contain_no-repeat]", className)}
    />
  );
}
