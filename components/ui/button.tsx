import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-btn font-bold text-sm transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-saffron disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:   'bg-saffron text-white hover:bg-[#d8631f]',
        secondary: 'bg-ink text-white hover:bg-[#3a2e24]',
        ghost:     'bg-surface border border-border text-ink hover:bg-cream',
        outline:   'border border-border bg-surface text-ink hover:border-saffron hover:text-ember',
        danger:    'bg-red-soft text-red hover:bg-[#f6d8d2]',
        success:   'bg-green-soft text-green hover:bg-[#cfe6d7]',
        wa:        'bg-[#1FA855] text-white hover:bg-[#188947]',
      },
      size: {
        default: 'h-12 px-4',
        sm:      'h-[42px] px-3.5 text-[13px]',
        lg:      'h-14 px-6 text-base',
        icon:    'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
