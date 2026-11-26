import React, { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Copy,
  Loader2,
  Monitor,
  Apple,
  AppWindow,
  Terminal
} from 'lucide-react'
import { cn } from '../lib/utils'
import { useApp } from '../store'
import type { Toast } from '../store'

/* ------------------------------- Button ------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft'
type ButtonSize = 'sm' | 'md' | 'lg'

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: React.ReactNode
}) {
  return (
    <button
      className={cn('btn', `btn-${variant}`, `btn-${size}`, className)}
      {...rest}
    >
      {icon ? <span className="btn-icon">{icon}</span> : null}
      {children ? <span>{children}</span> : null}
    </button>
  )
}

export function IconButton({
  label,
  active,
  danger,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  active?: boolean
  danger?: boolean
}) {
  return (
    <button
      className={cn('icon-btn', active && 'is-active', danger && 'is-danger', className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <span className="icon-btn-icon">{children}</span>
      <span className="icon-btn-label">{label}</span>
    </button>
  )
}

/* ------------------------------- Switch ------------------------------- */

export function Switch({
  checked,
  onChange,
  disabled,
  label
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cn('switch', checked && 'is-on')}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  )
}

/* ------------------------------ Segmented ----------------------------- */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className
}: {
  value: T
  options: { value: T; label: string; icon?: React.ReactNode }[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div className={cn('segmented', className)} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={value === option.value}
          className={cn('segmented-item', value === option.value && 'is-active')}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}

/* -------------------------------- Field ------------------------------- */

export function Field({
  label,
  hint,
  children,
  className
}: {
  label?: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn('field', className)}>
      {label ? <span className="field-label">{label}</span> : null}
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('input', props.className)} />
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('textarea', props.className)} />
}

/* -------------------------------- Modal ------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 460,
  closable = true
}: {
  open: boolean
  onClose?: () => void
  title?: React.ReactNode
  subtitle?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  width?: number
  closable?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onClose && closable) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, closable])

  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closable && onClose?.()}>
      <div className="modal" style={{ width }}>
        <div className="modal-glow" />
        {title ? (
          <div className="modal-header">
            <div>
              <h3>{title}</h3>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
          </div>
        ) : null}
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  )
}

/* -------------------------------- Toasts ------------------------------ */

const TOAST_ICON: Record<Toast['kind'], React.ReactNode> = {
  success: <Check size={16} />,
  error: <span className="toast-dot" />,
  info: <span className="toast-dot" />
}

export function ToastStack() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={cn('toast', `toast-${toast.kind}`)} onClick={() => dismiss(toast.id)}>
          <div className="toast-icon">{TOAST_ICON[toast.kind]}</div>
          <div className="toast-text">
            <div className="toast-title">{toast.title}</div>
            {toast.desc ? <div className="toast-desc">{toast.desc}</div> : null}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------- Spinner ------------------------------ */

export function Spinner({ size = 18 }: { size?: number }) {
  return <Loader2 size={size} className="spin" />
}

/* ----------------------------- Copy button ---------------------------- */

export function CopyButton({
  value,
  label = '复制',
  compact
}: {
  value: string
  label?: string
  compact?: boolean
}) {
  const [done, setDone] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current)
  }, [])
  return (
    <button
      className={cn('btn btn-ghost btn-sm', compact && 'btn-icon-only')}
      onClick={async () => {
        await window.cdesk.clipboard.write(value)
        setDone(true)
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setDone(false), 1600)
      }}
      data-tip={label}
    >
      {done ? <Check size={15} /> : <Copy size={15} />}
      {!compact ? <span>{done ? '已复制' : label}</span> : null}
    </button>
  )
}

/* ----------------------------- Device badge --------------------------- */

export function OsGlyph({ platform, os, size = 18 }: { platform?: string; os?: string; size?: number }) {
  const value = `${platform ?? ''} ${os ?? ''}`.toLowerCase()
  if (value.includes('darwin') || value.includes('mac')) return <Apple size={size} />
  if (value.includes('win')) return <Monitor size={size} />
  if (value.includes('linux')) return <Terminal size={size} />
  return <AppWindow size={size} />
}

export function DeviceAvatar({
  platform,
  os,
  size = 44,
  live
}: {
  platform?: string
  os?: string
  size?: number
  live?: boolean
}) {
  const value = `${platform ?? ''} ${os ?? ''}`.toLowerCase()
  const variant = value.includes('darwin') || value.includes('mac')
    ? 'mac'
    : value.includes('win')
      ? 'win'
      : 'default'
  return (
    <div className={cn('device-avatar', `avatar-${variant}`)} style={{ width: size, height: size }}>
      <OsGlyph platform={platform} os={os} size={Math.round(size * 0.42)} />
      {live ? <span className="avatar-live" /> : null}
    </div>
  )
}

/* ------------------------------ Popover ------------------------------- */

export function Popover({
  open,
  onClose,
  children,
  align = 'center'
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  align?: 'start' | 'center' | 'end'
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className={cn('popover', `popover-${align}`)} ref={ref}>
      {children}
    </div>
  )
}

export function Chevron({ open }: { open?: boolean }) {
  return <ChevronDown size={14} className={cn('chevron', open && 'is-open')} />
}
