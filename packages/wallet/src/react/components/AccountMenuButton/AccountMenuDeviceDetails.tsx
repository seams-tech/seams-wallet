import React from 'react';
import TouchIcon from './icons/TouchIcon';

/** Display data only. Removal and authentication remain owned by the caller. */
export function AccountMenuDeviceDetails({
  title,
  description,
  details,
  children,
  icon,
}: {
  title: string;
  description: string;
  details: readonly { label: string; value: string }[];
  children?: React.ReactNode;
  icon?: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <div className="seams-account-device-hero">
        <span className="seams-account-avatar">
          {icon ?? <TouchIcon width={30} height={30} strokeWidth={1.5} />}
        </span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <dl className="seams-account-inset">{details.map(renderDetail)}</dl>
      {children}
    </>
  );
}
function renderDetail(detail: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="seams-account-detail-row" key={detail.label}>
      <dt>{detail.label}</dt>
      <dd>{detail.value}</dd>
    </div>
  );
}
