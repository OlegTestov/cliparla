/**
 * Where the indicator (pill or error card) sits: bottom centre of the display's work area,
 * so a Dock at the bottom, left or right never covers its buttons.
 */

export interface Area {
  x: number
  y: number
  width: number
  height: number
}

const BOTTOM_OFFSET = 50

export function bottomCenterPosition(
  size: readonly [number, number],
  workArea: Area
): { x: number; y: number } {
  const [width, height] = size
  const centred = Math.round(workArea.x + workArea.width / 2 - width / 2)
  const x = Math.max(workArea.x, Math.min(centred, workArea.x + workArea.width - width))
  const y = Math.max(workArea.y, Math.round(workArea.y + workArea.height - height - BOTTOM_OFFSET))
  return { x, y }
}
