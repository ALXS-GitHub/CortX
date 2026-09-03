import { LayoutGrid, List, Rows3 } from 'lucide-react';
import { Segmented } from '@/components/ui/Segmented';
import type { ListViewMode } from '@/types';

const OPTIONS = [
  { value: 'card' as const, icon: LayoutGrid, title: 'Card view' },
  { value: 'list' as const, icon: List, title: 'List view' },
  { value: 'compact' as const, icon: Rows3, title: 'Compact view' },
];

interface ViewModeToggleProps {
  value: ListViewMode;
  onChange: (value: ListViewMode) => void;
}

/** Card / list / compact switcher shared by every list screen. */
export function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  return <Segmented<ListViewMode> value={value} onChange={onChange} options={OPTIONS} size="sm" />;
}
