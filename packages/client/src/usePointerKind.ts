import { useEffect, useState } from 'react';

export type PointerKind = 'coarse' | 'fine';

function detect(): PointerKind {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine';
}

export function usePointerKind(): PointerKind {
  const [kind, setKind] = useState<PointerKind>(detect);

  useEffect(() => {
    const mql = matchMedia('(pointer: coarse)');
    const onChange = () => setKind(mql.matches ? 'coarse' : 'fine');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return kind;
}
