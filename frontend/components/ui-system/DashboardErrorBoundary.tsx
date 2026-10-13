'use client'

import * as React from 'react'
import { AppErrorState } from './AppErrorState'
import { clientLog } from '@/lib/clientLog'

interface Props {
  children: React.ReactNode
  fallbackTitle?: string
  fallbackDescription?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Class-based error boundary. Catches render-time errors from descendants and
 * renders AppErrorState with a "Try again" button that resets the boundary.
 *
 * Wrap routes (or subtrees) where an uncaught exception should NOT crash the
 * whole dashboard shell.
 */
export class DashboardErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, _info: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    clientLog.error('[DashboardErrorBoundary] render error', error)
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null })
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="p-6">
          <AppErrorState
            title={this.props.fallbackTitle ?? 'This page hit an unexpected error'}
            description={
              this.props.fallbackDescription ??
              'The issue has been logged. Try again, or refresh the page if it persists.'
            }
            onRetry={this.reset}
          />
        </div>
      )
    }
    return this.props.children
  }
}
