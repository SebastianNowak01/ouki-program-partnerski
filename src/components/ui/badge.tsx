import type { HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const badgeVariants = cva('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold', {
  variants: {
    variant: {
      default: 'border-transparent bg-slate-900 text-white',
      secondary: 'border-transparent bg-slate-100 text-slate-900',
      success: 'border-transparent bg-emerald-100 text-emerald-800',
      warning: 'border-transparent bg-amber-100 text-amber-900',
      danger: 'border-transparent bg-rose-100 text-rose-900',
      outline: 'text-slate-700',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

type BadgeProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

