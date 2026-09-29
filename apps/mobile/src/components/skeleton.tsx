import { View, type ViewProps } from 'react-native'

import { cn } from '@/utils/cn'

/** A resting placeholder in the track colour: the shape of what is loading, nothing more. */
export function Skeleton({ className, ...props }: ViewProps) {
  return <View {...props} accessibilityElementsHidden className={cn('rounded-xs bg-track', className)} />
}
