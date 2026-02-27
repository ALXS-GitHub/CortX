import { useState, useRef, useEffect } from 'react';
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover';
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

  // Sync internal search with external value
  useEffect(() => {
    setSearch(value);
  }, [value]);

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
    <Popover open={open && filtered.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          ref={inputRef}
          id={id}
          value={search}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Small delay to allow click on option
            setTimeout(() => setOpen(false), 150);
          }}
          placeholder={placeholder}
          className={className}
          autoComplete="off"
        />
      </PopoverAnchor>
      <PopoverContent
        className="p-1 w-[var(--radix-popover-trigger-width)]"
        onOpenAutoFocus={(e) => e.preventDefault()}
        side="bottom"
        align="start"
        sideOffset={4}
      >
        <div className="max-h-[200px] overflow-y-auto">
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
      </PopoverContent>
    </Popover>
  );
}
