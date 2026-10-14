/**
 * gallery.js —— 图提取 ImageGrab 预览与下载页面
 * 职责：
 *   1. 从 storage 读取 content script 提取的图片列表
 *   2. 网格化展示缩略图 + 尺寸 + 复选框
 *   3. 全选 / 反选 / 已选数量 / 下载选中
 *   4. 通过 background 转 PNG 并调用 chrome.downloads 保存
 */
(() => {
  'use strict';

  const state = {
    images: [],
    selected: new Set()
  };

  const $ = (sel) => document.querySelector(sel);
  const grid = $('#grid');
  const emptyEl = $('#empty');
  const statEl = $('#stat');
  const downloadBtn = $('#download');
  const selectAllBtn = $('#selectAll');
  const invertBtn = $('#invert');
  const progressEl = $('#progress');
  const progressFill = $('#progressFill');
  const progressText = $('#progressText');
  const toastEl = $('#toast');

  /* ---------------- 初始化 ---------------- */
  async function init() {
    const data = await chrome.storage.local.get('currentImages');
    state.images = Array.isArray(data.currentImages) ? data.currentImages : [];
    render();
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    grid.innerHTML = '';
    state.selected.clear();

    if (!state.images.length) {
      grid.classList.add('hidden');
      emptyEl.classList.remove('hidden');
      updateStats();
      return;
    }

    emptyEl.classList.add('hidden');
    grid.classList.remove('hidden');
    state.images.forEach((img, index) => grid.appendChild(createCard(img, index)));
    updateStats();
  }

  function createCard(img, index) {
    const card = document.createElement('div');
    card.className = 'card';

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'check';
    check.dataset.index = index;
    check.addEventListener('change', () => {
      if (check.checked) state.selected.add(index);
      else state.selected.delete(index);
      card.classList.toggle('checked', check.checked);
      updateStats();
    });

    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.loading = 'lazy';
    thumb.alt = '商品图片 ' + (index + 1);
    thumb.src = img.url;
    thumb.addEventListener('click', () => {
      check.checked = !check.checked;
      check.dispatchEvent(new Event('change'));
    });

    const meta = document.createElement('div');
    meta.className = 'meta';

    const sizeEl = document.createElement('span');
    sizeEl.className = 'size';
    sizeEl.textContent = formatSize(img.width, img.height);

    const idxEl = document.createElement('span');
    idxEl.className = 'idx';
    idxEl.textContent = '#' + String(index + 1).padStart(3, '0');

    meta.appendChild(sizeEl);
    meta.appendChild(idxEl);

    // 尺寸未知时，图片加载完成后更新尺寸
    if (!(img.width > 0 && img.height > 0)) {
      thumb.addEventListener('load', () => {
        sizeEl.textContent = formatSize(thumb.naturalWidth, thumb.naturalHeight);
      });
    }

    card.appendChild(check);
    card.appendChild(thumb);
    card.appendChild(meta);
    return card;
  }

  function formatSize(w, h) {
    if (w > 0 && h > 0) return w + ' × ' + h;
    return '尺寸未知';
  }

  function updateStats() {
    statEl.textContent = '已选 ' + state.selected.size + ' / ' + state.images.length + ' 张';
    downloadBtn.disabled = state.selected.size === 0;
  }

  /* ---------------- 选择操作 ---------------- */
  selectAllBtn.addEventListener('click', () => {
    document.querySelectorAll('.check').forEach((c) => {
      if (!c.checked) {
        c.checked = true;
        c.dispatchEvent(new Event('change'));
      }
    });
  });

  invertBtn.addEventListener('click', () => {
    document.querySelectorAll('.check').forEach((c) => {
      c.checked = !c.checked;
      c.dispatchEvent(new Event('change'));
    });
  });

  /* ---------------- 下载 ---------------- */
  downloadBtn.addEventListener('click', downloadSelected);

  async function downloadSelected() {
    const indices = [...state.selected].sort((a, b) => a - b);
    if (!indices.length) return;

    downloadBtn.disabled = true;
    progressEl.classList.remove('hidden');
    let success = 0;
    let failed = 0;
    let fallback = 0;

    for (let i = 0; i < indices.length; i++) {
      const img = state.images[indices[i]];
      updateProgress(i, indices.length, '正在下载');
      const seq = String(i + 1).padStart(3, '0');
      const result = await downloadOne(img.url, seq);
      if (result === 'ok') success++;
      else if (result === 'fallback') { success++; fallback++; }
      else failed++;
    }

    updateProgress(indices.length, indices.length, '完成');
    progressEl.classList.add('hidden');
    downloadBtn.disabled = state.selected.size === 0;
    showToast(
      '下载完成：成功 ' + success + ' 张' +
      (failed ? '，失败 ' + failed + ' 张' : '') +
      (fallback ? '（' + fallback + ' 张因跨域保留原格式）' : '')
    );
  }

  // 下载单张：优先转 PNG，失败则回退直接下载原图
  async function downloadOne(url, seq) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'DOWNLOAD_IMAGE', url });
      if (res && res.ok && res.png) {
        const blob = new Blob([res.png], { type: 'image/png' });
        const blobUrl = URL.createObjectURL(blob);
        await doDownload({ url: blobUrl, filename: '商品图_' + seq + '.png', saveAs: false });
        URL.revokeObjectURL(blobUrl);
        return 'ok';
      }
    } catch (e) {
      // 转换失败，走下方回退逻辑
    }

    try {
      await doDownload({ url, filename: '商品图_' + seq + guessExt(url), saveAs: false });
      return 'fallback';
    } catch (e2) {
      return 'fail';
    }
  }

  // 用回调形式包装下载 API，兼容不同版本
  function doDownload(opts) {
    return new Promise((resolve, reject) => {
      chrome.downloads.download(opts, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      });
    });
  }

  function guessExt(url) {
    try {
      const path = new URL(url).pathname.toLowerCase();
      const m = path.match(/\.(jpe?g|png|webp|gif|bmp|avif)$/);
      if (m) return '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
    } catch (e) { /* ignore */ }
    return '.jpg';
  }

  function updateProgress(done, total, label) {
    progressFill.style.width = (total ? (done / total) * 100 : 0) + '%';
    progressText.textContent = label + ' ' + done + ' / ' + total;
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
  }

  init();
})();
