// リサイズ可能なドロワー。side で境界の位置を決める。
import { useCallback, useEffect, useRef, type ReactNode } from 'react'

interface Props {
  side: 'left' | 'right' | 'bottom'
  open: boolean
  size: number
  min: number
  max: number
  onResize: (size: number) => void
  onToggle: () => void
  children: ReactNode
}

export function Drawer({ side, open, size, min, max, onResize, onToggle, children }: Props) {
  const dragging = useRef<{ start: number; size: number } | null>(null)
  const horizontal = side !== 'bottom'

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = { start: horizontal ? e.clientX : e.clientY, size }
      document.body.classList.add(horizontal ? 'resizing-x' : 'resizing-y')
    },
    [horizontal, size]
  )

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragging.current
      if (!d) return
      const cur = horizontal ? e.clientX : e.clientY
      const delta = cur - d.start
      let next = d.size
      if (side === 'left') next = d.size + delta
      else if (side === 'right') next = d.size - delta
      else next = d.size - delta
      onResize(Math.max(min, Math.min(max, next)))
    }
    const up = () => {
      if (!dragging.current) return
      dragging.current = null
      document.body.classList.remove('resizing-x', 'resizing-y')
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [horizontal, side, min, max, onResize])

  const style = open ? (horizontal ? { width: size } : { height: size }) : horizontal ? { width: 0 } : { height: 0 }
  const arrow = side === 'left' ? (open ? '◂' : '▸') : side === 'right' ? (open ? '▸' : '◂') : open ? '▾' : '▴'

  return (
    <div className={`drawer drawer-${side} ${open ? 'open' : 'closed'}`} style={style}>
      <div className="drawer-content">{open && children}</div>
      <div className={`drawer-handle handle-${side}`} onMouseDown={open ? onMouseDown : undefined}>
        <button className="drawer-toggle" title={open ? '閉じる' : '開く'} onClick={onToggle} onMouseDown={(e) => e.stopPropagation()}>
          {arrow}
        </button>
      </div>
    </div>
  )
}
