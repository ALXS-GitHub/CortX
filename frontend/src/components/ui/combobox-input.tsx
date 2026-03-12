import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface ComboboxInputProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  id?: string;
  className?: string;
}

export function ComboboxInput({
  value,
  onChange,
  options,
  placeholder,
  id,
  className,
}: ComboboxInputProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync internal search with external value
  useEffect(() => {
    setSearch(value);
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = options.filter((opt) =>
    opt.toLowerCase().includes(search.toLowerCase())
  );

  const handleInputChange = (val: string) => {
    setSearch(val);
    onChange(val);
    if (!open) setOpen(true);
  };

  const handleSelect = (opt: string) => {
    onChange(opt);
    setSearch(opt);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        id={id}
        value={search}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 z-50 mt-1 w-full max-h-[200px] overflow-y-auto bg-popover border rounded-md shadow-md p-1"
        >
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none cursor-pointer',
                'hover:bg-accent hover:text-accent-foreground',
                value === opt && 'bg-accent/50'
              )}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent blur before click
                handleSelect(opt);
              }}
            >
              <Check
                className={cn(
                  'size-3.5 shrink-0',
                  value === opt ? 'opacity-100' : 'opacity-0'
                )}
              />
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
