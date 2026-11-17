/** URL of a file in `public/`, with the base path the demo is served under (next/image does not add it). */
export function asset(file: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${file}`;
}
