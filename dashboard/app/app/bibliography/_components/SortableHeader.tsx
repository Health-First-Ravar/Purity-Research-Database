'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

type Props = {
  col: string;
  label: string;
  currentCol: string;
  currentDir: 'asc' | 'desc';
};

export function SortableHeader({ col, label, currentCol, currentDir }: Props) {
  const router = useRouter();
  const sp = useSearchParams();

  const handleClick = useCallback(() => {
    const params = new URLSearchParams(sp.toString());
    const nextDir = currentCol === col && currentDir === 'desc' ? 'asc' : 'desc';
    params.set('sort', `${col}:${nextDir}`);
    router.replace(`?${params.toString()}`);
  }, [router, sp, col, currentCol, currentDir]);

  const isActive = currentCol === col;
  const arrow = isActive ? (currentDir === 'asc' ? '↑' : '↓') : '·';

  return (
    <button
      type="button"
      onClick={handleClick}
      className={
        'flex items-center gap-1 text-left ' +
        (isActive
          ? 'font-semibold text-purity-bean dark:text-purity-paper'
          : 'text-purity-muted hover:text-purity-bean dark:text-purity-mist dark:hover:text-purity-paper')
      }
    >
      {label}
      <span aria-hidden="true" className="text-[10px]">{arrow}</span>
    </button>
  );
}
