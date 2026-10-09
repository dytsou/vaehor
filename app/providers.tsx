"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { ModalProvider } from "@/components/providers/ModalProvider";
import { AppInitializer } from "@/components/providers/AppInitializer";

type Props = {
  children?: React.ReactNode;
};

import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

export function Providers({ children }: Readonly<Props>) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            gcTime: 10 * 60 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  useEffect(() => {
    if (
      process.env.NODE_ENV === "development" &&
      typeof window !== "undefined" &&
      "serviceWorker" in navigator
    ) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(
            registrations.map((registration) => registration.unregister()),
          ),
        )
        .catch((error: unknown) => {
          console.error("Failed to unregister service workers", error);
        });
    }
  }, []);

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AppInitializer>
            <ModalProvider>{children}</ModalProvider>
          </AppInitializer>
        </ThemeProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </SessionProvider>
  );
}
