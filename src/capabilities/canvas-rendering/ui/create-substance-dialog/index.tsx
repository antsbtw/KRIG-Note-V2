/**
 * CreateSubstanceDialog — Combine to Substance 命名对话框(Canvas.md §3.5)
 *
 * V1 直迁(src/plugins/graph/canvas/ui/dialogs/CreateSubstanceDialog.tsx:223 行),
 * V2 完全自包含,无外部依赖改动.
 *
 * 模态窗 + 居中 + ESC 取消 + Enter 提交
 * 字段:Name(必填)/ Category(默认 user)/ Description(可选)
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactElement, ReactNode } from 'react';

export interface CreateSubstanceFormResult {
  name: string;
  category: string;
  description: string;
}

export interface CreateSubstanceDialogProps {
  open: boolean;
  defaultName?: string;
  defaultCategory?: string;
  onCreate: (result: CreateSubstanceFormResult) => void;
  onCancel: () => void;
}

export function CreateSubstanceDialog(props: CreateSubstanceDialogProps): ReactElement | null {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(props.defaultName ?? '');
  const [category, setCategory] = useState(props.defaultCategory ?? 'user');
  const [description, setDescription] = useState('');

  // 打开时 reset + auto-focus 名字
  useEffect(() => {
    if (!props.open) return;
    setName(props.defaultName ?? '');
    setCategory(props.defaultCategory ?? 'user');
    setDescription('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [props.open, props.defaultName, props.defaultCategory]);

  // ESC 取消
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [props.open, props.onCancel, props]);

  if (!props.open) return null;

  const trimmedName = name.trim();
  const canCreate = trimmedName.length > 0;

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canCreate) return;
    props.onCreate({
      name: trimmedName,
      category: category.trim() || 'user',
      description: description.trim(),
    });
  };

  return (
    <div style={styles.backdrop} onMouseDown={props.onCancel}>
      <form
        style={styles.dialog}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div style={styles.title}>Create Substance</div>
        <div style={styles.body}>
          <Field label="Name *">
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Substance"
              style={styles.input}
            />
          </Field>
          <Field label="Category">
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="user"
              style={styles.input}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="(optional)"
              rows={2}
              style={{ ...styles.input, resize: 'vertical' }}
            />
          </Field>
        </div>
        <div style={styles.footer}>
          <button type="button" style={styles.btnCancel} onClick={props.onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            style={{ ...styles.btnCreate, ...(canCreate ? null : styles.btnDisabled) }}
            disabled={!canCreate}
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.4)',
    backdropFilter: 'blur(2px)',
    WebkitBackdropFilter: 'blur(2px)',
    zIndex: 1500,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialog: {
    width: 360,
    background: 'rgba(40, 40, 40, 0.98)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 10,
    boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)',
    color: 'var(--krig-text-primary)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
    padding: '12px 16px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    background: 'rgba(255, 255, 255, 0.04)',
  },
  body: { padding: 16, display: 'flex', flexDirection: 'column', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldLabel: { fontSize: 11, color: 'var(--krig-text-muted)' },
  input: {
    background: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 4,
    padding: '6px 8px',
    color: 'var(--krig-text-primary)',
    fontSize: 12,
    outline: 'none',
    boxSizing: 'border-box',
    width: '100%',
    fontFamily: 'inherit',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    padding: 12,
    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
  },
  btnCancel: {
    background: 'transparent',
    border: '1px solid var(--krig-border-input)',
    borderRadius: 4,
    color: 'var(--krig-text-primary)',
    fontSize: 12,
    height: 28,
    padding: '0 14px',
    cursor: 'pointer',
  },
  btnCreate: {
    background: 'var(--krig-accent-bg)',
    border: '1px solid var(--krig-accent-border)',
    borderRadius: 4,
    color: '#fff',
    fontSize: 12,
    height: 28,
    padding: '0 14px',
    cursor: 'pointer',
  },
  btnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
};
