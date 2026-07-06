"use client";

import { usePathname } from "next/navigation";

/**
 * Hides site chrome (header/footer) on /embed routes so the diagram can be
 * iframed without decoration. Children stay server-rendered.
 */
export function HideOnEmbed({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/embed/")) {
    return null;
  }
  return <>{children}</>;
}
