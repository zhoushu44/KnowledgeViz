import { IconFolder } from './Icons';
import './EmptyCanvas.css';

interface Props {
  /** 主文案 */
  title?: string;
  /** 辅助说明 */
  hint?: string;
  /** 主按钮文案，不传则不渲染按钮 */
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * 画布通用空态。
 * 覆盖在画布容器（position: relative）之上，居中显示图标 + 文案 + 可选主按钮。
 */
export default function EmptyCanvas({ title = '暂无内容', hint, actionLabel, onAction }: Props) {
  return (
    <div className="empty-canvas">
      <div className="empty-canvas-icon">
        <IconFolder size={26} />
      </div>
      <div className="empty-canvas-title">{title}</div>
      {hint ? <div className="empty-canvas-hint">{hint}</div> : null}
      {actionLabel && onAction ? (
        <button type="button" className="empty-canvas-action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
