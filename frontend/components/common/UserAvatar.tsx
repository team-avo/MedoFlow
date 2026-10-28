'use client'

import Image from 'next/image'
import { cn } from '@/lib/utils'

const avatarPool = [
  '/doctors/doctor-female-1.jpg',
  '/doctors/doctor-female-2.jpg',
  '/doctors/doctor-male-1.jpg',
  '/doctors/doctor-male-2.jpg',
]

function hashSeed(seed: string) {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  return hash
}

function getAvatar(seed?: string | null): string {
  if (!seed) return avatarPool[0]!
  return avatarPool[hashSeed(seed) % avatarPool.length]!
}

interface UserAvatarProps {
  seed?: string | null
  alt: string
  className?: string
  sizes?: string
}

export function UserAvatar({ seed, alt, className, sizes = '48px' }: UserAvatarProps) {
  return (
    <div className={cn('relative shrink-0 overflow-hidden rounded-full bg-white', className)}>
      <Image src={getAvatar(seed)} alt={alt} fill sizes={sizes} className="object-cover" />
    </div>
  )
}
