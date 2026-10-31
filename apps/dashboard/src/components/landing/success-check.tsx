/**
 * Animated success mark for the landing's done screen: the ring draws, the disc
 * fills with the brand colour, the check draws in white, then a short pop.
 * Static (already complete) with prefers-reduced-motion. The styles travel with
 * the component: React hoists and de-duplicates the <style> by its href.
 */
const CSS = `
.success-check {
  border-radius: 9999px;
  box-shadow: inset 0 0 0 var(--primary);
  animation:
    success-fill 0.4s ease-in-out 0.4s forwards,
    success-pop 0.3s ease-in-out 0.9s both;
}
.success-check__ring {
  stroke-dasharray: 166;
  stroke-dashoffset: 166;
  animation: success-draw 0.6s cubic-bezier(0.65, 0, 0.45, 1) forwards;
}
.success-check__tick {
  stroke-dasharray: 48;
  stroke-dashoffset: 48;
  animation: success-draw 0.3s cubic-bezier(0.65, 0, 0.45, 1) 0.8s forwards;
}
@keyframes success-draw { to { stroke-dashoffset: 0; } }
@keyframes success-fill { to { box-shadow: inset 0 0 0 40px var(--primary); } }
@keyframes success-pop { 50% { transform: scale3d(1.1, 1.1, 1); } }
@media (prefers-reduced-motion: reduce) {
  .success-check, .success-check__ring, .success-check__tick { animation: none; }
  .success-check { box-shadow: inset 0 0 0 40px var(--primary); }
  .success-check__ring, .success-check__tick { stroke-dashoffset: 0; }
}
`;

export function SuccessCheck() {
  return (
    <>
      <style href="landing-success-check" precedence="default">{CSS}</style>
      <svg viewBox="0 0 52 52" aria-hidden="true" className="success-check mb-2 size-16 text-primary">
        <circle
          className="success-check__ring" cx="26" cy="26" r="25"
          fill="none" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10"
        />
        <path
          className="success-check__tick" d="M14.1 27.2l7.1 7.2 16.7-16.8"
          fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
    </>
  );
}
