import React from 'react';
import { useDrawInStrokeIcon, type IconProps } from './strokeIcon';

export const SunIcon: React.FC<IconProps> = (props) =>
  useDrawInStrokeIcon(props, 'sun', '#FACC15', (drawIn) => (
    <>
      <circle cx="12" cy="12" r="4" {...drawIn} />
      <path d="M12 2v2" {...drawIn} />
      <path d="M12 20v2" {...drawIn} />
      <path d="m4.93 4.93 1.41 1.41" {...drawIn} />
      <path d="m17.66 17.66 1.41 1.41" {...drawIn} />
      <path d="M2 12h2" {...drawIn} />
      <path d="M20 12h2" {...drawIn} />
      <path d="m6.34 17.66-1.41 1.41" {...drawIn} />
      <path d="m19.07 4.93-1.41 1.41" {...drawIn} />
    </>
  ));

export default SunIcon;
