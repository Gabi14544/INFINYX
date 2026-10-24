import { Moon, Sun } from 'lucide-react';
import { useThemeStore } from '../stores/useThemeStore';

interface ThemeToggleProps {
  className?: string;
}

export default function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      className={`inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#0D111A] p-2 text-slate-700 dark:text-[#F8FAFC] shadow-sm transition hover:border-[#38BDF8]/50 hover:bg-slate-100 dark:hover:bg-[#111827] hover:text-[#0284C7] dark:hover:text-[#BAE6FD] ${className}`}
    >
      {isDark ? (
        <Sun className="h-4 w-4 text-[#38BDF8] transition-transform duration-200 hover:rotate-45" />
      ) : (
        <Moon className="h-4 w-4 text-[#0284C7] transition-transform duration-200 hover:-rotate-12" />
      )}
    </button>
  );
}
