'use client';

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PonderProvider } from '@ponder/react';
import { client } from "@/lib/ponder";
import { ReactNode } from 'react';

const queryClient = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PonderProvider client={client}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </PonderProvider>
  );
}
