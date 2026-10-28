'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            // Screens that need live data poll explicitly (refetchInterval);
            // refetching everything on every tab switch only adds load.
            refetchOnWindowFocus: false,
            // One retry: a failing call surfaces in seconds, not after 3 backoffs.
            retry: 1,
          },
        },
      })
  )

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
