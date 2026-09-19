import React from 'react';

export function LastUsedBadge({ active }: { active: boolean }): React.JSX.Element | null {
  if (!active) return null;
  return <span className="seams-auth-method-badge">Last used</span>;
}

export default LastUsedBadge;
