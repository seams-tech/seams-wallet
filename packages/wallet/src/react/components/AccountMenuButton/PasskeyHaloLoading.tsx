import TouchIcon from './icons/TouchIcon';
import { HaloBorder } from './HaloBorder';
import { useTheme } from '../theme';

interface PasskeyHaloLoadingProps {
  style?: React.CSSProperties;
  className?: string;
  height?: number;
  width?: number;
  innerPadding?: number;
}

export const PasskeyHaloLoading: React.FC<PasskeyHaloLoadingProps> = ({
  style = {},
  className = '',
  height = 24,
  width = 24,
  innerPadding = 5,
}) => {
  const { theme } = useTheme();
  return (
    <div className={`seams-passkey-loading-root ${theme} ${className}`} style={style}>
      <HaloBorder
        theme={theme}
        animated={true}
        ringGap={4}
        ringWidth={4}
        ringBorderRadius="1.5rem"
        innerPadding={`${innerPadding}px`}
        innerBackground="var(--seams-colors-surface)"
        ringBackground={
          theme === 'dark'
            ? `transparent 0%, var(--seams-colors-green400) 10%, var(--seams-colors-green500) 25%, transparent 35%`
            : `transparent 0%, var(--seams-colors-blue400) 10%, var(--seams-colors-blue500) 25%, transparent 35%`
        }
      >
        <div
          className="seams-passkey-loading-touch-icon-container"
          style={{
            display: 'grid',
            placeItems: 'center',
            backgroundColor: 'var(--seams-colors-colorBackground)',
            borderRadius: '1.25rem',
            width: 'fit-content',
            height: 'fit-content',
          }}
        >
          <TouchIcon
            height={height}
            width={width}
            strokeWidth={4}
            style={{
              color: 'var(--seams-colors-textSecondary)',
              margin: '0.75rem',
            }}
          />
        </div>
      </HaloBorder>
    </div>
  );
};

export default PasskeyHaloLoading;
