export const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export interface Field { name: string; label: string; type?: string; value?: string | number | boolean; min?: number; max?: number; step?: number; options?: (string | [string, string])[]; help?: string }
export function fieldHtml(f: Field) {
  const attrs = `name="${escapeHtml(f.name)}" id="field-${escapeHtml(f.name)}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} step="${f.step ?? 1}"`;
  let input: string;
  if (f.options) input = `<select ${attrs}>${f.options.map(o => { const [v, label] = typeof o === 'string' ? [o, o] : o; return `<option value="${escapeHtml(v)}" ${String(f.value) === v ? 'selected' : ''}>${escapeHtml(label)}</option>`; }).join('')}</select>`;
  else if (f.type === 'textarea') input = `<textarea ${attrs} rows="5">${escapeHtml(f.value ?? '')}</textarea>`;
  else input = `<input ${attrs} type="${f.type ?? 'text'}" ${f.type === 'checkbox' ? f.value ? 'checked' : '' : `value="${escapeHtml(f.value ?? '')}"`}>`;
  return `<label class="field ${f.type === 'checkbox' ? 'check-field' : ''}" for="field-${escapeHtml(f.name)}"><span>${escapeHtml(f.label)}</span>${input}${f.help ? `<small>${escapeHtml(f.help)}</small>` : ''}</label>`;
}
export function openDialog(title: string, body: string, actions: { label: string; primary?: boolean; run?: (dialog: HTMLDialogElement) => void | Promise<void> }[] = [{ label: 'Close' }]) {
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `<form method="dialog"><header><h2>${escapeHtml(title)}</h2><button class="dialog-close" aria-label="Close">×</button></header><div class="dialog-body">${body}</div><p class="dialog-error" role="alert"></p><footer>${actions.map((a, i) => `<button type="button" data-action="${i}" class="${a.primary ? 'primary' : ''}">${escapeHtml(a.label)}</button>`).join('')}</footer></form>`;
  dialog.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => button.onclick = async () => {
    const action = actions[Number(button.dataset.action)]; button.disabled = true;
    try { await action.run?.(dialog); dialog.close(); } catch (error) { dialog.querySelector('.dialog-error')!.textContent = error instanceof Error ? error.message : String(error); } finally { button.disabled = false; }
  });
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
  return dialog;
}
export function formDialog(title: string, fields: Field[], submit: (values: Record<string, string>, dialog: HTMLDialogElement) => void | Promise<void>, label = 'OK') {
  return openDialog(title, fields.map(fieldHtml).join(''), [{ label: 'Cancel' }, { label, primary: true, run: async dialog => {
    const form = dialog.querySelector('form')!; if (!form.reportValidity()) throw new Error('Check the highlighted fields.');
    const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
    for (const f of fields) if (f.type === 'checkbox') values[f.name] = values[f.name] ? '1' : '0';
    await submit(values, dialog);
  } }]);
}
export function message(title: string, text: string) { return openDialog(title, `<p class="message">${escapeHtml(text)}</p>`); }
