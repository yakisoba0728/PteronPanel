'use client';

import { useToastCtx } from './toast-provider';

export function useToast() {
  return useToastCtx().push;
}
