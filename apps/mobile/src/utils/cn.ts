import { twMerge } from 'tailwind-merge'

/** Joins class names, dropping falsy values and resolving Tailwind conflicts (the last wins). */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return twMerge(classes.filter(Boolean).join(' '))
}
