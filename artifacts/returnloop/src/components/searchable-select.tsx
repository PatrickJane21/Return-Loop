import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type SearchableSelectProps = {
  label: string;
  value: string;
  options: readonly string[];
  placeholder: string;
  searchPlaceholder: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function SearchableSelect({
  label,
  value,
  options,
  placeholder,
  searchPlaceholder,
  onChange,
  disabled = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          disabled={disabled}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-left text-sm outline-none focus-visible:border-[hsl(var(--secondary))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--secondary)/.2)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className={selected ? 'truncate' : 'truncate text-[hsl(var(--muted-foreground))]'}>
            {selected ?? placeholder}
          </span>
          <ChevronsUpDown size={15} className="shrink-0 text-[hsl(var(--muted-foreground))]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>No matching options.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  onSelect={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                >
                  <Check className={`shrink-0 ${value === option ? 'opacity-100' : 'opacity-0'}`} />
                  <span className="truncate">{option}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}