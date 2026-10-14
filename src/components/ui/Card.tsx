import React from 'react';
import { cn } from '../../lib/utils';

export const Card = ({ children, className }: any) => (
  <div className={cn('bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden', className)}>
    {children}
  </div>
);
