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
    <div className="flex items-center gap-2 py-1.5">
      {/* Key - readonly */}
      <Input
        value={variable.key}
        readOnly
        className="w-48 font-mono text-sm bg-muted/50"
      />

      {/* Value - masked by default */}
      <div className="flex-1 relative">
        <Input
          type={isValueVisible ? 'text' : 'password'}
          value={variable.value}
          readOnly
          className="font-mono text-sm pr-10 bg-muted/50"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
          onClick={() => setIsValueVisible(!isValueVisible)}
        >
          {isValueVisible ? (
            <EyeOff className="size-3.5" />
          ) : (
            <Eye className="size-3.5" />
          )}
        </Button>
      </div>

      {/* Copy buttons */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon-sm" onClick={handleCopyKey}>
            <Copy className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy key</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon-sm" onClick={handleCopyValue}>
            <ClipboardCopy className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy value</TooltipContent>
      </Tooltip>
    </div>
  );
}
