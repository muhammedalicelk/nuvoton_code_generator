export function setOptions(selectEl, options, valueKey = 'value', labelKey = 'label') {
  selectEl.innerHTML = '';
  options.forEach((item, index) => {
    const opt = document.createElement('option');
    if (typeof item === 'object') {
      opt.value = item[valueKey];
      opt.textContent = item[labelKey];
    } else {
      opt.value = item;
      opt.textContent = item;
    }
    if (valueKey === 'index') {
      opt.value = index;
    }
    selectEl.appendChild(opt);
  });
}

export function showMessages(container, result) {
  container.innerHTML = '';
  result.errors.forEach((text) => {
    const div = document.createElement('div');
    div.className = 'message error';
    div.textContent = text;
    container.appendChild(div);
  });
  result.warnings.forEach((text) => {
    const div = document.createElement('div');
    div.className = 'message warn';
    div.textContent = text;
    container.appendChild(div);
  });
  result.messages.forEach((text) => {
    const div = document.createElement('div');
    div.className = 'message ok';
    div.textContent = text;
    container.appendChild(div);
  });
}

export function downloadFile(filename, content, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
