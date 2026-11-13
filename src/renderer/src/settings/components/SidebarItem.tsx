interface SidebarItemProps {
  icon: React.ReactNode
  label: string
  isActive: boolean
  onClick: () => void
  badge?: string
  accentColor?: string
  ariaCurrent?: 'page' | undefined
  ariaLabel?: string
}

export default function SidebarItem({
  icon,
  label,
  isActive,
  onClick,
  badge,
  accentColor,
  ariaCurrent,
  ariaLabel
}: SidebarItemProps) {
  return (
    <button
      onClick={onClick}
      aria-current={ariaCurrent}
      aria-label={ariaLabel}
      className={`
        sidebar-item w-full
        ${isActive ? 'sidebar-item-active' : ''}
      `}
    >
      <span className={`flex-shrink-0 ${isActive && accentColor ? accentColor : 'text-white/50'}`}>
        {icon}
      </span>
      <span className="flex-1 text-start text-sm font-medium">{label}</span>
      {badge && (
        <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-cyan-500/30 text-cyan-300 rounded">
          {badge}
        </span>
      )}
    </button>
  )
}
