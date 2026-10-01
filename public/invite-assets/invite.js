'use strict';
window.addEventListener('hashchange', () => location.reload());
const code = new URLSearchParams(location.hash.slice(1)).get('code') || '';
const valid = /^[A-Fa-f0-9]{32}$/.test(code);
const field = document.getElementById('code');
const status = document.getElementById('status');
const copy = document.getElementById('copy');
field.value = valid ? code.toUpperCase() : '';
copy.disabled = !valid;
if (valid) {
  const open = document.getElementById('open');
  open.href = `heros://invite?code=${encodeURIComponent(field.value)}`;
  open.hidden = false;
}
copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(field.value);
    status.textContent = 'Đã sao chép mã lời mời.';
  } catch {
    field.focus();
    field.select();
    status.textContent = 'Hãy sao chép mã đang được chọn.';
  }
});
fetch('/v1/app-config')
  .then((res) => {
    if (!res.ok) throw new Error('Config unavailable');
    return res.json();
  })
  .then(({ data }) => {
    let count = 0;
    for (const [id, value] of [
      ['ios', data.iosDownloadUrl],
      ['android', data.androidDownloadUrl],
    ]) {
      if (!value) continue;
      const url = new URL(value);
      if (url.protocol !== 'https:') continue;
      const link = document.getElementById(id);
      link.href = url.href;
      link.rel = 'noopener noreferrer';
      link.hidden = false;
      count++;
    }
    status.textContent = !valid
      ? 'Link thiếu mã hợp lệ. Hãy xin người thân gửi lại lời mời.'
      : count
        ? 'Sau khi cài đặt, mở lại lời mời hoặc nhập mã trong HEROS.'
        : 'Bản cài đặt chưa được công bố. Hãy liên hệ người mời để nhận bản thử nghiệm.';
  })
  .catch(() => {
    status.textContent =
      'Chưa tải được thông tin cài đặt. Vui lòng thử lại sau.';
  });
