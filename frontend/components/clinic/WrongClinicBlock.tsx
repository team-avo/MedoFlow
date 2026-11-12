'use client'

/**
 * WrongClinicBlock: full-page hard block shown when an authenticated
 * patient lands on a clinic site that isn't theirs. No header, no
 * landing content: just a clean access-denied page with a logout
 * button so they can switch accounts.
 */

import React from 'react'
import { ShieldAlert, LogOut } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useAuthModal } from '@/components/auth/AuthModal'

interface Props {
  clinicName: string
  themeColor: string
}

export function WrongClinicBlock({ clinicName, themeColor }: Props) {
  const { logout } = useAuth()
  const { openLogin } = useAuthModal()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 py-16 text-center">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-md"
        style={{ backgroundColor: themeColor }}
      >
        <ShieldAlert className="h-7 w-7" />
      </div>

      <h1 className="mt-8 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
        Wrong account for this clinic
      </h1>

      <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-slate-500">
        You're signed in to a different clinic. {clinicName} is private: only its own patients can
        access this site.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => {
            logout()
            // Once we're logged out, surface the auth modal so the user
            // can sign in (or sign up) with the right clinic.
            setTimeout(() => openLogin(), 80)
          }}
          className="inline-flex h-12 items-center gap-2 rounded-full px-6 text-sm font-bold text-white shadow-md transition-opacity hover:opacity-90"
          style={{ backgroundColor: themeColor }}
        >
          <LogOut className="h-4 w-4" />
          Log out & switch account
        </button>
      </div>
    </div>
  )
}
