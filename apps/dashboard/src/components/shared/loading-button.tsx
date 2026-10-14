"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { usePendingProgress } from "@/components/layout/route-progress";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

type ButtonProps = React.ComponentProps<typeof Button>;

interface LoadingButtonProps extends ButtonProps {
  loading?: boolean;
  /** Replaces the label while loading (e.g. "Salvataggio..."). */
  loadingText?: React.ReactNode;
}

/**
 * shadcn `Button` with a pending state: spinner, disabled, `aria-busy`, and
 * the global top progress bar. Use for imperative actions (`useTransition`).
 */
export function LoadingButton({
  loading = false,
  loadingText,
  disabled,
  className,
  children,
  ...props
}: LoadingButtonProps) {
  const t = useT();
  usePendingProgress(loading);

  return (
    <Button
      disabled={disabled || loading}
      aria-busy={loading}
      // While loading, the spinner stands in for the button's own icon.
      className={cn(loading && "[&>svg:not([role=status])]:hidden", className)}
      {...props}
    >
      {loading ? (
        <>
          <Spinner data-icon="inline-start" aria-label={t.common.processing} />
          {loadingText ?? children}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

/**
 * Submit button that reads the pending state of its parent `<form action>`
 * via `useFormStatus`. Drop-in for `<Button type="submit">`, including in
 * Server Components.
 */
export function SubmitButton(props: Omit<LoadingButtonProps, "loading" | "type">) {
  const { pending } = useFormStatus();
  return <LoadingButton type="submit" loading={pending} {...props} />;
}
