import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { EnvVariable } from '@/types';
import { Eye, EyeOff, Copy, ClipboardCopy } from 'lucide-react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { toast } from 'sonner';

interface EnvVariableRowProps {
  variable: EnvVariable;
}

export function EnvVariableRow({ variable }: EnvVariableRowProps) {
  const [isValueVisible, setIsValueVisible] = useState(false);

  const handleCopyKey = async () => {
    try {
      await writeText(variable.key);
      toast.success('Key copied');
    } catch (error) {
      toast.error('Failed to copy key');
    }
  };

  const handleCopyValue = async () => {
    try {
      await writeText(variable.value);
      toast.success('Value copied');
    } catch (error) {
      toast.error('Failed to copy value');
    }
  };

  return (
    <div className="group/row grid grid-cols-[minmax(8rem,12rem)_1fr_auto] items-center gap-2">
      {/* Key - readonly */}
      <Input
        value={variable.key}
        readOnly
        aria-label="Variable name"
        className="h-8 bg-muted/40 font-mono text-[12px] font-medium shadow-none"
      />

      {/* Value - masked by default */}
      <div className="relative min-w-0">
        <Input
          type={isValueVisible ? 'text' : 'password'}
          value={variable.value}
          readOnly
          aria-label="Variable value"
          className="h-8 bg-muted/40 pr-9 font-mono text-[12px] shadow-none"
        />
        <Button
          variant="ghost"
          size="icon-xs"
          className="absolute right-1 top-1/2 -translate-y-1/2 text-faint hover:text-foreground"
          onClick={() => setIsValueVisible(!isValueVisible)}
          aria-label={isValueVisible ? 'Hide value' : 'Show value'}
        >
          {isValueVisible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </Button>
      </div>

      {/* Copy buttons */}
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={handleCopyKey} aria-label="Copy key" className="text-faint hover:text-foreground">
              <Copy className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy key</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={handleCopyValue} aria-label="Copy value" className="text-faint hover:text-foreground">
              <ClipboardCopy className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy value</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
