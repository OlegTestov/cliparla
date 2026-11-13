import type { FC } from 'react'

interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

interface SelectionBoxProps {
  selection: SelectionRect
}

/**
 * Selection rectangle with dimension label and corner handles.
 * Uses boxShadow trick to create "cutout" effect.
 */
const SelectionBox: FC<SelectionBoxProps> = ({ selection }) => {
  const { x, y, width, height } = selection

  return (
    <div
      className="absolute border-2 border-blue-500 pointer-events-none"
      style={{
        left: x,
        top: y,
        width,
        height,
        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)'
      }}
    >
      {/* Dimension label */}
      <div className="absolute -top-7 left-0 bg-blue-500 text-white text-xs px-2 py-1 rounded font-mono whitespace-nowrap">
        {width} × {height}
      </div>

      {/* Corner handles */}
      <div className="absolute -top-1 -left-1 w-2 h-2 bg-blue-500 rounded-full" />
      <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full" />
      <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-blue-500 rounded-full" />
      <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-blue-500 rounded-full" />
    </div>
  )
}

export default SelectionBox
