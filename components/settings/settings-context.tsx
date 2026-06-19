'use client'

import { createContext, useContext } from 'react'

export type AppSettingsContext = {
  currency: string
  vatRate: number
  businessName: string
}

const Ctx = createContext<AppSettingsContext>({
  currency: 'AED',
  vatRate: 5,
  businessName: 'Apna Chulha Restaurant LLC',
})

export function SettingsProvider({
  currency,
  vatRate,
  businessName,
  children,
}: AppSettingsContext & { children: React.ReactNode }) {
  return (
    <Ctx.Provider value={{ currency, vatRate, businessName }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAppSettings(): AppSettingsContext {
  return useContext(Ctx)
}
